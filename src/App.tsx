import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import EventManager from './pages/EventManager'
import { loadEvents, eventItems, canAdd, itemKey } from './services/events'
import type { EventData, EventItem } from './services/events'
import './App.css'
import ProductManager from './pages/ProductManager'
import { checkDatabase } from './database/diagnostics'

const tabs = ['会計', '在庫', 'イベント', '設定'] as const
type Tab = typeof tabs[number]
const navPaths: Record<Tab, string> = {
  '会計': 'M5 3h14v18H5z M8 7h8 M8 11h2 M14 11h2 M8 15h2 M14 15h2 M8 18h2 M14 18h2',
  '在庫': 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  'イベント': 'M3 6h18v15H3z M3 10h18 M7 3v5 M17 3v5 M7 14h3 M14 14h3 M7 17h3',
  '設定': 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
}
const yen = (n: number) => '¥' + n.toLocaleString('ja-JP')

function ItemPhoto({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const value = URL.createObjectURL(blob)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [blob])
  return url ? <img src={url} alt="" /> : <span>写真なし</span>
}
function App() {
  const [data, setData] = useState<EventData | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    const sub = liveQuery(loadEvents).subscribe({ next: setData, error: e => setLoadError(String(e)) })
    return () => sub.unsubscribe()
  }, [])
  const active = data?.events.find(e => e.id === data.selected)
  const products = data && active ? eventItems(data, active.id) : []
  const [dbBusy, setDbBusy] = useState(false)
  const [dbReport, setDbReport] = useState<string[]>([])
  const runDiagnostics = async () => {
    setDbBusy(true)
    setDbReport([])
    try { setDbReport(await checkDatabase()) }
    catch (error) { setDbReport(['診断失敗：' + String(error)]) }
    finally { setDbBusy(false) }
  }
  const [tab, setTab] = useState<Tab>('会計')
  const [cart, setCart] = useState<{ eventId: string; qty: Record<string, number> }>({ eventId: '', qty: {} })
  const qty = cart.eventId === active?.id ? cart.qty : {}
  const [cashOpen, setCashOpen] = useState(false)
  const [cash, setCash] = useState('')
  const amount = (p: EventItem) => qty[itemKey(p)] ?? 0
  const total = products.reduce((sum, p) => sum + p.price * amount(p), 0)
  const count = products.reduce((sum, p) => sum + amount(p), 0)
  const change = Number(cash) - total
  const valid = count > 0 && cash !== '' && Number.isSafeInteger(Number(cash)) && change >= 0
  const adjust = (p: EventItem, delta: number) => {
    if (!active) return
    setCart(prev => {
      const current = prev.eventId === active.id ? prev.qty : {}
      if (delta > 0 && !canAdd(products, current, p)) return prev
      return { eventId: active.id, qty: { ...current, [itemKey(p)]: Math.max(0, (current[itemKey(p)] ?? 0) + delta) } }
    })
  }
  const reset = () => { setCart({ eventId: active?.id ?? '', qty: {} }); setCash(''); setCashOpen(false) }

  return (
    <div className="app-shell">
      <header className="app-header"><div><h1>EventPOS</h1><p>{active ? active.name + ' · ' + active.date : 'イベント未選択'}</p></div><span className="preview-label">会計保存は未実装</span></header>
      <main className="workspace">{loadError && <p role="alert">読み込み失敗：{loadError}</p>}{!data && !loadError && <p>読み込み中…</p>}
        {tab === '会計' && <div className="checkout">
          <section className="catalog"><h2>商品選択</h2>{!active && <p className="muted">イベントタブで販売対象を登録・選択してください。</p>}{active && !products.length && <p className="muted">イベントに商品を紐づけてください。</p>}<div className="product-grid">{products.map(p => <article key={itemKey(p)} className={'product-card' + (amount(p) ? ' selected' : '')}>
            <button className="product-image"  onClick={() => adjust(p, 1)} disabled={!canAdd(products, qty, p)} aria-label={p.name + 'を追加'}><ItemPhoto blob={p.image} /></button>
            <div className="product-body"><h3>{p.name}{p.kind === "bundle" && <small> セット</small>}</h3><div className="product-meta"><strong>{yen(p.price)}</strong><small>在庫 {p.stock}</small></div>
            <div className="quantity"><button onClick={() => adjust(p, -1)} disabled={!amount(p)} aria-label={p.name + 'を減らす'}>−</button><strong>{amount(p)}</strong><button onClick={() => adjust(p, 1)} disabled={!canAdd(products, qty, p)} aria-label={p.name + 'を増やす'}>＋</button></div></div>
          </article>)}</div></section>
          <section className={"panel checkout-summary" + (cashOpen ? " expanded" : "")}><button className="mobile-summary-toggle" onClick={() => setCashOpen(v => !v)} aria-expanded={cashOpen}><span>合計 {count}点</span><strong>{yen(total)}</strong><span>{cashOpen ? "閉じる" : "会計へ"}</span></button><div className="summary-details"><h2>会計内容</h2><div className="cart-lines">{count === 0 ? <p className="muted">商品を選択してください</p> : products.map(p => amount(p) > 0 && <div className="line" key={itemKey(p)}><span>{p.name} × {amount(p)}</span><strong>{yen(p.price * amount(p))}</strong></div>)}</div>
            <div className="line total"><span>合計金額 · {count}点</span><strong>{yen(total)}</strong></div>
            <label htmlFor="cash">お預かり金額</label><input id="cash" type="number" min="0" step="1" inputMode="numeric" value={cash} onChange={e => setCash(e.target.value)} placeholder="金額を入力" />
            <div className="cash-buttons">{[1000, 5000, 10000].map(n => <button key={n} onClick={() => setCash(String((Number(cash) || 0) + n))}>+{n.toLocaleString()}</button>)}<button onClick={() => setCash(String(total))}>丁度</button></div>
            <div className={'line change' + (cash !== '' && change < 0 ? ' shortage' : '')}><span>{cash !== '' && change < 0 ? '不足金額' : 'お釣り'}</span><strong>{cash === '' ? '—' : yen(Math.abs(change))}</strong></div>
            <div className="actions"><button onClick={reset}>リセット</button><button className="primary" disabled={!valid} onClick={() => { window.alert('GUIプレビュー：会計データは保存されません。'); reset() }}>会計確定</button></div></div>
          </section>
        </div>}
        {tab === '在庫' && <section className="panel"><h2>在庫管理</h2><p className="muted">在庫追加は後続Phaseで実装します。</p>{active && <p>釣銭準備金：{yen(active.openingCash)}</p>}{products.map(p => <div className="inventory-row" key={itemKey(p)}><span>{p.name}</span><strong>{p.stock}点</strong><button disabled>在庫追加</button></div>)}</section>}
        {tab === 'イベント' && data && <EventManager data={data} />}
        {tab === '設定' && <section className="panel"><h2>設定</h2><ProductManager />{['バックアップ出力', 'インポート'].map(label => <div className="line setting-row" key={label}><span>{label}</span><button disabled>準備中</button></div>)}<p className="muted">各機能は後続Phaseで実装します。</p><h3>データベース診断</h3><button onClick={() => void runDiagnostics()} disabled={dbBusy}>{dbBusy ? "診断中…" : "保存・復元テスト"}</button><div role="status" aria-live="polite">{dbReport.map((line, i) => <p key={i}>{line}</p>)}</div></section>}
      </main>
      <nav className="navigation" aria-label="メインメニュー">{tabs.map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''} onClick={() => { if (t === 'イベント') reset(); setTab(t) }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={navPaths[t]} /></svg><span>{t}</span></button>)}</nav>
    </div>
  )
}

export default App
