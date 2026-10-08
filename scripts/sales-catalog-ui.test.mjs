// Offline integration checks. All API writes affect in-memory fixtures only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, product, screenshots } from './products-ui-fixture.mjs'
import { calculateCart } from '../frontend/src/features/sales/sale-flow.js'

async function sales(width = 1280, role = 'OWNER', mode = 'normal') {
  const setup = await open(width, 900, role)
  const { page } = setup
  const records = [1, 2, 3].map(index => product(index, role === 'OWNER'))
  if (mode === 'long-catalog') records.push(...Array.from({ length: 9 }, (_, index) => product(index + 4, role === 'OWNER')))
  if (mode === 'unpriced') records[0].variants.forEach(variant => { variant.sellingPrice = null })
  if (mode === 'mixed') {
    records[0].variants[1].color = 'Black'
    records[0].variants[2].isActive = false
  }
  if (mode === 'single') records[0].variants = [records[0].variants[0]]
  const salesCalls = [], catalogCalls = [], completed = new Map()
  await page.route('**/api/products?*', async route => {
    const url = new URL(route.request().url()); catalogCalls.push(url.search)
    if (mode === 'catalog-error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) })
    const matching = records.filter(record => [record.name, ...record.variants.map(variant => variant.sku)].some(value => value.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase())))
    if (mode === 'long-catalog' && catalogCalls.length > 1) await new Promise(resolve => setTimeout(resolve, 400))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ products: matching, total: matching.length, page: 1, limit: 12 }) })
  })
  await page.route('**/api/sales**', async route => {
    const request = route.request(), url = new URL(request.url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (request.method() === 'GET') return reply({ sales: [...completed.values()].map(({ sale }) => ({ ...sale, itemCount: sale.items.length, totalUnits: sale.items.reduce((total, item) => total + item.quantity, 0), createdAt: '2026-10-07T10:00:00Z', seller: { name: 'Store Team' }, status: 'COMPLETED' })), nextCursor: null })
    const body = request.postDataJSON(), key = request.headers()['idempotency-key']
    salesCalls.push({ path: url.pathname, body, key })
    if (mode === 'stock-conflict' && salesCalls.length === 1) {
      records[0].variants[0].currentStock = 1
      return reply({ error: { code: 'INSUFFICIENT_STOCK' } }, 409)
    }
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 600))
    if (!completed.has(key)) {
      for (const item of body.items) records.flatMap(record => record.variants).find(variant => variant.id === item.variantId).currentStock -= item.quantity
      completed.set(key, { sale: { id: '44444444-4444-4444-8444-444444444444', currency: 'USD', totalAmount: calculateCart(body.items).total, items: body.items } })
      if (mode === 'uncertain') return route.abort()
      if (mode === 'invalid-response') return reply({ sale: { id: 'unconfirmed' } })
    }
    return reply({ ...completed.get(key), idempotentReplay: salesCalls.length > 1 }, 201)
  })
  const navigation = page.getByRole('link', { name: 'Sales / POS', exact: true })
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true })
  if (await menu.isVisible()) await menu.click()
  await navigation.click()
  await page.getByRole('heading', { name: 'Sell products', exact: true }).waitFor()
  if (mode !== 'catalog-error') await page.locator('.sale-product-tile').first().waitFor()
  return { ...setup, records, salesCalls, catalogCalls, completed }
}
async function details(page) {
  await page.locator('.sale-product-tile').first().click()
  const dialog = page.getByRole('dialog', { name: 'Essential cotton T-shirt', exact: true })
  await dialog.waitFor()
  return dialog
}
async function select(page, size = 'S') {
  const dialog = await details(page)
  await dialog.getByRole('button', { name: 'Navy', exact: true }).click()
  await dialog.getByRole('button', { name: new RegExp(`^${size} \\d+ available$`) }).click()
  return dialog
}
async function fits(page, dialogOnly = false) {
  // The app shell has a 320px minimum. Below that, verify the modal independently.
  if (!dialogOnly) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(await page.locator('.sale-dialog[open] button, .sale-dialog[open] input').evaluateAll(nodes => nodes.filter(node => {
    const box = node.getBoundingClientRect(); return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
  }).map(node => node.id || node.textContent)), [])
}

for (const width of [320, 360, 390, 768, 1280, 1440]) test(`Photo/name catalog and product sale dialog fit ${width}px`, async () => {
  const { page, salesCalls, errors } = await sales(width)
  try {
    assert.equal(await page.locator('.sale-product-tile').count(), 3)
    assert.deepEqual(await page.locator('.sale-product-name').allTextContents(), ['Essential cotton T-shirt', 'Relaxed linen shirt', 'Everyday straight-leg jeans'])
    assert.equal(await page.locator('.sale-product-grid').innerText(), 'Essential cotton T-shirt\nNo photo\nRelaxed linen shirt\nEveryday straight-leg jeans')
    assert.equal(await page.locator('.pos-cart').count(), 0)
    const photo = await page.locator('.sale-product-tile').first().evaluate(node => {
      const tile = node.getBoundingClientRect(), image = node.querySelector('.sale-product-photo').getBoundingClientRect()
      return { tile: tile.width, image: image.width, height: image.height }
    })
    assert.ok(Math.abs(photo.tile - photo.image) <= 3, 'Photo fills its card width')
    assert.ok(Math.abs(photo.image - photo.height) <= 1, 'Photos reserve consistent square space')
    assert.equal(await page.getByRole('heading', { name: 'Recent sales', exact: true }).count(), 0)
    if (width <= 750) {
      const filters = await page.locator('.pos-search-toolbar').evaluate(node => {
        const search = node.querySelector('input').getBoundingClientRect(), category = node.querySelector('select').getBoundingClientRect()
        return { search, category, height: node.getBoundingClientRect().height, firstProductTop: document.querySelector('.sale-product-tile').getBoundingClientRect().top }
      })
      assert.ok(Math.abs(filters.search.top - filters.category.top) <= 1, 'Search and category share one row')
      assert.ok(filters.search.right <= filters.category.left, 'Fields do not overlap')
      assert.ok(filters.search.height >= 44 && filters.category.height >= 44, 'Touch targets stay usable')
      assert.ok(filters.height <= 90, 'Filters no longer consume two vertical rows')
      assert.ok(filters.firstProductTop <= 340, 'Products appear sooner in the mobile viewport')
      assert.equal(await page.getByLabel('Find a product', { exact: true }).isVisible(), true)
      assert.equal(await page.getByLabel('Category', { exact: true }).isVisible(), true)
    }
    await fits(page)
    await page.screenshot({ path: join(screenshots, `sales-catalog-${width}.png`), fullPage: true })
    const dialog = await select(page, 'M')
    assert.equal(await dialog.getByText('ITEM-1-M', { exact: true }).isVisible(), true)
    await dialog.getByRole('button', { name: 'Increase quantity', exact: true }).click()
    assert.equal(await dialog.locator('.sale-quick-total > strong').innerText(), '30.00 USD')
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isEnabled(), true)
    await fits(page)
    assert.ok(await dialog.getByRole('button', { name: 'Sell now', exact: true }).evaluate(node => { const box = node.getBoundingClientRect(); return box.height >= 44 && box.bottom <= innerHeight }), 'Primary action stays visible')
    await page.screenshot({ path: join(screenshots, `sales-details-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.locator('.sale-product-tile').first().evaluate(node => node === document.activeElement), true)
    assert.equal(salesCalls.length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

for (const width of [240, 280, 320, 360, 390]) test(`Mobile product dialog keeps long content, full-width actions and inputs inside ${width}px`, async () => {
  const { page, salesCalls, records } = await sales(390)
  try {
    records[0].name = 'Polo shirt with a long seasonal product name'
    records[0].category.name = 'T-shirts and polo shirts with longer labels'
    records[0].variants[0].sku = 'ITEM-7c990e46-6cba-481f-91c9-85e386d03cba'
    records[0].variants[0].sellingPrice = null
    // Refetch the modified fixture, then exercise a smaller visible viewport.
    await page.getByLabel('Find a product', { exact: true }).fill('Polo')
    await page.waitForFunction(() => document.querySelector('.sale-product-name')?.textContent.includes('Polo'))
    await page.setViewportSize({ width, height: 568 })
    await page.locator('.sale-product-tile').first().click()
    const dialog = page.getByRole('dialog', { name: records[0].name, exact: true })
    await dialog.getByRole('button', { name: 'S 4 available', exact: true }).click()
    await fits(page, width < 320)
    const geometry = await dialog.evaluate(node => {
      const rect = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height } }
      const body = node.querySelector('.sale-dialog-body'), footer = node.querySelector('.sale-dialog-footer')
      return { dialog: rect(node), close: rect(node.querySelector('.sale-close')), footer: rect(footer), body: rect(body), bodyWidth: body.clientWidth, bodyContentWidth: body.scrollWidth,
        buttons: [...footer.querySelectorAll('button')].map(rect), fonts: [...node.querySelectorAll('input')].map(input => parseFloat(getComputedStyle(input).fontSize)), headerPhoto: node.querySelector('.sale-dialog-thumbnail') ? getComputedStyle(node.querySelector('.sale-dialog-thumbnail')).display : 'none' }
    })
    assert.ok(geometry.dialog.width <= width, 'Dialog does not inherit the app shell minimum width')
    assert.ok(geometry.close.right <= width, 'Close remains reachable')
    assert.ok(geometry.bodyContentWidth <= geometry.bodyWidth, 'Scrolling is vertical only')
    assert.ok(geometry.footer.bottom <= 568 && geometry.footer.top > geometry.body.top)
    assert.ok(geometry.buttons.every(button => button.left >= 0 && button.right <= width && button.height >= 44))
    assert.ok(Math.abs(geometry.buttons[0].width - geometry.buttons[1].width) <= 1, 'Both actions use the complete footer width')
    assert.ok(geometry.buttons[0].bottom <= geometry.buttons[1].top, 'Sell and cart actions have separate rows')
    assert.ok(geometry.fonts.every(font => font >= 16), 'Mobile inputs use readable text without small-input zoom')
    assert.notEqual(geometry.headerPhoto, 'none')
    await dialog.getByLabel('Unit price (USD)', { exact: true }).fill('15.00')
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('2')
    assert.equal(await dialog.locator('.sale-quick-total > strong').innerText(), '30.00 USD')
    await fits(page, width < 320)
    await page.screenshot({ path: join(screenshots, `sales-mobile-fixed-${width}.png`), fullPage: false })
    await page.setViewportSize({ width, height: 380 })
    await dialog.getByLabel('Unit price (USD)', { exact: true }).scrollIntoViewIfNeeded()
    await dialog.getByLabel('Unit price (USD)', { exact: true }).focus()
    const shortLayout = await dialog.evaluate(node => {
      const body = node.querySelector('.sale-dialog-body').getBoundingClientRect(), input = node.querySelector('#quick-sale-price').getBoundingClientRect(), footer = node.querySelector('.sale-dialog-footer').getBoundingClientRect()
      return { inputTop: input.top, inputBottom: input.bottom, bodyTop: body.top, bodyBottom: body.bottom, footerTop: footer.top, footerBottom: footer.bottom }
    })
    assert.ok(shortLayout.inputTop >= shortLayout.bodyTop && shortLayout.inputBottom <= shortLayout.bodyBottom + 1, 'Focused input stays fully inside the short scroll viewport')
    assert.ok(shortLayout.inputBottom <= shortLayout.footerTop && shortLayout.footerBottom <= 380, 'Footer does not cover the focused input')
    await fits(page, width < 320)
    await page.screenshot({ path: join(screenshots, `sales-mobile-short-${width}.png`), fullPage: false })
    assert.equal(salesCalls.length, 0)
  } finally { await page.close() }
})

test('Explicit quick sale uses existing payload, refreshes stock and preserves search', async () => {
  const { page, salesCalls, records } = await sales()
  try {
    await page.getByLabel('Find a product', { exact: true }).fill('ITEM-1')
    await page.waitForFunction(() => document.querySelectorAll('.sale-product-tile').length === 1)
    const dialog = await select(page)
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('3')
    await dialog.getByLabel('Unit price (USD)', { exact: true }).fill('0.10')
    assert.equal(await dialog.locator('.sale-quick-total > strong').innerText(), '0.30 USD')
    assert.equal(salesCalls.length, 0)
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.equal(salesCalls.length, 1)
    assert.deepEqual(salesCalls[0].body, { items: [{ variantId: records[0].variants[0].id, quantity: 3, unitSoldPrice: '0.10' }] })
    assert.match(salesCalls[0].key, /^[\da-f-]{36}$/)
    assert.equal(records[0].variants[0].currentStock, 1)
    assert.equal(await page.getByLabel('Find a product', { exact: true }).inputValue(), 'ITEM-1')
    await page.locator('.sale-product-tile').first().waitFor()
    const refreshed = await select(page)
    await refreshed.getByText('1 in stock', { exact: true }).waitFor()
    assert.equal(await refreshed.getByRole('button', { name: 'Increase quantity', exact: true }).isDisabled(), true)
  } finally { await page.close() }
})

test('Modal keyboard focus stays inside; selection and invalid quantities do not write', async () => {
  const { page, salesCalls } = await sales(390)
  try {
    await page.locator('.sale-product-tile').first().focus(); await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isDisabled(), true)
    await dialog.getByRole('button', { name: 'Navy', exact: true }).click()
    await dialog.getByRole('button', { name: 'S 4 available', exact: true }).click()
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('5')
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isDisabled(), true)
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('0')
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isDisabled(), true)
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('1')
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).focus(); await page.keyboard.press('Tab')
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
    assert.equal(salesCalls.length, 0)
  } finally { await page.close() }
})

test('Sold-out and inactive choices cannot be sold; colors reset the size selection', async () => {
  const { page, salesCalls } = await sales(1280, 'OWNER', 'mixed')
  try {
    const dialog = await details(page)
    await dialog.getByRole('button', { name: 'Navy', exact: true }).click()
    await dialog.getByRole('button', { name: 'S 4 available', exact: true }).click()
    await dialog.getByRole('button', { name: 'Black', exact: true }).click()
    assert.equal(await dialog.getByText('ITEM-1-M', { exact: true }).isVisible(), true)
    assert.equal(await dialog.getByRole('button', { name: /^L / }).count(), 0)
    await page.keyboard.press('Escape')
    await page.locator('.sale-product-tile').nth(1).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Navy', exact: true }).click()
    assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'S Sold out', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Sell now', exact: true }).isDisabled(), true)
    assert.equal(salesCalls.length, 0)
  } finally { await page.close() }
})

test('WAREHOUSE sees catalog price only and can sell; costs stay absent', async () => {
  const { page, salesCalls } = await sales(390, 'WAREHOUSE')
  try {
    const dialog = await select(page)
    assert.equal(await dialog.locator('#quick-sale-price').count(), 0)
    assert.equal(await dialog.locator('.sale-read-price').innerText(), '15.00 USD')
    assert.equal(/cost|profit|margin/i.test(await dialog.innerText()), false)
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.equal(salesCalls[0].body.items[0].unitSoldPrice, '15.00')
  } finally { await page.close() }
})

test('Missing prices block WAREHOUSE; OWNER may enter a sale-only price', async () => {
  for (const role of ['WAREHOUSE', 'OWNER']) {
    const { page, salesCalls } = await sales(1280, role, 'unpriced')
    try {
      const dialog = await details(page)
      await dialog.getByRole('button', { name: 'Navy', exact: true }).click()
      const size = dialog.getByRole('button', { name: role === 'OWNER' ? 'S 4 available' : 'S No price', exact: true })
      assert.equal(await size.isDisabled(), role === 'WAREHOUSE')
      if (role === 'OWNER') {
        await size.click()
        assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isDisabled(), true)
        await dialog.getByLabel('Unit price (USD)', { exact: true }).fill('25')
        assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isEnabled(), true)
      }
      assert.equal(salesCalls.length, 0)
    } finally { await page.close() }
  }
})

for (const mode of ['uncertain', 'invalid-response']) test(`${mode} checkout locks selection and retries identical UUID/payload once`, async () => {
  const { page, salesCalls, records, completed } = await sales(390, 'OWNER', mode)
  try {
    const dialog = await select(page)
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).click()
    await dialog.getByRole('button', { name: 'Retry same sale', exact: true }).waitFor()
    assert.equal(await dialog.getByLabel('3. Quantity', { exact: true }).isDisabled(), true)
    assert.equal(await dialog.getByRole('button', { name: 'Close product details', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), true)
    await dialog.getByRole('button', { name: 'Retry same sale', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.equal(salesCalls.length, 2); assert.deepEqual(salesCalls[0], salesCalls[1])
    assert.equal(completed.size, 1); assert.equal(records[0].variants[0].currentStock, 3)
  } finally { await page.close() }
})

test('Double click during quick sale submits one checkout', async () => {
  const { page, salesCalls } = await sales(1280, 'OWNER', 'slow')
  try {
    const dialog = await select(page)
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).dblclick()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.equal(salesCalls.length, 1)
  } finally { await page.close() }
})

test('Stock conflict refreshes selected option and requires a valid revised quantity', async () => {
  const { page, salesCalls } = await sales(1280, 'OWNER', 'stock-conflict')
  try {
    const dialog = await select(page)
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('3')
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).click()
    await dialog.getByText('1 in stock', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isDisabled(), true)
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('1')
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.equal(salesCalls.length, 2); assert.notEqual(salesCalls[0].key, salesCalls[1].key)
  } finally { await page.close() }
})

test('Optional multi-item cart stays local, reserves stock, completes one sale and reveals history', async () => {
  const { page, salesCalls } = await sales(390)
  try {
    let dialog = await select(page)
    await dialog.getByLabel('3. Quantity', { exact: true }).fill('3')
    await dialog.getByRole('button', { name: 'Add to cart', exact: true }).click()
    dialog = await details(page)
    await dialog.getByRole('button', { name: 'Navy', exact: true }).click()
    await dialog.getByRole('button', { name: 'S 1 available', exact: true }).click()
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).count(), 0)
    await dialog.getByRole('button', { name: 'Add to cart', exact: true }).click()
    assert.equal(salesCalls.length, 0)
    await page.locator('.sale-product-tile').nth(2).click()
    dialog = page.getByRole('dialog', { name: 'Everyday straight-leg jeans', exact: true })
    await dialog.getByRole('button', { name: 'Navy', exact: true }).click()
    await dialog.getByRole('button', { name: 'M 8 available', exact: true }).click()
    await dialog.getByRole('button', { name: 'Add to cart', exact: true }).click()
    await page.getByRole('button', { name: 'Open cart, 5 items', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Cart', exact: true })
    await fits(page)
    assert.equal(await dialog.getByRole('button', { name: 'Increase Essential cotton T-shirt quantity', exact: true }).isDisabled(), true)
    await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.equal(salesCalls.length, 1); assert.equal(salesCalls[0].body.items[0].quantity, 4); assert.equal(salesCalls[0].body.items.length, 2)
    await page.getByRole('button', { name: 'Sales history', exact: true }).click()
    await page.getByRole('heading', { name: 'Recent sales', exact: true }).waitFor()
    await page.getByRole('button', { name: 'View details', exact: true }).waitFor()
  } finally { await page.close() }
})

test('A single option is ready without extra selection; small screens keep sale action visible', async () => {
  const { page, salesCalls } = await sales(320, 'OWNER', 'single')
  try {
    await page.setViewportSize({ width: 320, height: 568 })
    const dialog = await details(page)
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).isEnabled(), true)
    await fits(page)
    assert.equal(await dialog.getByRole('button', { name: 'Sell now', exact: true }).evaluate(node => node.getBoundingClientRect().bottom <= innerHeight), true)
    assert.equal(salesCalls.length, 0)
  } finally { await page.close() }
})

test('An uncertain optional-cart checkout reuses the original frozen sale', async () => {
  const { page, salesCalls, completed } = await sales(1280, 'OWNER', 'uncertain')
  try {
    const detail = await select(page)
    await detail.getByRole('button', { name: 'Add to cart', exact: true }).click()
    await page.getByRole('button', { name: 'Open cart, 1 items', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Cart', exact: true })
    await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click()
    await dialog.getByRole('button', { name: 'Retry same sale', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Close cart', exact: true }).isDisabled(), true)
    assert.equal(await dialog.getByRole('button', { name: 'Clear', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), true)
    await dialog.getByRole('button', { name: 'Retry same sale', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    assert.deepEqual(salesCalls[0], salesCalls[1]); assert.equal(completed.size, 1)
  } finally { await page.close() }
})

test('No results and catalog failure have clear recovery without sale writes', async () => {
  const { page, salesCalls } = await sales()
  try {
    await page.getByLabel('Find a product', { exact: true }).fill('missing')
    await page.getByRole('heading', { name: 'No sellable products found', exact: true }).waitFor()
    await page.getByLabel('Find a product', { exact: true }).fill('')
    await page.locator('.sale-product-tile').first().waitFor()
    assert.equal(salesCalls.length, 0)
  } finally { await page.close() }
  const error = await sales(390, 'OWNER', 'catalog-error')
  try { await error.page.getByRole('button', { name: 'Try again', exact: true }).waitFor(); assert.equal(error.salesCalls.length, 0) }
  finally { await error.page.close() }
})

test('Stock refresh retains the full catalog and a visible success message after selling from lower rows', async () => {
  const { page, salesCalls } = await sales(390, 'OWNER', 'long-catalog')
  try {
    const tile = page.locator('.sale-product-tile').last()
    await tile.scrollIntoViewIfNeeded()
    await tile.click()
    const dialog = page.getByRole('dialog', { name: 'New product', exact: true })
    await dialog.getByRole('button', { name: 'S 4 available', exact: true }).click()
    await dialog.getByRole('button', { name: 'Sell now', exact: true }).click()
    await page.getByRole('region', { name: 'Completed sale', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.pos-catalog').getAttribute('aria-busy') === 'true')
    assert.equal(await page.locator('.sale-product-tile').count(), 12, 'Refetch keeps the grid mounted')
    const message = page.locator('.simple-sales > .product-feedback')
    assert.equal(await message.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight }), true)
    await page.waitForFunction(() => document.querySelector('.pos-catalog').getAttribute('aria-busy') === 'false')
    assert.equal(await page.locator('.sale-product-tile').count(), 12)
    assert.equal(salesCalls.length, 1)
  } finally { await page.close() }
})
