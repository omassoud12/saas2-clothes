// DTO -> view model. The UI never reads raw backend fields directly, so a backend change is fixed here once.
import { toNumber, percentChange, pct } from '../lib/money.js';
import { PAYMENT_METHODS } from './types.js';

const methodLabel = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label]));

/** @param {import('./types.js').DailySummaryDTO} dto */
export function mapDailySummary(dto) {
  const sales = toNumber(dto.salesTotal) ?? 0;
  const cost = toNumber(dto.costTotal);
  const profit = toNumber(dto.profitTotal);
  const compare = (key, label, ref) => {
    const value = toNumber(ref?.salesTotal) ?? 0;
    return { key, label, date: ref?.date, sales: value, diff: sales - value, change: percentChange(sales, value) };
  };
  const pieces = dto.piecesSold ?? 0;
  return {
    date: dto.date,
    timezone: dto.timezone,
    rate: toNumber(dto.exchangeRate),
    live: Boolean(dto.live),
    asOf: dto.asOf,
    sales,
    invoices: dto.invoiceCount,
    averageInvoice: dto.invoiceCount ? sales / dto.invoiceCount : 0,
    pieces,
    piecesPerInvoice: dto.invoiceCount ? pieces / dto.invoiceCount : 0,
    cost,
    profit,
    grossMargin: pct(profit, sales),
    canSeeCost: cost !== null,
    costComplete: dto.costComplete,
    discounts: toNumber(dto.discountsTotal) ?? 0,
    returns: { count: dto.returns?.count ?? 0, amount: toNumber(dto.returns?.amountTotal) ?? 0 },
    comparisons: [
      compare('yesterday', 'Yesterday', dto.previousDay),
      compare('lastWeek', `Last ${dto.sameWeekdayLastWeek ? weekdayName(dto.sameWeekdayLastWeek.date) : 'week'}`, dto.sameWeekdayLastWeek),
    ],
    payments: mapPayments(dto.paymentSplit),
    staff: mapStaff(dto.byStaff),
    products: mapProducts(dto.products),
    hours: (dto.byHour || []).map((h) => ({ hour: h.hour, sales: toNumber(h.salesTotal) ?? 0 })),
  };
}

function weekdayName(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** @param {import('./types.js').InvoiceDTO} dto */
export function mapInvoice(dto) {
  return {
    id: dto.id,
    number: dto.number,
    createdAt: dto.createdAt,
    items: dto.itemCount,
    total: toNumber(dto.total) ?? 0,
    method: dto.paymentMethod,
    methodLabel: methodLabel[dto.paymentMethod] ?? dto.paymentMethod,
    status: dto.status,
    staff: dto.staff?.name ?? '',
    store: dto.store?.name ?? '',
    customer: dto.customerName,
  };
}

/** @param {import('./types.js').MonthlySummaryDTO} dto */
function mondayKey(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

export function mapMonthly(dto) {
  const live = Boolean(dto.live);
  const days = dto.days.map((d) => {
    const sales = toNumber(d.salesTotal);
    const profit = toNumber(d.profitTotal);
    return {
      date: d.date,
      day: Number(d.date.slice(8, 10)),
      sales,
      cost: toNumber(d.costTotal),
      profit,
      margin: pct(profit, sales),
      invoices: d.invoiceCount,
      closed: Boolean(d.closed),
      forecast: toNumber(d.forecastSalesTotal),
      isToday: live && d.date === dto.asOfDate,
    };
  });
  const sales = toNumber(dto.totals.salesTotal) ?? 0;
  const cost = toNumber(dto.totals.costTotal);
  const profit = toNumber(dto.totals.profitTotal);
  const invoices = dto.totals.invoiceCount;
  const pieces = dto.totals.piecesSold ?? 0;

  // Best / slowest day only once there is enough to compare (5+ finished open days).
  const finished = days.filter((d) => d.sales !== null && !d.isToday && !d.closed);
  const best = finished.length >= 5 ? finished.reduce((a, d) => (d.sales > a.sales ? d : a)) : null;
  const worst = finished.length >= 5 ? finished.reduce((a, d) => (d.sales < a.sales ? d : a)) : null;
  const openDays = days.filter((d) => d.sales !== null && !d.closed).length;

  // Weeks of the month (Mon–Sun, cut at the month edges): W1, W2…
  const weekMap = new Map();
  days.forEach((d) => {
    const k = mondayKey(d.date);
    if (!weekMap.has(k)) weekMap.set(k, { from: d.date, to: d.date, sales: 0, days: 0, started: false });
    const w = weekMap.get(k);
    w.to = d.date;
    if (d.sales !== null) { w.sales += d.sales; w.days += 1; w.started = true; }
  });
  const weeks = [...weekMap.values()].map((w, i) => ({ key: `W${i + 1}`, ...w, perDay: w.days ? w.sales / w.days : 0 }));

  // Projection: sales so far + expected for the rest of today + expected for the days still to come.
  const today = days.find((d) => d.isToday);
  const rest = days.filter((d) => d.sales === null).reduce((s, d) => s + (d.forecast ?? 0), 0);
  const projection = live ? sales + rest + (today ? Math.max(0, (today.forecast ?? 0) - (today.sales ?? 0)) : 0) : null;

  const c = dto.comparisons;
  const cmp = (key, label, ref, sub) => {
    const value = toNumber(ref?.salesTotal) ?? 0;
    return { key, label, sub, sales: value, diff: sales - value, change: percentChange(sales, value) };
  };
  const span = (r) => (r.from === r.to ? r.from : `${r.from}|${r.to}`);

  const target = toNumber(dto.target?.salesTotal);
  const elapsed = days.filter((d) => d.sales !== null).length;
  const expenses = dto.expenses ? dto.expenses.map((x) => ({ key: x.category, label: x.label, amount: toNumber(x.amountTotal) ?? 0 })) : null;
  const expensesTotal = expenses ? expenses.reduce((s, x) => s + x.amount, 0) : null;
  const net = profit !== null && expensesTotal !== null ? profit - expensesTotal : null;
  const inv = dto.inventory;

  return {
    month: dto.month,
    rate: toNumber(dto.exchangeRate),
    live,
    asOf: dto.asOf,
    asOfDate: dto.asOfDate,
    days,
    canSeeCost: cost !== null,
    sales,
    cost,
    profit,
    grossMargin: pct(profit, sales),
    invoices,
    averageInvoice: invoices ? sales / invoices : 0,
    pieces,
    piecesPerInvoice: invoices ? pieces / invoices : 0,
    perOpenDay: openDays ? sales / openDays : 0,
    discounts: toNumber(dto.totals.discountsTotal) ?? 0,
    returns: { count: dto.totals.returns?.count ?? 0, amount: toNumber(dto.totals.returns?.amountTotal) ?? 0 },
    best,
    worst,
    bestDate: best?.date ?? null,
    weeks,
    comparisons: [
      cmp('lastMonth', live ? 'Last month' : 'Previous month', c.sameWeekdaysLastMonth, span(c.sameWeekdaysLastMonth)),
      cmp('lastYear', live ? 'Last year' : 'Same month last year', c.sameWeekdaysLastYear, span(c.sameWeekdaysLastYear)),
    ],
    previousMonthFull: { month: c.previousMonthFull.month, sales: toNumber(c.previousMonthFull.salesTotal) ?? 0 },
    projection,
    target: target ? { value: target, progress: sales / target, expectedByNow: elapsed / days.length } : null,
    expenses,
    expensesTotal,
    net,
    netMargin: pct(net, sales),
    payments: mapPayments(dto.paymentSplit),
    staff: mapStaff(dto.byStaff),
    products: mapProducts(dto.products),
    inventory: inv ? {
      basisDays: inv.basisDays,
      stockUnits: inv.stockUnits,
      stockValue: toNumber(inv.stockValue),
      deadStockValue: toNumber(inv.deadStockValue),
      // sell-through = pieces sold this month / (sold + still in stock)
      sellThrough: pct(inv.piecesSoldThisMonth, inv.piecesSoldThisMonth + inv.stockUnits),
      deadStock: inv.deadStock.map((m) => ({ ...m, stockValue: toNumber(m.stockValue) })),
    } : null,
  };
}

/** @param {import('./types.js').WeeklySummaryDTO} dto */
/** Staff rows shared by Daily and Weekly: sales, invoices, average ticket, store(s) and gross profit. */
export function mapStaff(rows = []) {
  const total = rows.reduce((s, r) => s + (toNumber(r.salesTotal) ?? 0), 0) || 1;
  return rows
    .map((r) => {
      const sales = toNumber(r.salesTotal) ?? 0;
      const profit = toNumber(r.profitTotal);
      return {
        id: r.id, name: r.name, stores: r.storeNames || [], sales, invoices: r.invoiceCount,
        average: r.invoiceCount ? sales / r.invoiceCount : 0,
        profit, margin: pct(profit, sales),
        share: sales / total,
      };
    })
    .sort((a, b) => b.sales - a.sales);
}

export function mapStores(rows = []) {
  return rows.map((s) => {
    const sales = toNumber(s.salesTotal) ?? 0;
    const profit = toNumber(s.profitTotal);
    return { id: s.id, name: s.name, sales, profit, invoices: s.invoiceCount, margin: pct(profit, sales) };
  }).sort((x, y) => y.sales - x.sales);
}

export function mapPayments(rows = []) {
  const total = rows.reduce((s, r) => s + (toNumber(r.salesTotal) ?? 0), 0) || 1;
  return PAYMENT_METHODS.map((pm) => {
    const row = rows.find((m) => m.method === pm.value);
    const sales = toNumber(row?.salesTotal) ?? 0;
    return { key: pm.value, label: pm.label, sales, invoices: row?.invoiceCount ?? 0, share: sales / total };
  });
}

/** Products grouped by product, each with its variants (colour · size). Margin uses the shared pct(). */
export function mapProducts(rows = []) {
  const one = (r) => {
    const sales = toNumber(r.salesTotal) ?? 0;
    const profit = toNumber(r.profitTotal);
    return { sales, profit, margin: pct(profit, sales), quantity: r.quantity };
  };
  return rows.map((r) => ({
    id: r.id, name: r.name, category: r.category, ...one(r),
    variants: (r.variants || []).map((x) => ({ id: x.id, label: x.label, ...one(x) })),
  }));
}

export function mapWeekly(dto) {
  const sales = toNumber(dto.totals.salesTotal) ?? 0;
  const prev = toNumber(dto.previousWeek.salesTotal) ?? 0;
  const profit = toNumber(dto.totals.profitTotal);
  const days = dto.days.map((d) => {
    const s = toNumber(d.salesTotal);
    const p = toNumber(d.profitTotal);
    return {
      date: d.date,
      sales: s,
      cost: toNumber(d.costTotal),
      profit: p,
      margin: pct(p, s),
      lastWeek: toNumber(d.previousSalesTotal) ?? 0,
      forecast: toNumber(d.forecastSalesTotal),
      invoices: d.invoiceCount,
      isToday: dto.live && d.date === dto.asOfDate,
    };
  });
  // Best / worst only among finished days (today is still running). Worst needs 2+ finished days.
  const finished = days.filter((d) => d.sales !== null && !d.isToday);
  const best = finished.length ? finished.reduce((a, d) => (d.sales > a.sales ? d : a)) : null;
  const worst = finished.length > 1 ? finished.reduce((a, d) => (d.sales < a.sales ? d : a)) : null;
  const pieces = dto.totals.piecesSold ?? 0;
  const target = toNumber(dto.target?.salesTotal);
  const elapsed = days.filter((d) => d.sales !== null).length;
  return {
    weekStart: dto.weekStart,
    rate: toNumber(dto.exchangeRate),
    live: Boolean(dto.live),
    asOf: dto.asOf,
    asOfDate: dto.asOfDate,
    sales,
    invoices: dto.totals.invoiceCount,
    averageInvoice: dto.totals.invoiceCount ? sales / dto.totals.invoiceCount : 0,
    pieces,
    piecesPerInvoice: dto.totals.invoiceCount ? pieces / dto.totals.invoiceCount : 0,
    profit,
    grossMargin: pct(profit, sales),
    canSeeCost: dto.totals.costTotal !== null,
    previousSales: prev,
    diff: sales - prev,
    change: percentChange(sales, prev),
    target: target ? { value: target, progress: sales / target, expectedByNow: elapsed / 7 } : null,
    days,
    best,
    worst,
    payments: mapPayments(dto.paymentSplit),
    staff: mapStaff(dto.byStaff),
    products: mapProducts(dto.products),
    slowMovers: dto.slowMovers
      ? dto.slowMovers.map((m) => ({ ...m, stockValue: toNumber(m.stockValue) })).sort((a, b) => (b.stockValue ?? 0) - (a.stockValue ?? 0))
      : null,
    slowMoversBasisDays: dto.slowMoversBasisDays ?? 28,
  };
}

/** @param {import('./types.js').YearlySummaryDTO} dto */
export function mapYearly(dto, currentMonth = null) {
  const months = dto.months.map((m, i, all) => {
    // The current month is still running: no growth or trend for it, so a few days never look like a crash.
    const partial = m.month === currentMonth;
    const sales = toNumber(m.salesTotal) ?? 0;
    const cogs = toNumber(m.cogsTotal) ?? 0;
    const purchases = toNumber(m.purchasesTotal) ?? 0;
    const rent = toNumber(m.rentTotal) ?? 0;
    const other = toNumber(m.otherExpensesTotal) ?? 0;
    const prevSales = i > 0 ? toNumber(all[i - 1].salesTotal) ?? 0 : null;
    // Trend line: average of this month and the two before it (same $ scale as the bars).
    const last3 = all.slice(Math.max(0, i - 2), i + 1).map((x) => toNumber(x.salesTotal) ?? 0);
    return {
      month: m.month,
      index: Number(m.month.slice(5, 7)) - 1,
      sales,
      cogs,
      purchases,
      rent,
      other,
      moneyOut: purchases + rent + other,
      net: sales - cogs - rent - other,
      invoices: m.invoiceCount,
      partial,
      growth: !partial && prevSales ? percentChange(sales, prevSales) : null,
      trend: partial ? null : last3.reduce((s, v) => s + v, 0) / last3.length,
    };
  });
  const sum = (k) => months.reduce((s, m) => s + m[k], 0);
  const sales = sum('sales');
  const prevYear = toNumber(dto.previousYear.salesTotal) ?? 0;
  const best = months.reduce((a, m) => (!a || m.sales > a.sales ? m : a), null);
  return {
    year: dto.year,
    rate: toNumber(dto.exchangeRate),
    months,
    sales,
    purchases: sum('purchases'),
    rent: sum('rent'),
    other: sum('other'),
    cogs: sum('cogs'),
    net: sum('net'),
    invoices: sum('invoices'),
    vsLastYear: percentChange(sales, prevYear),
    monthsCompared: dto.previousYear.monthsCompared,
    bestMonth: best?.month ?? null,
  };
}
