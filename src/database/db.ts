import Dexie from 'dexie'
import type { Table } from 'dexie'
import type { EventRecord, Product, ProductImage, Bundle, EventProduct, EventBundle, InventoryMovement, Sale, Setting } from '../models/records'

export class EventPOSDatabase extends Dexie {
  declare events: Table<EventRecord, string>
  declare products: Table<Product, string>
  declare images: Table<ProductImage, string>
  declare bundles: Table<Bundle, string>
  declare eventProducts: Table<EventProduct, [string, string]>
  declare eventBundles: Table<EventBundle, [string, string]>
  declare movements: Table<InventoryMovement, string>
  declare sales: Table<Sale, string>
  declare settings: Table<Setting, string>

  constructor(name = 'EventPOS') {
    super(name)
    this.version(1).stores({
      events: 'id,date',
      products: 'id,sortOrder',
      images: 'id',
      bundles: 'id,sortOrder',
      eventProducts: '[eventId+productId],eventId,productId',
      eventBundles: '[eventId+bundleId],eventId,bundleId',
      movements: 'id,eventId,productId,timestamp,transactionId',
      sales: 'id,eventId,timestamp',
      settings: 'key',
    })
    this.version(2).stores({
      products: 'id,sortOrder,eventId',
      bundles: 'id,sortOrder,eventId',
    }).upgrade(async tx => {
      // Preserve old masters as unassigned legacy records. Clone linked records per event.
      const products = tx.table<Product, string>('products')
      const bundles = tx.table<Bundle, string>('bundles')
      const images = tx.table<ProductImage, string>('images')
      const links = tx.table<EventProduct, [string,string]>('eventProducts')
      const bundleLinks = tx.table<EventBundle, [string,string]>('eventBundles')
      const movements = tx.table<InventoryMovement, string>('movements')
      const sales = tx.table<Sale, string>('sales')
      const cloneImage = async (id?: string) => {
        if (!id) return undefined
        const image = await images.get(id)
        if (!image) return undefined
        const newId = crypto.randomUUID()
        await images.add({ id: newId, blob: image.blob })
        return newId
      }
      for (const event of await tx.table<EventRecord, string>('events').toArray()) {
        const ids = new Map<string,string>()
        const bundleIds = new Map<string,string>()
        for (const link of await links.where('eventId').equals(event.id).toArray()) {
          const old = await products.get(link.productId)
          if (!old) throw new Error('旧商品の移行に失敗しました')
          const id = crypto.randomUUID()
          ids.set(old.id,id)
          await products.add({ ...old, id, eventId: event.id, price: link.price, imageId: await cloneImage(old.imageId) })
          await links.delete([event.id,old.id])
          await links.add({ ...link, productId: id })
        }
        for (const link of await bundleLinks.where('eventId').equals(event.id).toArray()) {
          const old = await bundles.get(link.bundleId)
          if (!old) throw new Error('旧セットの移行に失敗しました')
          const id = crypto.randomUUID()
          bundleIds.set(old.id,id)
          const components = old.components.map(c => {
            const productId = ids.get(c.productId)
            if (!productId) throw new Error('旧セット構成の移行に失敗しました')
            return { ...c, productId }
          })
          await bundles.add({ ...old,id,eventId:event.id,price:link.price,components,imageId:await cloneImage(old.imageId) })
          await bundleLinks.delete([event.id,old.id])
          await bundleLinks.add({ ...link,bundleId:id })
        }
        for (const m of await movements.where('eventId').equals(event.id).toArray()) {
          await movements.put({ ...m,productId:ids.get(m.productId) ?? m.productId })
        }
        for (const sale of await sales.where('eventId').equals(event.id).toArray()) {
          await sales.put({ ...sale, lines:sale.lines.map(l=>({ ...l,itemId:(l.kind==='product'?ids:bundleIds).get(l.itemId) ?? l.itemId,components:l.components.map(c=>({...c,productId:ids.get(c.productId)??c.productId})) })) })
        }
      }
    })
  }
}

export const db = new EventPOSDatabase()
