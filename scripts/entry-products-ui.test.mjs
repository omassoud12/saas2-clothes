// Offline IA acceptance tests; every API request is intercepted before execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, noOverflow, catId, screenshots } from './products-ui-fixture.mjs'

async function detail(page) {
  await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
  await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
}
async function section(page, name) { await page.getByRole('navigation', { name: 'Product management sections' }).getByRole('button', { name, exact: true }).click() }
async function entry(page, name = 'New shirt') {
  await page.getByRole('button', { name: /Add product/i }).first().click()
  await page.getByRole('heading', { name: 'Product Entry', exact: true }).waitFor()
  await page.getByLabel('Product name', { exact: true }).fill(name)
  await page.getByLabel('Category', { exact: true }).selectOption(catId)
  await page.getByLabel('Colors', { exact: true }).selectOption('Black')
  await page.getByRole('button', { name: 'M', exact: true }).click()
}
async function receive(page, quantity = '2') {
  await page.getByLabel('Receiving now: Navy / S', { exact: true }).fill(quantity)
  await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
  await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm receiving', exact: true }).click()
}
async function correct(page, delta = 1) {
  await page.getByRole('button', { name: delta > 0 ? 'Add one piece: Navy / S' : 'Remove one piece: Navy / S', exact: true }).click()
  await page.getByRole('dialog', { name: 'Correct physical count?', exact: true }).getByRole('button', { name: 'Confirm correction', exact: true }).click()
}
const writes = calls => calls.filter(call => call.method !== 'GET')

for (const width of [390, 768, 1280, 1440]) test(`Entry and every product section fit ${width}px, load lazily and keep touch targets`, async () => {
  const { page, calls, errors } = await open(width, 900)
  try {
    await noOverflow(page)
    assert.equal(calls.filter(call => call.path === '/api/products').length, 1)
    assert.ok(calls.find(call => call.path === '/api/products').query.includes('view=summary'))
    assert.equal(calls.filter(call => call.path.startsWith('/api/inventory/')).length, 0)
    // The stretched semantic button makes the whole card clickable.
    await page.locator('.product-card').first().click({ position: { x: 14, y: 14 } })
    await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
    assert.equal(calls.filter(call => call.path.startsWith('/api/inventory/')).length, 0)
    for (const name of ['Overview', 'Stock', 'Restock', 'Movement History', 'Count Check', 'Receipt History']) {
      await section(page, name)
      const heights = await page.locator('.product-section-nav button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
      assert.ok(heights.every(height => height >= 44))
      try { await noOverflow(page) } catch (error) {
        error.message += ` Section: ${name}. ` + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r=node.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 }).map(node => ({tag:node.tagName,cls:node.className,width:node.getBoundingClientRect().width})).slice(0,15)))
        throw new Error(error.message)
      }
      await page.screenshot({ path: join(screenshots, `ia-${name.replaceAll(' ', '-').toLowerCase()}-${width}.png`), fullPage: true })
    }
    assert.equal(calls.filter(call => call.path === '/api/inventory/movements').length, 1)
    assert.equal(calls.filter(call => call.path === '/api/inventory/reconciliation').length, 1)
    assert.equal(calls.filter(call => call.path === '/api/inventory/receipts').length, 1)
    assert.ok(calls.find(call => call.path === '/api/inventory/movements').query.includes('productId='))
    assert.ok(calls.find(call => call.path === '/api/inventory/reconciliation').query.includes('productId='))
    await section(page, 'Movement History')
    await page.getByText('No movements match these filters yet.').waitFor()
    assert.equal(calls.filter(call => call.path === '/api/inventory/movements').length, 1, 'unchanged visits reuse loaded history')
    await page.getByRole('button', { name: 'Back to products', exact: true }).click()
    await entry(page)
    await noOverflow(page)
    assert.equal(await page.getByRole('heading', { name: 'Movement history', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Edit product', exact: true }).count(), 0)
    const minHeight = await page.getByLabel('Product name', { exact: true }).evaluate(node => node.getBoundingClientRect().height)
    assert.ok(minHeight >= 44)
    await page.screenshot({ path: join(screenshots, `ia-entry-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Receiving now: Black / M', { exact: true }).fill('3')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    await page.getByRole('heading', { name: 'Review receiving', exact: true }).waitFor()
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, `ia-entry-review-${width}.png`), fullPage: true })
    assert.equal(writes(calls).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('Sidebar Entry opens creation immediately, fetches categories only and excludes existing-product tools', async () => {
  const { page, calls } = await open(390, 844)
  try {
    const before = calls.length
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await page.getByRole('link', { name: 'Entry', exact: true }).click()
    await page.getByLabel('Product name', { exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/app/inventory')
    assert.equal(await page.getByRole('heading', { name: 'Product Entry', exact: true }).count(), 1)
    assert.equal(calls.slice(before).filter(call => call.path === '/api/products').length, 0)
    assert.equal(calls.filter(call => call.path.startsWith('/api/inventory/')).length, 0)
  } finally { await page.close() }
})

test('Owner zero-stock creation has one canonical setup, review and next actions', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await entry(page)
    await page.getByLabel('Price for all sizes (USD)', { exact: true }).fill('15.00')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Save product only', exact: true }).click()
    assert.equal(writes(calls).length, 0)
    await page.getByRole('heading', { name: 'Review product', exact: true }).waitFor()
    await page.getByText('Black / M', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Confirm product only', exact: true }).click()
    await page.getByRole('heading', { name: 'Product created successfully', exact: true }).waitFor()
    assert.equal(writes(calls).length, 1)
    const save = writes(calls)[0]
    assert.equal(save.path, '/api/inventory/product-setups')
    assert.equal(save.body.receipt, null)
    assert.equal(save.body.variants[0].sellingPrice, '15.00')
    assert.equal(Object.hasOwn(save.body.variants[0], 'openingStock'), false)
    assert.ok(save.operationId)
    await page.getByRole('button', { name: 'Add Another Product', exact: true }).click()
    assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), '')
  } finally { await page.close() }
})

test('Owner initial receiving uses setup receipt and no separate stock mutation', async () => {
  const { page, calls } = await open(768, 900)
  try {
    await entry(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Receiving now: Black / M', { exact: true }).fill('3')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    await page.getByText('3.7035 USD', { exact: true }).waitFor()
    assert.equal(writes(calls).length, 0)
    await page.getByRole('button', { name: 'Confirm receiving', exact: true }).click()
    await page.getByRole('heading', { name: 'Product created successfully', exact: true }).waitFor()
    assert.equal(writes(calls).length, 1)
    assert.equal(writes(calls)[0].path, '/api/inventory/product-setups')
    assert.equal(writes(calls)[0].body.receipt.unitCost, '1.2345')
    assert.equal(writes(calls)[0].body.receipt.items[0].quantity, 3)
    await page.getByRole('button', { name: 'View Product', exact: true }).click()
    await page.getByRole('heading', { name: 'New shirt', exact: true }).waitFor()
  } finally { await page.close() }
})

test('Warehouse retains zero-stock creation and operational reads without financial or correction controls', async () => {
  const { page, calls } = await open(390, 844, 'WAREHOUSE')
  try {
    await detail(page)
    assert.equal(await page.getByRole('button', { name: 'Restock', exact: true }).count(), 0)
    for (const name of ['Stock', 'Count Check', 'Receipt History', 'Movement History']) {
      await section(page, name)
      assert.equal(await page.getByText('Current purchase cost', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: /one piece:/ }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Set cost', exact: true }).count(), 0)
      await noOverflow(page)
    }
    await page.getByRole('button', { name: 'Back to products', exact: true }).click()
    await entry(page, 'Warehouse shirt')
    assert.equal(await page.getByLabel('Price for all sizes (USD)', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Save product only', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm product only', exact: true }).click()
    await page.getByRole('heading', { name: 'Product created successfully', exact: true }).waitFor()
    const saved = writes(calls)[0]
    for (const field of ['unitCost', 'sellingPrice', 'currentStock', 'lastPurchaseCost', 'accountId']) assert.equal(Object.hasOwn(saved.body.variants[0], field), false)
    assert.equal(saved.body.receipt, null)
  } finally { await page.close() }
})

test('Restock confirms a multi-option receipt, exact cost and refreshes stock without a count adjustment', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await detail(page); await section(page, 'Restock')
    await page.getByLabel('Receiving now: Navy / S', { exact: true }).fill('17')
    await page.getByLabel('Receiving now: Navy / M', { exact: true }).fill('23')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    await page.getByText('49.3800 USD', { exact: true }).waitFor()
    assert.equal(writes(calls).length, 0)
    await page.getByRole('button', { name: 'Confirm receiving', exact: true }).click()
    await page.getByRole('heading', { name: 'Stock received successfully', exact: true }).waitFor()
    const request = writes(calls)[0]
    assert.equal(request.path, '/api/inventory/receipts')
    assert.equal(request.body.items.length, 2)
    assert.equal(request.body.unitCost, '1.2345')
    assert.equal(writes(calls).length, 1)
    await page.getByRole('button', { name: 'View stock', exact: true }).click()
    await page.getByText('21 pieces', { exact: true }).waitFor()
  } finally { await page.close() }
})

test('Count correction requires confirmation, records delta only, retries its UUID and disables removal at zero', async () => {
  const { page, calls } = await open(390, 844, 'OWNER', 'quick-uncertain')
  try {
    await detail(page); await section(page, 'Count Check')
    const add = page.getByRole('button', { name: 'Add one piece: Navy / S', exact: true })
    await add.click()
    await page.getByRole('dialog').getByText('Add exactly one piece. System stock: 4 to 5. Records an ADJUSTMENT with no purchase or receipt.', { exact: true }).waitFor()
    assert.equal(writes(calls).length, 0)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await add.evaluate(node => node === document.activeElement), true)
    await correct(page)
    await page.getByRole('button', { name: 'Retry same update', exact: true }).waitFor()
    assert.equal(await add.isDisabled(), true)
    await page.reload()
    await page.getByRole('button', { name: 'Retry same update', exact: true }).click()
    await page.getByText(/Stock count updated/).waitFor()
    let requests = writes(calls)
    assert.equal(requests[0].operationId, requests[1].operationId)
    assert.deepEqual(requests[0].body, { delta: 1 })
    assert.ok(requests[0].path.endsWith('/stock-adjustment'))
    await correct(page)
    await page.getByText(/6 pieces\./).waitFor()
    requests = writes(calls)
    assert.notEqual(requests[1].operationId, requests[2].operationId)
    for (let n = 5; n >= 0; n--) { await correct(page, -1); await page.getByText(new RegExp(`${n} pieces\\.`)).waitFor() }
    assert.equal(await page.getByRole('button', { name: 'Remove one piece: Navy / S', exact: true }).isDisabled(), true)
    assert.equal(writes(calls).filter(call => call.path === '/api/inventory/receipts').length, 0)
  } finally { await page.close() }
})

test('Restock uncertainty survives reload and replays the exact request without showing operation UUIDs', async () => {
  const { page, calls } = await open(768, 900, 'OWNER', 'receipt-uncertain')
  try {
    await detail(page); await section(page, 'Restock'); await receive(page)
    await page.getByRole('button', { name: 'Retry original receiving request', exact: true }).waitFor()
    const original = writes(calls)[0]
    assert.equal(await page.getByText(original.operationId, { exact: false }).count(), 0)
    await page.reload()
    assert.equal(writes(calls).length, 1)
    await page.getByRole('button', { name: 'Retry original receiving request', exact: true }).click()
    await page.getByRole('heading', { name: 'Stock received successfully', exact: true }).waitFor()
    const replay = writes(calls)[1]
    assert.equal(replay.operationId, original.operationId)
    assert.deepEqual(replay.body, original.body)
  } finally { await page.close() }
})

test('Section navigation preserves restock quantities and catalog drafts without extra writes', async () => {
  const { page, calls } = await open(768, 900)
  try {
    await detail(page)
    await page.getByRole('button', { name: 'Edit product', exact: true }).click()
    await page.getByLabel('Product name', { exact: true }).fill('Draft name')
    await section(page, 'Restock')
    await page.getByLabel('Receiving now: Navy / S', { exact: true }).fill('3')
    await section(page, 'Stock'); await section(page, 'Restock')
    assert.equal(await page.getByLabel('Receiving now: Navy / S', { exact: true }).inputValue(), '3')
    await section(page, 'Overview')
    assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), 'Draft name')
    let prompts = 0
    page.on('dialog', async dialog => { prompts++; await dialog.dismiss() })
    await page.getByRole('button', { name: 'Back to products', exact: true }).click()
    assert.equal(prompts, 1)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Old receiving deep link redirects to Products Restock without loading an inventory list', async () => {
  const { page, calls } = await open(1280, 900)
  try {
    const before = calls.length
    await page.goto(new URL('/app/inventory?productId=22222222-2222-4222-8222-000000000001', page.url()).href)
    await page.getByRole('heading', { name: 'Restock', exact: true }).waitFor()
    assert.ok(new URL(page.url()).pathname.startsWith('/app/products/'))
    assert.equal(calls.slice(before).filter(call => call.path === '/api/products').length, 0)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

for (const role of ['OWNER', 'WAREHOUSE']) test(`${role} populated movement and receipt histories stay distinct and read-only on mobile`, async () => {
  const { page, calls, errors } = await open(390, 844, role, 'audit-history')
  try {
    await detail(page); await section(page, 'Movement History')
    await page.getByText('+3', { exact: true }).waitFor()
    await page.getByText('-1', { exact: true }).waitFor()
    await page.getByText(/Warehouse Team.*W01/).waitFor()
    assert.equal(await page.getByText(/Unit cost:/).count(), role === 'OWNER' ? 1 : 0)
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, `ia-populated-movements-${role.toLowerCase()}-390.png`), fullPage: true })
    await section(page, 'Receipt History')
    await page.locator('.inventory-receipt-row summary').click()
    await page.getByText('+3 received', { exact: true }).waitFor()
    assert.equal(await page.getByText('55555555-5555-4555-8555-555555555555', { exact: false }).count(), 0)
    assert.equal(await page.getByText(/per piece/).count(), role === 'OWNER' ? 1 : 0)
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('Invalid catalog prices and receipt quantities stop before any mutation', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await entry(page)
    await page.getByLabel('Price for all sizes (USD)', { exact: true }).fill('-1')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('#product-create-error[role=alert]').waitFor()
    assert.equal(writes(calls).length, 0)
    await page.getByLabel('Price for all sizes (USD)', { exact: true }).fill('15.00')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Receiving now: Black / M', { exact: true }).fill('-2')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    await page.locator('.receipt-form [role=alert]').waitFor()
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('An existing pending receipt offers only a Products handoff in Entry', async () => {
  const { page, calls } = await open(390, 844, 'OWNER', 'receipt-uncertain')
  try {
    await detail(page); await section(page, 'Restock'); await receive(page)
    await page.getByRole('button', { name: 'Retry original receiving request', exact: true }).waitFor()
    page.on('dialog', dialog => dialog.accept())
    await page.goto(new URL('/app/inventory', page.url()).href)
    await page.getByRole('button', { name: 'Open product to resolve it', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Retry original receiving request', exact: true }).count(), 0)
    assert.equal(writes(calls).length, 1)
    await page.getByRole('button', { name: 'Open product to resolve it', exact: true }).click()
    await page.getByRole('heading', { name: 'Restock', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Retry original receiving request', exact: true }).click()
    await page.getByRole('heading', { name: 'Stock received successfully', exact: true }).waitFor()
    assert.equal(writes(calls)[0].operationId, writes(calls)[1].operationId)
  } finally { await page.close() }
})
