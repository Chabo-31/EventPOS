import NumberInput from '../components/NumberInput'
import { useRef, useState } from 'react'
import { inspectDelete, deleteEvent, inspectMerge, mergeEvents } from '../services/eventCleanup'
import type { EventRemoval, MergePlan } from '../services/eventCleanup'
import { emptyEvent, saveEvent, selectEvent, copyEvent } from '../services/events'
import type { EventData, EventDraft } from '../services/events'
import { copyCatalog } from '../services/catalog'
import type { StockMode } from '../services/catalog'
import ProductManager from './ProductManager'

export default function EventManager({data}:{data:EventData}){
  const [mode,setMode]=useState<'list'|'edit'|'items'|'copy'|'import'|'delete'|'merge'>('list')
  const [id,setId]=useState<string|null>(null)
  const [source,setSource]=useState('')
  const [draft,setDraft]=useState<EventDraft>(emptyEvent)
  const [stock,setStock]=useState<StockMode>('zero')
  const [cash,setCash]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [removal,setRemoval]=useState<EventRemoval|null>(null)
  const [merge,setMerge]=useState<MergePlan|null>(null)
  const [target,setTarget]=useState('')
  const [confirmed,setConfirmed]=useState(false)
  const gate=useRef(false)
  const selected=data.events.find(e=>e.id===id)
  const origin=data.events.find(e=>e.id===source)
  const legacy=data.products.some(p=>!p.eventId)||data.bundles.some(b=>!b.eventId)
  const run=async(work:()=>Promise<void>,success:string)=>{
    if(gate.current)return
    gate.current=true;setBusy(true);setMessage('')
    try{await work();setMessage(success)}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{gate.current=false;setBusy(false)}
  }
  const edit=(eventId:string|null)=>{
    const e=data.events.find(r=>r.id===eventId)
    setId(eventId);setDraft(e?{name:e.name,date:e.date,openingCash:String(e.openingCash)}:emptyEvent());setMode('edit');setMessage('')
  }
  const copy=(eventId:string)=>{
    const e=data.events.find(r=>r.id===eventId)
    if(!e)return
    setSource(eventId);setDraft({name:e.name+'（コピー）',date:'',openingCash:String(e.openingCash)});setStock('zero');setCash(true);setMode('copy');setMessage('')
  }
  const stockChoice=<label>在庫の引き継ぎ<select value={stock} onChange={e=>setStock(e.target.value as StockMode)}><option value="zero">在庫を0にする</option><option value="initial">初期在庫を引き継ぐ</option><option value="remaining">残在庫を引き継ぐ</option></select></label>
  return <section className="panel event-manager"><h2>イベント管理</h2>
  {mode!=='list'&&<button disabled={busy} onClick={()=>{setMode(mode==='import'?'items':'list');setMessage('')}}>← 戻る</button>}
  {(mode==='edit'||mode==='copy')&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{
    const saved=mode==='copy'?await copyEvent(source,{...draft,openingCash:cash?draft.openingCash:'0'},stock):await saveEvent(id,draft)
    setId(saved);setMode('items')
  },'保存しました')}}><fieldset disabled={busy}>
    <h3>{mode==='copy'?'イベントのコピー':id?'イベント編集':'新規イベント'}</h3>
    {mode==='copy'&&<p>コピー元：{origin?.name}</p>}
    <label htmlFor="event-name">イベント名</label><input id="event-name" required maxLength={100} value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))}/>
    <label htmlFor="event-date">開催日</label><input id="event-date" type="date" required value={draft.date} onChange={e=>setDraft(d=>({...d,date:e.target.value}))}/>
    {mode==='copy'?<>{stockChoice}<label className="event-check"><input type="checkbox" checked={cash} onChange={e=>setCash(e.target.checked)}/>釣銭準備金を引き継ぐ</label><p className="muted">会計履歴・在庫増減履歴はコピーしません。</p></>:<><label htmlFor="opening-cash">釣銭準備金（円）</label><NumberInput id="opening-cash" min="0" max="99999999" step="1" required value={draft.openingCash} onValueChange={value =>setDraft(d=>({...d,openingCash:value}))}/></>}
    <div className="actions"><button type="button" onClick={()=>setMode('list')}>取消</button><button className="primary" type="submit">保存・商品管理</button></div>
  </fieldset></form>}
  {mode==='items'&&selected&&<><h3>{selected.name} · {selected.date}</h3><button onClick={()=>{setSource(data.events.find(e=>e.id!==id)?.id??'');setStock('zero');setMode('import');setMessage('')}}>以前のイベントから商品をコピー</button><ProductManager key={id} eventId={selected.id}/></>}
  {mode==='import'&&selected&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{await copyCatalog(source,selected.id,stock);setMode('items')},'商品をコピーしました')}}><fieldset disabled={busy}><h3>商品情報のコピー</h3><p>コピー先：{selected.name}</p><label>コピー元<select value={source} onChange={e=>setSource(e.target.value)} required={!legacy}><option value="" disabled={!legacy}>{legacy?'旧商品データ（在庫0）':'選択してください'}</option>{data.events.filter(e=>e.id!==id).map(e=><option key={e.id} value={e.id}>{e.name} · {e.date}</option>)}</select></label>{source&&stockChoice}<p className="muted">既存商品は上書きせず、新しい商品として追加します。</p><button className="primary" disabled={!source&&!legacy} type="submit">商品をコピー</button></fieldset></form>}
  {mode==='delete'&&removal&&<div className="cancel-confirm"><h3>イベント削除</h3><strong>{removal.name}（{removal.date}）</strong><p>商品 {removal.products}件 ／ セット {removal.bundles}件 ／ 写真 {removal.photos}件 ／ 会計 {removal.sales}件 ／ 在庫履歴 {removal.movements}件</p><p>売上 ¥{removal.total.toLocaleString()}。関連データも削除されます。事前にバックアップを保存してください。</p><label className="event-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>削除内容を確認しました</label><div className="actions"><button disabled={busy} onClick={()=>setMode('list')}>取消</button><button className="danger" disabled={busy||!confirmed} onClick={()=>void run(async()=>{await deleteEvent(removal);setMode('list');setRemoval(null)},'イベントを削除しました')}>削除確定</button></div></div>}
  {mode==='merge'&&origin&&<div className="cancel-confirm"><h3>イベントのマージ</h3><p>統合元（削除されるイベント）：{origin.name}（{origin.date}）</p><label>統合先（残すイベント）<select value={target} disabled={busy} onChange={e=>{setTarget(e.target.value);setMerge(null);setConfirmed(false)}}><option value="">選択してください</option>{data.events.filter(e=>e.id!==source).map(e=><option key={e.id} value={e.id}>{e.name}（{e.date}）</option>)}</select></label><button disabled={busy||!target} onClick={()=>void run(async()=>{setMerge(null);setConfirmed(false);setMerge(await inspectMerge(source,target))},'照合完了')}>内容を照合</button>
   {merge&&<><p className={merge.keep==='blocked'?'sale-error':'inventory-notice'}>{merge.reason}</p><p>統合元：商品 {merge.source.products+merge.source.bundles}種類 ／ 会計 {merge.source.sales}件 ／ 売上 ¥{merge.source.total.toLocaleString()}</p><p>統合先：商品 {merge.target.products+merge.target.bundles}種類 ／ 会計 {merge.target.sales}件 ／ 売上 ¥{merge.target.total.toLocaleString()}</p>{merge.keep!=='blocked'&&<><p>統合後は「{merge.target.name}」のみ残ります。売上・在庫を合算しません。事前にバックアップを保存してください。</p><label className="event-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>統合内容を確認しました</label><div className="actions"><button disabled={busy} onClick={()=>setMode('list')}>取消</button><button className="primary" disabled={busy||!confirmed} onClick={()=>void run(async()=>{await mergeEvents(merge);setMerge(null);setMode('list')},'イベントを統合しました')}>マージ確定</button></div></>}</>}
  </div>}
  {mode==='list'&&<><div className="line"><strong>{data.events.length}件</strong><button className="primary" onClick={()=>edit(null)}>＋ 新規イベント</button></div>
    {!data.events.length&&<p>イベントを登録してください。</p>}
    {data.events.map(e=><article className={"event-row"+(data.selected===e.id?" event-selected":"")} key={e.id}><div><strong>{e.name}</strong>{data.selected===e.id&&<span className="event-active-label">会計対象</span>}<p className="muted">{e.date} · 準備金 ¥{e.openingCash.toLocaleString()} · 商品 {data.links.filter(p=>p.eventId===e.id).length+data.bundleLinks.filter(b=>b.eventId===e.id).length}種類</p></div><div className="master-buttons"><button className={data.selected===e.id?"selected-event-button":""} disabled={busy||data.selected===e.id} onClick={()=>void run(()=>selectEvent(e.id),'選択しました')}>{data.selected===e.id?'選択中':'選択'}</button><button disabled={busy} onClick={()=>edit(e.id)}>編集</button><button disabled={busy} onClick={()=>{setId(e.id);setMode('items');setMessage('')}}>商品管理</button><button disabled={busy} onClick={()=>copy(e.id)}>コピー</button><button disabled={busy||data.events.length<2} onClick={()=>{setSource(e.id);setTarget('');setMerge(null);setConfirmed(false);setMessage('');setMode('merge')}}>マージ</button><button className="event-delete" disabled={busy} onClick={()=>void run(async()=>{setRemoval(await inspectDelete(e.id));setConfirmed(false);setMode('delete')},'')}>削除</button></div></article>)}</>}
  <p role="status" aria-live="polite">{message}</p></section>
}
