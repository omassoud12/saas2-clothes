// Mock backend that follows docs/API.md exactly, so switching VITE_USE_MOCK=false needs no UI change.
// Data is generated from the date (seeded), so the same day always shows the same numbers.
//
// ONE SOURCE OF TRUTH: every report (Daily, Weekly, Monthly, Yearly) is built from daySummary(),
// which is built from the same invoices. Closed days (holidays) have no invoices at all, so they are
// $0 everywhere, never $0 in one report and $2,013 in another.

const STORES = [
  { id: 'st_hamra', name: 'Hamra' },
  { id: 'st_jounieh', name: 'Jounieh' },
]
const STAFF = [
  { id: 'u_rami', name: 'Rami' },
  { id: 'u_lea', name: 'Lea' },
  { id: 'u_owner', name: 'Abu Ali' },
]
// Who works where: Rami in Hamra, Lea in Jounieh, the owner in both.
const STAFF_BY_STORE = { st_hamra: [STAFF[0], STAFF[0], STAFF[2]], st_jounieh: [STAFF[1], STAFF[1], STAFF[2]] }
const METHODS = ['CASH', 'CASH', 'CASH', 'WHISH', 'WHISH']
const RATE = '89500'

// Products have variants (colour + size). Reports group by product; tap shows the variants.
// The last three never sell, so they show up as dead stock.
const v = (id, color, size) => ({ id, color, size })
const CATALOG = [
  { id: 'p_linen', name: 'Linen shirt', category: 'Shirts', price: 35, unitCost: 22, weight: 5,
    variants: [v('v_linen_beige_m', 'Beige', 'M'), v('v_linen_beige_l', 'Beige', 'L'), v('v_linen_white_m', 'White', 'M'), v('v_linen_beige_s', 'Beige', 'S'), v('v_linen_white_xl', 'White', 'XL')] },
  { id: 'p_midi', name: 'Midi dress', category: 'Dresses', price: 45, unitCost: 28, weight: 4,
    variants: [v('v_midi_rose_s', 'Rose', 'S'), v('v_midi_rose_m', 'Rose', 'M'), v('v_midi_black_s', 'Black', 'S'), v('v_midi_black_l', 'Black', 'L')] },
  { id: 'p_jeans', name: 'Slim jeans', category: 'Jeans', price: 38, unitCost: 24, weight: 3,
    variants: [v('v_jeans_32', 'Blue', '32'), v('v_jeans_30', 'Blue', '30'), v('v_jeans_34', 'Blue', '34'), v('v_jeans_36', 'Blue', '36')] },
  { id: 'p_hoodie', name: 'Kids hoodie', category: 'Kids', price: 28, unitCost: 17, weight: 3,
    variants: [v('v_hood_6', 'Yellow', '6Y'), v('v_hood_4', 'Yellow', '4Y'), v('v_hood_8', 'Yellow', '8Y')] },
  { id: 'p_abaya', name: 'Classic abaya', category: 'Modest', price: 55, unitCost: 36, weight: 2,
    variants: [v('v_abaya_56', 'Black', '56'), v('v_abaya_54', 'Black', '54'), v('v_abaya_58', 'Black', '58'), v('v_abaya_52', 'Black', '52')] },
  { id: 'p_tee', name: 'Basic tee', category: 'Shirts', price: 12, unitCost: 7, weight: 4,
    variants: [v('v_tee_white_l', 'White', 'L'), v('v_tee_white_m', 'White', 'M'), v('v_tee_black_l', 'Black', 'L'), v('v_tee_black_s', 'Black', 'S')] },
  { id: 'p_tote', name: 'Leather tote', category: 'Accessories', price: 48, unitCost: 30, weight: 1,
    variants: [v('v_tote_tan', 'Tan', null), v('v_tote_black', 'Black', null)] },
  { id: 'p_coat', name: 'Wool coat', category: 'Outerwear', price: 95, unitCost: 60, weight: 0, variants: [v('v_coat_camel_l', 'Camel', 'L'), v('v_coat_camel_m', 'Camel', 'M')] },
  { id: 'p_blazer', name: 'Satin blazer', category: 'Outerwear', price: 65, unitCost: 40, weight: 0, variants: [v('v_blazer_black_m', 'Black', 'M')] },
  { id: 'p_scarf', name: 'Silk scarf', category: 'Accessories', price: 18, unitCost: 11, weight: 0, variants: [v('v_scarf_floral', 'Floral', null)] },
]
const WEIGHT_SUM = CATALOG.reduce((s, p) => s + p.weight, 0)
const VARIANTS = Object.fromEntries(CATALOG.flatMap((p) => p.variants.map((x) => [x.id, { ...x, product: p }])))
/** "Beige · Size M", "Black · Size 56", "Tan · One size" */
export const variantLabel = (x) => `${x.color} · ${x.size ? `Size ${x.size}` : 'One size'}`

// Shop closed on these days (MM-DD): no invoices, so $0 in every report.
const HOLIDAYS = ['01-01', '05-01', '08-15', '11-22', '12-25']
const isClosed = (date) => HOLIDAYS.includes(date.slice(5))

function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shift(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}
function shiftMonth(ym, k) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7)
}

const invoiceCache = new Map()
function invoicesFor(date) {
  if (invoiceCache.has(date)) return invoiceCache.get(date)
  const out = []
  if (!isClosed(date)) {
    const rnd = seeded(date)
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    const base = weekday === 6 ? 30 : weekday === 0 ? 12 : 20
    const count = base + Math.floor(rnd() * 10)
    for (let i = 0; i < count; i += 1) {
      const hour = 10 + Math.floor(rnd() * 11)
      const minute = Math.floor(rnd() * 60)
      const items = 1 + Math.floor(rnd() * 3)
      const method = METHODS[Math.floor(rnd() * METHODS.length)]
      const store = STORES[Math.floor(rnd() * STORES.length)]
      const staff = STAFF_BY_STORE[store.id][Math.floor(rnd() * 3)]
      const voided = rnd() < 0.04
      const lines = Array.from({ length: items }, () => {
        let r = rnd() * WEIGHT_SUM
        let k = 0
        while (r > CATALOG[k].weight) { r -= CATALOG[k].weight; k += 1; }
        const p = CATALOG[k]
        const variant = p.variants[Math.floor(rnd() ** 1.7 * p.variants.length)]
        return { variantId: variant.id, price: Math.round(p.price * (0.9 + rnd() * 0.2)), cost: p.unitCost }
      })
      const total = lines.reduce((s, l) => s + l.price, 0)
      const discount = rnd() < 0.15 ? Math.round(total * 0.08) : 0
      const returned = rnd() < 0.03 ? lines[0].price : 0
      const createdAt = new Date(Date.UTC(...date.split('-').map((x, k) => (k === 1 ? Number(x) - 1 : Number(x))), hour - 2, minute)).toISOString()
      out.push({
        id: `inv_${date}_${i}`,
        number: 0,
        createdAt,
        itemCount: items,
        total: total.toFixed(2),
        cost: lines.reduce((s, l) => s + l.cost, 0).toFixed(2),
        paymentMethod: method,
        status: voided ? 'VOIDED' : 'COMPLETED',
        staff,
        store,
        customerName: null,
        lines,
        discount: discount.toFixed(2),
        returned: returned.toFixed(2),
        minute: hour * 60 + minute,
      })
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    out.forEach((inv, k) => { inv.number = 2000 + Number(date.replaceAll('-', '').slice(-3)) * 10 + (out.length - k); })
  }
  invoiceCache.set(date, out)
  return out
}

function beirutNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((o, x) => ({ ...o, [x.type]: x.value }), {})
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute), hhmm: `${parts.hour}:${parts.minute}` }
}
const todayBeirut = () => beirutNow().date

/** Invoices of a day that exist so far: all for past days, up to now for today, up to `untilMinute` if given. */
function visibleInvoices(date, untilMinute = null) {
  const now = beirutNow()
  let cut = untilMinute
  if (date === now.date) cut = cut === null ? now.minute : Math.min(cut, now.minute)
  if (date > now.date) return []
  return invoicesFor(date).filter((i) => cut === null || i.minute <= cut)
}

const inStoreOf = (storeId) => (i) => storeId === 'all' || !storeId || i.store.id === storeId

function aggregate(list) {
  const out = emptyAgg()
  list.forEach((inv) => {
    if (Number(inv.returned) > 0) { out.returnsCount += 1; out.returnsAmount += Number(inv.returned); }
    if (inv.status !== 'COMPLETED') return // voided invoices never count
    const total = Number(inv.total)
    const net = total - Number(inv.returned) // sales are net of returns
    const k = net / total
    const c = Number(inv.cost) * k
    out.sales += net; out.cost += c; out.count += 1; out.pieces += inv.itemCount; out.discounts += Number(inv.discount)
    const st = out.staff[inv.staff.id] || (out.staff[inv.staff.id] = { id: inv.staff.id, name: inv.staff.name, sales: 0, cost: 0, count: 0, stores: {} })
    st.sales += net; st.cost += c; st.count += 1; st.stores[inv.store.id] = inv.store.name
    const m = out.methods[inv.paymentMethod] || (out.methods[inv.paymentMethod] = { sales: 0, count: 0 })
    m.sales += net; m.count += 1
    const h = Math.floor(inv.minute / 60)
    out.hours[h] = (out.hours[h] || 0) + net
    inv.lines.forEach((l) => {
      const p = out.products[l.variantId] || (out.products[l.variantId] = { quantity: 0, sales: 0, cost: 0 })
      p.quantity += 1; p.sales += l.price * k; p.cost += l.cost * k
    })
  })
  return out
}
function emptyAgg() {
  return { sales: 0, cost: 0, count: 0, pieces: 0, discounts: 0, returnsCount: 0, returnsAmount: 0, staff: {}, methods: {}, hours: {}, products: {} }
}
function mergeInto(acc, a) {
  ['sales', 'cost', 'count', 'pieces', 'discounts', 'returnsCount', 'returnsAmount'].forEach((key) => { acc[key] += a[key]; })
  Object.values(a.staff).forEach((s) => {
    const x = acc.staff[s.id] || (acc.staff[s.id] = { id: s.id, name: s.name, sales: 0, cost: 0, count: 0, stores: {} })
    x.sales += s.sales; x.cost += s.cost; x.count += s.count; Object.assign(x.stores, s.stores)
  })
  Object.entries(a.methods).forEach(([key, m]) => {
    const x = acc.methods[key] || (acc.methods[key] = { sales: 0, count: 0 })
    x.sales += m.sales; x.count += m.count
  })
  Object.entries(a.products).forEach(([key, p]) => {
    const x = acc.products[key] || (acc.products[key] = { quantity: 0, sales: 0, cost: 0 })
    x.quantity += p.quantity; x.sales += p.sales; x.cost += p.cost
  })
  return acc
}

/**
 * THE one definition of "a day's numbers", used by Daily, Weekly, Monthly and Yearly.
 * Completed invoices only (voided excluded), sales net of returns, cut at `untilMinute` when given
 * and at "now" for today. The real backend must do the same: one day-totals function every report calls.
 */
function daySummary(date, storeId, untilMinute = null) {
  return aggregate(visibleInvoices(date, untilMinute).filter(inStoreOf(storeId)))
}
function rangeSummary(dates, storeId, cutLastAt = null) {
  const acc = emptyAgg()
  dates.forEach((d, i) => mergeInto(acc, daySummary(d, storeId, i === dates.length - 1 ? cutLastAt : null)))
  return acc
}
/** Expected sales for a day: average of the last 4 *finished* days with the same weekday (never future days). */
function forecastFor(date, storeId) {
  const today = todayBeirut()
  let base = shift(date, -7)
  while (base >= today) base = shift(base, -7)
  return [0, 1, 2, 3].reduce((s, k) => s + daySummary(shift(base, -7 * k), storeId).sales, 0) / 4
}

const money = (n) => n.toFixed(2)
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); })
})

function staffRows(staff, isOwner) {
  return Object.values(staff).map((s) => ({
    id: s.id, name: s.name, storeNames: Object.values(s.stores).sort(),
    salesTotal: money(s.sales), profitTotal: isOwner ? money(s.sales - s.cost) : null, invoiceCount: s.count,
  }))
}
function paymentRows(methods) {
  return ['CASH', 'WHISH'].map((m) => ({ method: m, salesTotal: money(methods[m]?.sales || 0), invoiceCount: methods[m]?.count || 0 }))
}
/** Products grouped by product (all colours and sizes), each with its variants. Every product sold, sorted by sales. */
function productRows(products, isOwner) {
  return CATALOG.map((p) => {
    const variants = p.variants
      .map((x) => ({ x, a: products[x.id] }))
      .filter(({ a }) => a && a.quantity > 0)
      .map(({ x, a }) => ({ id: x.id, label: variantLabel(x), quantity: a.quantity, salesTotal: money(a.sales), profitTotal: isOwner ? money(a.sales - a.cost) : null }))
      .sort((a, b) => b.quantity - a.quantity)
    const sum = (key) => variants.reduce((s, x) => s + Number(x[key] ?? 0), 0)
    return {
      id: p.id, name: p.name, category: p.category,
      quantity: variants.reduce((s, x) => s + x.quantity, 0),
      salesTotal: money(sum('salesTotal')),
      profitTotal: isOwner ? money(sum('profitTotal')) : null,
      variants,
    }
  }).filter((p) => p.quantity > 0).sort((a, b) => Number(b.salesTotal) - Number(a.salesTotal))
}

/* ------------------------------------------------------------------ inventory */

const BASIS_DAYS = 30 // "dead stock" = nothing sold in 30 days

/** Stock right now, per variant and store. Seeded by day so it stays stable while you look at it. */
function stockNow(variantId, storeId, perDay) {
  const rnd = seeded('stock' + variantId + storeId + todayBeirut())
  if (perDay === 0) return 2 + Math.floor(rnd() * 7)
  return Math.round(perDay * (4 + rnd() * 20))
}

function inventoryNow(storeId, isOwner) {
  const today = todayBeirut()
  const dates = Array.from({ length: BASIS_DAYS }, (_, k) => shift(today, -(k + 1)))
  const storeList = STORES.filter((s) => storeId === 'all' || !storeId || s.id === storeId)
  const soldBy = {}
  storeList.forEach((s) => { soldBy[s.id] = rangeSummary(dates, s.id).products; })
  const items = Object.values(VARIANTS).map((x) => {
    const sold = storeList.reduce((s, st) => s + (soldBy[st.id][x.id]?.quantity || 0), 0)
    const stock = storeList.reduce((s, st) => s + stockNow(x.id, st.id, (soldBy[st.id][x.id]?.quantity || 0) / BASIS_DAYS), 0)
    return { x, sold, stock, value: stock * x.product.unitCost }
  })
  const dead = items.filter((i) => i.stock > 0 && i.sold === 0)
  return {
    items,
    stockUnits: items.reduce((s, i) => s + i.stock, 0),
    stockValue: isOwner ? money(items.reduce((s, i) => s + i.value, 0)) : null,
    deadStockValue: isOwner ? money(dead.reduce((s, i) => s + i.value, 0)) : null,
    deadStock: dead.map((i) => ({
      id: i.x.id, name: i.x.product.name, variant: variantLabel(i.x), stock: i.stock, soldLastNDays: 0,
      lastSoldDate: shift(today, -(BASIS_DAYS + 5 + Math.floor(seeded('last' + i.x.id)() * 60))),
      stockValue: isOwner ? money(i.value) : null,
    })).sort((a, b) => Number(b.stockValue ?? 0) - Number(a.stockValue ?? 0)),
  }
}

/* ------------------------------------------------------------------ expenses */

/** Monthly costs per store. Spread over the days of the month so "net profit so far" is fair mid-month. */
const EXPENSES = [
  { category: 'RENT', label: 'Rent', amount: 750 },
  { category: 'SALARIES', label: 'Salaries', amount: 1200 },
  { category: 'ELECTRICITY', label: 'Electricity (EDL)', amount: 120, vary: 40 },
  { category: 'GENERATOR', label: 'Generator', amount: 280, vary: 80 },
  { category: 'OTHER', label: 'Other', amount: 100, vary: 60 },
]
function monthExpenses(ym, storeId) {
  const today = todayBeirut()
  if (ym > today.slice(0, 7)) return EXPENSES.map((e) => ({ ...e, amount: 0 }))
  const days = monthDays(ym).length
  const share = ym === today.slice(0, 7) ? Number(today.slice(8, 10)) / days : 1
  const stores = STORES.filter((s) => storeId === 'all' || !storeId || s.id === storeId)
  return EXPENSES.map((e) => ({
    category: e.category,
    label: e.label,
    amount: stores.reduce((sum, s) => {
      const rnd = seeded(e.category + ym + s.id)
      return sum + (e.amount + (e.vary ? (rnd() - 0.5) * e.vary : 0)) * share
    }, 0),
  }))
}

/* ------------------------------------------------------------------ endpoints */

export async function mockGetStores({ signal } = {}) {
  await wait(150, signal)
  return { items: STORES }
}

export async function mockGetDailySummary({ date, storeId, role = 'OWNER' }, { signal } = {}) {
  await wait(450, signal)
  const now = beirutNow()
  const live = date === now.date
  const cut = live ? now.minute : null
  const today = daySummary(date, storeId)
  // Comparisons stop at the same time of day when today is still running ("by this time").
  const yDate = shift(date, -1)
  const wDate = shift(date, -7)
  const yest = daySummary(yDate, storeId, cut)
  const lastWeek = daySummary(wDate, storeId, cut)
  const isOwner = role === 'OWNER'
  const hourKeys = Array.from({ length: 12 }, (_, i) => 10 + i).filter((h) => !live || h * 60 <= now.minute)
  return {
    date,
    timezone: 'Asia/Beirut',
    currency: 'USD',
    exchangeRate: RATE,
    live,
    asOf: live ? now.hhmm : null,
    closed: isClosed(date),
    salesTotal: money(today.sales),
    costTotal: isOwner ? money(today.cost) : null,
    profitTotal: isOwner ? money(today.sales - today.cost) : null,
    costComplete: true,
    invoiceCount: today.count,
    piecesSold: today.pieces,
    discountsTotal: money(today.discounts),
    returns: { count: today.returnsCount, amountTotal: money(today.returnsAmount) },
    previousDay: { date: yDate, salesTotal: money(yest.sales), invoiceCount: yest.count },
    sameWeekdayLastWeek: { date: wDate, salesTotal: money(lastWeek.sales), invoiceCount: lastWeek.count },
    paymentSplit: paymentRows(today.methods),
    byStaff: staffRows(today.staff, isOwner),
    products: productRows(today.products, isOwner),
    byHour: hourKeys.map((h) => ({ hour: h, salesTotal: money(today.hours[h] || 0) })),
  }
}

export async function mockGetInvoices({ date, storeId, method, q, cursor, limit = 10 }, { signal } = {}) {
  await wait(350, signal)
  let list = visibleInvoices(date).filter(inStoreOf(storeId))
  if (method && method !== 'all') list = list.filter((i) => i.paymentMethod === method)
  if (q) {
    const needle = q.trim().toLowerCase().replace('#', '')
    list = list.filter((i) => String(i.number).includes(needle) || (i.customerName || '').toLowerCase().includes(needle))
  }
  const start = cursor ? Number(cursor) : 0
  const items = list.slice(start, start + limit).map((inv) => ({ id: inv.id, number: inv.number, createdAt: inv.createdAt, itemCount: inv.itemCount, total: inv.total, paymentMethod: inv.paymentMethod, status: inv.status, staff: inv.staff, store: inv.store, customerName: inv.customerName })) // cost never leaves the invoice list
  const next = start + limit < list.length ? String(start + limit) : null
  return { items, nextCursor: next }
}

export async function mockGetWeekly({ week, storeId, role = 'OWNER' }, { signal } = {}) {
  await wait(500, signal)
  const now = beirutNow()
  const today = now.date
  const isOwner = role === 'OWNER'
  const dates = Array.from({ length: 7 }, (_, i) => shift(week, i))
  const live = dates.includes(today)
  const acc = emptyAgg()
  let prevSales = 0; let prevCount = 0
  const days = dates.map((date) => {
    const lastWeekDate = shift(date, -7)
    if (date > today) {
      return { date, salesTotal: null, costTotal: null, profitTotal: null, invoiceCount: 0, closed: isClosed(date), previousSalesTotal: money(daySummary(lastWeekDate, storeId).sales), forecastSalesTotal: money(isClosed(date) ? 0 : forecastFor(date, storeId)) }
    }
    const isToday = date === today
    const day = daySummary(date, storeId) // same function as the Daily page
    const prev = daySummary(lastWeekDate, storeId, isToday ? now.minute : null) // last week cut at the same time
    mergeInto(acc, day)
    prevSales += prev.sales; prevCount += prev.count
    return {
      date,
      salesTotal: money(day.sales),
      costTotal: isOwner ? money(day.cost) : null,
      profitTotal: isOwner ? money(day.sales - day.cost) : null,
      invoiceCount: day.count,
      closed: isClosed(date),
      previousSalesTotal: money(prev.sales),
      forecastSalesTotal: null,
    }
  })
  // Target: in the real app the owner sets it in Settings. The mock uses the last 4 weeks' average + 5%, rounded.
  const avg4 = [1, 2, 3, 4].reduce((s, k) => s + rangeSummary(dates.map((d) => shift(d, -7 * k)), storeId).sales, 0) / 4
  const target = Math.round((avg4 * 1.05) / 500) * 500
  const inv = live ? inventoryNow(storeId, isOwner) : null
  return {
    weekStart: week,
    weekEnd: shift(week, 6),
    timezone: 'Asia/Beirut',
    exchangeRate: RATE,
    live,
    asOf: live ? now.hhmm : null,
    asOfDate: live ? today : null,
    totals: {
      salesTotal: money(acc.sales),
      costTotal: isOwner ? money(acc.cost) : null,
      profitTotal: isOwner ? money(acc.sales - acc.cost) : null,
      invoiceCount: acc.count,
      piecesSold: acc.pieces,
    },
    previousWeek: { salesTotal: money(prevSales), invoiceCount: prevCount },
    target: { salesTotal: money(target) },
    days,
    paymentSplit: paymentRows(acc.methods),
    byStaff: staffRows(acc.staff, isOwner),
    products: productRows(acc.products, isOwner),
    slowMoversBasisDays: BASIS_DAYS,
    slowMovers: inv ? inv.deadStock : null,
  }
}

export async function mockGetMonthly({ month, storeId, role = 'OWNER' }, { signal } = {}) {
  await wait(500, signal)
  const now = beirutNow()
  const today = now.date
  const isOwner = role === 'OWNER'
  const all = monthDays(month)
  const live = today.slice(0, 7) === month
  const done = all.filter((d) => d <= today)
  const acc = emptyAgg()
  const days = all.map((date) => {
    const closed = isClosed(date)
    if (date > today) {
      return { date, salesTotal: null, costTotal: null, profitTotal: null, invoiceCount: 0, closed, forecastSalesTotal: money(closed ? 0 : forecastFor(date, storeId)) }
    }
    const day = daySummary(date, storeId) // same function as the Daily page
    mergeInto(acc, day)
    return {
      date,
      salesTotal: money(day.sales),
      costTotal: isOwner ? money(day.cost) : null,
      profitTotal: isOwner ? money(day.sales - day.cost) : null,
      invoiceCount: day.count,
      closed,
      // today: expected for the whole day, so the UI can project the month
      forecastSalesTotal: date === today ? money(closed ? 0 : forecastFor(date, storeId)) : null,
    }
  })

  // Fair comparisons: the same weekdays, not the same dates (1–2 Nov = Sun+Mon is compared with Sun+Mon).
  // A finished month is compared with the whole previous month and the whole same month last year.
  const cut = live ? now.minute : null
  const back = done.length <= 28 ? 28 : 35
  const lmDates = live ? done.map((d) => shift(d, -back)) : monthDays(shiftMonth(month, -1))
  const lyDates = live ? done.map((d) => shift(d, -364)) : monthDays(shiftMonth(month, -12))
  const lm = rangeSummary(lmDates, storeId, cut)
  const ly = rangeSummary(lyDates, storeId, cut)
  const prevMonth = shiftMonth(month, -1)
  const prevFull = rangeSummary(monthDays(prevMonth), storeId)

  // Target: the owner sets it in Settings. Mock: average of the last 3 months + 5%, rounded to $1,000.
  const avg3 = [1, 2, 3].reduce((s, k) => s + rangeSummary(monthDays(shiftMonth(month, -k)), storeId).sales, 0) / 3
  const target = Math.round((avg3 * 1.05) / 1000) * 1000

  let inventory = null
  if (live) {
    const inv = inventoryNow(storeId, isOwner)
    inventory = {
      basisDays: BASIS_DAYS,
      stockUnits: inv.stockUnits,
      stockValue: inv.stockValue,
      deadStockValue: inv.deadStockValue,
      piecesSoldThisMonth: acc.pieces,
      deadStock: inv.deadStock,
    }
  }

  return {
    month,
    timezone: 'Asia/Beirut',
    exchangeRate: RATE,
    live,
    asOf: live ? now.hhmm : null,
    asOfDate: live ? today : null,
    totals: {
      salesTotal: money(acc.sales),
      costTotal: isOwner ? money(acc.cost) : null,
      profitTotal: isOwner ? money(acc.sales - acc.cost) : null,
      invoiceCount: acc.count,
      piecesSold: acc.pieces,
      discountsTotal: money(acc.discounts),
      returns: { count: acc.returnsCount, amountTotal: money(acc.returnsAmount) },
    },
    days,
    comparisons: {
      sameWeekdaysLastMonth: { from: lmDates[0], to: lmDates[lmDates.length - 1], salesTotal: money(lm.sales), invoiceCount: lm.count },
      sameWeekdaysLastYear: { from: lyDates[0], to: lyDates[lyDates.length - 1], salesTotal: money(ly.sales), invoiceCount: ly.count },
      previousMonthFull: { month: prevMonth, salesTotal: money(prevFull.sales) },
    },
    target: { salesTotal: money(target) },
    expenses: isOwner ? monthExpenses(month, storeId).map((e) => ({ category: e.category, label: e.label, amountTotal: money(e.amount) })) : null,
    paymentSplit: paymentRows(acc.methods),
    byStaff: staffRows(acc.staff, isOwner),
    products: productRows(acc.products, isOwner),
    inventory,
  }
}

export async function mockGetYearly({ year, storeId, role = 'OWNER' }, { signal } = {}) {
  await wait(600, signal)
  if (role !== 'OWNER') {
    const err = new Error('The yearly report is for the owner only.')
    err.status = 403
    throw err
  }
  const today = todayBeirut()
  const lastMonth = String(year) === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12
  const rnd = seeded('year' + year + storeId)
  let prevYearSales = 0
  const months = Array.from({ length: lastMonth }, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`
    const dates = monthDays(ym).filter((d) => d <= today)
    const base = rangeSummary(dates, storeId) // same day function as Daily/Weekly/Monthly
    prevYearSales += rangeSummary(dates.map((d) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`), storeId).sales
    const exp = monthExpenses(ym, storeId)
    return {
      month: ym,
      salesTotal: money(base.sales),
      cogsTotal: money(base.cost),
      purchasesTotal: money(base.cost * (0.85 + rnd() * 0.45)),
      rentTotal: money(exp.find((e) => e.category === 'RENT').amount),
      otherExpensesTotal: money(exp.filter((e) => e.category !== 'RENT').reduce((s, e) => s + e.amount, 0)),
      invoiceCount: base.count,
    }
  })
  return {
    year: Number(year),
    timezone: 'Asia/Beirut',
    exchangeRate: RATE,
    months,
    previousYear: { salesTotal: money(prevYearSales), monthsCompared: months.length },
  }
}
