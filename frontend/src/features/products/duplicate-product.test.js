import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildDuplicateDraft, saveDuplicateDraft, takeDuplicateDraft } from './duplicate-product.js'

const product = {
  name: 'Linen shirt', category: { id: 'cat-1', name: 'Shirts' },
  variants: [
    { id: 'v1', color: 'Blue', size: 'M', sellingPrice: '25.00', isActive: true },
    { id: 'v2', color: 'Blue', size: 'L', sellingPrice: '25.00', isActive: true },
    { id: 'v3', color: 'blue', size: 'XL', sellingPrice: '27.00', isActive: true },
    { id: 'v4', color: 'Black', size: 'M', sellingPrice: '25.00', isActive: true },
    { id: 'v5', color: 'Black', size: 'S', sellingPrice: '10.00', isActive: false },
    { id: 'v6', color: null, size: 'M', sellingPrice: null, isActive: true },
  ],
}

function memoryStorage() {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)) }, removeItem: (key) => { data.delete(key) } }
}

describe('duplicate product draft', () => {
  test('copies category, price, colors and sizes, and leaves the name to type', () => {
    let count = 0
    const draft = buildDuplicateDraft(product, { uuidFactory: () => `color-${++count}` })
    assert.equal(draft.name, ''); assert.equal(draft.categoryId, 'cat-1'); assert.equal(draft.sellingPrice, '25.00')
    assert.deepEqual(draft.colors.map((color) => [color.color, color.options.map((option) => option.size)]), [['Blue', ['M', 'L', 'XL']], ['Black', ['M']]])
    assert.ok(draft.colors.every((color) => color.options.every((option) => option.selected && option.barcode === '')))
    assert.equal(new Set(draft.colors.flatMap((color) => color.options.map((option) => option.sku))).size, 4, 'every copied size gets its own new code')
    assert.ok(!draft.colors.flatMap((color) => color.options.map((option) => option.sku)).includes(undefined))
  })

  test('skips inactive sizes and variants without a color, and a warehouse user gets no price', () => {
    const draft = buildDuplicateDraft(product, { owner: false })
    assert.equal(draft.sellingPrice, '')
    assert.equal(draft.colors.find((color) => color.color === 'Black').options.some((option) => option.size === 'S'), false)
    assert.equal(draft.colors.length, 2)
  })

  test('a product without variants gives an empty form with its category', () => {
    const draft = buildDuplicateDraft({ name: 'x', category: { id: 'c' }, variants: [] })
    assert.deepEqual({ ...draft, colors: [...draft.colors] }, { name: '', categoryId: 'c', sellingPrice: '', colors: [] })
  })
})

describe('handing the copy to the New product page', () => {
  test('is read once and then cleared', () => {
    const storage = memoryStorage()
    assert.equal(saveDuplicateDraft(storage, product), true)
    const taken = takeDuplicateDraft(storage)
    assert.equal(taken.sourceName, 'Linen shirt'); assert.equal(taken.draft.categoryId, 'cat-1')
    assert.equal(takeDuplicateDraft(storage), null, 'a second visit starts empty')
  })

  test('ignores damaged or missing data and works without storage', () => {
    const storage = memoryStorage()
    assert.equal(takeDuplicateDraft(storage), null)
    storage.setItem('saas2.duplicate-product', '{not json')
    assert.equal(takeDuplicateDraft(storage), null)
    storage.setItem('saas2.duplicate-product', JSON.stringify({ sourceName: 'x', draft: { name: 1, categoryId: '', sellingPrice: '', colors: [] } }))
    assert.equal(takeDuplicateDraft(storage), null)
    storage.setItem('saas2.duplicate-product', JSON.stringify({ sourceName: 'x', draft: { name: '', categoryId: '', sellingPrice: '', colors: [{ id: 'a', color: 'Red', options: [{ sku: 1 }] }] } }))
    assert.equal(takeDuplicateDraft(storage), null)
    assert.equal(saveDuplicateDraft(null, product), false); assert.equal(takeDuplicateDraft(null), null)
  })
})
