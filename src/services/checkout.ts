import { db } from '../database/db'
import type { Product, Bundle, Sale, SaleLine } from '../models/records'

export async function completeSale(eventId:string, requestId:string, lines:SaleLine[], cash:number, expectedTotal:number):Promise<Sale>{
  if(!lines.length || !Number.isSafeInteger(cash) || cash<0) throw new Error('会計内容を確認してください')
  return db.transaction('rw',[db.events,db.products,db.bundles,db.eventProducts,db.eventBundles,db.movements,db.sales,db.settings],async()=>{
    const existing=await db.sales.get(requestId)
    if(existing){
      if(existing.eventId!==eventId || existing.cash!==cash || existing.total!==expectedTotal || JSON.stringify(existing.lines)!==JSON.stringify(lines)) throw new Error('会計IDが重複しています')
      return existing
    }
    if(!await db.events.get(eventId) || (await db.settings.get('activeEvent'))?.value!==eventId) throw new Error('販売対象イベントが変更されました')
    const used=new Map<string,number>()
    const keys=new Set<string>()
    const verified:SaleLine[]=[]
    let total=0
    for(const line of lines){
      const key=line.kind+':'+line.itemId
      if(keys.has(key)||!Number.isSafeInteger(line.quantity)||line.quantity<1)throw new Error('販売数量が不正です')
      keys.add(key)
      const item:Product|Bundle|undefined=line.kind==='product'?await db.products.get(line.itemId):await db.bundles.get(line.itemId)
      const link=line.kind==='product'?await db.eventProducts.get([eventId,line.itemId]):await db.eventBundles.get([eventId,line.itemId])
      if(!item||item.eventId!==eventId||!link)throw new Error('商品情報が変更されました')
      const components='components' in item?item.components:[{productId:item.id,quantity:1}]
      if(item.name!==line.name||link.price!==line.unitPrice||JSON.stringify(components)!==JSON.stringify(line.components))throw new Error('商品情報が変更されました。会計を確認してください')
      if(!Number.isSafeInteger(link.price)||link.price<0||!components.length)throw new Error('商品設定が不正です')
      for(const c of components){
        const n=(used.get(c.productId)??0)+c.quantity*line.quantity
        if(!Number.isSafeInteger(c.quantity)||c.quantity<1||!Number.isSafeInteger(n))throw new Error('セット構成数量が不正です')
        used.set(c.productId,n)
      }
      total+=link.price*line.quantity
      verified.push({itemId:line.itemId,kind:line.kind,name:item.name,unitPrice:link.price,quantity:line.quantity,components})
    }
    if(!Number.isSafeInteger(total)||total!==expectedTotal||cash<total)throw new Error('合計金額または預かり金額を確認してください')
    const timestamp=new Date().toISOString()
    for(const [id,n] of used){
      const stock=await db.eventProducts.get([eventId,id])
      const p=await db.products.get(id)
      if(!stock||p?.eventId!==eventId||!Number.isSafeInteger(stock.stock)||stock.stock<n)throw new Error('在庫不足：'+(p?.name??id))
      await db.eventProducts.update([eventId,id],{stock:stock.stock-n})
      await db.movements.add({id:crypto.randomUUID(),eventId,productId:id,delta:-n,reason:'sale',timestamp,transactionId:requestId})
    }
    const sale:Sale={id:requestId,eventId,timestamp,lines:verified,total,cash,change:cash-total}
    await db.sales.add(sale)
    return sale
  })
}
