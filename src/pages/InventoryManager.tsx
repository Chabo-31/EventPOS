import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import NumberInput from '../components/NumberInput'
import { addStock, cancelSale, loadInventory, summarizeSales } from '../services/inventory'
import type { EventItem } from '../services/events'

const yen=(n:number)=>'¥'+n.toLocaleString('ja-JP')
const time=(s:string)=>new Date(s).toLocaleString('ja-JP')
const reasons={initial:'初期在庫',addition:'在庫追加',sale:'販売',cancel:'会計キャンセル'} as const
type Mode='在庫'|'売上集計'|'会計履歴'|'在庫履歴'
const modes:Mode[]=['在庫','売上集計','会計履歴','在庫履歴']

export default function InventoryManager({eventId,items,onMutation}:{eventId:string;items:EventItem[];onMutation:()=>void}){
  const [data,setData]=useState<Awaited<ReturnType<typeof loadInventory>>|null>(null)
  const [mode,setMode]=useState<Mode>('在庫')
  const [filter,setFilter]=useState('all')
  const [adding,setAdding]=useState<string|null>(null)
  const [qty,setQty]=useState('0')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [loadError,setLoadError]=useState('')
  const [pendingCancel,setPendingCancel]=useState<string|null>(null)
  const gate=useRef(false)
  useEffect(()=>{
    const sub=liveQuery(()=>loadInventory(eventId)).subscribe({next:value=>{setData(value);setLoadError('')},error:e=>setLoadError(String(e))})
    return ()=>sub.unsubscribe()
  },[eventId])
  const run=async(work:()=>Promise<void>,success:string)=>{
    if(gate.current)return
    gate.current=true;setBusy(true);setError('');setMessage('')
    try{await work();onMutation();setMessage(success)}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{gate.current=false;setBusy(false)}
  }
  if(loadError)return <section className="panel"><p role="alert">読み込み失敗：{loadError}</p></section>
  if(!data)return <section className="panel">読み込み中…</section>
  const stockSummary=summarizeSales(data.sales)
  const selectedEvent=data.events.find(e=>e.id===filter)
  const sales=filter==='all'?data.allSales:data.allSales.filter(s=>s.eventId===filter)
  const summary=summarizeSales(sales)
  const pending=sales.find(s=>s.id===pendingCancel&&!s.cancelledAt)
  const productName=(id:string)=>data.products.find(p=>p.id===id)?.name??'不明な商品'
  const count=Number(qty)
  return <section className="panel inventory-manager">
    <h2>在庫・売上管理</h2>
    <div className="inventory-tabs">{modes.map(m=><button key={m} className={mode===m?'primary':''} disabled={busy} onClick={()=>{setMode(m);setAdding(null);setPendingCancel(null);setMessage('');setError('')}}>{m}</button>)}</div>
    {message&&<p className="inventory-notice" role="status">{message}</p>}
    {error&&<p className="sale-error" role="alert">{error}</p>}
    {(mode==='売上集計'||mode==='会計履歴')&&<label className="sales-filter">集計対象イベント<select disabled={busy} value={filter} onChange={e=>{setFilter(e.target.value);setPendingCancel(null);setMessage('');setError('')}}><option value="all">すべてのイベント</option>{data.events.map(e=><option value={e.id} key={e.id}>{e.name}（{e.date}）</option>)}</select></label>}
    {(mode==='在庫'||mode==='在庫履歴')&&!data.event&&<p className="muted">会計対象イベントを選択してください。</p>}
    {mode==='在庫'&&data.event&&<>
      {!items.length&&<p className="muted">登録商品はありません。</p>}
      {items.map(p=><div className="inventory-entry" key={p.kind+':'+p.id}>
        <div className="inventory-row"><span>{p.name}{p.kind==='bundle'&&<small className="muted"> セット</small>}</span><strong>{p.stock}点</strong>{p.kind==='product'?<button disabled={busy} onClick={()=>{setAdding(p.id);setQty('0');setError('');setMessage('')}}>在庫追加</button>:<span className="muted">構成在庫</span>}</div>
        {p.kind==='product'&&<small className="muted">初期在庫 {data.links.find(l=>l.productId===p.id)?.initialStock??0}点 ／ 販売による減少 {stockSummary.consumed.get(p.id)??0}点</small>}
        {adding===p.id&&p.kind==='product'&&<form className="inventory-add" onSubmit={e=>{e.preventDefault();void run(async()=>{await addStock(eventId,p.id,count,crypto.randomUUID());setAdding(null);setQty('0')},'在庫を追加しました')}}>
          <label htmlFor="stock-add">追加数量</label><NumberInput id="stock-add" min="1" max="999999" step="1" required disabled={busy} value={qty} onValueChange={setQty}/>
          <div className="actions"><button type="button" disabled={busy} onClick={()=>setAdding(null)}>キャンセル</button><button className="primary" type="submit" disabled={busy||!Number.isSafeInteger(count)||count<1||count>999999}>追加確定</button></div>
        </form>}
      </div>)}
    </>}
    {mode==='売上集計'&&<>
      <div className="sales-metrics">
        {[['売上合計',yen(summary.total)],['会計件数',summary.count+'件'],['平均会計単価',yen(summary.count?Math.round(summary.total/summary.count):0)],['販売数量',summary.items.reduce((n,p)=>n+p.quantity,0)+'点'],...(selectedEvent?[['釣銭準備金',yen(selectedEvent.openingCash)],['レジ内現金（理論値）',yen(selectedEvent.openingCash+summary.total)]]:[['イベント数',data.events.length+'件']]),['キャンセル件数',summary.cancelled+'件']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {filter==='all'?<><h3>イベント別売上</h3>{data.events.map(e=>{const s=summarizeSales(data.allSales.filter(r=>r.eventId===e.id));return <div className="event-sales-row" key={e.id}><button onClick={()=>setFilter(e.id)} disabled={busy}><span>{e.name}<small>{e.date} ／ {s.count}件</small></span><strong>{yen(s.total)}</strong></button></div>})}</>:<>
      <p className="muted">レジ内現金は実際の現金移動・返金を行った前提の理論値です。</p>
      <h3>商品別売上</h3>
      {!summary.items.length&&<p className="muted">確定売上はありません。</p>}
      {summary.items.map(p=><div className="inventory-row" key={p.key}><span>{p.name}{p.kind==='bundle'?'（セット）':''}</span><span>{p.quantity}点</span><strong>{yen(p.total)}</strong></div>)}
      <p className="muted">セット売上を単品売上に重複計上しません。</p>
      <h3>単品商品の消費数量（セット分を含む）</h3>
      {data.allProducts.filter(p=>p.eventId===filter).map(p=><div className="line" key={p.id}><span>{p.name}</span><strong>{summary.consumed.get(p.id)??0}点</strong></div>)}</>}
    </>}
    {mode==='会計履歴'&&<>
      {!sales.length&&<p className="muted">会計履歴はありません。</p>}
      {sales.map(s=><article className={'history-card'+(s.cancelledAt?' cancelled':'')} key={s.id}>
        <p className="muted">{data.events.find(e=>e.id===s.eventId)?.name??"不明なイベント"}</p><div className="line"><span>{time(s.timestamp)}</span><strong>{yen(s.total)}</strong></div>
        {s.lines.map(l=><div className="line" key={l.kind+':'+l.itemId}><span>{l.name} × {l.quantity}</span><span>{yen(l.unitPrice*l.quantity)}</span></div>)}
        <p className="muted">預かり {yen(s.cash)} ／ お釣り {yen(s.change)}</p>
        {s.cancelledAt?<p className="muted">キャンセル済み：{time(s.cancelledAt)}</p>:<button disabled={busy} onClick={()=>{setPendingCancel(s.id);setError('');setMessage('')}}>会計キャンセル</button>}
        {pending?.id===s.id&&<div className="cancel-confirm"><strong>{yen(s.total)}の会計をキャンセルしますか？</strong><p>実際の返金は手動で行ってください。売上から除外し、販売時の単品在庫を復元します。</p><div className="actions"><button disabled={busy} onClick={()=>setPendingCancel(null)}>キャンセル</button><button className="danger" disabled={busy} onClick={()=>void run(async()=>{await cancelSale(s.eventId,s.id);setPendingCancel(null)},'会計をキャンセルしました')}>キャンセル確定</button></div></div>}
      </article>)}
    </>}
    {mode==='在庫履歴'&&data.event&&<>
      {!data.movements.length&&<p className="muted">在庫履歴はありません。</p>}
      {data.movements.map(m=><article className="history-card" key={m.id}><div className="line"><strong>{productName(m.productId)}</strong><strong className={m.delta<0?'shortage':''}>{m.delta>0?'+':''}{m.delta}点</strong></div><p className="muted">{reasons[m.reason]} ／ {time(m.timestamp)}</p></article>)}
    </>}
  </section>
}
