import { useState } from 'react'
import './App.css'

const products = [
  { id: 1, name: 'アクリルスタンド', price: 1500, stock: 30, color: '#e5d9f0' },
  { id: 2, name: '缶バッジ', price: 500, stock: 50, color: '#d9e6f3' },
  { id: 3, name: 'チェキ', price: 1000, stock: 40, color: '#f2dce2' },
  { id: 4, name: 'ステッカー', price: 300, stock: 100, color: '#d9e9df' },
]
const tabs = ['会計', '在庫', 'イベント', '設定'] as const
type Tab = typeof tabs[number]
const yen = (n: number) => '¥' + n.toLocaleString('ja-JP')

function App() {
  const [tab, setTab] = useState<Tab>('会計')
  const [qty, setQty] = useState([0, 0, 0, 0])
  const [cash, setCash] = useState('')
  const [eventName, setEventName] = useState('サンプル即売会')
  const [eventDate, setEventDate] = useState('2026-12-20')
  const total = products.reduce((sum, p, i) => sum + p.price * qty[i], 0)
  const count = qty.reduce((sum, n) => sum + n, 0)
  const change = Number(cash) - total
  const valid = count > 0 && cash !== '' && Number.isSafeInteger(Number(cash)) && change >= 0
  const adjust = (i: number, delta: number) => setQty(prev => prev.map((n, j) => j === i ? Math.max(0, Math.min(products[i].stock, n + delta)) : n))
  const reset = () => { setQty(products.map(() => 0)); setCash('') }

  return (
    <div className="app-shell">
      <header className="app-header"><div><h1>EventPOS</h1><p>{eventName || 'イベント未設定'} · {eventDate}</p></div><span className="preview-label">GUIプレビュー</span></header>
      <main className="workspace">
        {tab === '会計' && <div className="checkout">
          <section className="catalog"><h2>商品選択</h2><div className="product-grid">{products.map((p, i) => <article key={p.id} className={'product-card' + (qty[i] ? ' selected' : '')}>
            <button className="product-image" style={{ background: p.color }} onClick={() => adjust(i, 1)} disabled={qty[i] >= p.stock} aria-label={p.name + 'を追加'}><span>商品写真</span></button>
            <div className="product-body"><h3>{p.name}</h3><div className="product-meta"><strong>{yen(p.price)}</strong><small>在庫 {p.stock}</small></div>
            <div className="quantity"><button onClick={() => adjust(i, -1)} disabled={!qty[i]} aria-label={p.name + 'を減らす'}>−</button><strong>{qty[i]}</strong><button onClick={() => adjust(i, 1)} disabled={qty[i] >= p.stock} aria-label={p.name + 'を増やす'}>＋</button></div></div>
          </article>)}</div></section>
          <section className="panel checkout-summary"><h2>会計内容</h2><div className="cart-lines">{count === 0 ? <p className="muted">商品を選択してください</p> : products.map((p, i) => qty[i] > 0 && <div className="line" key={p.id}><span>{p.name} × {qty[i]}</span><strong>{yen(p.price * qty[i])}</strong></div>)}</div>
            <div className="line total"><span>合計金額 · {count}点</span><strong>{yen(total)}</strong></div>
            <label htmlFor="cash">お預かり金額</label><input id="cash" type="number" min="0" step="1" inputMode="numeric" value={cash} onChange={e => setCash(e.target.value)} placeholder="金額を入力" />
            <div className="cash-buttons">{[1000, 5000, 10000].map(n => <button key={n} onClick={() => setCash(String((Number(cash) || 0) + n))}>+{n.toLocaleString()}</button>)}<button onClick={() => setCash(String(total))}>丁度</button></div>
            <div className={'line change' + (cash !== '' && change < 0 ? ' shortage' : '')}><span>{cash !== '' && change < 0 ? '不足金額' : 'お釣り'}</span><strong>{cash === '' ? '—' : yen(Math.abs(change))}</strong></div>
            <div className="actions"><button onClick={reset}>リセット</button><button className="primary" disabled={!valid} onClick={() => { window.alert('GUIプレビュー：会計データは保存されません。'); reset() }}>会計確定</button></div>
          </section>
        </div>}
        {tab === '在庫' && <section className="panel"><h2>在庫管理</h2><p className="muted">在庫追加は後続Phaseで実装します。</p>{products.map(p => <div className="inventory-row" key={p.id}><span>{p.name}</span><strong>{p.stock}点</strong><button disabled>在庫追加</button></div>)}</section>}
        {tab === 'イベント' && <section className="panel"><h2>イベント設定</h2><label htmlFor="event-name">イベント名</label><input id="event-name" value={eventName} onChange={e => setEventName(e.target.value)} /><label htmlFor="event-date">開催日</label><input id="event-date" type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} /><h3>紐づけ商品（サンプル）</h3>{products.map(p => <div className="line" key={p.id}><span>{p.name}</span><span>{yen(p.price)}</span></div>)}<p className="muted">入力内容は保存されません。</p></section>}
        {tab === '設定' && <section className="panel"><h2>設定</h2>{['商品登録・編集', 'セット商品登録', 'バックアップ出力', 'インポート'].map(label => <div className="line setting-row" key={label}><span>{label}</span><button disabled>準備中</button></div>)}<p className="muted">各機能は後続Phaseで実装します。</p></section>}
      </main>
      <nav className="navigation" aria-label="メインメニュー">{tabs.map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
    </div>
  )
}

export default App
