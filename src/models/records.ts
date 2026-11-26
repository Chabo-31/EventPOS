export interface EventRecord { id: string; name: string; date: string; openingCash: number }
export interface Product { id: string; eventId?: string; name: string; price: number; imageId?: string; sortOrder: number }
export interface ProductImage { id: string; blob: Blob }
export interface Bundle { id: string; eventId?: string; name: string; price: number; imageId?: string; sortOrder: number; components: { productId: string; quantity: number }[] }
export interface EventProduct { eventId: string; productId: string; initialStock: number; stock: number; price: number }
export interface EventBundle { eventId: string; bundleId: string; price: number }
export interface InventoryMovement { id: string; eventId: string; productId: string; delta: number; reason: 'initial' | 'addition' | 'sale' | 'cancel'; timestamp: string; transactionId?: string }
export interface SaleLine { itemId: string; kind: 'product' | 'bundle'; name: string; unitPrice: number; quantity: number; components: { productId: string; quantity: number }[] }
export interface Sale { id: string; eventId: string; timestamp: string; lines: SaleLine[]; total: number; cash: number; change: number; cancelledAt?: string }
export interface Setting { key: string; value: string }
