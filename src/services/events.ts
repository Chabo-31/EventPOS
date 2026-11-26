import { db } from '../database/db'
import type { EventRecord } from '../models/records'

export async function loadEvents() {
  return db.transaction('r', [db.events, db.products, db.bundles, db.images, db.eventProducts, db.eventBundles, db.settings], async () => ({
    events: await db.events.orderBy('date').reverse().toArray(),
    products: await db.products.orderBy('sortOrder').toArray(),
    bundles: await db.bundles.orderBy('sortOrder').toArray(),
    images: await db.images.toArray(),
    links: await db.eventProducts.toArray(),
    bundleLinks: await db.eventBundles.toArray(),
    selected: (await db.settings.get('activeEvent'))?.value ?? '',
  }))
}
export type EventData = Awaited<ReturnType<typeof loadEvents>>
export type EventDraft = { name: string; date: string; openingCash: string }
export const emptyEvent = (): EventDraft => ({ name: '', date: '', openingCash: '0' })
function integer(value: string, label: string, max = 99999999) {
  const n = Number(value)
  if (!value.trim() || !Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(label + 'は0～' + max.toLocaleString() + 'の整数で入力してください')
  return n
}
export async function selectEvent(id: string) {
  await db.transaction('rw', [db.events, db.settings], async () => {
    if (!await db.events.get(id)) throw new Error('イベントが見つかりません')
    await db.settings.put({ key: 'activeEvent', value: id })
  })
}
export async function saveEvent(id: string | null, draft: EventDraft) {
  const name = draft.name.trim()
  if (!name || name.length > 100) throw new Error('イベント名を1～100文字で入力してください')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(draft.date)) || new Date(draft.date).toISOString().slice(0,10) !== draft.date) throw new Error('開催日を入力してください')
  const openingCash = integer(draft.openingCash, '釣銭準備金')
  const eventId = id ?? crypto.randomUUID()
  await db.transaction('rw', [db.events, db.sales, db.movements, db.settings], async () => {
    if (id && !await db.events.get(id)) throw new Error('イベントが見つかりません')
    if (id && (await db.sales.where('eventId').equals(id).count() || (await db.movements.where('eventId').equals(id).toArray()).some(m=>m.reason!=='initial'))) throw new Error('販売・在庫操作後のイベント設定変更はできません')
    const event: EventRecord = { id: eventId, name, date: draft.date, openingCash }
    await db.events.put(event)
    await db.settings.put({ key: 'activeEvent', value: eventId })
  })
  return eventId
}
export function eventItems(data: EventData, eventId: string) {
  const links = data.links.filter(p => p.eventId === eventId)
  const stock = Object.fromEntries(links.map(p => [p.productId, p.stock]))
  const singles = data.products.flatMap(p => {
    const link = links.find(l => l.productId === p.id)
    return link ? [{ id: p.id, kind: 'product' as const, name: p.name, price: link.price, stock: link.stock, image: data.images.find(i => i.id === p.imageId)?.blob, components: [{ productId: p.id, quantity: 1 }] }] : []
  })
  const bundles = data.bundles.flatMap(b => {
    const link = data.bundleLinks.find(l => l.eventId === eventId && l.bundleId === b.id)
    return link ? [{ id: b.id, kind: 'bundle' as const, name: b.name, price: link.price, stock: b.components.length ? Math.min(...b.components.map(c => Math.floor((stock[c.productId] ?? 0) / c.quantity))) : 0, image: data.images.find(i => i.id === b.imageId)?.blob, components: b.components }] : []
  })
  return [...singles, ...bundles]
}
export type EventItem = ReturnType<typeof eventItems>[number]
export const itemKey = (p: EventItem) => p.kind + ':' + p.id
export function canAdd(items: EventItem[], qty: Record<string, number>, item: EventItem) {
  const used: Record<string, number> = {}
  for (const p of items) for (const c of p.components) used[c.productId] = (used[c.productId] ?? 0) + c.quantity * (qty[itemKey(p)] ?? 0)
  return item.components.length > 0 && item.components.every(c => (used[c.productId] ?? 0) + c.quantity <= (items.find(p => p.kind === 'product' && p.id === c.productId)?.stock ?? 0))
}

export async function copyEvent(source:string,draft:EventDraft,mode:import('./catalog').StockMode){
  const {copyCatalog}=await import('./catalog')
  return db.transaction('rw',[db.events,db.products,db.bundles,db.images,db.eventProducts,db.eventBundles,db.movements,db.sales,db.settings],async()=>{
    const id=await saveEvent(null,draft)
    await copyCatalog(source,id,mode)
    return id
  })
}
