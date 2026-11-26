import Dexie from 'dexie'
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

type Change={label:string;added:number;changed:number;removed:number}
export type RestoreRow={id:string;name:string;status:'new'|'same'|'update'|'conflict';changes:Change[];reasons:string[]}
export type RestorePlan={rows:RestoreRow[];conflicts:string[];settings:number;legacy:number;fingerprint:string}
function canonical(x:unknown):string{
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']'
 if(x&&typeof x==='object'){const r=x as Record<string,unknown>;return '{'+Object.keys(r).filter(k=>r[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(r[k])).join(',')+'}'}
 return JSON.stringify(x)??'null'
}
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
function diff<T>(label:string,local:T[],incoming:T[],key:(r:T)=>string):Change{
 const a=new Map(local.map(r=>[key(r),r])),b=new Map(incoming.map(r=>[key(r),r]))
 return {label,added:incoming.filter(r=>!a.has(key(r))).length,changed:incoming.filter(r=>a.has(key(r))&&!equal(a.get(key(r)),r)).length,removed:local.filter(r=>!b.has(key(r))).length}
}
function subset(b:Backup,eventId:string){
 const products=b.products.filter(p=>p.eventId===eventId),bundles=b.bundles.filter(p=>p.eventId===eventId)
 const photoIds=new Set([...products,...bundles].map(p=>p.imageId))
 return {events:b.events.filter(e=>e.id===eventId),products,bundles,images:b.images.filter(i=>photoIds.has(i.id)),eventProducts:b.eventProducts.filter(p=>p.eventId===eventId),eventBundles:b.eventBundles.filter(p=>p.eventId===eventId),sales:b.sales.filter(s=>s.eventId===eventId),movements:b.movements.filter(m=>m.eventId===eventId)}
}
function planRestore(local:Backup,b:Backup):RestorePlan{
 const conflicts:string[]=[]
 const rows:RestoreRow[]=b.events.map(e=>{
  const a=subset(local,e.id),n=subset(b,e.id),reasons:string[]=[]
  const changes=[diff('イベント情報',a.events,n.events,r=>r.id),diff('単品商品',a.products,n.products,r=>r.id),diff('セット商品',a.bundles,n.bundles,r=>r.id),diff('写真',a.images,n.images,r=>r.id),diff('在庫・価格',a.eventProducts,n.eventProducts,r=>r.productId),diff('セット価格',a.eventBundles,n.eventBundles,r=>r.bundleId),diff('会計履歴',a.sales,n.sales,r=>r.id),diff('在庫履歴',a.movements,n.movements,r=>r.id)].filter(x=>x.added||x.changed||x.removed)
  for(const s of a.sales){
   const incoming=n.sales.find(r=>r.id===s.id)
   if(!incoming){reasons.push('端末側にのみ存在する会計履歴があります');continue}
   const {cancelledAt:oldCancel,...old}=s
   const {cancelledAt:newCancel,...next}=incoming
   if(!equal(old,next)||(oldCancel!==undefined&&oldCancel!==newCancel))reasons.push('会計内容または取消履歴が競合しています')
  }
  for(const m of a.movements.filter(r=>r.reason!=='initial')){
   if(!equal(m,n.movements.find(r=>r.id===m.id)))reasons.push('端末側の在庫増減履歴が欠落または変更されています')
  }
  // Initial stock can be edited before sales; once operational history exists, protect it too.
  if(a.sales.length||a.movements.some(m=>m.reason!=='initial')){
   if(a.movements.filter(m=>m.reason==='initial').some(m=>!equal(m,n.movements.find(r=>r.id===m.id))))reasons.push('販売開始後の初期在庫履歴が競合しています')
  }
  const status=reasons.length?'conflict':!a.events.length?'new':changes.length?'update':'same'
  return {id:e.id,name:e.name,status,changes,reasons:[...new Set(reasons)]}
 })
 // ID collisions across unrelated events or legacy records are never overwritten.
 for(const [label,old,next] of [['商品',local.products,b.products],['セット',local.bundles,b.bundles]] as const){
  for(const p of next){const prev=old.find(r=>r.id===p.id);if(prev&&(prev.eventId!==p.eventId||(!p.eventId&&!equal(prev,p))))conflicts.push(label+'IDの競合：'+p.name)}
 }
 for(const [label,old,next] of [['会計',local.sales,b.sales],['在庫履歴',local.movements,b.movements]] as const){
  for(const r of next){const prev=old.find(x=>x.id===r.id);if(prev&&prev.eventId!==r.eventId)conflicts.push(label+'IDの競合')}
 }
 const affected=new Set(rows.filter(r=>r.status==='update'||r.status==='new').map(r=>r.id))
 for(const i of b.images){const old=local.images.find(r=>r.id===i.id);if(old&&!equal(old,i)&&[...local.products,...local.bundles].some(p=>p.imageId===i.id&&(!p.eventId||!affected.has(p.eventId))))conflicts.push('他のイベント・旧商品が使用する写真IDの競合')}
 const legacy=[...b.products.filter(p=>!p.eventId&&!local.products.some(x=>x.id===p.id)),...b.bundles.filter(p=>!p.eventId&&!local.bundles.some(x=>x.id===p.id))].length
 const settings=b.settings.filter(s=>s.key!=='activeEvent'&&!local.settings.some(x=>x.key===s.key)).length
 // Include entire current snapshot except creation time; detect any change between preview and commit.
 const {createdAt,...snapshot}=local
 void createdAt
 return {rows,conflicts:[...new Set(conflicts)],settings,legacy,fingerprint:canonical(snapshot)}
}
export async function inspectRestore(input:Backup):Promise<RestorePlan>{
 return planRestore(await exportBackup(),validateBackup(input))
}
export async function restoreBackup(input:Backup,approved:RestorePlan){
 const b=validateBackup(input),images=b.images.map(decode)
 return db.transaction('rw',tables(),async()=>{
  // Blob encoding is not an IndexedDB request; keep the transaction alive while comparing bytes.
  const local=await Dexie.waitFor(exportBackup())
  const plan=planRestore(local,b)
  if(plan.fingerprint!==approved.fingerprint)throw new Error('確認後に端末データが変更されました。ファイルを選び直してください')
  if(plan.conflicts.length||plan.rows.some(r=>r.status==='conflict'))throw new Error('競合があるためインポートできません')
  const affected=new Set(plan.rows.filter(r=>r.status==='new'||r.status==='update').map(r=>r.id))
  const oldPhotos=new Set<string>()
  for(const eventId of affected){
   for(const p of [...await db.products.where('eventId').equals(eventId).toArray(),...await db.bundles.where('eventId').equals(eventId).toArray()])if(p.imageId)oldPhotos.add(p.imageId)
   await db.products.where('eventId').equals(eventId).delete();await db.bundles.where('eventId').equals(eventId).delete()
   await db.eventProducts.where('eventId').equals(eventId).delete();await db.eventBundles.where('eventId').equals(eventId).delete()
   await db.sales.where('eventId').equals(eventId).delete();await db.movements.where('eventId').equals(eventId).delete();await db.events.delete(eventId)
  }
  const products=b.products.filter(p=>p.eventId?affected.has(p.eventId):!local.products.some(x=>x.id===p.id))
  const bundles=b.bundles.filter(p=>p.eventId?affected.has(p.eventId):!local.bundles.some(x=>x.id===p.id))
  const photoIds=new Set([...products,...bundles].map(p=>p.imageId))
  for(const i of images.filter(i=>photoIds.has(i.id)))await db.images.put(i)
  await db.events.bulkAdd(b.events.filter(e=>affected.has(e.id)))
  await db.products.bulkAdd(products);await db.bundles.bulkAdd(bundles)
  await db.eventProducts.bulkAdd(b.eventProducts.filter(p=>affected.has(p.eventId)));await db.eventBundles.bulkAdd(b.eventBundles.filter(p=>affected.has(p.eventId)))
  await db.sales.bulkAdd(b.sales.filter(s=>affected.has(s.eventId)));await db.movements.bulkAdd(b.movements.filter(m=>affected.has(m.eventId)))
  const remaining=new Set([...await db.products.toArray(),...await db.bundles.toArray()].map(p=>p.imageId))
  for(const i of oldPhotos)if(!remaining.has(i))await db.images.delete(i)
  // Existing device settings and events not in the file are preserved.
  for(const s of b.settings)if(s.key!=='activeEvent'&&!await db.settings.get(s.key))await db.settings.add(s)
  if(b.events.length&&!(await db.settings.get('activeEvent'))?.value)await db.settings.put({key:'activeEvent',value:b.settings.find(s=>s.key==='activeEvent'&&b.events.some(e=>e.id===s.value))?.value??b.events[0].id})
  return affected.size
 })
}
