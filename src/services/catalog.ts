import { db } from '../database/db'
import type { Product, Bundle } from '../models/records'

export type Kind = 'product' | 'bundle'
export type Item = Product | Bundle
export type Draft = { name: string; price: string; stock: string; components: Record<string, string> }
export async function resizePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください')
  if (file.size > 30 * 1024 * 1024) throw new Error('画像は30MB以下にしてください')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像処理に失敗しました')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('画像変換に失敗しました')), 'image/jpeg', .85))
  } finally { URL.revokeObjectURL(url) }
}
export async function loadCatalog(eventId: string) {
  return db.transaction('r', [db.products, db.bundles, db.images, db.eventProducts], async () => ({
    products: (await db.products.where('eventId').equals(eventId).toArray()).sort((a,b)=>a.sortOrder-b.sortOrder),
    bundles: (await db.bundles.where('eventId').equals(eventId).toArray()).sort((a,b)=>a.sortOrder-b.sortOrder),
    images: await db.images.toArray(),
    links: await db.eventProducts.where('eventId').equals(eventId).toArray(),
  }))
}
async function assertEditable(eventId: string) {
  if (!await db.events.get(eventId)) throw new Error('イベントが見つかりません')
  if (await db.sales.where('eventId').equals(eventId).count() || (await db.movements.where('eventId').equals(eventId).toArray()).some(m=>m.reason!=='initial')) throw new Error('販売・在庫操作後の商品編集はできません')
}
const tables = () => [db.events,db.products,db.bundles,db.images,db.eventProducts,db.eventBundles,db.movements,db.sales]
export async function saveItem(eventId: string, kind: Kind, id: string | null, draft: Draft, photo: Blob | null | undefined) {
  const name = draft.name.trim(), price = Number(draft.price), stock = Number(draft.stock)
  if (!name || name.length>100) throw new Error('商品名を1～100文字で入力してください')
  if (!draft.price.trim() || !Number.isSafeInteger(price) || price<0 || price>99999999) throw new Error('価格を0～99,999,999円の整数で入力してください')
  if (kind==='product' && (!draft.stock.trim() || !Number.isSafeInteger(stock) || stock<0 || stock>999999)) throw new Error('初期在庫を0～999999の整数で入力してください')
  const components=Object.entries(draft.components).filter(([,v])=>v.trim()!=='' && Number(v)!==0).map(([productId,v])=>({productId,quantity:Number(v)}))
  if(kind==='bundle' && (!components.length || components.some(c=>!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>9999))) throw new Error('セット構成数量を確認してください')
  await db.transaction('rw',tables(),async()=>{
    await assertEditable(eventId)
    const table=kind==='product'?db.products:db.bundles
    const previous=id?await table.get(id):undefined
    if(id && previous?.eventId!==eventId) throw new Error('商品が見つかりません')
    if(kind==='bundle') for(const c of components) if((await db.products.get(c.productId))?.eventId!==eventId) throw new Error('構成商品が見つかりません')
    const itemId=id??crypto.randomUUID()
    let imageId=previous?.imageId
    if(photo!==undefined){
      if(imageId) await db.images.delete(imageId)
      imageId=photo?crypto.randomUUID():undefined
      if(photo&&imageId) await db.images.add({id:imageId,blob:photo})
    }
    const rows=await table.where('eventId').equals(eventId).toArray()
    const record:Product={id:itemId,eventId,name,price,sortOrder:previous?.sortOrder??(Math.max(-1,...rows.map(r=>r.sortOrder))+1),...(imageId?{imageId}:{})}
    if(kind==='product'){
      await db.products.put(record)
      await db.eventProducts.put({eventId,productId:itemId,initialStock:stock,stock,price})
      await db.movements.where('productId').equals(itemId).and(m=>m.eventId===eventId).delete()
      await db.movements.add({id:crypto.randomUUID(),eventId,productId:itemId,delta:stock,reason:'initial',timestamp:new Date().toISOString()})
    }else{
      await db.bundles.put({...record,components})
      await db.eventBundles.put({eventId,bundleId:itemId,price})
    }
  })
}
export async function deleteItem(eventId:string,kind:Kind,id:string){
  await db.transaction('rw',tables(),async()=>{
    await assertEditable(eventId)
    const table=kind==='product'?db.products:db.bundles
    const item=await table.get(id)
    if(item?.eventId!==eventId) throw new Error('商品が見つかりません')
    if(kind==='product'){
      if((await db.bundles.where('eventId').equals(eventId).toArray()).some(b=>b.components.some(c=>c.productId===id))) throw new Error('セットで使用中の商品は削除できません')
      await db.eventProducts.delete([eventId,id])
      await db.movements.where('productId').equals(id).and(m=>m.eventId===eventId).delete()
    }else await db.eventBundles.delete([eventId,id])
    await table.delete(id)
    if(item.imageId) await db.images.delete(item.imageId)
  })
}
export async function moveItem(eventId:string,kind:Kind,id:string,delta:number){
  await db.transaction('rw',[db.products,db.bundles],async()=>{
    const table=kind==='product'?db.products:db.bundles
    const rows=(await table.where('eventId').equals(eventId).toArray()).sort((a,b)=>a.sortOrder-b.sortOrder)
    const i=rows.findIndex(r=>r.id===id),j=i+delta
    if(i<0||j<0||j>=rows.length)return
    ;[rows[i],rows[j]]=[rows[j],rows[i]]
    for(let k=0;k<rows.length;k++)await table.update(rows[k].id,{sortOrder:k})
  })
}
export type StockMode='zero'|'initial'|'remaining'
export async function copyCatalog(source:string,target:string,mode:StockMode){
  await db.transaction('rw',tables(),async()=>{
    await assertEditable(target)
    if(source===target)throw new Error('同じイベントにはコピーできません')
    if(source!==''&&!await db.events.get(source))throw new Error('コピー元が見つかりません')
    const originals=(source?await db.products.where('eventId').equals(source).toArray():(await db.products.toArray()).filter(p=>!p.eventId)).sort((a,b)=>a.sortOrder-b.sortOrder)
    const sets=(source?await db.bundles.where('eventId').equals(source).toArray():(await db.bundles.toArray()).filter(p=>!p.eventId)).sort((a,b)=>a.sortOrder-b.sortOrder)
    if(!originals.length&&!sets.length)throw new Error('コピーできる商品がありません')
    const ids=new Map<string,string>()
    const photo=async(id?:string)=>{const p=id?await db.images.get(id):undefined;if(!p)return undefined;const newId=crypto.randomUUID();await db.images.add({id:newId,blob:p.blob});return newId}
    let order=Math.max(-1,...(await db.products.where('eventId').equals(target).toArray()).map(p=>p.sortOrder))+1
    for(const p of originals){
      const id=crypto.randomUUID();ids.set(p.id,id)
      const old=source?await db.eventProducts.get([source,p.id]):undefined
      const stock=mode==='initial'?old?.initialStock??0:mode==='remaining'?old?.stock??0:0
      const price=old?.price??p.price
      await db.products.add({...p,id,eventId:target,price,sortOrder:order++,imageId:await photo(p.imageId)})
      await db.eventProducts.add({eventId:target,productId:id,initialStock:stock,stock,price})
      await db.movements.add({id:crypto.randomUUID(),eventId:target,productId:id,delta:stock,reason:'initial',timestamp:new Date().toISOString()})
    }
    order=Math.max(-1,...(await db.bundles.where('eventId').equals(target).toArray()).map(p=>p.sortOrder))+1
    for(const b of sets){
      const id=crypto.randomUUID()
      const components=b.components.map(c=>{const productId=ids.get(c.productId);if(!productId)throw new Error('セット構成商品をコピーできません');return {...c,productId}})
      const old=source?await db.eventBundles.get([source,b.id]):undefined
      const price=old?.price??b.price
      await db.bundles.add({...b,id,eventId:target,price,components,sortOrder:order++,imageId:await photo(b.imageId)})
      await db.eventBundles.add({eventId:target,bundleId:id,price})
    }
  })
}
