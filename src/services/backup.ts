import { db } from '../database/db'
import type { EventRecord, Product, Bundle, EventProduct, EventBundle, InventoryMovement, Sale, Setting, ProductImage } from '../models/records'

type Snapshot={events:EventRecord[];products:Product[];bundles:Bundle[];images:ProductImage[];eventProducts:EventProduct[];eventBundles:EventBundle[];movements:InventoryMovement[];sales:Sale[];settings:Setting[]}
export type Backup=Omit<Snapshot,'images'>&{images:{id:string;type:string;base64:string}[];format:'EventPOS';version:1;scope:'all'|'event';createdAt:string}
const tables=()=>[db.events,db.products,db.bundles,db.images,db.eventProducts,db.eventBundles,db.movements,db.sales,db.settings]
const fail=(message:string):never=>{throw new Error('バックアップ検証：'+message)}
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=200
const num=(x:unknown,min=0):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min
const date=(x:unknown):x is string=>typeof x==='string'&&Number.isFinite(Date.parse(x))
const name=(x:unknown)=>typeof x==='string'&&x.trim().length>0&&x.length<=100
function unique<T>(rows:T[],key:(r:T)=>string){const keys=new Set<string>();for(const r of rows){const k=key(r);if(keys.has(k))fail('重複ID');keys.add(k)}}
async function encode(blob:Blob){const a=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)}
function decode(i:Backup['images'][number]):ProductImage{const s=atob(i.base64);return {id:i.id,blob:new Blob([Uint8Array.from(s,c=>c.charCodeAt(0))],{type:i.type})}}
export async function exportBackup(eventId?:string):Promise<Backup>{
 const s=await db.transaction('r',tables(),async()=>({events:await db.events.toArray(),products:await db.products.toArray(),bundles:await db.bundles.toArray(),images:await db.images.toArray(),eventProducts:await db.eventProducts.toArray(),eventBundles:await db.eventBundles.toArray(),movements:await db.movements.toArray(),sales:await db.sales.toArray(),settings:await db.settings.toArray()}))
 if(eventId){
  s.events=s.events.filter(e=>e.id===eventId);if(!s.events.length)throw new Error('イベントが見つかりません')
  s.products=s.products.filter(p=>p.eventId===eventId);s.bundles=s.bundles.filter(b=>b.eventId===eventId)
  const ids=new Set([...s.products,...s.bundles].map(p=>p.imageId))
  s.images=s.images.filter(i=>ids.has(i.id))
  s.eventProducts=s.eventProducts.filter(p=>p.eventId===eventId);s.eventBundles=s.eventBundles.filter(p=>p.eventId===eventId)
  s.movements=s.movements.filter(m=>m.eventId===eventId);s.sales=s.sales.filter(r=>r.eventId===eventId);s.settings=[]
 }
 return {...s,format:'EventPOS',version:1,scope:eventId?'event':'all',createdAt:new Date().toISOString(),images:await Promise.all(s.images.map(async i=>({id:i.id,type:i.blob.type,base64:await encode(i.blob)})))}
}
export function validateBackup(input:unknown):Backup{
 if(!input||typeof input!=='object')return fail('ファイル形式が不正です')
 const b=input as Backup
 if(b.format!=='EventPOS'||b.version!==1||!['all','event'].includes(b.scope)||!date(b.createdAt))return fail('対応していない形式・バージョンです')
 for(const k of ['events','products','bundles','images','eventProducts','eventBundles','movements','sales','settings'] as const){
  if(!Array.isArray(b[k])||b[k].some(r=>!r||typeof r!=='object'||Array.isArray(r)))return fail(k+' の形式が不正です')
 }
 if(b.scope==='event'&&(b.events.length!==1||b.settings.length))fail('イベント単位の形式が不正です')
 for(const rows of [b.events,b.products,b.bundles,b.images,b.movements,b.sales]){for(const r of rows)if(!id(r.id))fail('IDが不正です');unique(rows as {id:string}[],r=>r.id)}
 unique(b.eventProducts,r=>JSON.stringify([r.eventId,r.productId]));unique(b.eventBundles,r=>JSON.stringify([r.eventId,r.bundleId]));unique(b.settings,r=>r.key)
 const events=new Map(b.events.map(e=>[e.id,e])), products=new Map(b.products.map(p=>[p.id,p])), bundles=new Map(b.bundles.map(p=>[p.id,p])), images=new Set(b.images.map(i=>i.id))
 const links=new Map(b.eventProducts.map(p=>[JSON.stringify([p.eventId,p.productId]),p]))
 const bundleLinks=new Map(b.eventBundles.map(p=>[JSON.stringify([p.eventId,p.bundleId]),p]))
 const sales=new Map(b.sales.map(s=>[s.id,s]))
 for(const e of b.events)if(!name(e.name)||!date(e.date)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||new Date(e.date).toISOString().slice(0,10)!==e.date||!num(e.openingCash))fail('イベント情報が不正です')
 for(const i of b.images){if(typeof i.type!=='string'||!/^image\/(jpeg|png|webp|gif|bmp|avif|x-icon|vnd.microsoft.icon)$/.test(i.type)||typeof i.base64!=='string'||!i.base64.length||i.base64.length>42000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(i.base64))fail('画像形式が不正です');try{atob(i.base64)}catch{fail('画像データが不正です')}}
 for(const p of [...b.products,...b.bundles])if(!name(p.name)||!num(p.price)||!num(p.sortOrder)|| (p.eventId!==undefined&&(!id(p.eventId)||!events.has(p.eventId)))||(b.scope==='event'&&!p.eventId)||(p.imageId!==undefined&&!images.has(p.imageId)))fail('商品情報・画像参照が不正です')
 const components=(c:unknown,eventId?:string)=>{
  if(!Array.isArray(c)||!c.length)fail('セット構成が不正です')
  const seen=new Set<string>()
  for(const x of c as {productId:string;quantity:number}[]){if(!x||!id(x.productId)||!num(x.quantity,1)||!products.has(x.productId)||products.get(x.productId)?.eventId!==eventId||seen.has(x.productId))fail('構成商品参照が不正です');seen.add(x.productId)}
 }
 for(const p of b.bundles)components(p.components,p.eventId)
 for(const p of b.eventProducts)if(!events.has(p.eventId)||products.get(p.productId)?.eventId!==p.eventId||!num(p.initialStock)||!num(p.stock)||!num(p.price))fail('在庫情報が不正です')
 for(const p of b.eventBundles)if(!events.has(p.eventId)||bundles.get(p.bundleId)?.eventId!==p.eventId||!num(p.price))fail('セット参照が不正です')
 for(const p of b.products)if(p.eventId&&!links.has(JSON.stringify([p.eventId,p.id])))fail('商品在庫がありません')
 for(const p of b.bundles)if(p.eventId&&!bundleLinks.has(JSON.stringify([p.eventId,p.id])))fail('セット価格がありません')
 for(const s of b.sales){
  if(!events.has(s.eventId)||!date(s.timestamp)||!num(s.total)||!num(s.cash)||!num(s.change)||s.cash-s.total!==s.change||!Array.isArray(s.lines)||!s.lines.length||(s.cancelledAt!==undefined&&!date(s.cancelledAt)))fail('会計情報が不正です')
  let total=0
  for(const l of s.lines){
   if(!l||!['product','bundle'].includes(l.kind)||!name(l.name)||!num(l.quantity,1)||!num(l.unitPrice)||(l.kind==='product'?products:bundles).get(l.itemId)?.eventId!==s.eventId)fail('会計明細が不正です')
   components(l.components,s.eventId);total+=l.quantity*l.unitPrice
  }
  if(total!==s.total||!Number.isSafeInteger(total))fail('会計金額が一致しません')
 }
 const sums=new Map<string,number>(),initial=new Map<string,number>(),actual=new Map<string,number>()
 for(const m of b.movements){
  const k=JSON.stringify([m.eventId,m.productId])
  if(!links.has(k)||!date(m.timestamp)||!num(m.delta,Number.MIN_SAFE_INTEGER)||!['initial','addition','sale','cancel'].includes(m.reason))fail('在庫履歴が不正です')
  if(m.reason==='initial'||m.reason==='addition'){if(m.delta<(m.reason==='initial'?0:1)||m.transactionId!==undefined)fail('在庫増加履歴が不正です');if(m.reason==='initial')initial.set(k,(initial.get(k)??0)+m.delta)}
  else{const sale=sales.get(m.transactionId??'');if(!sale||sale.eventId!==m.eventId||(m.reason==='sale'?m.delta>=0:m.delta<=0||!sale.cancelledAt))fail('会計と在庫履歴が一致しません');const mk=JSON.stringify([m.transactionId,m.productId,m.reason]);actual.set(mk,(actual.get(mk)??0)+m.delta)}
  sums.set(k,(sums.get(k)??0)+m.delta)
 }
 for(const [k,p] of links)if((sums.get(k)??0)!==p.stock||(initial.get(k)??0)!==p.initialStock)fail('在庫数量と履歴が一致しません')
 const expected=new Map<string,number>()
 for(const s of b.sales)for(const l of s.lines)for(const c of l.components){const n=l.quantity*c.quantity;for(const reason of s.cancelledAt?['sale','cancel']:['sale']){const k=JSON.stringify([s.id,c.productId,reason]);expected.set(k,(expected.get(k)??0)+(reason==='sale'?-n:n))}}
 if(expected.size!==actual.size||[...expected].some(([k,n])=>actual.get(k)!==n))fail('販売数量と在庫履歴が一致しません')
 for(const s of b.settings)if(!id(s.key)||typeof s.value!=='string'||(s.key==='activeEvent'&&s.value!==''&&!events.has(s.value)))fail('設定情報が不正です')
 return b
}
export async function readBackup(file:File){if(file.size>100*1024*1024)throw new Error('ファイルは100MB以下にしてください');return validateBackup(JSON.parse(await file.text()))}
export async function restoreBackup(input:Backup,mode:'overwrite'|'copy'){
 const b=validateBackup(input)
 const images=b.images.map(decode)
 await db.transaction('rw',tables(),async()=>{
  if(mode==='copy'){
   // New IDs for every record, including transaction references and photos.
   const em=new Map(b.events.map(e=>[e.id,crypto.randomUUID()])),pm=new Map(b.products.map(p=>[p.id,crypto.randomUUID()])),bm=new Map(b.bundles.map(p=>[p.id,crypto.randomUUID()])),im=new Map(images.map(i=>[i.id,crypto.randomUUID()])),sm=new Map(b.sales.map(s=>[s.id,crypto.randomUUID()]))
   const comp=(c:Bundle['components'])=>c.map(x=>({...x,productId:pm.get(x.productId)!}))
   await db.events.bulkAdd(b.events.map(e=>({...e,id:em.get(e.id)!,name:e.name.slice(0,94)+'（復元）'})))
   await db.images.bulkAdd(images.map(i=>({...i,id:im.get(i.id)!})))
   await db.products.bulkAdd(b.products.map(p=>({...p,id:pm.get(p.id)!,eventId:p.eventId?em.get(p.eventId):undefined,imageId:p.imageId?im.get(p.imageId):undefined})))
   await db.bundles.bulkAdd(b.bundles.map(p=>({...p,id:bm.get(p.id)!,eventId:p.eventId?em.get(p.eventId):undefined,imageId:p.imageId?im.get(p.imageId):undefined,components:comp(p.components)})))
   await db.eventProducts.bulkAdd(b.eventProducts.map(p=>({...p,eventId:em.get(p.eventId)!,productId:pm.get(p.productId)!})))
   await db.eventBundles.bulkAdd(b.eventBundles.map(p=>({...p,eventId:em.get(p.eventId)!,bundleId:bm.get(p.bundleId)!})))
   await db.sales.bulkAdd(b.sales.map(s=>({...s,id:sm.get(s.id)!,eventId:em.get(s.eventId)!,lines:s.lines.map(l=>({...l,itemId:(l.kind==='product'?pm:bm).get(l.itemId)!,components:comp(l.components)}))})))
   await db.movements.bulkAdd(b.movements.map(m=>({...m,id:crypto.randomUUID(),eventId:em.get(m.eventId)!,productId:pm.get(m.productId)!,transactionId:m.transactionId?sm.get(m.transactionId):undefined})))
   if(b.events.length&&!(await db.settings.get('activeEvent'))?.value)await db.settings.put({key:'activeEvent',value:em.get(b.events[0].id)!})
   return
  }
  if(b.scope==='all'){
   // Full restore deliberately replaces the entire local snapshot.
   for(const t of tables())await t.clear()
  }else{
   const eventId=b.events[0].id
   const old=[...await db.products.where('eventId').equals(eventId).toArray(),...await db.bundles.where('eventId').equals(eventId).toArray()]
   await db.products.where('eventId').equals(eventId).delete();await db.bundles.where('eventId').equals(eventId).delete()
   await db.eventProducts.where('eventId').equals(eventId).delete();await db.eventBundles.where('eventId').equals(eventId).delete()
   await db.sales.where('eventId').equals(eventId).delete();await db.movements.where('eventId').equals(eventId).delete();await db.events.delete(eventId)
   const remaining=new Set([...await db.products.toArray(),...await db.bundles.toArray()].map(p=>p.imageId))
   for(const p of old)if(p.imageId&&!remaining.has(p.imageId))await db.images.delete(p.imageId)
  }
  // add, rather than put, prevents accidental overwrite of unrelated records on ID collision.
  await db.events.bulkAdd(b.events);await db.products.bulkAdd(b.products);await db.bundles.bulkAdd(b.bundles);await db.images.bulkAdd(images)
  await db.eventProducts.bulkAdd(b.eventProducts);await db.eventBundles.bulkAdd(b.eventBundles);await db.sales.bulkAdd(b.sales);await db.movements.bulkAdd(b.movements)
  if(b.scope==='all')await db.settings.bulkAdd(b.settings)
  if(b.events.length&&!(await db.settings.get('activeEvent'))?.value)await db.settings.put({key:'activeEvent',value:b.events[0].id})
 })
}
