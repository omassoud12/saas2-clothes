// Offline catalog presentation checks; the shared fixture blocks external services.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, noOverflow, product, screenshots } from './products-ui-fixture.mjs'

async function catalog(width, role = 'OWNER', edgeCases = false) {
  const result = await open(width, 900, role)
  const queries = []
  const records = Array.from({ length: 25 }, (_, i) => {
    const item = product(i + 1, role === 'OWNER')
    return { id: item.id, name: i < 3 ? item.name : `Cotton shirt ${i + 1}`, category: item.category,
      isActive: true, imageUrl: item.imageUrl, catalogSummary: {
        activeVariantCount: 3, inactiveVariantCount: 0, availableStock: i === 1 ? '0' : '24', inactiveStock: '0',
        priceMin: i === 2 ? '42.50' : '15.00', priceMax: i === 2 ? '42.50' : '15.00',
      } }
  })
  if (edgeCases) {
    records[0].name = 'Very long product name '.repeat(6)
    records[0].category = { ...records[0].category, name: 'Very long category '.repeat(6) }
    Object.assign(records[0].catalogSummary, { priceMin: '999999999999999.00', priceMax: '9999999999999999.99', inactiveStock: '18', inactiveVariantCount: 2 })
    records[1].imageStatus = 'unavailable'
    Object.assign(records[1].catalogSummary, { priceMin: null, priceMax: null })
    records[2].isActive = false
    Object.assign(records[2].catalogSummary, { activeVariantCount: 0, inactiveVariantCount: 3, availableStock: '0', inactiveStock: '24', priceMin: null, priceMax: null })
  }
  await result.page.route('**/api/products?**', async route => {
    const url = new URL(route.request().url())
    queries.push(Object.fromEntries(url.searchParams))
    const current = Number(url.searchParams.get('page') || 1)
    const matching = url.searchParams.get('search') === 'missing' ? [] : records
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      products: matching.slice((current - 1) * 12, current * 12), total: matching.length, page: current, limit: 12,
    }) })
  })
  await result.page.getByRole('button', { name: 'Refresh products', exact: true }).click()
  await result.page.locator('.product-card').nth(11).waitFor()
  return { ...result, queries, records }
}

async function containedRows(page) {
  await noOverflow(page)
  const result = await page.locator('.product-card').evaluateAll(rows => rows.every(row => {
    const bounds = row.getBoundingClientRect()
    return [...row.querySelectorAll('.product-row-copy,.product-image-frame,.product-row-category,.product-row-stock,.product-row-price,.product-status,.product-card-open')].every(node => {
      const rect = node.getBoundingClientRect()
      return rect.width === 0 || (rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top && rect.bottom <= bounds.bottom)
    })
  }))
  assert.equal(result, true, 'Names, stock, price, status and action stay inside each row')
}

for (const width of [1440, 1280, 768, 390]) {
  test(`Compact Products list is dense and usable at ${width}px`, async () => {
    const { page, calls, queries, errors } = await catalog(width)
    try {
      assert.equal(await page.locator('.product-card').count(), 12)
      assert.equal(await page.locator('.product-table-heading').isVisible(), width >= 1101)
      const measurements = await page.locator('.product-card').evaluateAll(rows => rows.map(row => {
        const rect = row.getBoundingClientRect(), thumb = row.querySelector('.product-image-frame').getBoundingClientRect()
        const action = row.querySelector('button').getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, height: rect.height, width: thumb.width, imageHeight: thumb.height,
          actionWidth: action.width, actionHeight: action.height, radius: getComputedStyle(row).borderRadius,
          nameSize: parseFloat(getComputedStyle(row.querySelector('strong')).fontSize), priceSize: parseFloat(getComputedStyle(row.querySelector('.product-row-price')).fontSize) }
      }))
      assert.ok(measurements.every(row => row.width === 48 && row.imageHeight === 48 && row.radius === '0px'))
      assert.ok(measurements.every(row => row.actionWidth >= 44 && row.actionHeight >= 44 && row.priceSize <= row.nameSize))
      assert.ok(measurements.every(row => row.height <= (width === 390 ? 144 : 80)), `Compact normal row height: ${JSON.stringify(measurements)}`)
      assert.ok(measurements.every((row, i) => i === 0 || Math.abs(row.top - measurements[i - 1].bottom) <= 1), 'Continuous list without large card gaps')
      assert.ok(measurements.filter(row => row.top >= 0 && row.bottom <= 900).length >= (width === 390 ? 3 : 6), 'Multiple complete products fit above the fold')
      assert.equal(await page.locator('.product-row-price').first().textContent(), 'Selling price15.00 USD')
      assert.match(await page.locator('.product-row-stock').nth(1).textContent(), /Out of stock/)
      assert.equal(await page.locator('.product-status').first().textContent(), 'Active')
      assert.equal(await page.locator('.product-card').first().getByRole('button').count(), 1)
      if (width === 390) {
        assert.equal(await page.locator('.product-row-count').first().isVisible(), true)
        const metadata = await page.locator('.product-row-metadata').first().evaluate(node => {
          const count = node.querySelector('.product-row-count').getBoundingClientRect(), stock = node.querySelector('.product-row-stock').getBoundingClientRect()
          return Math.abs(count.top - stock.top) <= 2 && count.right <= stock.left
        })
        assert.equal(metadata, true, 'Variants and stock share one metadata line')
      }
      await containedRows(page)
      await page.screenshot({ path: join(screenshots, `compact-products-${width}.png`), fullPage: true })
      assert.ok(queries.every(query => query.view === 'summary' && query.limit === '12'))
      assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })

  test(`Long names, exact price ranges, inactive stock and missing images fit ${width}px`, async () => {
    const { page, calls, records } = await catalog(width, 'WAREHOUSE', true)
    try {
      const first = page.locator('.product-card').first()
      assert.equal(await first.locator('strong').getAttribute('title'), records[0].name)
      assert.equal(await first.getByRole('button').getAttribute('aria-label'), `View product: ${records[0].name}`)
      assert.match(await first.locator('.product-row-price').textContent(), /999999999999999.00 USD - 9999999999999999.99 USD/)
      assert.match(await first.locator('.product-row-stock').textContent(), /24 available.*18 inactive/)
      assert.equal(await page.getByLabel('Photo unavailable', { exact: true }).count(), 1)
      assert.match(await page.locator('.product-row-price').nth(1).textContent(), /Price unavailable/)
      assert.equal(await page.locator('.product-status').nth(2).textContent(), 'Inactive')
      assert.match(await page.locator('.product-row-stock').nth(2).textContent(), /Out of stock.*24 inactive/)
      assert.ok(await first.locator('strong').evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis'))
      await containedRows(page)
      await page.screenshot({ path: join(screenshots, `compact-products-long-${width}.png`), fullPage: true })
      assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
      assert.equal(await page.getByText(/purchase cost|profit|margin/i).count(), 0)
    } finally { await page.close() }
  })
}

for (const width of [390, 1280]) test(`Filters, clear, refresh and page boundaries retain behavior at ${width}px`, async () => {
  const { page, queries, calls, records } = await catalog(width)
  try {
    const pages = page.getByRole('navigation', { name: 'Product pages', exact: true })
    assert.equal(await pages.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), true)
    await pages.getByRole('button', { name: 'Next', exact: true }).click()
    await pages.getByText('Page 2 of 3', { exact: true }).waitFor()
    assert.equal(queries.at(-1).page, '2')
    await pages.getByRole('button', { name: 'Next', exact: true }).click()
    await pages.getByText('Page 3 of 3', { exact: true }).waitFor()
    assert.equal(await page.locator('.product-card').count(), 1)
    assert.equal(await pages.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true)
    await pages.getByRole('button', { name: 'Previous', exact: true }).click()
    await pages.getByText('Page 2 of 3', { exact: true }).waitFor()
    await page.getByLabel('Search', { exact: true }).fill('cotton')
    if (width === 390) await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByLabel('Category', { exact: true }).selectOption(records[0].category.id)
    await page.getByLabel('Status', { exact: true }).selectOption('all')
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await pages.getByText('Page 1 of 3', { exact: true }).waitFor()
    assert.deepEqual(queries.at(-1), { limit: '12', page: '1', search: 'cotton', categoryId: records[0].category.id, isActive: 'all', view: 'summary' })
    await page.getByRole('button', { name: 'Refresh products', exact: true }).click()
    await page.locator('.product-card').nth(11).waitFor()
    assert.equal(queries.at(-1).search, 'cotton')
    await page.getByLabel('Search', { exact: true }).fill('missing')
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await page.getByRole('heading', { name: 'No matching products', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.locator('.product-card').nth(11).waitFor()
    assert.equal(await page.getByLabel('Search', { exact: true }).inputValue(), '')
    assert.equal(queries.at(-1).page, '1')
    assert.equal(queries.at(-1).isActive, undefined, 'Default active status is omitted by the existing API transport')
    if (width === 390) await page.getByRole('button', { name: 'Filters', exact: true }).click()
    assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), 'true')
    assert.equal(await page.getByLabel('Category', { exact: true }).inputValue(), '')
    if (width === 390) await page.getByRole('button', { name: 'Close', exact: true }).click()
    assert.equal(queries.at(-1).search, undefined)
    await pages.scrollIntoViewIfNeeded()
    await containedRows(page)
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
  } finally { await page.close() }
})

test('View remains one accessible keyboard action with a visible row focus and existing detail route', async () => {
  const { page, calls } = await open(390, 844)
  try {
    const view = page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true })
    await view.focus()
    const focus = await view.evaluate(node => {
      const style = getComputedStyle(node.closest('.product-card'))
      return node === document.activeElement && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
    })
    assert.equal(focus, true)
    assert.equal(await page.locator('.product-card img').first().getAttribute('alt'), '')
    assert.match(await view.getAttribute('aria-describedby'), /^product-summary-/)
    await page.keyboard.press('Enter')
    await page.locator('.product-detail-header h1').waitFor()
    assert.ok(new URL(page.url()).pathname.startsWith('/app/products/'))
    assert.equal(await page.locator('.product-detail-header h1').textContent(), 'Essential cotton T-shirt')
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
  } finally { await page.close() }
})
