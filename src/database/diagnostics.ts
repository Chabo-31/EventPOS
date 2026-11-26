import { db, EventPOSDatabase } from './db'

export async function checkDatabase(): Promise<string[]> {
  const results: string[] = []
  await db.open()
  results.push('本番DBの初期化：OK（スキーマ v' + db.verno + '）')
  // Use a separate temporary database, never modify actual sales or stock.
  const name = 'EventPOS-diagnostic-' + crypto.randomUUID()
  let test = new EventPOSDatabase(name)
  try {
    await test.open()
    await test.transaction('rw', [test.events, test.products, test.images, test.eventProducts], async () => {
      await test.events.add({ id: 'e', name: '診断イベント', date: '2026-12-20', openingCash: 0 })
      await test.products.add({ id: 'p', name: '診断商品', price: 500, imageId: 'i', sortOrder: 0 })
      await test.images.add({ id: 'i', blob: new Blob(['image-test'], { type: 'text/plain' }) })
      await test.eventProducts.add({ eventId: 'e', productId: 'p', initialStock: 10, stock: 10, price: 500 })
    })
    results.push('イベント・商品・在庫の一括保存：OK')
    test.close()
    test = new EventPOSDatabase(name)
    await test.open()
    const product = await test.products.get('p')
    const stock = await test.eventProducts.get(['e', 'p'])
    const image = await test.images.get('i')
    const event = await test.events.get('e')
    if (event?.name !== '診断イベント' || product?.price !== 500 || stock?.stock !== 10 || !image || await image.blob.text() !== 'image-test') throw new Error('再読み込み結果が一致しません')
    results.push('DB再接続・画像データ復元：OK')
    let aborted = false
    try {
      await test.transaction('rw', test.eventProducts, async () => {
        await test.eventProducts.update(['e', 'p'], { stock: 7 })
        throw new Error('diagnostic rollback')
      })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'diagnostic rollback') throw error
      aborted = true
    }
    if (!aborted || (await test.eventProducts.get(['e', 'p']))?.stock !== 10) throw new Error('ロールバック失敗')
    results.push('トランザクションのロールバック：OK')
  } finally {
    test.close()
    await test.delete()
  }
  results.push('診断用DB削除：OK')
  return results
}
