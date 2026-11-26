import Dexie from 'dexie'
import { db } from '../database/db'
import { exportBackup, validateBackup } from './backup'
import type { Backup } from './backup'

const tables=()=>[db.events,db.products,db.bundles,db.images,db.eventProducts,db.eventBundles,db.movements,db.sales,db.settings]
function canon(x:unknown):string{
 if(Array.isArray(x))return '['+x.map(canon).join(',')+']'
 if(x&&typeof x==='object'){const r=x as Record<string,unknown>;return '{'+Object.keys(r).filter(k=>r[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(r[k])).join(',')+'}'}
 return JSON.stringify(x)??'null'
}
const ordered=(rows:unknown[])=>rows.map(canon).sort()
const subset=(a:string[],b:string[])=>{const counts=new Map<string,number>();for(const x of b)counts.set(x,(counts.get(x)??0)+1);for(const x of a){const n=counts.get(x)??0;if(!n)return false;counts.set(x,n-1)}return true}
const signature=(b:Backup)=>{const {createdAt,...data}=b;void createdAt;return canon(data)}
function normalize(b:Backup){
 const p=b.products,bundles=b.bundles
 const key=(id:string)=>p.find(x=>x.id===id)?.name??'不明'
 const item=(kind:string,id:string)=>kind==='product'?key(id):bundles.find(x=>x.id===id)?.name??'不明'
 const photo=(id?:string)=>{const i=b.images.find(x=>x.id===id);return i?{type:i.type,base64:i.base64}:null}
 const components=(c:{productId:string;quantity:number}[])=>ordered(c.map(x=>({name:key(x.productId),quantity:x.quantity})))
 const catalog=ordered([...p.map(x=>({kind:'product',name:x.name,price:x.price,sortOrder:x.sortOrder,photo:photo(x.imageId),initialStock:b.eventProducts.find(l=>l.productId===x.id)?.initialStock,linkPrice:b.eventProducts.find(l=>l.productId===x.id)?.price})),...bundles.map(x=>({kind:'bundle',name:x.name,price:x.price,sortOrder:x.sortOrder,photo:photo(x.imageId),components:components(x.components),linkPrice:b.eventBundles.find(l=>l.bundleId===x.id)?.price}))])
 const saleKey=(s:Backup['sales'][number])=>canon({timestamp:s.timestamp,total:s.total,cash:s.cash,change:s.change,lines:ordered(s.lines.map(l=>({kind:l.kind,name:l.name,item:item(l.kind,l.itemId),unitPrice:l.unitPrice,quantity:l.quantity,components:components(l.components)})))})
 const sales=ordered(b.sales.map(s=>({sale:saleKey(s),cancelledAt:s.cancelledAt??null})))
 const movements=ordered(b.movements.filter(m=>m.reason!=='initial').map(m=>({product:key(m.productId),delta:m.delta,reason:m.reason,timestamp:m.timestamp,transaction:m.transactionId?saleKey(b.sales.find(s=>s.id===m.transactionId)!):null})))
 const stock=ordered(b.eventProducts.map(l=>({name:key(l.productId),stock:l.stock})))
 const ambiguous=new Set(p.map(x=>x.name)).size!==p.length||new Set(bundles.map(x=>x.name)).size!==bundles.length||new Set(b.sales.map(saleKey)).size!==b.sales.length
 return {catalog,sales,movements,stock,ambiguous,empty:!p.length&&!bundles.length&&!b.sales.length&&!b.movements.length}
}
export type EventRemoval={id:string;name:string;date:string;products:number;bundles:number;photos:number;sales:number;movements:number;total:number;fingerprint:string}
function describe(b:Backup):EventRemoval{const e=b.events[0];return {id:e.id,name:e.name,date:e.date,products:b.products.length,bundles:b.bundles.length,photos:b.images.length,sales:b.sales.length,movements:b.movements.length,total:b.sales.filter(s=>!s.cancelledAt).reduce((n,s)=>n+s.total,0),fingerprint:signature(b)}}
export async function inspectDelete(id:string){return describe(await exportBackup(id))}
async function erase(id:string){
 const photos=new Set([...await db.products.where('eventId').equals(id).toArray(),...await db.bundles.where('eventId').equals(id).toArray()].map(p=>p.imageId).filter((x):x is string=>!!x))
 await db.eventProducts.where('eventId').equals(id).delete();await db.eventBundles.where('eventId').equals(id).delete()
 await db.sales.where('eventId').equals(id).delete();await db.movements.where('eventId').equals(id).delete()
 await db.products.where('eventId').equals(id).delete();await db.bundles.where('eventId').equals(id).delete();await db.events.delete(id)
 const used=new Set([...await db.products.toArray(),...await db.bundles.toArray()].map(p=>p.imageId))
 for(const i of photos)if(!used.has(i))await db.images.delete(i)
}
export async function deleteEvent(approved:EventRemoval){
 await db.transaction('rw',tables(),async()=>{
  const b=await Dexie.waitFor(exportBackup(approved.id))
  if(signature(b)!==approved.fingerprint)throw new Error('確認後にデータが変わりました。確認し直してください')
  await erase(approved.id)
  if((await db.settings.get('activeEvent'))?.value===approved.id)await db.settings.put({key:'activeEvent',value:''})
 })
}
export type MergePlan={source:EventRemoval;target:EventRemoval;keep:'source'|'target'|'blocked';reason:string}
const equalRows=(a:string[],b:string[])=>a.length===b.length&&a.every((x,i)=>x===b[i])
function compare(a:Backup,b:Backup):MergePlan{
 validateBackup(a);validateBackup(b)
 const source=describe(a),target=describe(b)
 const result=(keep:MergePlan['keep'],reason:string):MergePlan=>({source,target,keep,reason})
 if(source.id===target.id)return result('blocked','同じイベントは統合できません')
 if(source.date!==target.date||a.events[0].openingCash!==b.events[0].openingCash)return result('blocked','開催日または釣銭準備金が一致しません')
 const x=normalize(a),y=normalize(b)
 if(x.empty)return result('target','統合元に商品・会計・在庫履歴がないため、統合先を保持します')
 if(y.empty)return result('source','統合先が空のため、統合元の全内容を移します')
 if(x.ambiguous||y.ambiguous)return result('blocked','同名商品または識別できない同一会計があり、安全に照合できません')
 if(!equalRows(x.catalog,y.catalog))return result('blocked','商品・セット・写真・価格・初期在庫が一致しません')
 const aInB=subset(x.sales,y.sales)&&subset(x.movements,y.movements)
 const bInA=subset(y.sales,x.sales)&&subset(y.movements,x.movements)
 if(aInB&&bInA&&!equalRows(x.stock,y.stock))return result('blocked','在庫数量が一致しません')
 if(aInB)return result('target','統合先に統合元の全履歴が含まれています。重複計上せず統合先を保持します')
 if(bInA)return result('source','統合元に統合先の全履歴が含まれています。統合元の内容を移します')
 return result('blocked','両方に固有の履歴または取消状態の違いがあります。自動統合できません')
}
export async function inspectMerge(source:string,target:string){return compare(await exportBackup(source),await exportBackup(target))}
export async function mergeEvents(approved:MergePlan){
 await db.transaction('rw',tables(),async()=>{
  const a=await Dexie.waitFor(exportBackup(approved.source.id)),b=await Dexie.waitFor(exportBackup(approved.target.id))
  const plan=compare(a,b)
  if(plan.source.fingerprint!==approved.source.fingerprint||plan.target.fingerprint!==approved.target.fingerprint)throw new Error('確認後にデータが変わりました。確認し直してください')
  if(plan.keep==='blocked')throw new Error(plan.reason)
  const source=plan.source.id,target=plan.target.id
  if(plan.keep==='source'){
   await erase(target)
   await db.events.add({...b.events[0]})
   for(const p of a.products)await db.products.update(p.id,{eventId:target})
   for(const p of a.bundles)await db.bundles.update(p.id,{eventId:target})
   await db.eventProducts.where('eventId').equals(source).delete();await db.eventBundles.where('eventId').equals(source).delete()
   await db.eventProducts.bulkAdd(a.eventProducts.map(p=>({...p,eventId:target})));await db.eventBundles.bulkAdd(a.eventBundles.map(p=>({...p,eventId:target})))
   for(const s of a.sales)await db.sales.update(s.id,{eventId:target})
   for(const m of a.movements)await db.movements.update(m.id,{eventId:target})
   await db.events.delete(source)
  }else await erase(source)
  if([source,target].includes((await db.settings.get('activeEvent'))?.value??''))await db.settings.put({key:'activeEvent',value:target})
 })
}
