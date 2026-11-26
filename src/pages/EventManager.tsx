import { useState } from 'react'
import { emptyEvent, saveEvent, selectEvent } from '../services/events'
import type { EventData, EventDraft } from '../services/events'

export default function EventManager({ data }: { data: EventData }) {
  const [editing, setEditing] = useState(false)
  const [id, setId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyEvent)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const start = (eventId: string | null) => {
    const e = data.events.find(row => row.id === eventId)
    setId(eventId); setMessage('')
    setDraft(e ? { name: e.name, date: e.date, openingCash: String(e.openingCash), products: Object.fromEntries(data.links.filter(p => p.eventId === e.id).map(p => [p.productId, { stock: String(p.initialStock), price: String(p.price) }])), bundles: Object.fromEntries(data.bundleLinks.filter(p => p.eventId === e.id).map(p => [p.bundleId, String(p.price)])) } : emptyEvent())
    setEditing(true)
  }
  const run = async (work: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await work(); setMessage(success) } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <section className="panel event-manager"><h2>イベント管理</h2>
    {editing ? <form onSubmit={e => { e.preventDefault(); void run(async () => { await saveEvent(id, draft); setEditing(false) }, '保存しました') }}>
      <fieldset disabled={busy}><h3>{id ? 'イベント編集' : '新規イベント'}</h3>
      <label htmlFor="event-name">イベント名</label><input id="event-name" required maxLength={100} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
      <label htmlFor="event-date">開催日</label><input id="event-date" type="date" required value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
      <label htmlFor="opening-cash">釣銭準備金（円）</label><input id="opening-cash" type="number" min="0" max="99999999" step="1" required inputMode="numeric" value={draft.openingCash} onChange={e => setDraft(d => ({ ...d, openingCash: e.target.value }))} />
      <h3>単品商品・初期在庫</h3>
      {!data.products.length && <p className="muted">設定から商品を登録してください。</p>}
      {data.products.map(p => { const row = draft.products[p.id]; return <div className="event-link" key={p.id}>
        <label className="event-check"><input type="checkbox" checked={!!row} onChange={e => { const checked = e.target.checked; setDraft(d => { const products = { ...d.products }; if (checked) products[p.id] = { stock: '0', price: String(p.price) }; else delete products[p.id]; return { ...d, products } }) }} />{p.name}</label>
        {row && <div className="event-fields"><label>初期在庫<input type="number" min="0" max="999999" step="1" required inputMode="numeric" value={row.stock} onChange={e => setDraft(d => ({ ...d, products: { ...d.products, [p.id]: { ...d.products[p.id], stock: e.target.value } } }))} /></label><label>価格（円）<input type="number" min="0" max="99999999" step="1" required inputMode="numeric" value={row.price} onChange={e => setDraft(d => ({ ...d, products: { ...d.products, [p.id]: { ...d.products[p.id], price: e.target.value } } }))} /></label></div>}
      </div> })}
      <h3>セット商品</h3><p className="muted">構成する単品商品もすべて選択してください。在庫は単品と共通です。</p>
      {data.bundles.map(b => <div className="event-link" key={b.id}><label className="event-check"><input type="checkbox" checked={b.id in draft.bundles} onChange={e => { const checked = e.target.checked; setDraft(d => { const bundles = { ...d.bundles }; if (checked) bundles[b.id] = String(b.price); else delete bundles[b.id]; return { ...d, bundles } }) }} />{b.name}</label>
      {b.id in draft.bundles && <label>セット価格（円）<input type="number" min="0" max="99999999" step="1" required inputMode="numeric" value={draft.bundles[b.id]} onChange={e => setDraft(d => ({ ...d, bundles: { ...d.bundles, [b.id]: e.target.value } }))} /></label>}</div>)}
      <div className="actions"><button type="button" onClick={() => setEditing(false)}>取消</button><button type="submit" className="primary">保存・選択</button></div></fieldset>
    </form> : <><div className="line"><strong>{data.events.length}件</strong><button className="primary" onClick={() => start(null)} disabled={busy}>＋ 新規イベント</button></div>
    {!data.events.length && <p className="muted">イベントを登録してください。</p>}
    {data.events.map(e => <article className="event-row" key={e.id}><div><strong>{e.name}</strong><p className="muted">{e.date} · 準備金 ¥{e.openingCash.toLocaleString()}</p></div><div className="master-buttons"><button disabled={busy || data.selected === e.id} onClick={() => void run(() => selectEvent(e.id), 'イベントを選択しました')}>{data.selected === e.id ? '選択中' : '選択'}</button><button disabled={busy} onClick={() => start(e.id)}>編集</button></div></article>)}</>}
    <p role="status" aria-live="polite">{message}</p></section>
}
