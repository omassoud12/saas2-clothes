// Offline visual/accessibility checks: fixture blocks all external services.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, noOverflow, screenshots } from './products-ui-fixture.mjs'

async function detail(page) {
  await page.getByRole('button', { name: /^View product:/ }).first().click()
  await page.locator('.product-detail-header h1').waitFor()
}
async function section(page, name) {
  await page.getByRole('tab', { name, exact: true }).click()
  await page.getByRole('tabpanel', { name, exact: true }).waitFor()
}
const writes = calls => calls.filter(call => call.method !== 'GET')

for (const width of [390, 768, 1280, 1440]) test(`Polished catalog, persistent header, tabs and Count Check controls fit ${width}px`, async () => {
  const { page, calls, errors } = await open(width, 900)
  try {
    const add = page.getByRole('button', { name: /Add Product/ }).first()
    assert.equal((await add.textContent()).trim(), '+ Add Product')
    assert.ok(await add.evaluate(node => node.getBoundingClientRect().height >= 44))
    assert.equal(await page.getByRole('button', { name: 'Refresh products', exact: true }).textContent(), 'Refresh')
    assert.equal(await page.locator('.product-row-identity .product-image-frame').first().evaluate(node => node.getBoundingClientRect().width), 56)
    assert.equal(await page.locator('.product-card-open').first().textContent(), 'View Product ↗')
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, `polish-catalog-${width}.png`), fullPage: true })
    await detail(page)
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Overview', 'Stock', 'Restock', 'Count Check', 'Movements', 'Receipts'])
    assert.equal(await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).count(), 1)
    assert.equal(await page.getByRole('menuitem').count(), 0, 'Rare actions stay hidden')
    assert.equal(await page.getByText('0 inactive pieces', { exact: false }).count(), 0)
    await page.screenshot({ path: join(screenshots, `polish-overview-${width}.png`), fullPage: true })
    for (const name of ['Stock', 'Restock', 'Count Check', 'Movements', 'Receipts']) {
      await section(page, name)
      const visible = await page.getByRole('tab', { name, exact: true }).evaluate(node => {
        const tab = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect()
        return tab.left >= list.left - 1 && tab.right <= list.right + 1 && node.getAttribute('aria-selected') === 'true'
      })
      assert.equal(visible, true)
      assert.equal(await page.locator('.product-detail-header h1').textContent(), 'Essential cotton T-shirt')
      assert.match(await page.locator('.product-detail-meta').textContent(), /T-shirts.*3 variants.*Active/)
      await noOverflow(page)
      if (name === 'Count Check') {
        const geometry = await page.locator('.count-check-actions button').evaluateAll(nodes => nodes.map(node => {
          const button = node.getBoundingClientRect(), row = node.closest('.count-check-row').getBoundingClientRect(), panel = node.closest('.count-check').getBoundingClientRect()
          return button.width >= 44 && button.height >= 44 && button.left >= row.left && button.right <= row.right + 1 && button.right <= panel.right && button.right <= innerWidth
        }))
        assert.equal(geometry.length, 6)
        assert.ok(geometry.every(Boolean), 'Both +/- controls are inside their row and panel')
        assert.equal(await page.locator('.count-check-size').getByText('Active', { exact: true }).count(), 0)
      }
      if (['Restock', 'Count Check'].includes(name)) await page.screenshot({ path: join(screenshots, `polish-${name.replaceAll(' ', '-').toLowerCase()}-${width}.png`), fullPage: true })
    }
    assert.equal(calls.filter(call => call.path === '/api/inventory/movements').length, 1)
    assert.equal(calls.filter(call => call.path === '/api/inventory/receipts').length, 1)
    await section(page, 'Movements')
    await page.getByText('No movements match these filters yet.', { exact: true }).waitFor()
    assert.equal(calls.filter(call => call.path === '/api/inventory/movements').length, 1)
    assert.equal(writes(calls).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('Tabs use manual keyboard activation without requesting histories on focus', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await detail(page)
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus()
    await page.keyboard.press('End')
    assert.equal(await page.getByRole('tab', { name: 'Receipts', exact: true }).evaluate(node => node === document.activeElement), true)
    assert.equal(calls.filter(call => call.path.startsWith('/api/inventory/')).length, 0)
    assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Receipt history', exact: true }).waitFor()
    assert.equal(await page.getByRole('tab', { name: 'Receipts', exact: true }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('tabpanel', { name: 'Overview', exact: true }).isVisible(), true)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Variant menu is labelled, supports keyboard navigation and restores focus on Escape', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await detail(page)
    const trigger = page.getByRole('button', { name: 'Variant actions: Navy / S', exact: true })
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const edit = page.getByRole('menuitem', { name: 'Edit Variant', exact: true })
    assert.equal(await edit.evaluate(node => node === document.activeElement), true)
    await page.keyboard.press('End')
    assert.equal(await page.getByRole('menuitem', { name: 'Deactivate variant', exact: true }).evaluate(node => node === document.activeElement), true)
    await page.keyboard.press('Escape')
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    await trigger.click()
    await trigger.click()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'Clicking the trigger again closes its menu')
    await trigger.click()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    await trigger.click()
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('menu').count(), 0)
    assert.equal(await page.evaluate(() => document.activeElement !== document.body), true, 'Tab advances outside the menu without losing focus')
    await trigger.click()
    await edit.click()
    await page.getByRole('heading', { name: 'Edit color / size', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Color', { exact: true }).inputValue(), 'Navy')
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Count Check +/- controls also fit a narrow 260px panel without shrinking tap targets', async () => {
  const { page } = await open(390, 844)
  try {
    await detail(page); await section(page, 'Count Check')
    await page.locator('.count-check').evaluate(node => { node.style.width = '260px'; node.style.padding = '12px' })
    const fits = await page.locator('.count-check-actions button').evaluateAll(nodes => nodes.every(node => {
      const rect = node.getBoundingClientRect(), row = node.closest('.count-check-row').getBoundingClientRect()
      return rect.width >= 44 && rect.height >= 44 && rect.right <= row.right + 1 && rect.left >= row.left
    }))
    assert.equal(fits, true)
    await noOverflow(page)
  } finally { await page.close() }
})

for (const width of [390, 1440]) test(`Restock static context, quantity layout and exact purchase preview at ${width}px`, async () => {
  const { page, calls } = await open(width, 900)
  try {
    await detail(page); await section(page, 'Restock')
    assert.match(await page.locator('.receipt-product-context').textContent(), /3 variants.*Current stock 24/)
    assert.equal(await page.locator('.receipt-product-context h2').evaluate(node => getComputedStyle(node).borderTopWidth), '0px')
    assert.equal(await page.locator('.receipt-product-context input').count(), 0)
    assert.equal(await page.locator('.receipt-mobile-color').count(), width === 390 ? 1 : 0)
    assert.equal(await page.locator('.receipt-matrix').count(), width === 390 ? 0 : 1)
    await page.getByLabel('Receiving now: Navy / S', { exact: true }).fill('10')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('6.5000')
    assert.match(await page.locator('.receipt-live-summary').textContent(), /Receiving: 10 pieces.*Unit cost: 6.5000 USD.*Total purchase65.0000 USD/)
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Confirm receiving', exact: true }).textContent(), 'Confirm Restock')
    await page.getByText('65.0000 USD', { exact: true }).waitFor()
    await noOverflow(page)
    assert.equal(writes(calls).length, 0, 'Review does not submit stock')
    await page.screenshot({ path: join(screenshots, `polish-restock-review-${width}.png`), fullPage: true })
  } finally { await page.close() }
})

test('WAREHOUSE retains inspection tabs and never receives financial controls', async () => {
  const { page, calls } = await open(390, 844, 'WAREHOUSE', 'audit-history')
  try {
    await detail(page)
    assert.equal(await page.getByRole('tab', { name: 'Restock', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Apply price to variants', exact: true }).count(), 0)
    await section(page, 'Stock')
    assert.equal(await page.locator('.stock-purchase-cost').count(), 0)
    await section(page, 'Count Check')
    assert.equal(await page.locator('.count-check-actions').count(), 0)
    await section(page, 'Movements')
    await page.getByText('+3', { exact: true }).waitFor()
    await page.getByText('-1', { exact: true }).waitFor()
    assert.equal(await page.getByText(/unit cost|Purchased delivery/i).count(), 0)
    await section(page, 'Receipts')
    await page.getByText('Store-wide deliveries across all products.', { exact: true }).waitFor()
    await page.locator('.inventory-receipt-row summary').click()
    assert.equal(await page.locator('.inventory-receipt-row').getByText(/USD/).count(), 0)
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Existing skeletons announce catalog/detail/history loading and respect reduced motion', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.fallback()
    })
    await page.getByRole('button', { name: 'Refresh products', exact: true }).click()
    await page.getByText('Loading products...', { exact: true }).waitFor()
    assert.equal(await page.locator('.product-loading').getAttribute('aria-busy'), 'true')
    assert.equal(await page.locator('.product-loading .ui-skeleton').first().evaluate(node => getComputedStyle(node).animationName), 'none')
    await page.getByRole('button', { name: /^View product:/ }).first().waitFor()
    await page.getByRole('button', { name: /^View product:/ }).first().click()
    await page.getByText('Loading product details...', { exact: true }).waitFor()
    await page.locator('.product-detail-header h1').waitFor()
    await section(page, 'Movements')
    await page.getByText('Loading movement history...', { exact: true }).waitFor()
    await page.getByText('No movements match these filters yet.', { exact: true }).waitFor()
    await section(page, 'Count Check')
    await page.getByText('Checking stock...', { exact: true }).waitFor()
    await page.getByText('No variants match these filters.', { exact: true }).waitFor()
    await section(page, 'Receipts')
    await page.getByText('Loading receipts…', { exact: true }).waitFor()
    await page.getByRole('heading', { name: 'No receipts yet', exact: true }).waitFor()
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Dense desktop color groups remain compact with 44px menus and no overlap', async () => {
  const { page, errors } = await open(1440, 900, 'OWNER', 'inventory-dense')
  try {
    await detail(page)
    assert.equal(await page.locator('.product-color-stock-card').count(), 4)
    assert.equal(await page.locator('.product-stock-row').count(), 32)
    assert.ok(await page.locator('.product-menu-trigger').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width >= 44 && node.getBoundingClientRect().height >= 44)))
    const fits = await page.locator('.product-stock-row').evaluateAll(rows => rows.every(row => {
      const bounds = row.getBoundingClientRect()
      return [...row.children].every(node => { const rect = node.getBoundingClientRect(); return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 })
    }))
    assert.equal(fits, true)
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'polish-dense-overview-1440.png'), fullPage: true })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
