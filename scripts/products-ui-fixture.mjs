// Offline browser verification. No application/API/auth network is allowed.
// QA_PLAYWRIGHT_MODULE points to an external Playwright installation; no app dependency.
// Run: node --test scripts/products-ui.test.mjs
import { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { summarizeProductCatalog, decimalToMinorUnits, minorUnitsToDecimal } from '../frontend/src/lib/money.js'

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
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import '/src/index.css'; import {AppLayout} from '/src/app/AppLayout.jsx'; import {confirmDiscardChanges} from '/src/app/dirty-state.js'; const role = new URLSearchParams(location.search).get('role') || 'OWNER'; function Root(){const [path,setPath]=React.useState(location.pathname.startsWith('/app/')?location.pathname:new URLSearchParams(location.search).get('page')==='inventory'?'/app/inventory':new URLSearchParams(location.search).get('page')==='reports'?'/app/reports':'/app/products');React.useEffect(()=>{const onPop=event=>{if(!confirmDiscardChanges()){history.pushState(null,'',path);event.stopImmediatePropagation();return}setPath(location.pathname)};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[path]);return React.createElement(AppLayout,{pathname:path,navigate:(next,options={})=>{if(!confirmDiscardChanges())return;if(options.replace)history.replaceState(null,'',next);else history.pushState(null,'',next);setPath(next.split('?')[0])},profile:{user:{id:'qa-user',firstName:'Store',lastName:'Team',role},account:{id:'qa-account',name:'Sample clothing store',baseCurrency:'USD',status:'ACTIVE'}}})} createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Root)));`
  server = await createServer({ configFile: false, root: resolve('frontend'), envDir: false,
    plugins: [{ name: 'products-offline-fixture', enforce: 'pre',
      resolveId(id) { if (id === '/qa-entry.jsx') return '\0products-qa-entry.jsx' },
      load(id) {
        if (id === '\0products-qa-entry.jsx') return entry
        if (id.replaceAll('\\', '/').endsWith('/src/lib/supabase.js')) return `export const supabase = { auth: {getSession:async()=>({data:{session:{access_token:'offline-fixture',user:{id:'qa-user'}}}})}};`
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        if (!['/qa','/login','/pending-approval'].includes(req.url.split('?')[0]) && !req.url.startsWith('/app/')) return next()
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
  page.setDefaultTimeout(5000)
  const calls = [], errors = [], stockKeys = new Set(), receiptKeys = new Map()
  const records = [1, 2, 3].map((id) => product(id, role === 'OWNER'))
  if (mode === 'dense' || mode === 'inventory-dense') { records[0].variants = (mode === 'inventory-dense' ? ['Black', 'White', 'Midnight blue with a long custom name', 'Burgundy'] : ['Black', 'White']).flatMap((color, c) => ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'].map((size, i) => ({ ...records[0].variants[0], id: `dense-${c}-${i}`, color, size, currentStock: 1 }))) }
  if (mode === 'inventory-dense') { records[0].name = 'Essential cotton T-shirt with a longer seasonal product name'; records[0].category = {...category, name: 'T-shirts and longer category names'} }
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
    if (url.pathname === '/api/inventory/receipts' && method === 'POST') {
      const key=route.request().headers()['idempotency-key']
      if(mode==='inventory-receipt-auth')return reply({error:{code:'SESSION_REQUIRED'}},401)
      if(mode==='inventory-receipt-product-not-found')return reply({error:{code:'PRODUCT_NOT_FOUND'}},404)
      if(mode==='inventory-receipt-variant-not-found')return reply({error:{code:'VARIANT_NOT_FOUND'}},404)
      if(mode==='inventory-receipt-conflict')return reply({error:{code:'RECEIPT_IDEMPOTENCY_CONFLICT'}},409)
      if(receiptKeys.has(key))return reply({...receiptKeys.get(key),idempotentReplay:true})
      const target=records.find(p=>p.id===body.productId)
      for(const item of body.items){const variant=target.variants.find(v=>v.id===item.variantId);variant.currentStock+=item.quantity;variant.lastPurchaseCost=body.unitCost}
      const totalQuantity=body.items.reduce((sum,item)=>sum+item.quantity,0)
      const result={productId:target.id,idempotentReplay:false,receipt:{id:'receipt-fixture',totalQuantity,totalCost:minorUnitsToDecimal(decimalToMinorUnits(body.unitCost,4)*BigInt(totalQuantity),4)}}
      receiptKeys.set(key,result)
      if(mode==='receipt-uncertain'||mode==='inventory-receipt-uncertain')return route.abort()
      return reply(result,201)
    }
    if (url.pathname.startsWith('/api/inventory/receipts/by-operation/') && method === 'GET') {
      const key=decodeURIComponent(url.pathname.split('/').at(-1))
      if(mode==='inventory-receipt-conflict')return reply({error:{code:'RECEIPT_NOT_FOUND'}},404)
      const result=receiptKeys.get(key)
      return result?reply({...result,idempotentReplay:true}):reply({error:{code:'RECEIPT_NOT_FOUND'}},404)
    }
    if (url.pathname === '/api/inventory/movements') return reply({movements:mode === 'audit-history' ? [
      {id:'movement-in',type:'RESTOCK',quantityChange:3,createdAt:'2026-10-01T10:00:00Z',product:{name:records[0].name},variant:records[0].variants[0],performer:{name:'Store Owner'},...(role==='OWNER'?{unitCost:'1.2345',note:'Purchased delivery'}:{})},
      {id:'movement-out',type:'SALE',quantityChange:-1,createdAt:'2026-10-01T11:00:00Z',product:{name:records[0].name},variant:records[0].variants[0],performer:{name:'Warehouse Team',employeeCode:'W01'}}
    ]:[],nextCursor:null})
    if (url.pathname === '/api/inventory/reconciliation') return reply({ variants: [], nextCursor: null })
    if (url.pathname === '/api/reports/daily') return reply({report:{reportDate:url.searchParams.get('date'),currency:'USD',salesCount:1,totalUnitsSold:2,grossRevenue:'50.00',returnedRevenue:'0.00',voidedRevenue:'0.00',netRevenue:'50.00',operatingExpenses:'3.00',costStatus:'INCOMPLETE',grossCOGS:null,returnedCOGS:null,voidedCOGS:null,netCOGS:null,grossProfit:null,netProfit:null,stockValue:null}})
    if (url.pathname === '/api/inventory/receipts' && method === 'GET') return reply({receipts:mode==='audit-history'?[{id:'55555555-5555-4555-8555-555555555555',productId:records[0].id,productName:records[0].name,createdAt:'2026-10-01T10:00:00Z',actor:'Store Owner',totalQuantity:3,...(role==='OWNER'?{totalCost:'3.7035'}:{}),items:[{variantId:records[0].variants[0].id,color:'Navy',size:'S',quantity:3,...(role==='OWNER'?{unitCost:'1.2345'}:{})}]}]:[],hasMore:false,page:1})
    if (url.pathname === '/api/inventory/product-setups' && method === 'POST') {
      const key=route.request().headers()['idempotency-key']
      if(mode==='inventory-save-rejected')return reply({error:{code:'INVALID_RECEIVING_SETUP'}},422)
      if(receiptKeys.has(key))return reply({...receiptKeys.get(key),idempotentReplay:true})
      const added={...product(4,role==='OWNER'),name:body.product.name,variants:body.variants.map((option,i)=>({...product(1,role==='OWNER').variants[0],...option,id:'setup-'+i,currentStock:0,lastPurchaseCost:null}))};records.push(added)
      let receipt=null
      if(body.receipt){for(const item of body.receipt.items){const variant=added.variants.find(v=>v.sku===item.sku);variant.currentStock+=item.quantity;variant.lastPurchaseCost=body.receipt.unitCost}const totalQuantity=body.receipt.items.reduce((sum,item)=>sum+item.quantity,0);receipt={id:'setup-receipt-fixture',totalQuantity,totalCost:minorUnitsToDecimal(decimalToMinorUnits(body.receipt.unitCost,4)*BigInt(totalQuantity),4)}}
      const result={productId:added.id,receipt,idempotentReplay:false};receiptKeys.set(key,result)
      if(mode==='inventory-save-uncertain')return route.abort()
      return reply(result,201)
    }
    if (url.pathname === '/api/categories') return reply({ categories: [category] })
    if (url.pathname === '/api/inventory/movements') return reply({ movements: [], nextCursor: null })
    if (url.pathname === '/api/inventory/reconciliation') return reply({ variants: [], nextCursor: null })
    if (url.pathname === '/api/products' && method === 'GET') return reply({ products: mode === 'empty' || url.searchParams.get('search') === 'missing' ? [] : url.searchParams.get('view') === 'summary' ? records.map(item => {const summary=summarizeProductCatalog(item,'USD'); const prices=item.variants.filter(v=>item.isActive&&v.isActive&&v.sellingPrice!==null).map(v=>v.sellingPrice).sort((a,b)=>Number(a)-Number(b));return {id:item.id,name:item.name,category:item.category,isActive:item.isActive,imageUrl:item.imageUrl,...(item.imageStatus ? {imageStatus:item.imageStatus} : {}),catalogSummary:{availableStock:summary.stock,inactiveStock:summary.inactiveStock,activeVariantCount:item.variants.filter(v=>item.isActive&&v.isActive).length,inactiveVariantCount:item.variants.filter(v=>!item.isActive||!v.isActive).length,priceMin:prices[0]??null,priceMax:prices.at(-1)??null}}}) : records, total: mode === 'empty' || url.searchParams.get('search') === 'missing' ? 0 : 25, page: Number(url.searchParams.get('page') || 1), limit: 12 })
    if (url.pathname === '/api/products/setup' && method === 'POST') { const added = { ...product(4, role === 'OWNER'), name: body.product.name, variants: body.variants.map((option,i) => ({ ...product(1, role === 'OWNER').variants[0], ...option, id:`setup-${i}`, currentStock: option.openingStock ? 1 : 0, ...(role === 'OWNER' ? { lastPurchaseCost: null } : {}) })) }; records.push(added); return reply({ product: added }, 201) }
    if (url.pathname === '/api/products' && method === 'POST') { const added = { ...product(4, role === 'OWNER'), name: body.name, variants: [] }; records.push(added); return reply({ product: added }, 201) }
    const record = records.find((item) => url.pathname.includes(item.id))
    if (!record) return reply({ error: { code: 'PRODUCT_NOT_FOUND' } }, 404)
    if (url.pathname.endsWith('/variant-prices')) { for (const variant of record.variants) if (body.variantIds.includes(variant.id)) variant.sellingPrice=body.sellingPrice; return reply({product:record}) }
    if (url.pathname.endsWith('/stock-adjustment') && method === 'POST') { const variant = record.variants.find(item => url.pathname.includes(item.id)); const key = route.request().headers()['idempotency-key']; const first = !stockKeys.has(key); if (first) { variant.currentStock += route.request().postDataJSON().delta ?? 1; stockKeys.add(key) } if (mode === 'quick-slow') await new Promise(resolve=>setTimeout(resolve,600)); if ((mode === 'quick-all-uncertain' && first) || (mode === 'quick-uncertain' && first && stockKeys.size === 1)) return route.abort(); return reply({ variant }) }
    if (url.pathname.endsWith('/opening-cost') && method === 'PUT') { const variant = record.variants.find(item => url.pathname.includes(item.id)); variant.lastPurchaseCost = body.unitCost; return reply({ variant }) }
    if (url.pathname.endsWith('/image')) {
      if(method==='POST' && mode==='image-upload-failure' && calls.filter(c=>c.method==='POST'&&c.path.endsWith('/image')).length===1)return reply({error:{code:'PRODUCT_IMAGE_UPLOAD_FAILED'}},503)
      if (method === 'DELETE') { record.imageUrl = null; record.imageStatus = 'none'; if (mode === 'image-cleanup-failure') return reply({error:{code:'PRODUCT_IMAGE_DELETE_FAILED'}},502); return route.fulfill({ status: 204 }) }
      record.imageUrl = picture; return reply({ product: record })
    }
    if (url.pathname.endsWith('/variants') && method === 'POST') { const variant = { ...product(1, role === 'OWNER').variants[0], ...body, id: `variant-${record.variants.length}`, currentStock: body.openingStock ? 1 : 0, lastPurchaseCost: null }; record.variants.push(variant); return reply({ variant }, 201) }
    if (url.pathname.includes('/variants/') && method === 'PATCH') { const variant = record.variants.find((item) => url.pathname.endsWith(item.id)); Object.assign(variant, body); return reply({ variant }) }
    if (method === 'PATCH') Object.assign(record, body)
    return reply({ product: record })
  })
  await page.goto(`${origin}/qa?role=${role}${mode === 'inventory-deep-link' ? '&page=inventory' : mode==='incomplete-report'?'&page=reports':''}${mode==='inventory-deep-link'?`&productId=${records[0].id}`:''}`)
  await page.getByRole('heading', { name: mode === 'inventory-deep-link' ? 'Restock' : mode==='incomplete-report'?'Financial reports': mode === 'empty' ? 'No products yet' : 'Products', exact: true }).waitFor()
  if (mode !== 'empty' && mode !== 'inventory-deep-link' && mode !== 'incomplete-report') await page.getByRole('button', { name: /^View product:/ }).first().waitFor()
  return { page, calls, errors }
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page has horizontal overflow')
  const overflowing = await page.locator('.products-page input:not([type=file]), .products-page select, .product-card').evaluateAll((nodes) => nodes.filter((node) => {
    if (node.closest('.receipt-matrix')) return false // contained table scrolling is not page overflow
    const rect = node.getBoundingClientRect(); return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
  }).map((node) => node.className || node.id))
  assert.deepEqual(overflowing, [], 'Visible controls overflow')
}

export { open, noOverflow, catId, screenshots, product, origin }
