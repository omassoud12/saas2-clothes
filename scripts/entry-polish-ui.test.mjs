// Local browser checks; fixture blocks external auth/API/storage services.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, noOverflow, screenshots, catId } from './products-ui-fixture.mjs'

async function entry(page) {
  await page.getByRole('button', { name: /Add product/i }).first().click()
  await page.getByRole('heading', { name: 'Product Entry', exact: true }).waitFor()
  await page.getByLabel('Product name', { exact: true }).waitFor()
}
async function define(page) {
  await page.getByLabel('Product name', { exact: true }).fill('Cotton shirt')
  await page.getByLabel('Category', { exact: true }).selectOption(catId)
  await page.getByLabel('Color', { exact: true }).selectOption('Black')
  await page.getByRole('button', { name: 'M', exact: true }).click()
}
const writes = calls => calls.filter(call => call.method !== 'GET')

for (const width of [390, 768, 1280, 1440]) test(`Entry header, centered workflow, consistent fields and actions fit ${width}px`, async () => {
  const { page, calls, errors } = await open(width, 900)
  try {
    const before = calls.length
    await entry(page)
    assert.equal(await page.locator('.inventory-header-copy .eyebrow').isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'View products', exact: true }).getAttribute('class'), 'text-button entry-view-products')
    assert.equal(await page.getByText('Create a new product for your catalog. Add first stock now or save with zero stock.', { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('list', { name: 'Workflow progress' }).getByRole('listitem').count(), 3)
    assert.equal(await page.locator('.receipt-steps [aria-current=step]').getAttribute('aria-label'), 'Step 1: Product, current')
    const layout = await page.evaluate(() => {
      const card = document.querySelector('.inventory-definition').getBoundingClientRect(), main = document.querySelector('.business-content').getBoundingClientRect()
      const name = document.querySelector('#new-product-name').getBoundingClientRect(), category = document.querySelector('#new-product-category').getBoundingClientRect(), color = document.querySelector('#product-color-list').getBoundingClientRect(), grid = document.querySelector('.product-info-fields .product-form-grid').getBoundingClientRect()
      return { width: card.width, center: (card.left + card.right) / 2 - (main.left + main.right) / 2, name, category, color, grid, formBorder: getComputedStyle(document.querySelector('.product-create-form')).borderTopWidth, empty: getComputedStyle(document.querySelector('.product-color-options')).display }
    })
    assert.ok(layout.width <= 1040)
    assert.ok(Math.abs(layout.center) <= 1, 'Workflow is centered in the available content area')
    assert.ok(Math.abs(layout.name.width - layout.category.width) <= 1)
    assert.equal(layout.name.height, 44); assert.equal(layout.category.height, 44)
    assert.equal(layout.name.top === layout.category.top, width > 900)
    assert.ok(Math.abs(layout.color.width - layout.grid.width) <= 1, 'Color uses the intentional full field-group width')
    assert.equal(layout.formBorder, '0px', 'No noisy divider above Product details')
    assert.equal(layout.empty, 'none', 'Empty size area reserves no blank grid track')
    await page.getByText('Select a color to configure its sizes.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Edit product', exact: true }).count(), 0)
    assert.equal(await page.getByRole('navigation', { name: 'Product management sections' }).count(), 0)
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, `entry-polish-empty-${width}.png`), fullPage: true })
    await define(page)
    await page.getByLabel('Price for all sizes (USD)', { exact: true }).fill('15.00')
    await page.getByRole('button', { name: 'Continue', exact: true }).scrollIntoViewIfNeeded()
    const footer = await page.locator('.product-create-footer').evaluate(node => {
      const rect = node.getBoundingClientRect()
      return { position: getComputedStyle(node).position, cancelLeft: node.querySelector('button').getBoundingClientRect().left - rect.left, buttonsFit: [...node.querySelectorAll('button')].every(button => { const b = button.getBoundingClientRect(); return b.height >= 44 && b.left >= rect.left && b.right <= rect.right + 1 && b.bottom <= innerHeight + 1 }) }
    })
    assert.equal(footer.position, 'static')
    assert.equal(footer.buttonsFit, true)
    assert.ok(Math.abs(footer.cancelLeft) <= 1, 'Cancel stays at the leading edge of the action area')
    await noOverflow(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: join(screenshots, `entry-polish-selected-${width}.png`), fullPage: true })
    assert.ok(calls.slice(before).every(call => call.path === '/api/categories'), 'Entry fetches categories only')
    assert.equal(writes(calls).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('Custom color is a keyboard-accessible action; existing case-insensitive deduplication remains', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await entry(page)
    const action = page.locator('.product-custom-color-action summary')
    assert.equal(await action.textContent(), '+ Add Custom Color')
    await action.focus(); await page.keyboard.press('Enter')
    await page.getByLabel('Custom color name', { exact: true }).fill('Dusty rose')
    await page.getByRole('button', { name: 'Add color', exact: true }).click()
    await page.getByRole('group', { name: 'Sizes for Dusty rose', exact: true }).waitFor()
    await page.getByRole('button', { name: 'M', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'M', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByLabel('Custom color name', { exact: true }).fill('dusty ROSE')
    await page.getByRole('button', { name: 'Add color', exact: true }).click()
    assert.equal(await page.locator('.product-create-option').count(), 1)
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Existing color/size/price validation is placed near its section before any request', async () => {
  const { page, calls } = await open(768, 900)
  try {
    await entry(page)
    await page.getByLabel('Product name', { exact: true }).fill('Cotton shirt')
    await page.getByLabel('Category', { exact: true }).selectOption(catId)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Choose at least one color.' }).waitFor()
    assert.equal(await page.locator('.product-color-fields').getAttribute('aria-describedby'), 'product-create-error')
    await page.getByLabel('Color', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Choose at least one size for each color.' }).waitFor()
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByLabel('Price for all sizes (USD)', { exact: true }).fill('bad')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.locator('.product-price-fields').getAttribute('aria-describedby'), 'product-create-error')
    assert.equal(await page.locator('#product-create-error').count(), 1)
    assert.equal(await page.locator('#product-create-error').isVisible(), true)
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('OWNER step progression preserves exact initial receiving review without saving early', async () => {
  const { page, calls } = await open(390, 844)
  try {
    await entry(page); await define(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.locator('.receipt-steps [aria-current=step]').getAttribute('aria-label'), 'Step 2: Quantities & Cost, current')
    assert.equal(await page.locator('.receipt-steps .is-complete').getAttribute('aria-label'), 'Step 1: Product, completed')
    await page.getByLabel('Receiving now: Black / M', { exact: true }).fill('3')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    await page.getByText('3.7035 USD', { exact: true }).waitFor()
    assert.equal(await page.locator('.receipt-steps [aria-current=step]').getAttribute('aria-label'), 'Step 3: Review, current')
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'entry-polish-review-390.png'), fullPage: true })
    assert.equal(writes(calls).length, 0)
    await page.getByRole('button', { name: 'Back / edit quantities', exact: true }).click()
    await page.getByRole('button', { name: 'Back to product', exact: true }).click()
    assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), 'Cotton shirt')
    assert.equal(await page.getByRole('button', { name: 'M', exact: true }).getAttribute('aria-pressed'), 'true')
  } finally { await page.close() }
})

test('WAREHOUSE workflow never renders price/cost/receiving controls', async () => {
  const { page, calls } = await open(390, 844, 'WAREHOUSE')
  try {
    await entry(page); await define(page)
    assert.equal(await page.locator('.receipt-steps li').count(), 2)
    assert.equal(await page.locator('.product-price-fields').count(), 0)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.getByLabel(/Purchase cost|Receiving now|Price for all sizes/).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Review receipt', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Save product only', exact: true }).isEnabled(), true)
    await noOverflow(page)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})

test('Category loading disables Continue, and safe category failure offers retry', async () => {
  const { page, calls } = await open(768, 900)
  try {
    let categoryRequests = 0
    await page.route('**/api/categories', async route => {
      categoryRequests += 1
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'internal database detail must not render' } }) })
    })
    await entry(page)
    await page.getByText('Loading categories...', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Retry categories', exact: true }).waitFor()
    assert.equal(await page.getByText('internal database detail must not render', { exact: false }).count(), 0)
    const before = categoryRequests
    await page.getByRole('button', { name: 'Retry categories', exact: true }).click()
    await page.getByRole('button', { name: 'Retry categories', exact: true }).waitFor()
    assert.equal(categoryRequests, before + 1)
    assert.equal(writes(calls).length, 0)
  } finally { await page.close() }
})
