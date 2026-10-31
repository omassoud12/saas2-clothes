import { decimalToMinorUnits, formatMoneyCompact, minorUnitsToDecimal } from '../../lib/money.js'
import { receiptNumber } from './pos-checkout.js'

// The receipt shown after a sale, its plain-text version for sharing, and the WhatsApp/share handoff.
// Amounts use the compact format from lib/money.js. The Sale API stores neither discount nor payment method,
// so the discount comes from the cart that was checked out (summary), and no payment line is shown.

const WHATSAPP_MAX_ITEMS = 40

function formatReceiptDate(iso, locale, timeZone) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(date)
}

export function buildReceipt({ sale, summary = null, storeName = '', locale, timeZone }) {
  const currency = sale.currency
  const money = minor => formatMoneyCompact(minorUnitsToDecimal(minor), currency)
  const totalMinor = decimalToMinorUnits(sale.totalAmount) ?? 0n
  const listMinor = summary ? BigInt(summary.listSubtotalCents) : (decimalToMinorUnits(sale.subtotal) ?? totalMinor)
  const discountMinor = listMinor > totalMinor ? listMinor - totalMinor : 0n
  return Object.freeze({
    storeName: String(storeName || '').trim(),
    number: receiptNumber(sale.id),
    isoDate: sale.createdAt,
    dateText: formatReceiptDate(sale.createdAt, locale, timeZone),
    currency,
    lines: Object.freeze(sale.items.map(item => Object.freeze({
      id: item.id,
      name: item.productName,
      detail: [item.color, item.size].filter(Boolean).join(' · '),
      quantity: item.quantity,
      unitPrice: formatMoneyCompact(item.unitSoldPrice, currency),
      lineTotal: formatMoneyCompact(item.lineTotal, currency),
    }))),
    units: sale.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: money(listMinor),
    discount: discountMinor > 0n ? money(discountMinor) : null,
    discountPercent: discountMinor > 0n && summary ? summary.discountPercent : null,
    total: money(totalMinor),
  })
}

export function buildReceiptText(receipt, { maxItems = Infinity } = {}) {
  const shown = receipt.lines.slice(0, maxItems)
  const hidden = receipt.lines.length - shown.length
  return [
    ...(receipt.storeName ? [`*${receipt.storeName}*`] : []),
    `Receipt ${receipt.number}`,
    ...(receipt.dateText ? [receipt.dateText] : []),
    '',
    ...shown.flatMap(line => [`${line.name}${line.detail ? ` (${line.detail})` : ''}`, `  ${line.quantity} × ${line.unitPrice} = ${line.lineTotal}`]),
    ...(hidden > 0 ? [`…and ${hidden} more ${hidden === 1 ? 'item' : 'items'}`] : []),
    '',
    ...(receipt.discount ? [`Subtotal: ${receipt.subtotal}`, `Discount${receipt.discountPercent ? ` (${receipt.discountPercent}%)` : ''}: -${receipt.discount}`] : []),
    `*Total: ${receipt.total}*`,
    '',
    'Thank you!',
  ].join('\n')
}

export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

// Uses the phone's share sheet when there is one (WhatsApp is listed there); otherwise opens WhatsApp with the text.
export async function shareReceipt(receipt, { nav = globalThis.navigator, open = globalThis.window?.open?.bind(globalThis.window) } = {}) {
  if (typeof nav?.share === 'function') {
    try {
      await nav.share({ title: `Receipt ${receipt.number}`, text: buildReceiptText(receipt) })
      return Object.freeze({ ok: true, method: 'share' })
    } catch (error) {
      if (error?.name === 'AbortError') return Object.freeze({ ok: true, method: 'cancelled' })
    }
  }
  const opened = typeof open === 'function' ? open(whatsappUrl(buildReceiptText(receipt, { maxItems: WHATSAPP_MAX_ITEMS })), '_blank') : null
  if (!opened) return Object.freeze({ ok: false, method: 'blocked' })
  try { opened.opener = null } catch { /* a cross-origin window may refuse this */ }
  return Object.freeze({ ok: true, method: 'whatsapp' })
}
