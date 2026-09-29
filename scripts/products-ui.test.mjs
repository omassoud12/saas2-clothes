// Offline browser verification. No application/API/auth network is allowed.
// QA_PLAYWRIGHT_MODULE points to an external Playwright installation; no app dependency.
// Run: node --test scripts/products-ui.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { summarizeProductCatalog } from '../frontend/src/lib/money.js'

const qaDir = join(tmpdir(), 'saas2-products-qa')
const { chromium } = await import(pathToFileURL(process.env.QA_PLAYWRIGHT_MODULE || join(qaDir, 'node_modules/playwright/index.mjs')).href)
const screenshots = join(qaDir, 'screenshots')
const catId = '11111111-1111-4111-8111-111111111111'
const category = { id: catId, name: 'T-shirts', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#edf0eb"/><path d="M32 18 18 28 25 43 33 39 33 77 63 77 63 39 71 43 78 28 64 18 57 23 39 23Z" fill="#3d5367"/><path d="M39 22Q48 34 57 22" fill="none" stroke="#a9b6bf" stroke-width="3"/></svg>')
function product(index, owner = true) {
  return { id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`, name: ['Essential cotton T-shirt', 'Relaxed linen shirt', 'Everyday straight-leg jeans'][index - 1] || 'New product', category, isActive: true, imageUrl: index === 2 ? null : picture,
    ...(owner ? { profitMarginOverride: null } : {}),
    variants: ['S', 'M', 'L'].map((size, i) => ({ id: `33333333-3333-4333-8333-${String(index * 10 + i).padStart(12, '0')}`, sku: `ITEM-${index}-${size}`, barcode: null, color: 'Navy', size, sellingPrice: index === 3 ? '42.50' : '15.00', currentStock: index === 2 ? 0 : (i + 1) * 4, isActive: true, ...(owner ? { lastPurchaseCost: '8.0000' } : {}) })) }
}
let server, browser, origin
before(async () => {
  await mkdir(screenshots, { recursive: true })
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import '/src/index.css'; import {AppLayout} from '/src/app/AppLayout.jsx'; const role = new URLSearchParams(location.search).get('role') || 'OWNER'; function Root(){const [path,setPath]=React.useState(location.pathname.startsWith('/app/')?location.pathname:new URLSearchParams(location.search).get('page')==='inventory'?'/app/inventory':new URLSearchParams(location.search).get('page')==='reports'?'/app/reports':'/app/products');React.useEffect(()=>{const onPop=()=>setPath(location.pathname);window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);return React.createElement(AppLayout,{pathname:path,navigate:(next)=>{history.pushState(null,'',next);setPath(next)},profile:{user:{id:'qa-user',firstName:'Store',lastName:'Team',role},account:{id:'qa-account',name:'Sample clothing store',baseCurrency:'USD',status:'ACTIVE'}}})} createRoot(document.getElementById('root')).render(React.createElement(Root));`
  server = await createServer({ configFile: false, root: resolve('frontend'), envDir: false,
    plugins: [{ name: 'products-offline-fixture', enforce: 'pre',
      resolveId(id) { if (id === '/qa-entry.jsx') return '\0products-qa-entry.jsx' },
      load(id) {
        if (id === '\0products-qa-entry.jsx') return entry
        if (id.replaceAll('\\', '/').endsWith('/src/lib/supabase.js')) return `export const supabase = { auth: {getSession:async()=>({data:{session:{access_token:'offline-fixture',user:{id:'qa-user'}}}})}};`
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        if (req.url.split('?')[0] !== '/qa' && !req.url.startsWith('/app/products')) return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/qa', '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/qa-entry.jsx"></script></body></html>'))
      }) },
    }, react()], server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking'] })
})
after(async () => { await browser?.close(); await server?.close() })

async function open(width, height, role = 'OWNER', mode = 'normal', shared = false) {
  const context = shared ? await browser.newContext({ viewport: { width, height } }) : null
  const page = context ? await context.newPage() : await browser.newPage({ viewport: { width, height } })
  const calls = [], errors = [], stockKeys = new Set()
  const records = [1, 2, 3].map((id) => product(id, role === 'OWNER'))
  if (mode === 'dense') { records[0].variants = ['Black', 'White'].flatMap((color, c) => ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'].map((size, i) => ({ ...records[0].variants[0], id: `dense-${c}-${i}`, color, size, currentStock: 1 }))) }
  if (mode === 'photo-unavailable') { records[0].imageUrl=null; records[0].imageStatus='unavailable' }
  if (mode === 'mixed-color') { records[0].variants[0].color='Black'; records[0].variants[1].color='black'; records[0].variants[2].color=' Black ' }
  if (mode === 'pending-cost') records[0].variants.forEach(variant=>{variant.lastPurchaseCost=null})
  if (mode === 'inventory') { records[0].variants[0].currentStock = 1; records[0].variants[0].lastPurchaseCost = null }
  page.on('pageerror', (error) => errors.push(error.message))
  await (context || page).route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { errors.push(`Blocked external URL: ${url.origin}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const method = route.request().method()
    const body = method !== 'GET' && !url.pathname.endsWith('/image') ? route.request().postDataJSON() : null
    calls.push({ path: url.pathname, query: url.search, method, body, operationId: route.request().headers()['idempotency-key'] })
    const reply = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    if (url.pathname === '/api/inventory/movements') return reply({ movements: [], nextCursor: null })
    if (url.pathname === '/api/inventory/reconciliation') return reply({ variants: [], nextCursor: null })
    if (url.pathname === '/api/reports/daily') return reply({report:{reportDate:url.searchParams.get('date'),currency:'USD',salesCount:1,totalUnitsSold:2,grossRevenue:'50.00',returnedRevenue:'0.00',voidedRevenue:'0.00',netRevenue:'50.00',operatingExpenses:'3.00',costStatus:'INCOMPLETE',grossCOGS:null,returnedCOGS:null,voidedCOGS:null,netCOGS:null,grossProfit:null,netProfit:null,stockValue:null}})
    if (url.pathname === '/api/categories') return reply({ categories: [category] })
    if (url.pathname === '/api/products' && method === 'GET') return reply({ products: mode === 'empty' || url.searchParams.get('search') === 'missing' ? [] : url.searchParams.get('view') === 'summary' ? records.map(item => {const summary=summarizeProductCatalog(item,'USD'); const prices=item.variants.filter(v=>item.isActive&&v.isActive&&v.sellingPrice!==null).map(v=>v.sellingPrice).sort((a,b)=>Number(a)-Number(b));return {id:item.id,name:item.name,category:item.category,isActive:item.isActive,imageUrl:item.imageUrl,...(item.imageStatus ? {imageStatus:item.imageStatus} : {}),catalogSummary:{availableStock:summary.stock,inactiveStock:summary.inactiveStock,activeVariantCount:item.variants.filter(v=>item.isActive&&v.isActive).length,inactiveVariantCount:item.variants.filter(v=>!item.isActive||!v.isActive).length,priceMin:prices[0]??null,priceMax:prices.at(-1)??null}}}) : records, total: mode === 'empty' || url.searchParams.get('search') === 'missing' ? 0 : 25, page: Number(url.searchParams.get('page') || 1), limit: 12 })
    if (url.pathname === '/api/products/setup' && method === 'POST') { const added = { ...product(4, role === 'OWNER'), name: body.product.name, variants: body.variants.map((option,i) => ({ ...product(1, role === 'OWNER').variants[0], ...option, id:`setup-${i}`, currentStock: option.openingStock ? 1 : 0, ...(role === 'OWNER' ? { lastPurchaseCost: null } : {}) })) }; records.push(added); return reply({ product: added }, 201) }
    if (url.pathname === '/api/products' && method === 'POST') { const added = { ...product(4, role === 'OWNER'), name: body.name, variants: [] }; records.push(added); return reply({ product: added }, 201) }
    const record = records.find((item) => url.pathname.includes(item.id))
    if (!record) return reply({ error: { code: 'PRODUCT_NOT_FOUND' } }, 404)
    if (url.pathname.endsWith('/variant-prices')) { for (const variant of record.variants) if (body.variantIds.includes(variant.id)) variant.sellingPrice=body.sellingPrice; return reply({product:record}) }
    if (url.pathname.endsWith('/quick-stock') && method === 'POST') { const variant = record.variants.find(item => url.pathname.includes(item.id)); const key = route.request().headers()['idempotency-key']; const first = !stockKeys.has(key); if (first) { variant.currentStock += route.request().postDataJSON().delta ?? 1; stockKeys.add(key) } if (mode === 'quick-slow') await new Promise(resolve=>setTimeout(resolve,600)); if ((mode === 'quick-all-uncertain' && first) || (mode === 'quick-uncertain' && first && stockKeys.size === 1)) return route.abort(); return reply({ variant }) }
    if (url.pathname.endsWith('/opening-cost') && method === 'PUT') { const variant = record.variants.find(item => url.pathname.includes(item.id)); variant.lastPurchaseCost = body.unitCost; return reply({ variant }) }
    if (url.pathname.endsWith('/image')) {
      if (method === 'DELETE') { record.imageUrl = null; return route.fulfill({ status: 204 }) }
      record.imageUrl = picture; return reply({ product: record })
    }
    if (url.pathname.endsWith('/variants') && method === 'POST') { const variant = { ...product(1, role === 'OWNER').variants[0], ...body, id: `variant-${record.variants.length}`, currentStock: body.openingStock ? 1 : 0, lastPurchaseCost: null }; record.variants.push(variant); return reply({ variant }, 201) }
    if (url.pathname.includes('/variants/') && method === 'PATCH') { const variant = record.variants.find((item) => url.pathname.endsWith(item.id)); Object.assign(variant, body); return reply({ variant }) }
    if (method === 'PATCH') Object.assign(record, body)
    return reply({ product: record })
  })
  await page.goto(`${origin}/qa?role=${role}${mode === 'inventory' ? '&page=inventory' : mode==='incomplete-report'?'&page=reports':''}`)
  await page.getByRole('heading', { name: mode === 'inventory' ? 'Inventory' : mode==='incomplete-report'?'Financial reports': mode === 'empty' ? 'No products yet' : 'Products', exact: true }).waitFor()
  if (mode !== 'empty' && mode !== 'inventory' && mode !== 'incomplete-report') await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).waitFor()
  return { page, calls, errors }
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page has horizontal overflow')
  const overflowing = await page.locator('.products-page input:not([type=file]), .products-page select, .product-card').evaluateAll((nodes) => nodes.filter((node) => {
    const rect = node.getBoundingClientRect(); return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
  }).map((node) => node.className || node.id))
  assert.deepEqual(overflowing, [], 'Visible controls overflow')
}
for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1366, 768], [1440, 900]]) {
  test(`Products catalog, form and variants at ${width}x${height}`, async () => {
    const { page, calls, errors } = await open(width, height)
    try {
      await noOverflow(page)
      assert.equal(calls.length, 2, 'Only categories and product list requested initially')
      const titleSize = await page.getByRole('heading', { name: 'Products', exact: true }).evaluate((el) => getComputedStyle(el).fontSize)
      assert.equal(titleSize, width <= 700 ? '24px' : '28px')
      await page.screenshot({ path: join(screenshots, `catalog-${width}.png`) })
      await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
      await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
      await noOverflow(page)
      await page.screenshot({ path: join(screenshots, `detail-${width}.png`) })
      assert.match(new URL(page.url()).pathname, /^\/app\/products\/[0-9a-f-]{36}$/)
      assert.equal(await page.locator('.product-filter-panel').count(), 0)
      assert.equal(await page.locator('.product-card-list').count(), 0)
      await page.getByRole('heading', { name: 'Colors & sizes', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
      await page.getByRole('heading', { name: 'Edit color / size' }).waitFor()
      await noOverflow(page)
      await page.screenshot({ path: join(screenshots, `variant-edit-${width}.png`) })
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      await page.getByRole('button', { name: 'Back to products', exact: true }).click()
      await page.getByRole('button', { name: 'Add product', exact: false }).first().click()
      await page.getByRole('heading', { name: 'New product' }).waitFor()
      await page.getByLabel('Product name', { exact: true }).fill('Cotton T-shirt')
      await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
      await page.getByLabel('Colors', { exact: true }).selectOption('Black')
      await page.getByRole('button', { name: 'M', exact: true }).click()
      await noOverflow(page)
      const fieldHeight = await page.getByLabel('Product name', { exact: true }).evaluate((el) => el.getBoundingClientRect().height)
      assert.equal(fieldHeight, 40)
      const gridColumns = await page.locator('.product-info-fields .product-form-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      assert.equal(gridColumns, 2)
      const fits = await page.locator('.product-create-panel').evaluate(el => {
        const rect = el.getBoundingClientRect()
        return rect.height + rect.top <= innerHeight && window.scrollY === 0
      })
      assert.ok(fits, `Basic create form fits ${width} without scrolling`)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: join(screenshots, `create-${width}.png`), fullPage: true })
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

test('mobile filter sheet traps focus, restores focus, Escape and applies draft filters', async () => {
  const { page, calls, errors } = await open(390, 844)
  try {
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Product filters' })
    await dialog.waitFor()
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).evaluate((el) => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).evaluate((el) => el === document.activeElement), true)
    await page.screenshot({ path: join(screenshots, 'filters-390.png') })
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Filters', exact: true }).evaluate((el) => el === document.activeElement), true)
    assert.equal(await page.evaluate(() => document.body.style.overflow), '')
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByLabel('Status', { exact: true }).selectOption('false')
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.product-filter-options.is-open'))
    assert.ok(calls.some((call) => call.query.includes('isActive=false')))
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('search, empty/no-results and server pagination keep their contracts', async () => {
  const { page, calls } = await open(1366, 768)
  try {
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByText('Page 2 of 3', { exact: true }).waitFor()
    assert.ok(calls.some((call) => call.query.includes('page=2')))
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('missing')
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await page.getByRole('heading', { name: 'No matching products' }).waitFor()
    assert.ok(calls.some((call) => call.query.includes('search=missing') && call.query.includes('page=1')))
  } finally { await page.close() }
  const empty = await open(390, 844, 'OWNER', 'empty')
  try { await noOverflow(empty.page); await empty.page.screenshot({ path: join(screenshots, 'empty-390.png') }) } finally { await empty.page.close() }
})

test('OWNER edit and mobile confirmation dialog preserve mutation behavior and focus', async () => {
  const { page, calls, errors } = await open(390, 844)
  try {
    await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
    await page.getByRole('button', { name: 'Edit product', exact: true }).click()
    await page.getByLabel('Product name', { exact: true }).fill('Updated cotton T-shirt')
    await page.getByRole('button', { name: 'Save product', exact: true }).click()
    await page.getByRole('heading', { name: 'Updated cotton T-shirt', exact: true }).waitFor()
    assert.ok(calls.some((call) => call.method === 'PATCH' && call.body.name === 'Updated cotton T-shirt'))
    assert.equal(await page.getByRole('heading', { name: 'Colors & sizes', exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Edit product', exact: true }).click()
    const stockBefore = await page.locator('.product-stock-quantity').first().innerText()
    await page.getByRole('button', { name: 'Add stock', exact: true }).first().click()
    await page.getByText(/Stock saved\./).waitFor()
    assert.equal(Number(await page.locator('.product-stock-quantity').first().innerText().then(text => text.replace('Stock', '').trim())), Number(stockBefore.replace('Stock', '').trim()) + 1)
    assert.equal(await page.getByLabel('Quantity to add', { exact: true }).count(), 0)
    await page.locator('.product-stock-more').first().evaluate(el => { el.open = true })
    await page.getByRole('button', { name: 'Deactivate variant', exact: true }).first().click()
    await page.getByRole('dialog', { name: 'Deactivate color / size?', exact: true }).waitFor()
    await page.screenshot({ path: join(screenshots, 'confirmation-390.png') })
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Deactivate variant', exact: true }).first().evaluate((el) => el === document.activeElement), true)
    await page.locator('.product-stock-more').first().evaluate(el => { el.open = true })
    await page.getByRole('button', { name: 'Deactivate variant', exact: true }).first().click()
    await page.getByRole('button', { name: 'Deactivate color / size', exact: true }).click()
    await page.locator('.product-stock-more').first().evaluate(el => { el.open = true })
    await page.getByRole('button', { name: 'Reactivate variant', exact: true }).waitFor()
    assert.ok(calls.some((call) => call.method === 'PATCH' && call.path.includes('/variants/') && call.body.isActive === false))
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('WAREHOUSE retains catalog creation but never renders private cost or editable price', async () => {
  const { page, calls, errors } = await open(390, 844, 'WAREHOUSE')
  try {
    await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
    await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
    assert.equal(await page.getByText('Last purchase cost', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Add stock', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Back to products', exact: true }).click()
    await page.getByRole('button', { name: 'Add product', exact: false }).first().click()
    await page.getByLabel('Product name', { exact: true }).fill('Warehouse shirt')
    await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
    assert.equal(await page.getByLabel('Price for all sizes', { exact: false }).count(), 0)
    await page.getByLabel('Colors', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'Save product', exact: true }).click()
    await page.getByRole('heading', { name: 'Warehouse shirt', exact: true }).waitFor()
    const createdVariant = calls.find((call) => call.method === 'POST' && call.path.endsWith('/setup'))
    assert.ok(createdVariant)
    for (const key of ['sellingPrice', 'lastPurchaseCost', 'unitCost', 'accountId', 'currentStock']) assert.equal(Object.hasOwn(createdVariant.body.variants[0], key), false)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('optional image preview, removal and upload use existing image endpoint', async () => {
  const { page, calls, errors } = await open(768, 1024)
  try {
    await page.getByRole('button', { name: 'Add product', exact: false }).first().click()
    const file = { name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }
    await page.locator('.product-photo-fields').evaluate(el => { el.open = true })
    await page.getByLabel('Choose a photo', { exact: true }).setInputFiles(file)
    await page.getByAltText('Selected product photo preview').waitFor()
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
    assert.equal(await page.getByAltText('Selected product photo preview').count(), 0)
    await page.locator('.product-photo-fields').evaluate(el => { el.open = true })
    await page.getByLabel('Choose a photo', { exact: true }).setInputFiles(file)
    await page.getByLabel('Product name', { exact: true }).fill('Photo product')
    await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
    await page.getByLabel('Colors', { exact: true }).selectOption('White')
    await page.getByRole('button', { name: 'L', exact: true }).click()
    await page.getByRole('button', { name: 'Save product', exact: true }).click()
    await page.getByRole('heading', { name: 'Photo product', exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.method === 'POST' && call.path.endsWith('/image')).length, 1)
    await page.getByText('Product photo (optional)', { exact: true }).click()
    await page.getByLabel('Choose image', { exact: true }).setInputFiles(file)
    await page.getByRole('button', { name: 'Replace image', exact: true }).click()
    await page.getByText('Product image saved.', { exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.method === 'POST' && call.path.endsWith('/image')).length, 2)
    await page.getByRole('button', { name: 'Remove image', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove image', exact: true }).click()
    await page.getByText('Product image removed.', { exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.method === 'DELETE' && call.path.endsWith('/image')).length, 1)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('OWNER initial creation sends opening piece for each selected color and size', async () => {
  const { page, calls, errors } = await open(390, 844)
  try {
    await page.getByRole('button', { name: 'Add product', exact: false }).first().click()
    await page.getByLabel('Product name', { exact: true }).fill('Opening pieces')
    await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
    await page.getByLabel('Colors', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'S', exact: true }).click()
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'Save product', exact: true }).click()
    await page.getByRole('heading', { name: 'Opening pieces', exact: true }).waitFor()
    const setups = calls.filter(c => c.method === 'POST' && c.path.endsWith('/setup'))
    assert.equal(setups.length, 1)
    assert.equal(setups[0].body.variants.length, 2)
    assert.ok(setups[0].body.variants.every(v => v.openingStock === true && !Object.hasOwn(v, 'unitCost')))
    assert.equal(calls.filter(c => c.method === 'POST' && c.path.endsWith('/variants')).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
test('Inventory initializes purchase cost of the existing piece without restocking', async () => {
  const { page, calls, errors } = await open(390, 844, 'OWNER', 'inventory')
  try {
    await page.getByRole('button', { name: 'Set cost', exact: true }).click()
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('8.1234')
    await page.getByRole('button', { name: 'Save cost', exact: true }).click()
    await page.getByText('Purchase cost saved. Stock quantity is unchanged.', { exact: true }).waitFor()
    const saved = calls.find(c => c.method === 'PUT' && c.path.endsWith('/opening-cost'))
    assert.deepEqual(saved.body, { unitCost: '8.1234' })
    assert.equal(calls.filter(c => c.path.endsWith('/restocks')).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('one View product action opens a standalone page with product editing and reload support', async () => {
  const { page, calls, errors } = await open(390, 844)
  try {
    await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
    await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
    const detailPath = new URL(page.url()).pathname
    assert.equal(await page.locator('.product-filter-panel').count(), 0)
    const beforeReload = calls.length
    await page.reload()
    await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
    assert.equal(calls.slice(beforeReload).filter(c => c.path === '/api/products').length, 0)
    await page.getByRole('button', { name: 'Back to products', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Edit Essential cotton T-shirt', exact: true }).count(), 0)
    assert.equal(await page.locator('.product-card').first().getByRole('button').count(), 1)
    await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
    await page.getByRole('heading', { name: 'Essential cotton T-shirt', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, detailPath)
    await page.getByRole('button', { name: 'Edit product', exact: true }).click()
    await page.getByLabel('Product name', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goBack()
    await page.getByRole('heading', { name: 'Products', exact: true }).waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('compact size matrix uses one row per size inside each color section', async () => {
  const { page, errors } = await open(1366, 900, 'OWNER', 'dense')
  try {
    await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
    await page.locator('.product-stock-row').last().waitFor()
    assert.equal(await page.locator('.product-color-stock-card').count(), 2)
    assert.equal(await page.locator('.product-stock-row').count(), 16)
    const tiles = await page.locator('.product-color-stock-card').first().locator('.product-stock-row').evaluateAll(nodes => nodes.map(n => ({ top:n.getBoundingClientRect().top, left:n.getBoundingClientRect().left })))
    assert.ok(tiles[1].top > tiles[0].top)
    assert.equal(tiles[1].left, tiles[0].left)
    assert.ok(await page.locator('.product-color-stock-card').first().evaluate(el => el.getBoundingClientRect().height < 480))
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < 1300), 'Dense details should be shorter than the previous layout')
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'compact-colors-1366.png'), fullPage: true })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('quick Add stock retries an uncertain piece with the same key; next click is a new piece', async () => {
  const { page, calls, errors } = await open(1366, 768, 'OWNER', 'quick-uncertain')
  try {
    await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
    await page.getByRole('button', { name: 'Add stock', exact: true }).first().click()
    await page.locator('#products-feedback[role=alert]').waitFor()
    await page.getByRole('button', { name: 'Retry same update', exact: true }).first().click()
    await page.getByText(/Stock saved\./).waitFor()
    assert.equal(await page.locator('.product-stock-quantity').first().innerText().then(text => text.replace('Stock', '').trim()), '5')
    await page.getByRole('button', { name: 'Add stock', exact: true }).first().click()
    await page.getByText(/6 pieces\./).waitFor()
    const requests = calls.filter(c => c.path.endsWith('/quick-stock'))
    assert.equal(requests.length, 3)
    assert.equal(requests[0].operationId, requests[1].operationId)
    assert.notEqual(requests[1].operationId, requests[2].operationId)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('minus corrects stock by one and is disabled at zero', async () => {
 const { page, calls } = await open(1366, 768, 'OWNER')
 try {
  await page.getByRole('button', { name: 'View product: Essential cotton T-shirt', exact: true }).click()
  for (let stock = 3; stock >= 0; stock--) {
   await page.getByRole('button', { name: 'Remove stock', exact: true }).first().click()
   await page.getByText(new RegExp(`${stock} pieces\\.`)).waitFor()
  }
  assert.equal(await page.getByRole('button', { name: 'Remove stock', exact: true }).first().isDisabled(), true)
  assert.equal(calls.find(c => c.path.endsWith('/quick-stock')).body.delta, -1)
  await page.getByRole('button', { name: 'Add stock', exact: true }).first().click()
  await page.getByText(/1 pieces\./).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Remove stock', exact: true }).first().isEnabled(), true)
 } finally { await page.close() }
})

test('reload exposes deliberate stock recovery with the same UUID and no extra piece', async () => {
 const {page,calls}=await open(1366,768,'OWNER','quick-uncertain')
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await page.getByRole('button',{name:'Add stock',exact:true}).first().click()
 await page.locator('#products-feedback[role=alert]').waitFor()
 await page.reload()
 assert.equal(await page.getByRole('button',{name:'Add stock',exact:true}).first().isDisabled(),true)
 assert.equal(calls.filter(c=>c.path.endsWith('/quick-stock')).length,1)
 await page.getByRole('button',{name:'Retry same update',exact:true}).click()
 await page.getByText(/5 pieces\./).waitFor()
 const requests=calls.filter(c=>c.path.endsWith('/quick-stock'))
 assert.equal(requests[0].operationId,requests[1].operationId)
 assert.equal(await page.getByRole('button',{name:'Add stock',exact:true}).first().isEnabled(),true)
 } finally {await page.close()}
})
for(const width of [390,768,1024,1366,1440]) test(`bulk pricing, cost pending and duplicate feedback at ${width}`,async()=>{
 const {page,calls}=await open(width, width===390?844:900)
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await page.getByRole('button',{name:'Apply price to variants',exact:true}).click()
 await page.getByLabel('Selling price (USD)',{exact:true}).fill('22.50')
 await page.getByRole('button',{name:'Review price update',exact:true}).click()
 assert.equal(calls.filter(c=>c.path.endsWith('/variant-prices')).length,0)
 await noOverflow(page)
 await page.screenshot({path:join(screenshots,`bulk-price-${width}.png`),fullPage:true})
 await page.getByRole('button',{name:'Confirm price update',exact:true}).click()
 await page.getByText('Selected option prices updated together.',{exact:true}).waitFor()
 assert.equal(calls.find(c=>c.path.endsWith('/variant-prices')).body.variantIds.length,3)
 await page.getByRole('button',{name:'Add color / size',exact:true}).click()
 await page.getByLabel('Color',{exact:true}).fill(' navy ')
 await page.getByLabel('Size',{exact:true}).fill('s')
 await page.getByRole('button',{name:'Save color / size',exact:true}).click()
 await page.getByText('This color and size already exist. Edit the existing option.',{exact:true}).waitFor()
 await noOverflow(page)
 await page.screenshot({path:join(screenshots,`hardening-${width}.png`),fullPage:true})
 }finally{await page.close()}
})
test('dirty product back warns while clean back does not',async()=>{
 const {page}=await open(1366,768)
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await page.getByRole('button',{name:'Edit product',exact:true}).click()
 await page.getByLabel('Product name',{exact:true}).fill('Unsaved')
 let prompts=0
 page.on('dialog',async dialog=>{prompts++;await dialog.dismiss()})
 await page.getByRole('button',{name:'Back to products',exact:true}).click()
 assert.equal(prompts,1)
 assert.equal(await page.getByLabel('Product name',{exact:true}).inputValue(),'Unsaved')
 await page.getByLabel('Product name',{exact:true}).fill('Essential cotton T-shirt')
 await page.getByRole('button',{name:'Back to products',exact:true}).click()
 await page.getByRole('heading',{name:'Products',exact:true}).waitFor()
 assert.equal(prompts,1)
 }finally{await page.close()}
})

test('stock progress disables only the affected stock option',async()=>{
 const {page}=await open(1366,768,'OWNER','quick-slow')
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await page.getByRole('button',{name:'Add stock',exact:true}).first().click()
 await page.getByText('Updating...',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Add stock',exact:true}).first().isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:'Add stock',exact:true}).nth(1).isEnabled(),true)
 await page.getByText(/Stock saved\./).waitFor()
 }finally{await page.close()}
})
test('browser Back preserves dirty drafts and reload displays a beforeunload warning',async()=>{
 const {page}=await open(1366,768)
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await page.getByRole('button',{name:'Edit product',exact:true}).click()
 await page.getByLabel('Product name',{exact:true}).fill('Unsaved draft')
 let confirmations=0
 page.on('dialog',async dialog=>{confirmations++;await dialog.dismiss()})
 await page.evaluate(()=>history.back())
 await page.waitForTimeout(150)
 assert.equal(confirmations,1)
 assert.equal(await page.getByLabel('Product name',{exact:true}).inputValue(),'Unsaved draft')
 await page.evaluate(()=>{setTimeout(()=>location.reload(),0)})
 await page.waitForTimeout(300)
 assert.equal(confirmations,2)
 // Native beforeunload choices are controlled by Chromium; verify the warning.
 // The preceding browser Back assertion verifies preservation on a cancelled internal exit.
 }finally{await page.close()}
})
test('Warehouse detail exposes operational readiness and no financial completeness or bulk pricing',async()=>{
 const {page}=await open(390,844,'WAREHOUSE')
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 assert.equal(await page.getByText('Sellable',{exact:true}).count(),3)
 assert.equal(await page.getByText('Cost pending: Inventory',{exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Apply price to variants',exact:true}).count(),0)
 }finally{await page.close()}
})

for(const width of [390,768,1024,1366,1440]) test(`owner cost pending is independent from sellability at ${width}`,async()=>{
 const {page}=await open(width,width===390?844:900,'OWNER','pending-cost')
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 assert.equal(await page.getByText('Cost pending: Inventory',{exact:true}).count(),3)
 assert.equal(await page.locator('.product-option-state').filter({hasText:'Sellable'}).count(),3)
 await noOverflow(page)
 await page.screenshot({path:join(screenshots,`cost-pending-${width}.png`),fullPage:true})
 }finally{await page.close()}
})

test('OWNER financial UI shows authoritative revenue and unavailable incomplete profit',async()=>{
 const {page}=await open(390,844,'OWNER','incomplete-report')
 try {
 await page.getByText('Cost data incomplete.',{exact:true}).waitFor()
 assert.equal(await page.getByText('Unavailable',{exact:true}).count(),6)
 assert.ok(await page.getByText('50.00 USD',{exact:true}).count()>0)
 await noOverflow(page)
 await page.screenshot({path:join(screenshots,'incomplete-report-390.png'),fullPage:true})
 }finally{await page.close()}
})

test('dashboard handles incomplete economics without crashing or claiming profit',async()=>{
 const {page,errors}=await open(1366,768)
 try {
 await page.getByRole('link',{name:'Dashboard',exact:true}).click()
 await page.getByText('Cost data incomplete. Revenue is available; final COGS and profit are unavailable.',{exact:true}).waitFor()
 assert.ok(await page.getByText('Unavailable',{exact:true}).count()>0)
 assert.deepEqual(errors,[])
 }finally{await page.close()}
})


test('phase 1: cancelling product deactivation preserves unsaved product draft',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Edit product',exact:true}).click();
 await page.locator('#catalog-product-name').fill('Unsaved model');
 await page.getByRole('button',{name:'Deactivate product',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.locator('#catalog-product-name').count(),1);
 assert.equal(await page.locator('#catalog-product-name').inputValue(),'Unsaved model');
 }finally{await page.close()}
});

test('phase 1: clean product Cancel preserves an unrelated dirty variant',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Edit product',exact:true}).click();
 await page.locator('.product-stock-row').first().getByRole('button',{name:'Edit',exact:true}).click();
 await page.locator('#catalog-variant-color').fill('Unsaved color');
 let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.dismiss()});
 await page.locator('.product-overview').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.locator('#catalog-variant-color').count(),1);
 assert.equal(await page.locator('#catalog-variant-color').inputValue(),'Unsaved color');
 assert.equal(prompts,0);
 }finally{await page.close()}
});

test('phase 1: reopening bulk pricing preserves price selection and review',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Apply price to variants',exact:true}).click();
 await page.locator('#product-common-price').fill('27.50');
 await page.locator('.product-price-selection summary').click();
 await page.locator('.product-price-targets input').first().uncheck();
 await page.getByRole('button',{name:'Review price update',exact:true}).click();
 await page.getByRole('button',{name:'Apply price to variants',exact:true}).click();
 assert.equal(await page.locator('#product-common-price').inputValue(),'27.50');
 assert.equal(await page.locator('.product-price-targets input').first().isChecked(),false);
 assert.equal(await page.getByRole('button',{name:'Confirm price update',exact:true}).count(),1);
 }finally{await page.close()}
});

test('phase 1: cancelling variant deactivation preserves unsaved variant draft',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 const row=page.locator('.product-stock-row').first();
 await row.getByRole('button',{name:'Edit',exact:true}).click();
 await page.locator('#catalog-variant-color').fill('Unsaved color');
 await row.locator('.product-stock-more').evaluate(el=>{el.open=true});
 await row.getByRole('button',{name:'Deactivate variant',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.locator('#catalog-variant-color').count(),1);
 assert.equal(await page.locator('#catalog-variant-color').inputValue(),'Unsaved color');
 }finally{await page.close()}
});

test('phase 1: pending stock disables price and photo saves with accessible wait feedback',async()=>{
 const {page,calls}=await open(1366,900);
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Apply price to variants',exact:true}).click();
 await page.locator('#product-common-price').fill('27.50');
 await page.getByRole('button',{name:'Review price update',exact:true}).click();
 await page.locator('.product-photo-action summary').click();
 await page.locator('#product-image-file').setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=','base64')});
 await page.route('**/quick-stock',async route=>{await gate;await route.fallback()});
 await page.locator('.product-stock-row').first().getByRole('button',{name:'Add stock',exact:true}).click();
 await page.locator('.product-stock-row').first().getByRole('status').waitFor();
 const confirm=page.getByRole('button',{name:'Confirm price update',exact:true});
 const photo=page.getByRole('button',{name:'Replace image',exact:true});
 assert.equal(await confirm.isDisabled(),true);
 assert.equal(await photo.isDisabled(),true);
 for(const button of [confirm,photo]){
 assert.equal(await button.getAttribute('aria-disabled'),'true');
 const id=await button.getAttribute('aria-describedby');assert.ok(id);
 assert.equal(await page.locator('#'+id).textContent(),'Waiting for stock update to finish.');
 assert.equal(await page.locator('#'+id).isVisible(),true);
 }
 assert.equal(await page.locator('.product-stock-row').nth(1).getByRole('button',{name:'Add stock',exact:true}).isEnabled(),true);
 release();
 await page.locator('.product-stock-row').first().getByRole('status').waitFor({state:'hidden'});
 assert.equal(await confirm.isEnabled(),true);assert.equal(await photo.isEnabled(),true);
 assert.equal(await page.getByText('Waiting for stock update to finish.',{exact:true}).count(),0);
 assert.equal(calls.filter(call=>call.path.endsWith('/variant-prices')||call.path.endsWith('/image')).length,0);
 assert.equal(await page.locator('#product-common-price').inputValue(),'27.50');
 }finally{release?.();await page.close()}
});


test('phase 1: cancelling a clean bulk form does not warn about unrelated product edits',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Edit product',exact:true}).click();
 await page.locator('#catalog-product-name').fill('Unsaved model');
 await page.getByRole('button',{name:'Apply price to variants',exact:true}).click();
 let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.dismiss()});
 await page.locator('.product-bulk-price').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(prompts,0);
 assert.equal(await page.locator('#product-common-price').count(),0);
 assert.equal(await page.locator('#catalog-product-name').inputValue(),'Unsaved model');
 }finally{await page.close()}
});

test('phase 1: clean variant Cancel preserves an unrelated dirty product',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Edit product',exact:true}).click();
 await page.locator('#catalog-product-name').fill('Unsaved model');
 await page.locator('.product-stock-row').first().getByRole('button',{name:'Edit',exact:true}).click();
 let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.dismiss()});
 await page.locator('.product-stock-row').first().getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(prompts,0);
 assert.equal(await page.locator('#catalog-variant-color').count(),0);
 assert.equal(await page.locator('#catalog-product-name').inputValue(),'Unsaved model');
 }finally{await page.close()}
});

for(const kind of ['product','variant'])test(`phase 1: ${kind} draft survives failed confirmation and clears only after success`,async()=>{
 const {page,calls}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Edit product',exact:true}).click();
 await page.locator('#catalog-product-name').fill('Unsaved model');
 const row=page.locator('.product-stock-row').first();
 await row.getByRole('button',{name:'Edit',exact:true}).click();
 await page.locator('#catalog-variant-color').fill('Unsaved color');
 const pattern=kind==='product'?'**/api/products/22222222-2222-4222-8222-000000000001':'**/api/products/*/variants/*';
 await page.route(pattern,async route=>{
 if(route.request().method()==='PATCH')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'API_UNAVAILABLE'}})});
 await route.fallback();
 });
 if(kind==='product')await page.getByRole('button',{name:'Deactivate product',exact:true}).click();
 else {await row.locator('.product-stock-more').evaluate(el=>{el.open=true});await row.getByRole('button',{name:'Deactivate variant',exact:true}).click()}
 const dialog=page.getByRole('dialog');
 const action=dialog.getByRole('button',{name:kind==='product'?'Deactivate product':'Deactivate color / size',exact:true});
 await action.click();await dialog.getByRole('alert').waitFor();
 assert.equal(await page.locator('#catalog-product-name').inputValue(),'Unsaved model');
 assert.equal(await page.locator('#catalog-variant-color').inputValue(),'Unsaved color');
 await page.unroute(pattern);
 await action.click();await dialog.waitFor({state:'hidden'});
 if(kind==='product'){
 assert.equal(await page.locator('#catalog-product-name').count(),0);
 assert.equal(await page.locator('#catalog-variant-color').inputValue(),'Unsaved color');
 }else{
 assert.equal(await page.locator('#catalog-variant-color').count(),0);
 assert.equal(await page.locator('#catalog-product-name').inputValue(),'Unsaved model');
 }
 assert.equal(calls.filter(call=>call.method==='PATCH'&&call.body?.isActive===false).length,1);
 }finally{await page.close()}
});


test('phase 1: selection-only bulk changes receive their own discard guard',async()=>{
 const {page}=await open(1366,900);
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click();
 await page.getByRole('button',{name:'Apply price to variants',exact:true}).click();
 await page.locator('.product-price-selection summary').click();
 await page.locator('.product-price-targets input').first().uncheck();
 const answers=[false,true];let prompts=0;
 page.on('dialog',async dialog=>{prompts++;if(answers.shift())await dialog.accept();else await dialog.dismiss()});
 await page.locator('.product-bulk-price').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(prompts,1);
 assert.equal(await page.locator('#product-common-price').count(),1);
 assert.equal(await page.locator('.product-price-targets input').first().isChecked(),false);
 await page.locator('.product-bulk-price').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(prompts,2);
 assert.equal(await page.locator('#product-common-price').count(),0);
 }finally{await page.close()}
});

async function stockKeysOn(page) {
 return page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('saas2:quick-stock:v1:')&&key.includes(':operation:')))
}
test('phase 2: two tabs retain separate unresolved operations across reload and replay original UUIDs',async()=>{
 const {page,calls}=await open(1366,900,'OWNER','quick-all-uncertain',true)
 const context=page.context();const other=await context.newPage()
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await other.goto(page.url());await other.locator('.product-stock-row').first().waitFor()
  await page.getByRole('button',{name:'Add stock',exact:true}).nth(0).click()
  await page.locator('#products-feedback[role=alert]').waitFor()
  await other.getByRole('button',{name:'Add stock',exact:true}).nth(1).click()
  await other.locator('#products-feedback[role=alert]').waitFor()
  assert.equal((await stockKeysOn(page)).length,2)
  await page.reload();await other.reload()
  await page.getByRole('button',{name:'Retry same update',exact:true}).nth(1).waitFor()
  await other.getByRole('button',{name:'Retry same update',exact:true}).nth(1).waitFor()
  assert.equal(await other.getByRole('button',{name:'Retry same update',exact:true}).count(),2)
  assert.equal(calls.filter(call=>call.path.endsWith('/quick-stock')).length,2)
  await page.getByRole('button',{name:'Retry same update',exact:true}).first().click()
  await page.getByText(/5 pieces\./).waitFor()
  await other.getByRole('button',{name:'Retry same update',exact:true}).click()
  await other.getByText(/9 pieces\./).waitFor()
  const requests=calls.filter(call=>call.path.endsWith('/quick-stock'))
  assert.equal(requests[0].operationId,requests[2].operationId)
  assert.equal(requests[1].operationId,requests[3].operationId)
  assert.equal((await stockKeysOn(page)).length,0)
 }finally{await context.close()}
})
test('phase 2: cross-tab same-variant retry is blocked while original request holds lock',async()=>{
 const {page,calls}=await open(1366,900,'OWNER','normal',true)
 const context=page.context();const other=await context.newPage()
 let release;const gate=new Promise(resolve=>{release=resolve})
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await other.goto(page.url());await other.locator('.product-stock-row').first().waitFor()
  await page.route('**/quick-stock',async route=>{await gate;await route.fallback()})
  await page.getByRole('button',{name:'Add stock',exact:true}).first().click()
  await other.getByRole('button',{name:'Retry same update',exact:true}).waitFor()
  assert.equal(await other.getByRole('button',{name:'Add stock',exact:true}).first().isDisabled(),true)
  await other.getByRole('button',{name:'Retry same update',exact:true}).click()
  await other.getByText('Another page is confirming this option. Wait for it to finish before retrying.').waitFor()
  release();await page.getByText(/5 pieces\./).waitFor()
  assert.equal(calls.filter(call=>call.path.endsWith('/quick-stock')).length,1)
  assert.equal((await stockKeysOn(other)).length,0)
 }finally{release();await context.close()}
})
test('phase 2: late response after navigation clears only its own operation',async()=>{
 const {page}=await open(1366,900,'OWNER','normal',true)
 let release;const gate=new Promise(resolve=>{release=resolve})
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.route('**/quick-stock',async route=>{
   if(route.request().url().includes('000000000010')){await gate;await route.fallback()}
   else await route.abort()
  })
  await page.getByRole('button',{name:'Add stock',exact:true}).first().click()
  await page.locator('.product-stock-row').first().getByRole('status').waitFor()
  await page.getByRole('button',{name:'Back to products',exact:true}).click()
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.getByRole('button',{name:'Retry same update',exact:true}).waitFor()
  await page.getByRole('button',{name:'Add stock',exact:true}).nth(1).click()
  await page.locator('#products-feedback[role=alert]').waitFor()
  assert.equal((await stockKeysOn(page)).length,2)
  release()
  await page.waitForFunction(()=>Object.keys(localStorage).filter(k=>k.includes(':operation:')).length===1)
  assert.equal(await page.getByRole('button',{name:'Retry same update',exact:true}).count(),1)
  const remaining=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes(':operation:')))))
  assert.ok(remaining.variantId.endsWith('000000000011'))
 }finally{release();await page.context().close()}
})
test('phase 2: unsupported Web Locks preserves pending data and sends no stock request',async()=>{
 const {page,calls}=await open(1366,900,'OWNER','normal',true)
 try {
  await page.evaluate(()=>localStorage.setItem('saas2:quick-stock:v1:qa-account:qa-user:22222222-2222-4222-8222-000000000001',JSON.stringify([{operationId:'77777777-7777-4777-8777-777777777777',variantId:'33333333-3333-4333-8333-000000000010',delta:1,createdAt:Date.now()}])))
  await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}))
  await page.reload()
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.getByText(/Safe stock updates require browser Web Locks/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Add stock',exact:true}).first().isDisabled(),true)
  assert.equal(calls.filter(call=>call.path.endsWith('/quick-stock')).length,0)
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('saas2:quick-stock:v1:')).length),1)
 }finally{await page.context().close()}
})

test('phase 2: browser migrates legacy recovery once and keeps explicit retry UUID',async()=>{
 const {page,calls}=await open(1366,900,'OWNER','normal',true)
 const operationId='77777777-7777-4777-8777-777777777777'
 const legacyKey='saas2:quick-stock:v1:qa-account:qa-user:22222222-2222-4222-8222-000000000001'
 try {
  await page.evaluate(({key,id})=>localStorage.setItem(key,JSON.stringify([{operationId:id,variantId:'33333333-3333-4333-8333-000000000010',delta:-1,createdAt:Date.now()}])),{key:legacyKey,id:operationId})
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.getByRole('button',{name:'Retry same update',exact:true}).waitFor()
  await page.waitForFunction(key=>localStorage.getItem(key)===null,legacyKey)
  assert.equal((await stockKeysOn(page)).length,1)
  assert.equal(calls.filter(call=>call.path.endsWith('/quick-stock')).length,0)
  await page.reload()
  await page.getByRole('button',{name:'Retry same update',exact:true}).click()
  await page.getByText(/3 pieces\./).waitFor()
  const request=calls.find(call=>call.path.endsWith('/quick-stock'))
  assert.equal(request.operationId,operationId);assert.equal(request.body.delta,-1)
  assert.equal((await stockKeysOn(page)).length,0)
 }finally{await page.context().close()}
})

test('phase 3: unavailable photo is explicit in catalog and detail while edits remain usable',async()=>{
 const {page,calls,errors}=await open(1366,900,'OWNER','photo-unavailable')
 try {
  await page.getByLabel('Photo unavailable',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('No product image',{exact:true}).count(),1)
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.getByLabel('Photo unavailable',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Edit product',exact:true}).click()
  await page.locator('#catalog-product-name').fill('Photo independent product')
  await page.getByRole('button',{name:'Save product',exact:true}).click()
  await page.getByText('Product updated.',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Photo unavailable',{exact:true}).count(),1)
  assert.equal(calls.filter(call=>call.method==='PATCH').length,1)
  assert.deepEqual(errors,[])
 }finally{await page.close()}
})
test('phase 3: mixed-case trimmed colors share one group and retain separate sizes and quantities',async()=>{
 const {page,errors}=await open(390,844,'OWNER','mixed-color')
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.locator('.product-stock-row').nth(2).waitFor()
  assert.equal(await page.locator('.product-color-stock-card').count(),1)
  assert.equal(await page.getByRole('heading',{name:'Black',exact:true}).count(),1)
  assert.deepEqual(await page.locator('.product-stock-size').allTextContents(),['S','M','L'])
  assert.deepEqual(await page.locator('.product-stock-quantity').allTextContents(),['Stock4','Stock8','Stock12'])
  await noOverflow(page);assert.deepEqual(errors,[])
 }finally{await page.close()}
})

test('phase 4: mobile state badges and More do not overlap and bulk selector is compact',async()=>{
 const {page}=await open(390,844)
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.locator('.product-stock-row').first().waitFor()
  const separated=await page.locator('.product-stock-row').first().evaluate(row=>{
   const badge=row.querySelector('.product-option-state').getBoundingClientRect()
   const more=row.querySelector('.product-stock-more').getBoundingClientRect()
   return badge.top>=more.bottom || badge.bottom<=more.top || badge.right<=more.left || badge.left>=more.right
  })
  assert.equal(separated,true)
  await page.getByRole('button',{name:'Apply price to variants',exact:true}).click()
  assert.equal(await page.locator('.product-price-targets input').first().isVisible(),false)
  await page.locator('.product-price-selection summary').click()
  assert.equal(await page.locator('.product-price-targets input').first().isVisible(),true)
  await page.locator('.product-price-targets input').first().uncheck()
  assert.equal(await page.locator('.product-price-selection summary').textContent(),'Choose options (2 selected)')
  await noOverflow(page)
 }finally{await page.close()}
})
