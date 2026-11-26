import { db } from '../database/db'
import type { Product, Bundle } from '../models/records'

export type Kind = 'product' | 'bundle'
export type Item = Product | Bundle
export type Draft = { name: string; price: string; components: Record<string, string> }
export async function resizePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください')
  if (file.size > 30 * 1024 * 1024) throw new Error('画像は30MB以下にしてください')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像処理に失敗しました')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('画像変換に失敗しました')), 'image/jpeg', .85))
  } finally { URL.revokeObjectURL(url) }
}
export async function loadCatalog() {
  return db.transaction('r', [db.products, db.bundles, db.images], async () => ({
    products: await db.products.orderBy('sortOrder').toArray(),
    bundles: await db.bundles.orderBy('sortOrder').toArray(),
    images: await db.images.toArray(),
  }))
}
export async function saveItem(kind: Kind, id: string | null, draft: Draft, photo: Blob | null | undefined) {
  const name = draft.name.trim()
  const price = Number(draft.price)
  if (!name || name.length > 100) throw new Error('商品名は1～100文字で入力してください')
  if (!draft.price.trim() || !Number.isSafeInteger(price) || price < 0 || price > 99999999) throw new Error('価格は0～99,999,999円の整数で入力してください')
  const components = Object.entries(draft.components).filter(([, v]) => v.trim() !== '' && Number(v) !== 0).map(([productId, v]) => ({ productId, quantity: Number(v) }))
  if (kind === 'bundle' && (!components.length || components.some(c => !Number.isSafeInteger(c.quantity) || c.quantity < 1 || c.quantity > 9999))) throw new Error('セット構成数量を1～9999の整数で入力してください')
  await db.transaction('rw', [db.products, db.bundles, db.images, db.eventBundles], async () => {
    const table = kind === 'product' ? db.products : db.bundles
    const previous = id ? await table.get(id) : undefined
    if (id && !previous) throw new Error('商品が見つかりません')
    if (kind === 'bundle') {
      for (const c of components) if (!await db.products.get(c.productId)) throw new Error('構成商品が見つかりません')
      if (previous && 'components' in previous && await db.eventBundles.where('bundleId').equals(previous.id).count()) {
        const signature = (list: Bundle['components']) => JSON.stringify([...list].sort((a,b) => a.productId.localeCompare(b.productId)))
        if (signature(previous.components) !== signature(components)) throw new Error('イベントに紐づいたセットの構成は変更できません')
      }
    }
    const itemId = id ?? crypto.randomUUID()
    let imageId = previous?.imageId
    if (photo !== undefined) {
      if (imageId) await db.images.delete(imageId)
      imageId = photo ? crypto.randomUUID() : undefined
      if (photo && imageId) await db.images.add({ id: imageId, blob: photo })
    }
    const last = await table.orderBy('sortOrder').last()
    const record: Product = { id: itemId, name, price, sortOrder: previous?.sortOrder ?? ((last?.sortOrder ?? -1) + 1), ...(imageId ? { imageId } : {}) }
    if (kind === 'product') await db.products.put(record)
    else await db.bundles.put({ ...record, components })
  })
}
export async function deleteItem(kind: Kind, id: string) {
  await db.transaction('rw', [db.products, db.bundles, db.images, db.eventProducts, db.eventBundles, db.sales, db.movements], async () => {
    if (kind === 'product') {
      if (await db.eventProducts.where('productId').equals(id).count() || await db.movements.where('productId').equals(id).count() || (await db.bundles.toArray()).some(b => b.components.some(c => c.productId === id))) throw new Error('イベント・在庫履歴・セットで使用中の商品は削除できません')
    } else if (await db.eventBundles.where('bundleId').equals(id).count()) throw new Error('イベントで使用中のセットは削除できません')
    if ((await db.sales.toArray()).some(s => s.lines.some(l => (l.kind === kind && l.itemId === id) || (kind === 'product' && l.components.some(c => c.productId === id))))) throw new Error('会計履歴で使用中の商品は削除できません')
    const table = kind === 'product' ? db.products : db.bundles
    const item = await table.get(id)
    await table.delete(id)
    if (item?.imageId) await db.images.delete(item.imageId)
  })
}
export async function moveItem(kind: Kind, id: string, delta: number) {
  await db.transaction('rw', [db.products, db.bundles], async () => {
    const table = kind === 'product' ? db.products : db.bundles
    const rows = await table.orderBy('sortOrder').toArray()
    const i = rows.findIndex(r => r.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= rows.length) return
    const temp = rows[i]; rows[i] = rows[j]; rows[j] = temp
    for (let k = 0; k < rows.length; k++) await table.update(rows[k].id, { sortOrder: k })
  })
}
