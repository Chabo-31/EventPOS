import NumberInput from '../components/NumberInput'
import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { loadCatalog, saveItem, deleteItem, moveItem, resizePhoto } from '../services/catalog'
import type { Kind, Item, Draft } from '../services/catalog'

const empty = (): Draft => ({ name: '', price: '0', stock: '0', components: {} })
const yen = (n: number) => '¥' + n.toLocaleString('ja-JP')
function Photo({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const value = URL.createObjectURL(blob)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [blob])
  return url ? <img className="master-photo" src={url} alt="商品写真" /> : <span className="master-photo placeholder">写真なし</span>
}
export default function ProductManager({ eventId }: { eventId: string }) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadCatalog>>>({ products: [], bundles: [], images: [], links: [] })
  const [kind, setKind] = useState<Kind>('product')
  const [editing, setEditing] = useState(false)
  const [id, setId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(empty)
  const [photo, setPhoto] = useState<Blob | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const sub = liveQuery(() => loadCatalog(eventId)).subscribe({ next: setCatalog, error: e => setMessage('読み込み失敗：' + String(e)) })
    return () => sub.unsubscribe()
  }, [eventId])
  const rows: Item[] = kind === 'product' ? catalog.products : catalog.bundles
  const imageFor = (item?: Item) => catalog.images.find(i => i.id === item?.imageId)?.blob
  const start = (item?: Item) => {
    setId(item?.id ?? null)
    setDraft(item ? { name: item.name, price: String(item.price), stock: String(catalog.links.find(l=>l.productId===item.id)?.initialStock??0), components: 'components' in item ? Object.fromEntries(item.components.map(c => [c.productId, String(c.quantity)])) : {} } : empty())
    setPhoto(undefined); setMessage(''); setEditing(true)
  }
  const perform = async (work: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await work(); setMessage(success) }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const current = rows.find(r => r.id === id)
  return <div className="master-manager">
    <h2>イベント商品</h2>
    <div className="master-tabs"><button className={kind === 'product' ? 'primary' : ''} disabled={busy} onClick={() => { setKind('product'); setEditing(false); setMessage('') }}>単品商品</button><button className={kind === 'bundle' ? 'primary' : ''} disabled={busy} onClick={() => { setKind('bundle'); setEditing(false); setMessage('') }}>セット商品</button></div>
    <p className="muted">このイベント専用の商品・在庫を登録します。</p>
    {editing ? <form className="master-form" onSubmit={e => { e.preventDefault(); void perform(async () => { await saveItem(eventId, kind, id, draft, photo); setEditing(false) }, '保存しました') }}>
      <h3>{id ? '商品編集' : '新規登録'}</h3>
      <fieldset disabled={busy}>
      <label htmlFor="master-name">商品名</label><input id="master-name" required maxLength={100} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
      <label htmlFor="master-price">販売価格（円）</label><NumberInput id="master-price" inputMode="numeric" min="0" max="99999999" step="1" required value={draft.price} onValueChange={value => setDraft(d => ({ ...d, price: value }))} />
      {kind==='product' && <><label htmlFor="master-stock">初期在庫</label><NumberInput id="master-stock" min="0" max="999999" step="1" required inputMode="numeric" value={draft.stock} onValueChange={value =>setDraft(d=>({...d,stock:value}))}/></>}
      <label htmlFor="master-photo">商品写真</label><Photo blob={photo === undefined ? imageFor(current) : photo ?? undefined} />
      <input id="master-photo" type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void perform(async () => setPhoto(await resizePhoto(file)), '画像を選択しました（保存前）') }} />
      <button className="danger-outline" type="button" onClick={() => setPhoto(null)}><svg className="danger-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>写真を削除</button>
      {kind === 'bundle' && <><h3>セット構成</h3>{catalog.products.length === 0 && <p>先に単品商品を登録してください。</p>}{catalog.products.map(p => <div className="master-component" key={p.id}><label htmlFor={'component-' + p.id}>{p.name}</label><NumberInput id={'component-' + p.id} inputMode="numeric" min="0" max="9999" step="1" value={draft.components[p.id] ?? ''} placeholder="0" onValueChange={value => setDraft(d => ({ ...d, components: { ...d.components, [p.id]: value } }))} /></div>)}</>}
      <div className="actions"><button type="button" onClick={() => setEditing(false)}>キャンセル</button><button className="primary" type="submit">保存</button></div>
      </fieldset>
    </form> : <><div className="line"><strong>{rows.length}件</strong><button className="primary" disabled={busy} onClick={() => start()}>＋ 新規登録</button></div>
      {rows.length === 0 && <p className="muted">登録されている商品はありません。</p>}
      {rows.map((item, i) => <article className="master-row" key={item.id}><Photo blob={imageFor(item)} /><div className="master-info"><strong>{item.name}</strong><span>{yen(item.price)}</span>{kind==='product' && <small>初期在庫 {catalog.links.find(l=>l.productId===item.id)?.initialStock??0}</small>}{'components' in item && item.components.map(c => <small key={c.productId}>{catalog.products.find(p => p.id === c.productId)?.name ?? '不明な商品'} × {c.quantity}</small>)}</div><div className="master-buttons"><button disabled={busy || i === 0} aria-label="上へ" onClick={() => void perform(() => moveItem(eventId, kind, item.id, -1), '並び替えました')}>↑</button><button disabled={busy || i === rows.length - 1} aria-label="下へ" onClick={() => void perform(() => moveItem(eventId, kind, item.id, 1), '並び替えました')}>↓</button><button disabled={busy} onClick={() => start(item)}>編集</button><button className="danger-outline" disabled={busy} onClick={() => { if (window.confirm(item.name + 'を削除しますか？')) void perform(() => deleteItem(eventId, kind, item.id), '削除しました') }}><svg className="danger-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>削除</button></div></article>)}
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </div>
}
