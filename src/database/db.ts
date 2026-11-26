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
  }
}

export const db = new EventPOSDatabase()
