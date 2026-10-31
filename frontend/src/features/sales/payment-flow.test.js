import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildSalePayload, checkoutOperation, markSalePaid } from './sale-flow.js'
import { prepareCheckout, receiptLabel } from './pos-checkout.js'
import { DEFAULT_PAYMENT, paymentExtras, paymentFromPayload, paymentLabel, validatePayment } from './payment.js'
import { buildReceipt, buildReceiptText } from './pos-receipt.js'
import { historyQuery, saleBadges } from './history-flow.js'
import { loadSaleHistory } from './sale-flow.js'

const variant = '22222222-2222-4222-8222-222222222222'
const key = '33333333-3333-4333-8333-333333333333'
const saleId = 'a1b2c3d4-0000-4000-8000-000000000000'
const cart = [{ key: 'k', variantId: variant, productId: 'p', productName: 'Linen shirt', colorName: 'Blue', size: 'M', priceCents: 3000, quantity: 3, stock: 10 }]
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-test-token' } } } } } }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('payment choices', () => {
  test('labels and defaults', () => {
    assert.deepEqual(DEFAULT_PAYMENT, { method: 'CASH', customerName: '', customerPhone: '' })
    assert.deepEqual(['CASH', 'CARD', 'WHISH_OMT', 'DEBT'].map((id) => paymentLabel(id)), ['Cash', 'Card', 'Whish / OMT', 'Debt'])
    assert.equal(paymentLabel('CARD', (text) => `[${text}]`), '[Card]')
  })

  test('a debt needs the customer name; the phone is optional but must look like one', () => {
    assert.equal(validatePayment({ method: 'CASH' }).ok, true)
    assert.equal(validatePayment({ method: 'CARD', customerName: '' }).ok, true)
    assert.equal(validatePayment({ method: 'DEBT', customerName: '   ' }).field, 'customerName')
    assert.equal(validatePayment({ method: 'DEBT', customerName: 'Rana' }).ok, true)
    assert.equal(validatePayment({ method: 'DEBT', customerName: 'Rana', customerPhone: '+961 3 123 456' }).ok, true)
    assert.equal(validatePayment({ method: 'DEBT', customerName: 'Rana', customerPhone: 'call me' }).field, 'customerPhone')
    assert.equal(validatePayment({ method: 'DEBT', customerName: 'x'.repeat(121) }).ok, false)
    assert.equal(validatePayment({ method: 'PAYPAL' }).ok, false)
  })

  test('only what is not the default is sent', () => {
    assert.deepEqual(paymentExtras({}), {})
    assert.deepEqual(paymentExtras({ method: 'CASH', customerName: 'ignored', discountPercent: 0 }), {})
    assert.deepEqual(paymentExtras({ method: 'CARD' }), { paymentMethod: 'CARD' })
    assert.deepEqual(paymentExtras({ method: 'DEBT', customerName: ' Rana ', customerPhone: ' 03 123 ', discountPercent: 10 }),
      { paymentMethod: 'DEBT', customer: { name: 'Rana', phone: '03 123' }, discountPercent: '10.00' })
    assert.deepEqual(paymentExtras({ method: 'DEBT', customerName: 'Rana' }).customer, { name: 'Rana' })
  })

  test('a saved checkout gives its payment back', () => {
    assert.deepEqual(paymentFromPayload({ items: [], paymentMethod: 'DEBT', customer: { name: 'Rana', phone: '03' } }), { method: 'DEBT', customerName: 'Rana', customerPhone: '03' })
    assert.deepEqual(paymentFromPayload({ items: [] }), DEFAULT_PAYMENT)
  })
})

describe('sale request with payment', () => {
  test('a plain cash sale is exactly the request it was before', () => {
    assert.deepEqual(buildSalePayload(cart.map((line) => ({ ...line, unitSoldPrice: '30.00' }))).payload, { items: [{ variantId: variant, quantity: 3, unitSoldPrice: '30.00' }] })
    const prepared = prepareCheckout({ cart, role: 'OWNER', discountPercent: 0, uuidFactory: () => key })
    assert.deepEqual(Object.keys(prepared.operation.payload), ['items'])
  })

  test('payment, customer and discount travel with the items and change the signature', () => {
    const cash = prepareCheckout({ cart, role: 'OWNER', discountPercent: 10, uuidFactory: () => key })
    assert.equal(cash.operation.payload.discountPercent, '10.00')
    const debt = prepareCheckout({ cart, role: 'OWNER', discountPercent: 10, payment: { method: 'DEBT', customerName: 'Rana', customerPhone: '' }, current: cash.operation, uuidFactory: () => '44444444-4444-4444-8444-444444444444' })
    assert.deepEqual(debt.operation.payload.customer, { name: 'Rana' })
    assert.equal(debt.operation.payload.paymentMethod, 'DEBT')
    assert.notEqual(debt.operation.key, cash.operation.key, 'a different sale gets a new Idempotency-Key')
    const same = prepareCheckout({ cart, role: 'OWNER', discountPercent: 10, payment: { method: 'DEBT', customerName: 'Rana', customerPhone: '' }, current: debt.operation, uuidFactory: () => key })
    assert.equal(same.operation.key, debt.operation.key, 'an unchanged retry keeps its key')
    assert.equal(debt.summary.paymentMethod, 'DEBT')
  })

  test('a debt without a customer is refused before anything is sent', () => {
    const result = prepareCheckout({ cart, role: 'OWNER', discountPercent: 0, payment: { method: 'DEBT', customerName: '', customerPhone: '' }, uuidFactory: () => key })
    assert.equal(result.ok, false); assert.equal(result.code, 'POS_PAYMENT_INVALID')
    assert.equal(checkoutOperation(cart.map((line) => ({ ...line, unitSoldPrice: '30.00' })), null, () => key, { paymentMethod: 'DEBT' }).code, 'INVALID_SALE_CUSTOMER')
  })

  test('a warehouse user never sends a discount', () => {
    const result = prepareCheckout({ cart, role: 'WAREHOUSE', discountPercent: 20, uuidFactory: () => key })
    assert.equal('discountPercent' in result.operation.payload, false)
  })
})

describe('receipt with the stored sale details', () => {
  const sale = (commercial) => ({
    id: saleId, status: 'COMPLETED', currency: 'USD', subtotal: '90.00', totalAmount: '81.00', createdAt: '2026-10-14T09:05:00.000Z',
    items: [{ id: 'i1', productName: 'Linen shirt', color: 'Blue', size: 'M', quantity: 3, unitSoldPrice: '27.00', lineTotal: '81.00' }],
    commercial,
  })
  const base = { receiptNumber: 12, paymentMethod: 'CASH', customer: null, discountAmount: '9.00', discountPercent: '10.00', lbpRateAtSale: '89500.00', paidAt: null }

  test('shows the receipt number, payment, discount and the total in pounds', () => {
    const receipt = buildReceipt({ sale: sale(base), locale: 'en-GB', timeZone: 'UTC' })
    assert.equal(receipt.number, '#12'); assert.equal(receipt.paymentText, 'Cash')
    assert.equal(receipt.subtotal, '$90'); assert.equal(receipt.discount, '$9'); assert.equal(receipt.discountPercent, '10'); assert.equal(receipt.total, '$81')
    assert.equal(receipt.totalLbp, '7,249,500 LBP')
    const text = buildReceiptText(receipt)
    for (const line of ['Receipt #12', 'Payment: Cash', 'Subtotal: $90', 'Discount (10%): -$9', '*Total: $81*', 'Total (LBP): 7,249,500 LBP']) assert.ok(text.includes(line), line)
    assert.equal(text.includes('Customer'), false)
  })

  test('a debt shows the customer and whether it is paid', () => {
    const open = buildReceipt({ sale: sale({ ...base, paymentMethod: 'DEBT', customer: { name: 'Rana', phone: '03 123' }, discountAmount: '0.00', discountPercent: null }), locale: 'en-GB', timeZone: 'UTC' })
    assert.deepEqual(open.customer, { name: 'Rana', phone: '03 123' }); assert.equal(open.debt.paid, false); assert.equal(open.debt.text, 'Unpaid')
    const text = buildReceiptText(open)
    assert.ok(text.includes('Customer: Rana · 03 123')); assert.ok(text.includes('Payment: Debt')); assert.ok(text.includes('Debt: Unpaid'))
    const paid = buildReceipt({ sale: sale({ ...base, paymentMethod: 'DEBT', customer: { name: 'Rana', phone: null }, paidAt: '2026-10-20T10:00:00.000Z' }), locale: 'en-GB', timeZone: 'UTC' })
    assert.equal(paid.debt.paid, true); assert.match(paid.debt.text, /^Paid on /u)
  })

  test('an older sale keeps its short id and shows no payment, no pounds and no discount', () => {
    const old = buildReceipt({ sale: { ...sale(null), subtotal: '81.00' }, locale: 'en-GB', timeZone: 'UTC' })
    assert.equal(old.number, '#A1B2C3D4'); assert.equal(old.paymentText, null); assert.equal(old.totalLbp, null); assert.equal(old.discount, null)
    assert.equal(receiptLabel({ id: saleId }), '#A1B2C3D4'); assert.equal(receiptLabel({ id: saleId, receiptNumber: 5 }), '#5'); assert.equal(receiptLabel({ id: saleId, commercial: { receiptNumber: 7 } }), '#7')
    assert.equal(receiptLabel({ id: saleId, receiptNumber: null }), '#A1B2C3D4')
  })

  test('no rate at the time of the sale means no pounds, and a non-USD sale never shows pounds', () => {
    assert.equal(buildReceipt({ sale: sale({ ...base, lbpRateAtSale: null }) }).totalLbp, null)
    assert.equal(buildReceipt({ sale: { ...sale(base), currency: 'EUR' } }).totalLbp, null)
  })

  test('labels come from the translate function', () => {
    const receipt = buildReceipt({ sale: sale(base), t: (text, params) => `«${text}»${params ? JSON.stringify(params) : ''}` })
    assert.equal(receipt.labels.total, '«Total»'); assert.equal(receipt.labels.more(2), '«…and {count} more items»{"count":2}')
    assert.equal(receipt.paymentText, '«Cash»')
  })
})

describe('marking a debt as paid', () => {
  test('posts { confirm: true } and returns the settlement', async () => {
    let call
    const result = await markSalePaid({ supabase, saleId, fetchImpl: async (input, init) => { call = { url: String(input), init }; return json(201, { sale: { id: saleId, paidAt: '2026-10-20T10:00:00.000Z', paidBy: { name: 'Ada', employeeCode: null } }, idempotentReplay: false }) } })
    assert.equal(result.ok, true); assert.equal(result.paidBy.name, 'Ada'); assert.equal(result.idempotentReplay, false)
    assert.match(call.url, new RegExp(`/api/sales/${saleId}/pay$`, 'u')); assert.equal(call.init.method, 'POST'); assert.deepEqual(JSON.parse(call.init.body), { confirm: true })
  })

  test('explains the failures a person can act on', async () => {
    const fail = (status, code) => markSalePaid({ supabase, saleId, fetchImpl: async () => json(status, { error: { code, message: 'private detail' } }) })
    assert.match((await fail(409, 'SALE_NOT_DEBT')).message, /Only a debt sale/u)
    assert.match((await fail(409, 'SALE_PAY_NOT_ALLOWED')).message, /voided/u)
    assert.match((await fail(403, 'ROLE_FORBIDDEN')).message, /Only an owner/u)
    assert.equal((await fail(401, 'SESSION_REQUIRED')).requiresLogin, true)
    const server = await fail(503, 'SALE_PAY_UNAVAILABLE'); assert.equal(server.retryable, true); assert.doesNotMatch(server.message, /private/u)
    assert.equal((await markSalePaid({ supabase, saleId, fetchImpl: async () => json(200, { sale: { id: saleId } }) })).code, 'INVALID_SALE_PAY_RESPONSE')
  })
})

describe('history filters for payment', () => {
  const now = new Date(2026, 9, 14, 15, 30)
  test('payment method and unpaid debts become server filters', () => {
    assert.equal(historyQuery({ range: 'today', payment: 'CARD', now }).query.paymentMethod, 'CARD')
    assert.equal('paymentMethod' in historyQuery({ range: 'today', now }).query, false)
    const unpaid = historyQuery({ range: 'today', status: 'unpaid', now }).query
    assert.equal(unpaid.unpaid, true); assert.equal('status' in unpaid, false); assert.equal('paymentMethod' in unpaid, false)
    assert.equal(historyQuery({ range: 'today', status: 'unpaid', payment: 'DEBT', now }).ok, true)
    assert.equal(historyQuery({ range: 'today', status: 'unpaid', payment: 'CASH', now }).ok, false)
    assert.equal(historyQuery({ range: 'today', payment: 'PAYPAL', now }).ok, false)
  })

  test('the request carries paymentMethod and unpaid, and refuses an unknown method', async () => {
    let url
    const fetchImpl = async (input) => { url = new URL(input, 'https://local.test'); return json(200, { sales: [], nextCursor: null }) }
    await loadSaleHistory({ supabase, limit: 25, paymentMethod: 'WHISH_OMT', fetchImpl })
    assert.equal(url.searchParams.get('paymentMethod'), 'WHISH_OMT')
    await loadSaleHistory({ supabase, limit: 25, unpaid: true, fetchImpl })
    assert.equal(url.searchParams.get('unpaid'), 'true')
    assert.equal((await loadSaleHistory({ supabase, paymentMethod: 'PAYPAL', fetchImpl })).code, 'INVALID_SALE_PAYMENT_METHOD')
  })

  test('row badges say how a sale was paid and whether a debt is still open', () => {
    assert.deepEqual(saleBadges({ status: 'COMPLETED', paymentMethod: 'CASH' }), [])
    assert.deepEqual(saleBadges({ status: 'COMPLETED', paymentMethod: 'DEBT', paidAt: null }).map((badge) => badge.text), ['Unpaid debt'])
    assert.deepEqual(saleBadges({ status: 'COMPLETED', paymentMethod: 'DEBT', paidAt: '2026-10-20T10:00:00.000Z' }).map((badge) => badge.text), ['Debt paid'])
    assert.deepEqual(saleBadges({ status: 'COMPLETED', paymentMethod: 'CARD' }).map((badge) => badge.text), ['Card'])
    assert.deepEqual(saleBadges({ status: 'VOIDED', paymentMethod: 'WHISH_OMT' }).map((badge) => badge.text), ['Voided', 'Whish / OMT'])
  })
})
