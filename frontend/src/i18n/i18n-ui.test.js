import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let vite
let I18nProvider
let LanguageSwitch
let ReceiptView
let buildReceipt
let translate

before(async () => {
  vite = await createServer({ root, configFile: false, plugins: [react()], logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } })
  I18nProvider = (await vite.ssrLoadModule('/src/i18n/I18nProvider.jsx')).I18nProvider
  LanguageSwitch = (await vite.ssrLoadModule('/src/i18n/LanguageSwitch.jsx')).LanguageSwitch
  ReceiptView = (await vite.ssrLoadModule('/src/features/sales/SaleReceipt.jsx')).ReceiptView
  buildReceipt = (await vite.ssrLoadModule('/src/features/sales/pos-receipt.js')).buildReceipt
  translate = (await vite.ssrLoadModule('/src/i18n/translate.js')).translate
})

after(async () => { await vite?.close() })

describe('language switch and screens', () => {
  test('the switch names both languages and marks the chosen one', () => {
    const arabic = renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: 'ar' }, createElement(LanguageSwitch)))
    assert.match(arabic, /aria-pressed="true"[^>]*>العربية</u); assert.match(arabic, /aria-pressed="false"[^>]*>English</u)
    const english = renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: 'en' }, createElement(LanguageSwitch)))
    assert.match(english, /aria-pressed="true"[^>]*>English</u)
  })

  test('the receipt on screen is written in the chosen language', () => {
    const sale = {
      id: 'a1b2c3d4-0000-4000-8000-000000000000', status: 'COMPLETED', currency: 'USD', subtotal: '90.00', totalAmount: '81.00', createdAt: '2026-10-14T09:05:00.000Z',
      items: [{ id: 'i1', productName: 'Linen shirt', color: 'Blue', size: 'M', quantity: 3, unitSoldPrice: '27.00', lineTotal: '81.00' }],
      commercial: { receiptNumber: 12, paymentMethod: 'CARD', customer: null, discountAmount: '9.00', discountPercent: '10.00', lbpRateAtSale: '89500.00', paidAt: null },
    }
    const html = renderToStaticMarkup(createElement(ReceiptView, { receipt: buildReceipt({ sale, t: (text, params) => translate('ar', text, params), locale: 'ar-u-nu-latn', timeZone: 'UTC' }) }))
    for (const text of ['الإيصال #12', 'بطاقة', 'المجموع قبل الخصم', 'الخصم (10%)', 'المجموع (ل.ل.)', 'شكراً إلك!']) assert.ok(html.includes(text), text)
    assert.ok(html.includes('7,249,500 LBP'))
  })
})
