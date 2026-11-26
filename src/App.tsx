import NumberInput from './components/NumberInput'
import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { completeSale } from './services/checkout'
import type { Sale, SaleLine } from './models/records'
import EventManager from './pages/EventManager'
import BackupManager from './pages/BackupManager'
import PwaSettings from './components/PwaSettings'
import { pwa, subscribePwa } from './services/pwa'
import InventoryManager from './pages/InventoryManager'
import { loadEvents, eventItems, canAdd, itemKey } from './services/events'
import type { EventData, EventItem } from './services/events'
import './App.css'
import { checkDatabase } from './database/diagnostics'
import { db } from './database/db'
import CashPresetSettings, { defaultPresets, readPresets } from './components/CashPresetSettings'

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
  const [pwaState,setPwaState]=useState({...pwa})
  useEffect(()=>{const sync=()=>setPwaState({...pwa});const unsubscribe=subscribePwa(sync);sync();return unsubscribe},[])
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
  const [cash, setCash] = useState('0')
  const [presets,setPresets]=useState<number[]>(defaultPresets)
  useEffect(()=>{const sub=liveQuery(async()=>readPresets((await db.settings.get('cashPresets'))?.value)).subscribe({next:setPresets,error:e=>setLoadError(String(e))});return ()=>sub.unsubscribe()},[])
  const cashLimit=999999999
  const enterCash=(key:string)=>{if(gate.current)return;setCash(prev=>{const digits=/^\d+$/.test(prev)?prev:'0';if(key==='C')return '0';if(key==='⌫')return digits.slice(0,-1)||'0';const n=Number(digits+key);return Number.isSafeInteger(n)&&n<=cashLimit?String(n):prev})}
  const addCash=(n:number)=>setCash(prev=>String(Math.min(cashLimit,Math.max(0,Number(prev)||0)+n)))
  const [saving,setSaving]=useState(false)
  const [receipt,setReceipt]=useState<Sale|null>(null)
  const [saleError,setSaleError]=useState('')
  const gate=useRef(false)
  const amount = (p: EventItem) => qty[itemKey(p)] ?? 0
  const total = products.reduce((sum, p) => sum + p.price * amount(p), 0)
  const count = products.reduce((sum, p) => sum + amount(p), 0)
  const change = Number(cash) - total
  const valid = !!active && !saving && count > 0 && Number.isSafeInteger(total) && cash !== '' && Number.isSafeInteger(Number(cash)) && Number(cash) >= 0 && Number(cash)<=cashLimit && change >= 0
  const adjust = (p: EventItem, delta: number) => {
    if (!active || gate.current) return
    setReceipt(null); setSaleError('')
    setCart(prev => {
      const current = prev.eventId === active.id ? prev.qty : {}
      if (delta > 0 && !canAdd(products, current, p)) return prev
      return { eventId: active.id, qty: { ...current, [itemKey(p)]: Math.max(0, (current[itemKey(p)] ?? 0) + delta) } }
    })
  }
  const reset = () => { setCart({ eventId: active?.id ?? '', qty: {} }); setCash('0'); setCashOpen(false) }

  const confirmSale=async()=>{
    if(!active||!valid||gate.current)return
    gate.current=true;setSaving(true);setSaleError('');setReceipt(null)
    const lines:SaleLine[]=products.filter(p=>amount(p)>0).map(p=>({itemId:p.id,kind:p.kind,name:p.name,unitPrice:p.price,quantity:amount(p),components:p.components}))
    try{
      const sale=await completeSale(active.id,crypto.randomUUID(),lines,Number(cash),total)
      reset();setReceipt(sale)
    }catch(e){setSaleError(e instanceof Error?e.message:String(e))}
    finally{gate.current=false;setSaving(false)}
  }

  return (
    <div className="app-shell">
      <header className="app-header"><div><h1>EventPOS</h1><p>{active ? active.name + ' · ' + active.date : 'イベント未選択'}</p></div><div className="header-status"><span className="preview-label">現金決済</span>{!pwaState.online&&<span className="offline-label">オフライン</span>}</div></header>
      <main className="workspace">{pwaState.update&&<div className="inventory-notice pwa-update" role="status">新しいバージョンがあります。会計終了後に設定タブから更新してください。</div>}{loadError && <p role="alert">読み込み失敗：{loadError}</p>}{!data && !loadError && <p>読み込み中…</p>}
        {tab === '会計' && <>{receipt && receipt.eventId===active?.id && <div className="sale-receipt" role="status"><div><strong>会計完了</strong><span>売上 {yen(receipt.total)} ／ お釣り {yen(receipt.change)}</span></div><button onClick={()=>setReceipt(null)}>閉じる</button></div>}{saleError && <p className="sale-error" role="alert">{saleError}</p>}<div className="checkout">
          <section className="catalog"><h2>商品選択</h2>{!active && <p className="muted">イベントタブで販売対象を登録・選択してください。</p>}{active && !products.length && <p className="muted">イベントタブで商品を登録してください。</p>}<div className="product-grid">{products.map(p => <article key={itemKey(p)} className={'product-card' + (amount(p) ? ' selected' : '')}>
            <button className="product-image"  onClick={() => adjust(p, 1)} disabled={saving || !canAdd(products, qty, p)} aria-label={p.name + 'を追加'}><ItemPhoto blob={p.image} /></button>
            <div className="product-body"><h3>{p.name}{p.kind === "bundle" && <small> セット</small>}</h3><div className="product-meta"><strong>{yen(p.price)}</strong><small>在庫 {p.stock}</small></div>
            <div className="quantity"><button onClick={() => adjust(p, -1)} disabled={saving || !amount(p)} aria-label={p.name + 'を減らす'}>−</button><strong>{amount(p)}</strong><button onClick={() => adjust(p, 1)} disabled={saving || !canAdd(products, qty, p)} aria-label={p.name + 'を増やす'}>＋</button></div></div>
          </article>)}</div></section>
          <section className={"panel checkout-summary" + (cashOpen ? " expanded" : "")}><button className="mobile-summary-toggle" onClick={() => setCashOpen(v => !v)} aria-expanded={cashOpen}><span>合計 {count}点</span><strong>{yen(total)}</strong><span>{cashOpen ? "閉じる" : "会計へ"}</span></button><div className="summary-details"><h2>会計内容</h2><div className="cart-lines">{count === 0 ? <p className="muted">商品を選択してください</p> : products.map(p => amount(p) > 0 && <div className="line" key={itemKey(p)}><span>{p.name} × {amount(p)}</span><strong>{yen(p.price * amount(p))}</strong></div>)}</div>
            <div className="line total"><span>合計金額 · {count}点</span><strong>{yen(total)}</strong></div>
            <label htmlFor="cash">お預かり金額</label><NumberInput disabled={saving} id="cash" min="0" max={cashLimit} step="1" inputMode="numeric" value={cash} onValueChange={value => {if(value===""||(/^\d+$/.test(value)&&Number(value)<=cashLimit))setCash(value)}} placeholder="金額を入力" />
            <div className="cash-buttons">{presets.map((n,i)=><button disabled={saving} key={i} onClick={()=>addCash(n)}>+{n.toLocaleString()}</button>)}<button disabled={saving||total>cashLimit} onClick={()=>setCash(String(total))}>ぴったり</button></div>
            <div className="cash-keypad" aria-label="お預かり金額テンキー">{['7','8','9','4','5','6','1','2','3','C','0','⌫'].map(k=><button type="button" key={k} disabled={saving} aria-label={k==='C'?'金額クリア':k==='⌫'?'1桁削除':k} onClick={()=>enterCash(k)}>{k}</button>)}</div>
            <div className={'line change' + (cash !== '' && change < 0 ? ' shortage' : '')}><span>{cash !== '' && change < 0 ? '不足金額' : 'お釣り'}</span><strong>{cash === '' ? '—' : yen(Math.abs(change))}</strong></div>
            <div className="actions"><button disabled={saving} onClick={()=>{reset();setReceipt(null);setSaleError('')}}>リセット</button><button className="primary" disabled={!valid} onClick={() => void confirmSale()}>{saving ? '保存中…' : '会計確定'}</button></div></div>
          </section>
        </div></>}
        {tab === '在庫' && data && <InventoryManager key={active?.id??''} eventId={active?.id??''} items={products} onMutation={()=>{reset();setReceipt(null);setSaleError('')}} />}
        {tab === 'イベント' && data && <EventManager data={data} />}
        {tab === '設定' && <section className="panel"><h2>設定</h2><CashPresetSettings values={presets}/><BackupManager data={data} onRestore={()=>{reset();setReceipt(null);setSaleError('')}} /><PwaSettings/><h3>データベース診断</h3><button onClick={() => void runDiagnostics()} disabled={dbBusy}>{dbBusy ? "診断中…" : "保存・復元テスト"}</button><div role="status" aria-live="polite">{dbReport.map((line, i) => <p key={i}>{line}</p>)}</div></section>}
      </main>
      <nav className="navigation" aria-label="メインメニュー">{tabs.map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''} disabled={saving} onClick={() => { if (t === 'イベント') { reset();setReceipt(null);setSaleError('') }; setTab(t) }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={navPaths[t]} /></svg><span>{t}</span></button>)}</nav>
    </div>
  )
}

export default App
