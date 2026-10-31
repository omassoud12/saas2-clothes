// How a sale was paid, and what the till sends for it. The server stores the method, the customer of a debt and the discount.

export const PAYMENT_METHODS = Object.freeze([
  Object.freeze({ id: 'CASH', label: 'Cash' }),
  Object.freeze({ id: 'CARD', label: 'Card' }),
  Object.freeze({ id: 'WHISH_OMT', label: 'Whish / OMT' }),
  Object.freeze({ id: 'DEBT', label: 'Debt' }),
])

export const DEFAULT_PAYMENT = Object.freeze({ method: 'CASH', customerName: '', customerPhone: '' })

const identity = (text) => text

export function paymentLabel(method, t = identity) {
  const found = PAYMENT_METHODS.find((item) => item.id === method)
  return t(found ? found.label : 'Cash')
}

export function isDebt(method) { return method === 'DEBT' }

const MAX_NAME = 120
const MAX_PHONE = 30
const phonePattern = /^[+()\d][\d\s().-]*$/

// A debt needs the customer's name; a phone number is optional but must look like one.
export function validatePayment({ method = 'CASH', customerName = '', customerPhone = '' } = {}) {
  if (!PAYMENT_METHODS.some((item) => item.id === method)) return Object.freeze({ ok: false, field: 'method', message: 'Choose how the customer is paying.' })
  if (method !== 'DEBT') return Object.freeze({ ok: true })
  const name = customerName.trim()
  if (!name) return Object.freeze({ ok: false, field: 'customerName', message: 'Enter the customer name for a debt.' })
  if ([...name].length > MAX_NAME) return Object.freeze({ ok: false, field: 'customerName', message: 'The customer name is too long.' })
  const phone = customerPhone.trim()
  if (phone && ([...phone].length > MAX_PHONE || !phonePattern.test(phone))) {
    return Object.freeze({ ok: false, field: 'customerPhone', message: 'Enter a valid phone number, or leave it empty.' })
  }
  return Object.freeze({ ok: true })
}

// Fields added to the sale request. A plain cash sale adds nothing, so its request is the same as before.
export function paymentExtras({ method = 'CASH', customerName = '', customerPhone = '', discountPercent = 0 } = {}) {
  const extras = {}
  if (method !== 'CASH') extras.paymentMethod = method
  if (method === 'DEBT') extras.customer = { name: customerName.trim(), ...(customerPhone.trim() ? { phone: customerPhone.trim() } : {}) }
  if (Number.isFinite(discountPercent) && discountPercent > 0) extras.discountPercent = discountPercent.toFixed(2)
  return Object.freeze(extras)
}

// The payment state the screen needs back from a saved (pending) checkout payload.
export function paymentFromPayload(payload) {
  return Object.freeze({
    method: payload?.paymentMethod ?? 'CASH',
    customerName: payload?.customer?.name ?? '',
    customerPhone: payload?.customer?.phone ?? '',
  })
}
