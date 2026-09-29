import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductSetupWorkflow, validateProductSetup } from './product-setup-flow.js'

const option = { sku: 'BLACK-M', color: 'Black', size: 'M', sellingPrice: '15', quantity: '10', unitCost: '8' }
const draft = () => ({ name: 'T-shirt', categoryId: 'category', options: [{ ...option }] })
function setup(overrides = {}) {
  const calls = { product: 0, variant: 0, stock: [] }
  const workflow = createProductSetupWorkflow({
    role: 'OWNER', createKey: () => 'stable-key',
    createProduct: async () => { calls.product++; return { ok: true, product: { id: 'product' } } },
    createVariant: async () => { calls.variant++; return { ok: true, variant: { id: 'variant' } } },
    restock: async (...args) => { calls.stock.push(args); return { ok: true } },
    ...overrides,
  })
  return { workflow, calls }
}

test('validates every option before any creation', async () => {
  const { workflow, calls } = setup()
  const input = draft()
  input.options.push({ ...option, sku: 'WHITE-L', unitCost: '0' })
  assert.equal((await workflow.submit(input)).ok, false)
  assert.equal(calls.product, 0)
  assert.equal(workflow.started, false)
  assert.equal(validateProductSetup({ ...input, options: [option, option] }, 'OWNER').ok, false)
})

test('uncertain stock retry keeps IDs, payload and key without recreating catalog records', async () => {
  const stocks = []
  const { workflow, calls } = setup({ restock: async (...args) => {
    stocks.push(args)
    return stocks.length === 1 ? { ok: false, uncertain: true } : { ok: true }
  } })
  const input = draft()
  assert.equal((await workflow.submit(input)).ok, false)
  input.options[0].quantity = '999'
  assert.equal((await workflow.submit(input)).ok, true)
  assert.equal(calls.product, 1)
  assert.equal(calls.variant, 1)
  assert.deepEqual(stocks[0], stocks[1])
  assert.equal(stocks[1][2].quantity, 10)
})

test('confirmed earlier rows are skipped when a later row fails', async () => {
  let variants = 0
  const { workflow, calls } = setup({ createVariant: async () => {
    variants++
    return variants === 2 ? { ok: false, message: 'Temporary limit' } : { ok: true, variant: { id: String(variants) } }
  } })
  const input = draft()
  input.options.push({ ...option, sku: 'WHITE-M', color:'White' })
  assert.equal((await workflow.submit(input)).ok, false)
  assert.equal((await workflow.submit(input)).ok, true)
  assert.equal(calls.product, 1)
  assert.equal(calls.stock.length, 2)
  assert.equal(variants, 3)
})

test('uncertain catalog creation cannot be blindly repeated', async () => {
  let count = 0
  const { workflow } = setup({ createProduct: async () => { count++; return { ok: false, uncertain: true } } })
  assert.equal((await workflow.submit(draft())).review, true)
  assert.equal((await workflow.submit(draft())).review, true)
  assert.equal(count, 1)
})

test('a thrown variant request also requires review instead of repeating creation', async () => {
  const { workflow } = setup({ createVariant: async () => { throw Error('Disconnected') } })
  assert.equal((await workflow.submit(draft())).review, true)
  assert.equal(workflow.productId, 'product')
})

test('zero stock and warehouse submissions never call restock', async () => {
  for (const role of ['OWNER', 'WAREHOUSE']) {
    const { workflow, calls } = setup({ role })
    const input = draft()
    if (role === 'OWNER') input.options[0].quantity = '0'
    assert.equal((await workflow.submit(input)).ok, true)
    assert.equal(calls.stock.length, 0)
  }
})

test('concurrent submit is ignored while a request is pending', async () => {
  let finish
  const { workflow } = setup({ createProduct: () => new Promise((resolve) => { finish = resolve }) })
  const first = workflow.submit(draft())
  assert.deepEqual(await workflow.submit(draft()), { skipped: true })
  finish({ ok: true, product: { id: 'product' } })
  assert.equal((await first).ok, true)
})

test('one model saves all selected sizes with separate stock quantities', async () => {
  const variants = []
  const { workflow, calls } = setup({ createVariant: async (productId, input) => {
    variants.push({ productId, ...input })
    return { ok: true, variant: { id: input.size } }
  } })
  const input = draft()
  input.options = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'].map((size, index) => ({ ...option, sku: `BLACK-${size}`, size, quantity: String(index + 1) }))
  assert.equal((await workflow.submit(input)).ok, true)
  assert.equal(calls.product, 1)
  assert.equal(variants.length, 8)
  assert.ok(variants.every((variant) => variant.productId === 'product' && variant.color === 'Black'))
  assert.deepEqual(calls.stock.map((args) => [args[1], args[2].quantity]), input.options.map((item) => [item.size, Number(item.quantity)]))
})


test('invalid optional photo is rejected before creating a product', async () => {
  const { workflow, calls } = setup()
  const result = await workflow.submit(draft(), { type: 'image/gif', size: 100 })
  assert.equal(result.ok, false)
  assert.equal(calls.product, 0)
})

test('photo retry retains the file and never recreates product or sizes', async () => {
  const uploads = []
  const file = { type: 'image/png', size: 100 }
  const { workflow, calls } = setup({ uploadImage: async (id, image) => {
    uploads.push([id, image])
    return uploads.length === 1 ? { ok: false, uncertain: true, message: 'Connection lost' } : { ok: true }
  } })
  assert.equal((await workflow.submit(draft(), file)).ok, false)
  assert.equal((await workflow.submit(draft(), null)).ok, true)
  assert.equal(calls.product, 1)
  assert.equal(calls.variant, 1)
  assert.equal(uploads.length, 2)
  assert.equal(uploads[1][0], 'product')
  assert.equal(uploads[1][1], file)
})

test('batch creation uses one request and image retry never repeats the catalog save', async () => {
  let saves = 0, uploads = 0
  const { workflow, calls } = setup({ createSetup: async () => { saves++; return { ok: true, product: { id: 'batch' } } }, uploadImage: async () => ++uploads === 1 ? { ok: false, message: 'Retry image' } : { ok: true } })
  const input = draft()
  input.options = ['XS','S','M','L','XL','XXL','3XL','4XL'].map(size => ({ sku: `BLACK-${size}`, color: 'Black', size, sellingPrice: '15', openingStock: true }))
  const image = { type: 'image/png', size: 100 }
  assert.equal((await workflow.submit(input, image)).ok, false)
  assert.equal((await workflow.submit(input, image)).ok, true)
  assert.equal(saves, 1)
  assert.equal(calls.product, 0)
  assert.equal(calls.variant, 0)
  assert.equal(calls.stock.length, 0)
})
