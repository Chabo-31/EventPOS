import { db } from '../database/db'
import type { Sale } from '../models/records'

export async function loadInventory(eventId: string) {
  return db.transaction('r', [db.events, db.products, db.eventProducts, db.sales, db.movements], async () => ({
    event: await db.events.get(eventId),
    products: await db.products.where('eventId').equals(eventId).toArray(),
    links: await db.eventProducts.where('eventId').equals(eventId).toArray(),
    sales: (await db.sales.where('eventId').equals(eventId).toArray()).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),
    movements: (await db.movements.where('eventId').equals(eventId).toArray()).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),
  }))
}

export async function addStock(eventId:string, productId:string, quantity:number, requestId:string) {
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>999999) throw new Error('追加数量を1～999999の整数で入力してください')
  await db.transaction('rw',[db.events,db.products,db.eventProducts,db.movements],async()=>{
    const existing=await db.movements.get(requestId)
    if(existing){
      if(existing.eventId!==eventId||existing.productId!==productId||existing.delta!==quantity||existing.reason!=='addition')throw new Error('在庫操作IDが重複しています')
      return
    }
    const p=await db.products.get(productId)
    const link=await db.eventProducts.get([eventId,productId])
    if(!await db.events.get(eventId)||p?.eventId!==eventId||!link)throw new Error('商品が見つかりません')
    const next=link.stock+quantity
    if(!Number.isSafeInteger(link.stock)||link.stock<0||!Number.isSafeInteger(next)||next>999999)throw new Error('在庫上限を超えています')
    await db.eventProducts.update([eventId,productId],{stock:next})
    await db.movements.add({id:requestId,eventId,productId,delta:quantity,reason:'addition',timestamp:new Date().toISOString()})
  })
}

export async function cancelSale(eventId:string,saleId:string){
  await db.transaction('rw',[db.events,db.products,db.eventProducts,db.sales,db.movements],async()=>{
    const sale=await db.sales.get(saleId)
    if(!await db.events.get(eventId)||!sale||sale.eventId!==eventId)throw new Error('会計履歴が見つかりません')
    if(sale.cancelledAt)throw new Error('すでに取消済みです')
    const used=new Map<string,number>()
    for(const l of sale.lines){
      if(!Number.isSafeInteger(l.quantity)||l.quantity<1||!l.components.length)throw new Error('会計明細が不正です')
      for(const c of l.components){
        const n=(used.get(c.productId)??0)+l.quantity*c.quantity
        if(!Number.isSafeInteger(c.quantity)||c.quantity<1||!Number.isSafeInteger(n))throw new Error('構成数量が不正です')
        used.set(c.productId,n)
      }
    }
    const timestamp=new Date().toISOString()
    for(const [productId,n] of used){
      const p=await db.products.get(productId)
      const link=await db.eventProducts.get([eventId,productId])
      if(p?.eventId!==eventId||!link||!Number.isSafeInteger(link.stock)||link.stock<0||!Number.isSafeInteger(link.stock+n))throw new Error('在庫の復元に失敗しました')
      await db.eventProducts.update([eventId,productId],{stock:link.stock+n})
      await db.movements.add({id:crypto.randomUUID(),eventId,productId,delta:n,reason:'cancel',timestamp,transactionId:saleId})
    }
    await db.sales.update(saleId,{cancelledAt:timestamp})
  })
}

export function summarizeSales(sales:Sale[]){
  const active=sales.filter(s=>!s.cancelledAt)
  const items=new Map<string,{key:string;name:string;kind:'product'|'bundle';quantity:number;total:number}>()
  const consumed=new Map<string,number>()
  for(const s of active)for(const l of s.lines){
    const key=l.kind+':'+l.itemId
    const row=items.get(key)??{key,name:l.name,kind:l.kind,quantity:0,total:0}
    row.quantity+=l.quantity;row.total+=l.unitPrice*l.quantity;items.set(key,row)
    for(const c of l.components)consumed.set(c.productId,(consumed.get(c.productId)??0)+l.quantity*c.quantity)
  }
  return {total:active.reduce((n,s)=>n+s.total,0),count:active.length,cancelled:sales.length-active.length,items:[...items.values()],consumed}
}
