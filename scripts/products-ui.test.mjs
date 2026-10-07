// Offline browser regressions. All application requests are synthetic fixtures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, noOverflow, catId, screenshots, origin } from './products-ui-fixture.mjs'
async function selectSection(page, name) {
  await page.getByRole('navigation', { name: 'Product management sections' }).getByRole('button', { name, exact: true }).click()
}
async function openDetail(page) {
  if (!new URL(page.url()).pathname.startsWith('/app/products/')) await page.getByRole('button', { name: /^View product:/ }).first().click()
  await page.locator('.product-section-nav').waitFor()
}
async function openRestock(page) { await openDetail(page); await selectSection(page, 'Restock') }
async function openEntry(page) {
  if (await page.locator('.entry-page').count()) return
  if (new URL(page.url()).pathname.startsWith('/app/products/')) await page.getByRole('button', { name: 'Back to products', exact: true }).click()
  await page.getByRole('button', { name: /Add product/i }).first().click()
  await page.getByRole('heading', { name: 'Product Entry', exact: true }).waitFor()
}
async function correctStock(page, index = 0, delta = 1) {
  await selectSection(page, 'Count Check')
  await page.getByRole('button', {name:delta > 0 ? /^Add one piece:/ : /^Remove one piece:/}).nth(index).click()
  await page.getByRole('dialog').getByRole('button',{name:'Confirm correction',exact:true}).click()
}

async function confirmInventoryReceipt(page) {
  await openRestock(page)
  await page.getByLabel('Receiving now: Navy / S',{exact:true}).fill('2')
  await page.getByLabel('Purchase cost per piece (USD)',{exact:true}).fill('4')
  await page.getByRole('button',{name:'Review receipt',exact:true}).click()
  await page.getByRole('button',{name:'Confirm receiving',exact:true}).click()
}
async function receiptRecoveryRecords(page) {
  return page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('saas2:receiving:v1:')&&key.includes(':operation:')).map(key=>JSON.parse(localStorage.getItem(key))))
}
test('Products Restock receives 40 pieces by matrix in one atomic request with common cost',async()=>{
  const {page,calls,errors}=await open(390,844,'OWNER','inventory')
  try{
    await openRestock(page)
    await page.getByLabel('Receiving now: Navy / S',{exact:true}).fill('17')
    await page.getByLabel('Receiving now: Navy / M',{exact:true}).fill('23')
    await page.getByLabel('Purchase cost per piece (USD)',{exact:true}).fill('1.2345')
    await page.screenshot({path:join(screenshots,'inventory-receiving-390.png'),fullPage:true})
    await page.getByRole('button',{name:'Review receipt',exact:true}).click()
    await page.getByRole('heading',{name:'Review receiving',exact:true}).waitFor()
    await page.getByText('49.3800 USD',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Confirm receiving',exact:true}).click()
    await page.getByRole('heading',{name:'Stock received successfully',exact:true}).waitFor()
    assert.equal(await page.locator('.receipt-success .inventory-feedback.is-success').count(),1)
    await page.screenshot({path:join(screenshots,'inventory-success-390.png'),fullPage:true})
    const writes=calls.filter(c=>c.path==='/api/inventory/receipts'&&c.method==='POST')
    assert.equal(writes.length,1);assert.equal(writes[0].body.items.length,2)
    assert.equal(writes[0].body.unitCost,'1.2345');assert.ok(writes[0].operationId)
    assert.deepEqual(errors,[])
  }finally{await page.close()}
})
test('receiving lost response survives reload and reuses the exact original payload and key',async()=>{
  const {page,calls}=await open(768,1024,'OWNER','receipt-uncertain')
  try{
    await openRestock(page)
    await openRestock(page)
    await page.getByLabel('Receiving now: Navy / S',{exact:true}).fill('2')
    await page.getByLabel('Purchase cost per piece (USD)',{exact:true}).fill('4')
    await page.getByRole('button',{name:'Review receipt',exact:true}).click()
    await page.getByRole('button',{name:'Confirm receiving',exact:true}).click()
    await page.getByRole('button',{name:'Retry original receiving request',exact:true}).waitFor()
    assert.equal(await page.locator('.receipt-recovery .inventory-feedback.is-pending').count(),1)
    await page.getByText('2 pieces · 1 option',{exact:false}).waitFor()
    await page.reload()
    await page.getByRole('button',{name:'Retry original receiving request',exact:true}).click()
    await page.getByRole('heading',{name:'Stock received successfully',exact:true}).waitFor()
    const writes=calls.filter(c=>c.path==='/api/inventory/receipts'&&c.method==='POST')
    assert.equal(writes.length,2);assert.equal(writes[0].operationId,writes[1].operationId);assert.deepEqual(writes[0].body,writes[1].body)
  }finally{await page.close()}
})
test('Phase 4: expired receipt session preserves the original operation before auth redirect',async()=>{
  const {page,calls}=await open(768,900,'OWNER','inventory-receipt-auth')
  try{
    await confirmInventoryReceipt(page)
    await page.waitForURL(url=>url.pathname==='/login')
    const records=await receiptRecoveryRecords(page)
    assert.equal(records.length,1);assert.equal(records[0].recovery.outcome,'authentication_pause')
    const writes=calls.filter(call=>call.path==='/api/inventory/receipts'&&call.method==='POST')
    assert.equal(writes.length,1);assert.equal(records[0].operationId,writes[0].operationId);assert.deepEqual(records[0].payload,writes[0].body)
  }finally{await page.close()}
})
for(const [mode,message] of [
  ['inventory-receipt-product-not-found','This product is no longer available. Return to Products and refresh before starting again.'],
  ['inventory-receipt-variant-not-found','One or more color / size options are no longer available. Refresh the product before starting again.'],
]) test(`Phase 4: ${mode} releases recovery and restores Products actions`,async()=>{
  const {page,calls}=await open(768,900,'OWNER',mode)
  try{
    await confirmInventoryReceipt(page)
    await page.getByText(message,{exact:true}).waitFor()
    assert.equal((await receiptRecoveryRecords(page)).length,0)
    assert.equal(await page.getByRole('button',{name:'Back to products',exact:true}).isEnabled(),true)
    assert.equal(await page.getByRole('button',{name:'Review receipt',exact:true}).isEnabled(),true)
    assert.equal(calls.filter(call=>call.path==='/api/inventory/receipts'&&call.method==='POST').length,1)
  }finally{await page.close()}
})
test('Phase 4: idempotency conflict presents review and never loops the conflicting POST',async()=>{
  const {page,calls}=await open(768,900,'OWNER','inventory-receipt-conflict')
  try{
    await confirmInventoryReceipt(page)
    await page.getByText('Receiving operation needs review',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Retry original receiving request',exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'Check original result',exact:true}).count(),1)
    let records=await receiptRecoveryRecords(page);assert.equal(records.length,1);assert.equal(records[0].recovery.outcome,'idempotency_conflict')
    await page.getByRole('button',{name:'Check original result',exact:true}).click()
    await page.getByText(/still needs review/i).first().waitFor()
    records=await receiptRecoveryRecords(page);assert.equal(records[0].recovery.outcome,'idempotency_conflict')
    assert.equal(calls.filter(call=>call.path==='/api/inventory/receipts'&&call.method==='POST').length,1)
    assert.equal(calls.filter(call=>call.path.includes('/by-operation/')&&call.method==='GET').length,1)
  }finally{await page.close()}
})
test('Phase 4: save-only uncertainty uses product-save language and exact replay',async()=>{
  const {page,calls}=await open(768,900,'OWNER','inventory-save-uncertain')
  try{
    await openEntry(page)
    await page.getByLabel('Product name',{exact:true}).fill('Recovery product')
    await page.getByLabel('Category',{exact:true}).first().selectOption(catId)
    await page.getByLabel('Colors',{exact:true}).selectOption('Black')
    await page.getByRole('button',{name:'M',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Save product only',exact:true}).click()
    await page.getByRole('button',{name:'Confirm product only',exact:true}).click()
    const banner=page.locator('.receipt-recovery')
    await banner.getByText('Product save awaiting confirmation',{exact:true}).waitFor()
    await banner.getByRole('button',{name:'Retry original product save',exact:true}).waitFor()
    assert.doesNotMatch(await banner.textContent(),/receipt/i)
    await page.reload()
    await page.getByRole('button',{name:'Retry original product save',exact:true}).click()
    await page.getByRole('heading',{name:'Product created successfully',exact:true}).waitFor()
    const writes=calls.filter(call=>call.path==='/api/inventory/product-setups'&&call.method==='POST')
    assert.equal(writes.length,2);assert.equal(writes[0].operationId,writes[1].operationId);assert.deepEqual(writes[0].body,writes[1].body)
  }finally{await page.close()}
})
test('Phase 4: rejected save-only operation releases recovery without receipt wording',async()=>{
  const {page}=await open(768,900,'OWNER','inventory-save-rejected')
  try{
    await openEntry(page)
    await page.getByLabel('Product name',{exact:true}).fill('Rejected product')
    await page.getByLabel('Category',{exact:true}).first().selectOption(catId)
    await page.getByLabel('Colors',{exact:true}).selectOption('Black')
    await page.getByRole('button',{name:'M',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Save product only',exact:true}).click()
    await page.getByRole('button',{name:'Confirm product only',exact:true}).click()
    const alert=page.locator('.receipt-form .inventory-feedback.is-error')
    await alert.getByText(/product details were not accepted/i).waitFor()
    assert.doesNotMatch(await alert.textContent(),/receipt/i)
    assert.equal((await receiptRecoveryRecords(page)).length,0)
    assert.equal(await page.getByRole('button',{name:'Save product only',exact:true}).isEnabled(),true)
  }finally{await page.close()}
})
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
      await page.getByRole('heading', { name: 'Product Entry', exact: true }).waitFor()
      await page.getByLabel('Product name', { exact: true }).fill('Cotton T-shirt')
      await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
      await page.getByLabel('Colors', { exact: true }).selectOption('Black')
      await page.getByRole('button', { name: 'M', exact: true }).click()
      await noOverflow(page)
      const fieldHeight = await page.getByLabel('Product name', { exact: true }).evaluate((el) => el.getBoundingClientRect().height)
      assert.ok(fieldHeight >= 44)
      const gridColumns = await page.locator('.product-info-fields .product-form-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      assert.equal(gridColumns, width <= 600 ? 1 : 2)
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
    await selectSection(page, 'Count Check')
    const stockBefore = await page.locator('.count-check-quantity').first().innerText()
    await correctStock(page, 0, 1)
    await page.getByText(/Stock count updated\./).waitFor()
    assert.equal(Number(await page.locator('.count-check-quantity').first().innerText().then(text => text.replace('System stock', '').trim())), Number(stockBefore.replace('System stock', '').trim()) + 1)
    assert.equal(await page.getByLabel('Quantity to add', { exact: true }).count(), 0)
    await selectSection(page, 'Overview')
    await page.locator('.product-stock-more').first().evaluate(el => { el.open = true })
    await page.getByRole('button', { name: 'Deactivate variant', exact: true }).first().click()
    await page.getByRole('dialog', { name: 'Deactivate color / size?', exact: true }).waitFor()
    await page.screenshot({ path: join(screenshots, 'confirmation-390.png') })
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Deactivate variant', exact: true }).first().evaluate((el) => el === document.activeElement), true)
    await selectSection(page, 'Overview')
    await page.locator('.product-stock-more').first().evaluate(el => { el.open = true })
    await page.getByRole('button', { name: 'Deactivate variant', exact: true }).first().click()
    await page.getByRole('button', { name: 'Deactivate color / size', exact: true }).click()
    await selectSection(page, 'Overview')
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
    assert.equal(await page.getByRole('button', { name: /^Add one piece:/ }).count(), 0)
    await page.getByRole('button', { name: 'Back to products', exact: true }).click()
    await page.getByRole('button', { name: 'Add product', exact: false }).first().click()
    await page.getByLabel('Product name', { exact: true }).fill('Warehouse shirt')
    await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
    assert.equal(await page.getByLabel('Price for all sizes', { exact: false }).count(), 0)
    await page.getByLabel('Colors', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.locator('.receipt-steps [aria-current="step"]').textContent(), '2Product review')
    await page.getByRole('button',{name:'Save product only',exact:true}).click()
    await page.getByRole('button',{name:'Confirm product only',exact:true}).click()
    await page.getByRole('heading', { name: 'Product created successfully', exact: true }).waitFor()
    await page.getByText('Saved with zero stock.',{exact:true}).waitFor()
    assert.equal(await page.getByText('Purchase total:',{exact:false}).count(),0)
    const createdVariant = calls.find((call) => call.method === 'POST' && call.path.endsWith('/product-setups'))
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
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button',{name:'Save product only',exact:true}).click()
    await page.getByRole('button',{name:'Confirm product only',exact:true}).click()
    await page.getByRole('heading', { name: 'Product created successfully', exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.method === 'POST' && call.path.endsWith('/image')).length, 1)
    await page.getByRole('button',{name:'Open navigation',exact:true}).click()
    await page.getByRole('link',{name:'Products',exact:true}).click()
    await page.getByRole('button',{name:'View product: Photo product',exact:true}).click()
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

test('OWNER product-only creation sends zero initial stock for every option', async () => {
  const { page, calls, errors } = await open(390, 844)
  try {
    await page.getByRole('button', { name: 'Add product', exact: false }).first().click()
    await page.getByLabel('Product name', { exact: true }).fill('Opening pieces')
    await page.getByLabel('Category', { exact: true }).first().selectOption(catId)
    await page.getByLabel('Colors', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'S', exact: true }).click()
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button',{name:'Save product only',exact:true}).click()
    await page.getByRole('button',{name:'Confirm product only',exact:true}).click()
    await page.getByRole('heading', { name: 'Product created successfully', exact: true }).waitFor()
    const setups = calls.filter(c => c.method === 'POST' && c.path.endsWith('/product-setups'))
    assert.equal(setups.length, 1)
    assert.equal(setups[0].body.variants.length, 2)
    assert.ok(setups[0].body.variants.every(v => !Object.hasOwn(v, 'openingStock') && !Object.hasOwn(v, 'unitCost')))
    assert.equal(calls.filter(c => c.method === 'POST' && c.path.endsWith('/variants')).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
test('receiving creation image failure retries only photo without recreating definition',async()=>{
  const {page,calls}=await open(1366,768,'OWNER','image-upload-failure')
  try{
    await page.getByRole('button',{name:'Add product',exact:false}).first().click()
    await page.getByLabel('Product name',{exact:true}).fill('Photo retry product')
    await page.getByLabel('Category',{exact:true}).first().selectOption(catId)
    await page.getByLabel('Colors',{exact:true}).selectOption('Black')
    await page.getByRole('button',{name:'M',exact:true}).click()
    await page.locator('.product-photo-fields').evaluate(el=>{el.open=true})
    await page.getByLabel('Choose a photo',{exact:true}).setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')})
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Save product only',exact:true}).click()
    await page.getByRole('button',{name:'Confirm product only',exact:true}).click()
    await page.getByRole('button',{name:'Retry photo only',exact:true}).click()
    await page.getByRole('heading',{name:'Product created successfully',exact:true}).waitFor()
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/api/inventory/product-setups').length,1)
    assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/image')).length,2)
  }finally{await page.close()}
})
test('Products histories load on demand, retain sections and support explicit refresh', async () => {
 const {page,calls,errors}=await open(1366,900,'OWNER','inventory')
 try {
 const count=path=>calls.filter(call=>call.method==='GET'&&call.path===path).length
 assert.equal(count('/api/products'),1)
 for(const path of ['/api/inventory/receipts','/api/inventory/movements','/api/inventory/reconciliation'])assert.equal(count(path),0)
 await openDetail(page);await selectSection(page,'Receipt History')
 await page.getByRole('heading',{name:'No receipts yet'}).waitFor();assert.equal(count('/api/inventory/receipts'),1)
 await selectSection(page,'Overview');await selectSection(page,'Receipt History')
 assert.equal(count('/api/inventory/receipts'),1)
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:'No receipts yet'}).waitFor()
 assert.equal(count('/api/inventory/receipts'),2)
 await selectSection(page,'Movement History');await page.getByText('No movements match these filters yet.').waitFor();assert.equal(count('/api/inventory/movements'),1)
 await selectSection(page,'Count Check');await page.getByText('No variants match these filters.').waitFor();assert.equal(count('/api/inventory/reconciliation'),1)
 assert.deepEqual(errors,[])
 }finally{await page.close()}
})

test('Legacy Inventory productId bookmark redirects to Products receiving', async () => {
 const {page,calls,errors}=await open(1366,900,'OWNER','inventory-deep-link')
 try {
 await page.getByRole('heading',{name:'Restock',exact:true}).waitFor()
 await page.getByLabel('Receiving now: Navy / S',{exact:true}).waitFor()
 assert.equal(calls.filter(call=>call.method==='GET'&&call.path.includes('/api/products/')).length,1)
 assert.equal(calls.filter(call=>call.path==='/api/products').length,0)
 assert.equal(calls.filter(call=>call.path.startsWith('/api/inventory/')).length,0)
 assert.deepEqual(errors,[])
 }finally{await page.close()}
})

test('Products Stock initializes purchase cost of the existing piece without restocking', async () => {
  const { page, calls, errors } = await open(390, 844, 'OWNER', 'inventory')
  try {
    await openDetail(page); await selectSection(page, 'Stock')
    await page.getByRole('button', { name: 'Set cost', exact: true }).click()
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('8.1234')
    await page.getByRole('button', { name: 'Save cost', exact: true }).click()
    await page.getByText('Purchase cost saved. Quantity and historical sale costs are unchanged.', { exact: true }).waitFor()
    const saved = calls.find(c => c.method === 'PUT' && c.path.endsWith('/opening-cost'))
    assert.deepEqual(saved.body, { unitCost: '8.1234' })
    assert.equal(calls.filter(c => c.path.endsWith('/restocks')).length, 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

for (const width of [390, 430, 768, 1280, 1366, 1440]) test(`Products catalog and history stay contained at ${width}px`,async()=>{
 const {page,errors}=await open(width,900,'OWNER','inventory')
 try {
 await noOverflow(page);assert.equal(await page.locator('.product-card').count(),3)
 await page.getByLabel('Search',{exact:true}).fill('shirt')
 await openDetail(page);await selectSection(page,'Receipt History')
 await page.getByRole('heading',{name:'No receipts yet'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Previous receipts'}).count(),0)
 await noOverflow(page);await page.screenshot({path:join(screenshots,`product-history-${width}.png`),fullPage:true})
 assert.deepEqual(errors,[])
 }finally{await page.close()}
})

for (const width of [390, 430, 768, 1366]) {
  test(`Dense receiving uses mobile lists and contained desktop matrices at ${width}px`, async () => {
    const { page, errors } = await open(width, 900, 'OWNER', 'inventory-dense')
    try {
      await openRestock(page)
      await page.getByLabel('Receiving now: Black / XS', { exact: true }).fill('2')
      await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
      await noOverflow(page)
      if(width<=600) {
        assert.equal(await page.locator('.receipt-mobile-color').count(),4)
        assert.equal(await page.locator('.receipt-matrix').count(),0)
      } else {
        const widths=await page.locator('.receipt-matrix').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}))
        assert.ok(widths.scroll>widths.client)
        assert.equal(await page.locator('.receipt-matrix th').first().evaluate(el=>getComputedStyle(el).position),'sticky')
        await page.locator('.receipt-matrix').focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(80)
        assert.ok(await page.locator('.receipt-matrix').evaluate(el=>el.scrollLeft)>0)
      }
      await page.screenshot({ path: join(screenshots, `inventory-dense-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
      await page.getByRole('heading', { name: 'Review receiving', exact: true }).waitFor()
      await noOverflow(page)
      await page.screenshot({ path: join(screenshots, `inventory-review-${width}.png`), fullPage: true })
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

test('Entry step back preserves product definition, quantities and exact cost preview', async () => {
  const { page, calls } = await open(390, 844, 'OWNER', 'inventory')
  try {
    await openEntry(page)
    await page.getByLabel('Product name', { exact: true }).fill('Draft shirt')
    await page.getByLabel('Category', { exact: true }).selectOption(catId)
    await page.getByLabel('Colors', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Receiving now: Black / M', { exact: true }).fill('3')
    await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).fill('1.2345')
    await page.getByText('3.7035 USD', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back to product', exact: true }).click()
    assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), 'Draft shirt')
    assert.equal(await page.getByRole('button', { name: 'M', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    assert.equal(await page.getByLabel('Receiving now: Black / M', { exact: true }).inputValue(), '3')
    assert.equal(await page.getByLabel('Purchase cost per piece (USD)', { exact: true }).inputValue(), '1.2345')
    assert.equal(calls.filter(c => c.method === 'POST' && c.path === '/api/inventory/product-setups').length, 0)
  } finally { await page.close() }
})

test('Receipt validation errors use an alert before any request', async () => {
  const { page, calls } = await open(430, 900, 'OWNER', 'inventory')
  try {
    await openRestock(page)
    await page.getByRole('button', { name: 'Review receipt', exact: true }).click()
    await page.locator('.receipt-form .inventory-feedback.is-error[role="alert"]').waitFor()
    assert.equal(calls.filter(c => c.method === 'POST' && c.path === '/api/inventory/receipts').length, 0)
    await page.getByLabel('Receiving now: Navy / S', { exact: true }).fill('1')
    assert.equal(await page.locator('.receipt-form .inventory-feedback.is-error').count(), 0)
  } finally { await page.close() }
})

test('Leaving the returned product step prompts once for both unsaved forms', async () => {
  const { page } = await open(390, 844, 'OWNER', 'inventory')
  try {
    await openEntry(page)
    await page.getByLabel('Product name', { exact: true }).fill('Draft shirt')
    await page.getByLabel('Category', { exact: true }).selectOption(catId)
    await page.getByLabel('Colors', { exact: true }).selectOption('Black')
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Receiving now: Black / M', { exact: true }).fill('3')
    await page.getByRole('button', { name: 'Back to product', exact: true }).click()
    let prompts = 0
    page.on('dialog', async (dialog) => { prompts += 1; await dialog.accept() })
    await page.locator('.product-create-form').getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByLabel('Product name', {exact:true}).waitFor()
    assert.equal(await page.getByLabel('Product name', {exact:true}).inputValue(),'')
    assert.equal(prompts, 1)
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
    await correctStock(page, 0, 1)
    await page.locator('#products-feedback[role=alert]').waitFor()
    await page.getByRole('button', { name: 'Retry same update', exact: true }).first().click()
    await page.getByText(/Stock count updated\./).waitFor()
    assert.equal(await page.locator('.count-check-quantity').first().innerText().then(text => text.replace('System stock', '').trim()), '5')
    await correctStock(page, 0, 1)
    await page.getByText(/6 pieces\./).waitFor()
    const requests = calls.filter(c => c.path.endsWith('/stock-adjustment'))
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
   await correctStock(page, 0, -1)
   await page.getByText(new RegExp(`${stock} pieces\\.`)).waitFor()
  }
  assert.equal(await page.getByRole('button', { name: /^Remove one piece:/ }).first().isDisabled(), true)
  assert.equal(calls.find(c => c.path.endsWith('/stock-adjustment')).body.delta, -1)
  await correctStock(page, 0, 1)
  await page.getByText(/1 pieces\./).waitFor()
  assert.equal(await page.getByRole('button', { name: /^Remove one piece:/ }).first().isEnabled(), true)
 } finally { await page.close() }
})

test('reload exposes deliberate stock recovery with the same UUID and no extra piece', async () => {
 const {page,calls}=await open(1366,768,'OWNER','quick-uncertain')
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await correctStock(page, 0, 1)
 await page.locator('#products-feedback[role=alert]').waitFor()
 await page.reload()
 assert.equal(await page.getByRole('button',{name:/^Add one piece:/}).first().isDisabled(),true)
 assert.equal(calls.filter(c=>c.path.endsWith('/stock-adjustment')).length,1)
 await page.getByRole('button',{name:'Retry same update',exact:true}).click()
 await page.getByText(/5 pieces\./).waitFor()
 const requests=calls.filter(c=>c.path.endsWith('/stock-adjustment'))
 assert.equal(requests[0].operationId,requests[1].operationId)
 assert.equal(await page.getByRole('button',{name:/^Add one piece:/}).first().isEnabled(),true)
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
 await correctStock(page, 0, 1)
 await page.getByText('Confirming correction...',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:/^Add one piece:/}).first().isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:/^Add one piece:/}).nth(1).isEnabled(),true)
 await page.getByText(/Stock count updated\./).waitFor()
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
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await Promise.all([page.waitForEvent('dialog'),page.evaluate(()=>history.back())])
 await page.waitForTimeout(50)
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
 await page.getByText('Sellable',{exact:true}).first().waitFor()
 assert.equal(await page.getByText('Sellable',{exact:true}).count(),3)
 assert.equal(await page.getByText('Cost pending: set in Stock',{exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Apply price to variants',exact:true}).count(),0)
 }finally{await page.close()}
})

for(const width of [390,768,1024,1366,1440]) test(`owner cost pending is independent from sellability at ${width}`,async()=>{
 const {page}=await open(width,width===390?844:900,'OWNER','pending-cost')
 try {
 await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
 await page.getByText('Cost pending: set in Stock',{exact:true}).first().waitFor()
 assert.equal(await page.getByText('Cost pending: set in Stock',{exact:true}).count(),3)
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
 await page.route('**/stock-adjustment',async route=>{await gate;await route.fallback()});
 await correctStock(page);await selectSection(page,'Overview');
 await page.locator('.count-check-row [role=status]').first().waitFor({state:'attached'});
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
 await selectSection(page,'Count Check');assert.equal(await page.getByRole('button',{name:/^Add one piece:/}).nth(1).isEnabled(),true);await selectSection(page,'Overview');
 release();
 await page.locator('.count-check-row').first().getByRole('status').waitFor({state:'hidden'});
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
  await selectSection(page,'Count Check');await other.goto(page.url());await other.locator('.count-check-row').first().waitFor()
  await correctStock(page, 0, 1)
  await page.locator('#products-feedback[role=alert]').waitFor()
  await correctStock(other, 1, 1)
  await other.locator('#products-feedback[role=alert]').waitFor()
  assert.equal((await stockKeysOn(page)).length,2)
  await page.reload();await other.reload()
  await page.getByRole('button',{name:'Retry same update',exact:true}).nth(1).waitFor()
  await other.getByRole('button',{name:'Retry same update',exact:true}).nth(1).waitFor()
  assert.equal(await other.getByRole('button',{name:'Retry same update',exact:true}).count(),2)
  assert.equal(calls.filter(call=>call.path.endsWith('/stock-adjustment')).length,2)
  await page.getByRole('button',{name:'Retry same update',exact:true}).first().click()
  await page.getByText(/5 pieces\./).waitFor()
  await other.getByRole('button',{name:'Retry same update',exact:true}).click()
  await other.getByText(/9 pieces\./).waitFor()
  const requests=calls.filter(call=>call.path.endsWith('/stock-adjustment'))
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
  await selectSection(page,'Count Check');await other.goto(page.url());await other.locator('.count-check-row').first().waitFor()
  await page.route('**/stock-adjustment',async route=>{await gate;await route.fallback()})
  await correctStock(page, 0, 1)
  await other.getByRole('button',{name:'Retry same update',exact:true}).waitFor()
  assert.equal(await other.getByRole('button',{name:/^Add one piece:/}).first().isDisabled(),true)
  await other.getByRole('button',{name:'Retry same update',exact:true}).click()
  await other.getByText('Another page is confirming this option. Wait for it to finish before retrying.').waitFor()
  release();await page.getByText(/5 pieces\./).waitFor()
  assert.equal(calls.filter(call=>call.path.endsWith('/stock-adjustment')).length,1)
  assert.equal((await stockKeysOn(other)).length,0)
 }finally{release();await context.close()}
})
test('phase 2: late response after navigation clears only its own operation',async()=>{
 const {page}=await open(1366,900,'OWNER','normal',true)
 let release;const gate=new Promise(resolve=>{release=resolve})
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.route('**/stock-adjustment',async route=>{
   if(route.request().url().includes('000000000010')){await gate;await route.fallback()}
   else await route.abort()
  })
  await correctStock(page, 0, 1)
  await page.locator('.count-check-row').first().getByRole('status').waitFor()
  await page.evaluate(()=>{history.pushState(null,'','/app/products');window.dispatchEvent(new PopStateEvent('popstate'))})
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await selectSection(page,'Count Check');await page.getByRole('button',{name:'Retry same update',exact:true}).waitFor()
  await correctStock(page, 1, 1)
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
  await selectSection(page,'Count Check');await page.getByText(/Safe stock updates require browser Web Locks/).waitFor()
  assert.equal(await page.getByRole('button',{name:/^Add one piece:/}).first().isDisabled(),true)
  assert.equal(calls.filter(call=>call.path.endsWith('/stock-adjustment')).length,0)
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
  await selectSection(page,'Count Check');await page.getByRole('button',{name:'Retry same update',exact:true}).waitFor()
  await page.waitForFunction(key=>localStorage.getItem(key)===null,legacyKey)
  assert.equal((await stockKeysOn(page)).length,1)
  assert.equal(calls.filter(call=>call.path.endsWith('/stock-adjustment')).length,0)
  await page.reload()
  await page.getByRole('button',{name:'Retry same update',exact:true}).click()
  await page.getByText(/3 pieces\./).waitFor()
  const request=calls.find(call=>call.path.endsWith('/stock-adjustment'))
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


test('receiving stage 1: overlapping variant draft blocks bulk price without losing input', async () => {
 const {page,calls}=await open(1366,900)
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.getByRole('button',{name:'Edit',exact:true}).first().click()
  await page.locator('#catalog-variant-color').fill('Blue')
  await page.getByRole('button',{name:'Apply price to variants',exact:true}).click()
  await page.locator('#product-common-price').fill('27.50')
  await page.getByRole('button',{name:'Review price update',exact:true}).click()
  assert.match(await page.locator('#products-feedback').textContent(),/Save or cancel the open option edit/)
  assert.equal(calls.filter(c=>c.path.endsWith('/variant-prices')).length,0)
  assert.equal(await page.locator('#catalog-variant-color').inputValue(),'Blue')
  page.on('dialog',dialog=>dialog.accept())
  await page.locator('.product-stock-row .product-form').getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('button',{name:'Review price update',exact:true}).click()
  await page.getByRole('button',{name:'Confirm price update',exact:true}).click()
  await page.getByText('Selected option prices updated together.',{exact:true}).waitFor()
  assert.equal(calls.filter(c=>c.path.endsWith('/variant-prices')).length,1)
 } finally {await page.close()}
})

test('receiving stage 1: external completion refreshes stock and preserves product draft', async () => {
 const {page}=await open(1366,900,'OWNER','normal',true)
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.getByRole('button',{name:'Edit product',exact:true}).click()
  await page.locator('#catalog-product-name').fill('Unsaved name')
  const variantId='33333333-3333-4333-8333-000000000010'
  const operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const key='saas2:quick-stock:v1:qa-account:qa-user:22222222-2222-4222-8222-000000000001:operation:'+operationId
  const other=await page.context().newPage()
  await other.goto(origin+'/qa')
  await other.evaluate(({key,variantId,operationId})=>localStorage.setItem(key,JSON.stringify({variantId,operationId,delta:1,createdAt:Date.now()})),{key,variantId,operationId})
  await page.getByText('A count correction is awaiting confirmation.',{exact:false}).waitFor()
  await other.evaluate(async ({key,variantId,operationId})=>{
   await fetch('/api/products/22222222-2222-4222-8222-000000000001/variants/'+variantId+'/stock-adjustment',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':operationId},body:JSON.stringify({delta:1})})
   localStorage.removeItem(key)
  },{key,variantId,operationId})
  await page.waitForFunction(()=>document.querySelector('.product-stock-quantity')?.textContent==='Stock5',null,{timeout:2500})
  assert.equal(await page.locator('#catalog-product-name').inputValue(),'Unsaved name')
 } finally {await page.context().close()}
})

test('receiving stage 1: unavailable attached photo retains removal action', async () => {
 const {page}=await open(1366,900,'OWNER','photo-unavailable')
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.locator('.product-photo-action summary').click()
  assert.equal(await page.getByRole('button',{name:'Remove image',exact:true}).count(),1)
 } finally {await page.close()}
})

test('receiving stage 1: failed object cleanup refreshes detached photo and reports partial outcome', async () => {
 const {page}=await open(1366,900,'OWNER','image-cleanup-failure')
 try {
  await page.getByRole('button',{name:'View product: Essential cotton T-shirt',exact:true}).click()
  await page.locator('.product-photo-action summary').click()
  await page.getByRole('button',{name:'Remove image',exact:true}).click()
  await page.getByRole('button',{name:'Remove image',exact:true}).last().click()
  await page.getByText(/removed from the product.*storage cleanup/i).waitFor({timeout:2500})
  assert.equal(await page.locator('.product-overview-summary img').count(),0)
  assert.equal(await page.getByRole('dialog').count(),0)
 } finally {await page.close()}
})

test('Product section visits and history refresh retain movement and reconciliation filters',async()=>{
 const {page}=await open(1366,900,'OWNER','inventory')
 try {
 await openDetail(page);await selectSection(page,'Movement History');await page.locator('#history-type').selectOption('SALE')
 await selectSection(page,'Count Check');await page.locator('#reconciliation-status').selectOption('MISMATCH')
 await selectSection(page,'Movement History');await page.getByRole('button',{name:'Apply filters',exact:true}).click()
 await selectSection(page,'Count Check');await page.getByRole('button',{name:'Apply filters',exact:true}).click()
 await selectSection(page,'Overview');await selectSection(page,'Movement History');await page.getByRole('button',{name:'Refresh',exact:true}).click()
 assert.equal(await page.locator('#history-type').inputValue(),'SALE')
 assert.equal(await page.locator('#reconciliation-status').inputValue(),'MISMATCH')
 }finally{await page.close()}
})

test('Unsaved purchase cost blocks leaving Products and survives section navigation',async()=>{
 const {page}=await open(1366,900,'OWNER','inventory')
 try {
 await openDetail(page);await selectSection(page,'Stock');await page.getByRole('button',{name:'Set cost',exact:true}).click()
 await page.getByLabel('Purchase cost per piece (USD)',{exact:true}).fill('8.1234')
 await selectSection(page,'Overview');await selectSection(page,'Stock')
 let warned=false;page.on('dialog',async dialog=>{warned=true;await dialog.dismiss()})
 await page.getByRole('button',{name:'Back to products',exact:true}).click()
 assert.equal(warned,true)
 assert.equal(await page.getByLabel('Purchase cost per piece (USD)',{exact:true}).inputValue(),'8.1234')
 }finally{await page.close()}
})
