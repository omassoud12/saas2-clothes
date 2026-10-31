import { decimalToMinorUnits, formatMoneyCompact, minorUnitsToDecimal } from '../../lib/money.js'
import { usdCentsToLbp } from '../../lib/currency.js'
import { plainTranslate } from '../../lib/interpolate.js'
import { receiptLabel } from './pos-checkout.js'
import { paymentLabel } from './payment.js'

// The receipt shown after a sale (and from the sales history), its plain-text version for sharing, and the WhatsApp/share
// handoff. Amounts use the compact format from lib/money.js. The sale carries its payment method, customer, discount and the
// USD->LBP rate in force when it was made; older sales have none of that and show only what they have.

const WHATSAPP_MAX_ITEMS = 40

function formatReceiptDate(iso, locale, timeZone) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(date)
}

function percentText(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? String(Number(number.toFixed(2))) : null
}

export function buildReceipt({ sale, summary = null, storeName = '', locale, timeZone, t = plainTranslate }) {
  const currency = sale.currency
  const commercial = sale.commercial ?? null
  const money = minor => formatMoneyCompact(minorUnitsToDecimal(minor), currency)
  const totalMinor = decimalToMinorUnits(sale.totalAmount) ?? 0n
  const listMinor = decimalToMinorUnits(sale.subtotal) ?? totalMinor
  const storedDiscount = commercial ? decimalToMinorUnits(commercial.discountAmount) : null
  // The server's own discount wins; a sale from the cart screen before it is stored falls back to the cart summary.
  const fallbackList = summary ? BigInt(summary.listSubtotalCents) : listMinor
  const discountMinor = storedDiscount !== null ? storedDiscount : (fallbackList > totalMinor ? fallbackList - totalMinor : 0n)
  const discountPercent = discountMinor > 0n ? (percentText(commercial?.discountPercent) ?? (summary && summary.discountPercent > 0 ? String(summary.discountPercent) : null)) : null
  const rate = currency === 'USD' ? commercial?.lbpRateAtSale ?? null : null
  const totalLbpValue = rate && totalMinor <= BigInt(Number.MAX_SAFE_INTEGER) ? usdCentsToLbp(Number(totalMinor), rate) : null
  const customer = commercial?.customer ?? null
  const isDebt = commercial?.paymentMethod === 'DEBT'
  const paidAt = commercial?.paidAt ?? null

  return Object.freeze({
    storeName: String(storeName || '').trim(),
    number: receiptLabel(sale),
    isoDate: sale.createdAt,
    dateText: formatReceiptDate(sale.createdAt, locale, timeZone),
    currency,
    paymentMethod: commercial?.paymentMethod ?? null,
    paymentText: commercial?.paymentMethod ? paymentLabel(commercial.paymentMethod, t) : null,
    customer: customer ? Object.freeze({ name: customer.name, phone: customer.phone ?? null }) : null,
    debt: isDebt ? Object.freeze({
      paid: Boolean(paidAt),
      text: paidAt ? t('Paid on {date}', { date: formatReceiptDate(paidAt, locale, timeZone) }) : t('Unpaid'),
    }) : null,
    lines: Object.freeze(sale.items.map(item => Object.freeze({
      id: item.id,
      name: item.productName,
      detail: [item.color, item.size].filter(Boolean).join(' · '),
      quantity: item.quantity,
      unitPrice: formatMoneyCompact(item.unitSoldPrice, currency),
      lineTotal: formatMoneyCompact(item.lineTotal, currency),
    }))),
    units: sale.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: money(discountMinor > 0n ? totalMinor + discountMinor : listMinor),
    discount: discountMinor > 0n ? money(discountMinor) : null,
    discountPercent,
    total: money(totalMinor),
    totalLbp: totalLbpValue === null ? null : formatMoneyCompact(String(totalLbpValue), 'LBP', 0),
    labels: Object.freeze({
      receipt: t('Receipt'),
      payment: t('Payment'),
      customer: t('Customer'),
      subtotal: t('Subtotal'),
      discount: t('Discount'),
      total: t('Total'),
      totalLbp: t('Total (LBP)'),
      debt: t('Debt'),
      thanks: t('Thank you!'),
      more: count => t(count === 1 ? '…and {count} more item' : '…and {count} more items', { count }),
    }),
  })
}

export function buildReceiptText(receipt, { maxItems = Infinity } = {}) {
  const { labels } = receipt
  const shown = receipt.lines.slice(0, maxItems)
  const hidden = receipt.lines.length - shown.length
  const discountSuffix = receipt.discountPercent ? ` (${receipt.discountPercent}%)` : ''
  return [
    ...(receipt.storeName ? [`*${receipt.storeName}*`] : []),
    `${labels.receipt} ${receipt.number}`,
    ...(receipt.dateText ? [receipt.dateText] : []),
    ...(receipt.paymentText ? [`${labels.payment}: ${receipt.paymentText}`] : []),
    ...(receipt.customer ? [`${labels.customer}: ${receipt.customer.name}${receipt.customer.phone ? ` · ${receipt.customer.phone}` : ''}`] : []),
    '',
    ...shown.flatMap(line => [`${line.name}${line.detail ? ` (${line.detail})` : ''}`, `  ${line.quantity} × ${line.unitPrice} = ${line.lineTotal}`]),
    ...(hidden > 0 ? [labels.more(hidden)] : []),
    '',
    ...(receipt.discount ? [`${labels.subtotal}: ${receipt.subtotal}`, `${labels.discount}${discountSuffix}: -${receipt.discount}`] : []),
    `*${labels.total}: ${receipt.total}*`,
    ...(receipt.totalLbp ? [`${labels.totalLbp}: ${receipt.totalLbp}`] : []),
    ...(receipt.debt ? [`${labels.debt}: ${receipt.debt.text}`] : []),
    '',
    labels.thanks,
  ].join('\n')
}

export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

// Uses the phone's share sheet when there is one (WhatsApp is listed there); otherwise opens WhatsApp with the text.
export async function shareReceipt(receipt, { nav = globalThis.navigator, open = globalThis.window?.open?.bind(globalThis.window) } = {}) {
  if (typeof nav?.share === 'function') {
    try {
      await nav.share({ title: `${receipt.labels.receipt} ${receipt.number}`, text: buildReceiptText(receipt) })
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
