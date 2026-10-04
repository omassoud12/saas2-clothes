import test from 'node:test'
import assert from 'node:assert/strict'
import { definitionDraft, recoverySummary } from './inventory-presentation.js'

test('recovery context uses exact decimal arithmetic and hides cost from Warehouse', () => {
  const record = { path: '/api/inventory/receipts', payload: { productId: 'product-1', unitCost: '1.2345', items: [{ variantId: 'a', quantity: 17 }, { variantId: 'b', quantity: 23 }] } }
  assert.deepEqual(recoverySummary(record, true), { name: null, productId: 'product-1', quantity: 40, options: 2, total: '49.3800', unitCost: '1.2345', saveOnly: false })
  assert.deepEqual(recoverySummary(record, false), { name: null, productId: 'product-1', quantity: 40, options: 2, total: null, unitCost: null, saveOnly: false })
})

test('save-only recovery context does not claim stock was received', () => {
  const record = { path: '/api/inventory/product-setups', payload: { product: { name: 'Shirt' }, variants: [{ sku: 'A' }], receipt: null } }
  assert.equal(recoverySummary(record, true).saveOnly, true)
  assert.equal(recoverySummary(record, true).quantity, 0)
})

test('returning to product definition restores colors, sizes, codes and price', () => {
  const original = { name: 'Shirt', categoryId: 'category', options: [{ color: 'Black', size: 'M', sku: 'BLACK-M', barcode: '123', sellingPrice: '15.00' }, { color: 'White', size: 'XL', sku: 'WHITE-XL', barcode: '', sellingPrice: '15.00' }] }
  const draft = definitionDraft(original)
  assert.equal(draft.name, 'Shirt')
  assert.equal(draft.categoryId, 'category')
  assert.equal(draft.sellingPrice, '15.00')
  assert.deepEqual(draft.colors.map(group => [group.color, group.options.map(option => ({ sku: option.sku, size: option.size, barcode: option.barcode, selected: option.selected }))]), [['Black', [{ sku: 'BLACK-M', size: 'M', barcode: '123', selected: true }]], ['White', [{ sku: 'WHITE-XL', size: 'XL', barcode: '', selected: true }]]])
})
