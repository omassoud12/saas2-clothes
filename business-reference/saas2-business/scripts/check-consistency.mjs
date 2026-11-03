// Proves on the mock that every report shows the same numbers for the same days.
// Run: npm run check   (the real backend should pass the same checks against its API)
import { getDailySummary, getWeekly, getMonthly, getYearly } from '../src/api/business.js';
import { mapDailySummary, mapWeekly, mapMonthly, mapYearly } from '../src/domain/mappers.js';
import { mondayOf, todayInShop } from '../src/lib/date.js';

const today = todayInShop();
const ym = today.slice(0, 7);
let failed = 0;
const eq = (label, a, b) => {
  const ok = Math.abs(a - b) < 0.01;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);
};

for (const storeId of ['all', 'st_hamra', 'st_jounieh']) {
  const m = mapMonthly(await getMonthly({ month: ym, storeId }));
  const w = mapWeekly(await getWeekly({ week: mondayOf(today), storeId }));
  let sales = 0; let invoices = 0; let weekSales = 0; let weekInvoices = 0;
  const pieces = {};
  for (const d of m.days.filter((x) => x.sales !== null)) {
    const day = mapDailySummary(await getDailySummary({ date: d.date, storeId }));
    eq(`${storeId} ${d.date} monthly day = daily`, d.sales, day.sales);
    sales += day.sales; invoices += day.invoices;
    if (d.date >= mondayOf(today)) { weekSales += day.sales; weekInvoices += day.invoices; }
    day.products.forEach((p) => { pieces[p.name] = (pieces[p.name] || 0) + p.quantity; });
  }
  eq(`${storeId} month = sum of daily`, m.sales, sales);
  eq(`${storeId} month invoices = sum of daily`, m.invoices, invoices);
  eq(`${storeId} week (days in this month) = sum of daily`, w.days.filter((d) => d.sales !== null && d.date.startsWith(ym)).reduce((s, d) => s + d.sales, 0), weekSales);
  m.products.forEach((p) => eq(`${storeId} ${p.name} pieces month = sum of daily`, p.quantity, pieces[p.name] || 0));
  const y = mapYearly(await getYearly({ year: today.slice(0, 4), storeId }), ym);
  eq(`${storeId} yearly ${ym} = monthly`, y.months.find((x) => x.month === ym).sales, m.sales);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll reports agree.');
process.exit(failed ? 1 : 0);
