import { createHash } from 'node:crypto'
import { HttpError } from '../errors/http-error.js'
import { parseCatalogId, parseProductSetup } from '../products/product.schemas.js'
import { parseRestockInput } from '../restocks/restock.schemas.js'

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(422, 'INVALID_RECEIPT_INPUT', 'Unsupported receipt fields')
  return value as Record<string, unknown>
}
export function parseReceipt(value: unknown, key: 'variantId' | 'sku' = 'variantId') {
  const input = object(value, ['unitCost', 'items'])
  const cost = parseRestockInput({ quantity: 1, unitCost: input.unitCost }).unitCost
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) throw new HttpError(422, 'INVALID_RECEIPT_INPUT', 'Choose 1 to 200 receiving options')
  const seen = new Set<string>()
  const items = input.items.map(value => {
    const row = object(value, [key, 'quantity'])
    const id = key === 'variantId' ? parseCatalogId(row[key], key) : typeof row[key] === 'string' ? row[key].normalize('NFC').trim() : ''
    if (!id || seen.has(id)) throw new HttpError(422, 'RECEIPT_ITEM_DUPLICATE', 'Options must be unique')
    seen.add(id)
    const quantity = parseRestockInput({ quantity: row.quantity, unitCost: cost }).quantity
    return { id, quantity }
  }).sort((a, b) => a.id.localeCompare(b.id))
  return { unitCost: cost, items }
}
export function parseReceivingSetup(value: unknown, owner: boolean) {
  const input = object(value, ['product', 'variants', 'receipt'])
  const setup = parseProductSetup({ product: input.product, variants: input.variants }, owner)
  const combinations = new Set<string>()
  for (const variant of setup.variants) {
    const key = JSON.stringify([variant.color,variant.size].map(value=>(value??'').normalize('NFC').trim().toLowerCase()))
    if(combinations.has(key)) throw new HttpError(409,'VARIANT_COMBINATION_ALREADY_EXISTS','This color and size already exist')
    combinations.add(key)
  }
  if (setup.variants.some(v => v.openingStock !== undefined)) throw new HttpError(422, 'INVALID_RECEIPT_INPUT', 'Opening stock is not supported by this creation path')
  if (!owner && input.receipt != null) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Receiving requires an owner')
  const receipt = input.receipt == null ? null : parseReceipt(input.receipt, 'sku')
  if (receipt && receipt.items.some(item => !setup.variants.some(v => v.sku === item.id))) throw new HttpError(422, 'VARIANT_NOT_FOUND', 'Receipt option is not in this product')
  return { ...setup, variants: [...setup.variants].sort((a,b) => a.sku.localeCompare(b.sku)), receipt }
}
export function receiptFingerprint(accountId: string, userId: string, kind: string, input: unknown) {
  return createHash('sha256').update(JSON.stringify([accountId, userId, kind, input])).digest('hex')
}

function deterministicReceiptMovementKey(operationId: string, accountId: string, variantId: string): string {
  // Match the established internal-child-key model used by Exchanges: the
  // receipt operation UUID is the namespace and the option is the child name.
  const namespace = Buffer.from(operationId.replaceAll('-', ''), 'hex')
  const digest = createHash('sha1')
    .update(namespace)
    .update(`receipt-restock:${accountId.toLowerCase()}:${variantId.toLowerCase()}`, 'utf8')
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = digest.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function receiptMovementIdentity(
  accountId: string,
  userId: string,
  operationId: string,
  productId: string,
  item: { id: string; quantity: number },
  unitCost: string,
) {
  const scope = {
    type: 'RECEIPT_RESTOCK',
    accountId: accountId.toLowerCase(),
    receiptOperationId: operationId.toLowerCase(),
    variantId: item.id.toLowerCase(),
  }
  const requestFingerprint = createHash('sha256').update(JSON.stringify({
    ...scope,
    performedById: userId.toLowerCase(),
    productId: productId.toLowerCase(),
    quantity: item.quantity,
    unitCost,
  }), 'utf8').digest('hex')
  return { idempotencyKey: deterministicReceiptMovementKey(operationId,accountId,item.id), requestFingerprint }
}
