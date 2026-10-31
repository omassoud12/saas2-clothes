import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import ar from './ar.js'
import { DEFAULT_LANGUAGE, LANGUAGES, languageInfo, readStoredLanguage, storeLanguage, translate } from './translate.js'
import { buildReceipt, buildReceiptText } from '../features/sales/pos-receipt.js'
import { plural, stockBadge } from '../features/sales/mock-sales-model.js'

const srcDir = fileURLToPath(new URL('../', import.meta.url))
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',')

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.jsx$/.test(name) && !/\.test\./.test(name)) out.push(path)
  }
  return out
}

describe('languages', () => {
  test('Arabic is the default and is right-to-left; English is left-to-right', () => {
    assert.equal(DEFAULT_LANGUAGE, 'ar')
    assert.equal(languageInfo('ar').dir, 'rtl'); assert.equal(languageInfo('en').dir, 'ltr')
    assert.equal(languageInfo('xx').id, 'ar', 'an unknown language falls back to the default')
    assert.deepEqual(LANGUAGES.map((language) => language.id), ['ar', 'en'])
  })

  test('Arabic dates and times keep Western digits so numbers stay readable', () => {
    const text = new Intl.DateTimeFormat(languageInfo('ar').locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(2026, 9, 14, 9, 5))
    assert.match(text, /\d/u); assert.doesNotMatch(text, /[٠-٩]/u)
  })

  test('the choice is remembered and a bad stored value is ignored', () => {
    const data = new Map()
    const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
    assert.equal(readStoredLanguage(storage), 'ar')
    assert.equal(storeLanguage(storage, 'en'), true); assert.equal(readStoredLanguage(storage), 'en')
    data.set('saas2.language', 'fr'); assert.equal(readStoredLanguage(storage), 'ar')
    assert.equal(readStoredLanguage(null), 'ar')
  })
})

describe('translate', () => {
  test('looks the text up in Arabic and fills in the values', () => {
    assert.equal(translate('ar', 'Sales history'), 'سجل المبيعات')
    assert.equal(translate('ar', 'Sold by {name}', { name: 'Rana' }), 'باعها Rana')
    assert.equal(translate('en', 'Sold by {name}', { name: 'Rana' }), 'Sold by Rana')
  })

  test('a missing translation shows the English text, and values that are not text pass through', () => {
    assert.equal(translate('ar', 'A sentence nobody translated {x}', { x: 1 }), 'A sentence nobody translated 1')
    assert.equal(translate('ar', undefined), undefined); assert.equal(translate('ar', 42), 42)
    assert.equal(translate('ar', 'Sold by {name}'), 'باعها {name}', 'a placeholder without a value is left as written')
  })

  test('every Arabic text keeps the same {values} as its English key', () => {
    const problems = Object.entries(ar).filter(([key, value]) => placeholders(key) !== placeholders(value)).map(([key]) => key)
    assert.deepEqual(problems, [])
  })

  test('every Arabic entry has text', () => {
    assert.deepEqual(Object.entries(ar).filter(([, value]) => typeof value !== 'string' || !value.trim()).map(([key]) => key), [])
  })

  test('every text the screens wrap in t(\'…\') has an Arabic translation', () => {
    const missing = new Set()
    // demo content of the landing page preview and sample codes are intentionally shown as written
    const intentionallyEnglish = /^(\d|[A-Z]{2,}-|Rose \/|Sage \/|Stone \/|SaaS2 —|[A-Z0-9-]+$)/u
    for (const file of sourceFiles(srcDir)) {
      const code = readFileSync(file, 'utf8')
      for (const match of code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
        const key = match[1].replace(/\\(['\\])/g, '$1')
        if (!(key in ar) && !intentionallyEnglish.test(key)) missing.add(key)
      }
    }
    assert.deepEqual([...missing].sort(), [])
  })
})

describe('screens in Arabic', () => {
  test('counts and stock badges are phrased in Arabic', () => {
    const t = (text, params) => translate('ar', text, params)
    assert.equal(plural(3, 'item', t), '3 قطع'); assert.equal(plural(1, 'item', t), '1 قطعة'); assert.equal(plural(2, 'color', t), '2 ألوان')
    assert.equal(stockBadge(3, t).text, 'قليل · باقي 3'); assert.equal(stockBadge(12, t).text, '12 بالمخزون'); assert.equal(stockBadge(0, t).text, 'نفد المخزون')
    assert.equal(plural(3, 'item'), '3 items', 'English is unchanged without a translate function')
  })

  test('a receipt and its WhatsApp text follow the chosen language', () => {
    const t = (text, params) => translate('ar', text, params)
    const sale = {
      id: 'a1b2c3d4-0000-4000-8000-000000000000', status: 'COMPLETED', currency: 'USD', subtotal: '90.00', totalAmount: '81.00', createdAt: '2026-10-14T09:05:00.000Z',
      items: [{ id: 'i1', productName: 'Linen shirt', color: 'Blue', size: 'M', quantity: 3, unitSoldPrice: '27.00', lineTotal: '81.00' }],
      commercial: { receiptNumber: 12, paymentMethod: 'DEBT', customer: { name: 'Rana', phone: null }, discountAmount: '9.00', discountPercent: '10.00', lbpRateAtSale: '89500.00', paidAt: null },
    }
    const receipt = buildReceipt({ sale, t, locale: languageInfo('ar').locale, timeZone: 'UTC' })
    assert.equal(receipt.paymentText, 'دين'); assert.equal(receipt.debt.text, 'غير مدفوع'); assert.equal(receipt.labels.total, 'المجموع')
    const text = buildReceiptText(receipt)
    for (const line of ['الإيصال #12', 'الدفع: دين', 'الزبون: Rana', 'المجموع: $81', 'المجموع (ل.ل.): 7,249,500 LBP', 'شكراً إلك!']) assert.ok(text.includes(line), line)
    assert.doesNotMatch(text, /[٠-٩]/u, 'numbers stay in Western digits')
  })
})
