// EXAMPLE ONLY: an Express + Prisma + Zod sketch of the Daily endpoints in docs/API.md.
// Adapt table/column names to your schema (Sale, SaleItem, Return...). Keep the rules:
// tenant from the session, OWNER-only cost/profit, Beirut business day, decimal strings, cursor pagination.
import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const businessRouter = Router();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dailyQuery = z.object({ date: ymd, storeId: z.string().optional() });
const invoicesQuery = dailyQuery.extend({
  method: z.enum(['CASH', 'WHISH']).optional(),
  q: z.string().max(60).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Assumes your auth middleware sets req.auth = { accountId, userId, role, timezone }.
type AuthedReq = { auth: { accountId: string; role: 'OWNER' | 'WAREHOUSE' | string; timezone?: string } };

async function assertStore(accountId: string, storeId?: string) {
  if (!storeId || storeId === 'all') return null;
  const store = await prisma.store.findFirst({ where: { id: storeId, accountId }, select: { id: true } });
  if (!store) throw Object.assign(new Error('Store not found'), { status: 403, code: 'STORE_FORBIDDEN' });
  return store.id;
}

// RULE: every report (daily, weekly, monthly, yearly) must build on dayTotals() below, so the same day
// always has the same numbers everywhere. Weekly = dayTotals() for each day of the week, summed.
// Day totals in the account timezone. Postgres does the timezone math so DST is always right.
// `untilMinute` cuts the day at a time of day (minutes after midnight) so "today so far" is
// compared with yesterday and last week *up to the same time*.
function dayBounds(date: string, tz: string, untilMinute: number | null) {
  return Prisma.sql`
    WITH bounds AS (
      SELECT (${date}::date)::timestamp AT TIME ZONE ${tz} AS start_at,
             ${untilMinute === null
               ? Prisma.sql`((${date}::date) + 1)::timestamp`
               : Prisma.sql`((${date}::date)::timestamp + make_interval(mins => ${untilMinute}))`} AT TIME ZONE ${tz} AS end_at
    )`;
}
const saleFilter = (accountId: string, storeId: string | null) => Prisma.sql`
  s."accountId" = ${accountId}
  AND s."voidedAt" IS NULL
  AND s."createdAt" >= b.start_at AND s."createdAt" < b.end_at
  ${storeId ? Prisma.sql`AND s."storeId" = ${storeId}` : Prisma.empty}`;

async function dayTotals(accountId: string, date: string, tz: string, storeId: string | null, untilMinute: number | null = null) {
  const rows = await prisma.$queryRaw<Array<{ sales: string | null; cost: string | null; invoices: bigint; pieces: bigint | null; missing_cost: bigint }>>(Prisma.sql`
    ${dayBounds(date, tz, untilMinute)}
    SELECT
      COALESCE(SUM(si."unitSoldPrice" * si."quantity"), 0)::text AS sales,
      COALESCE(SUM(si."unitCost" * si."quantity"), 0)::text AS cost,
      COUNT(DISTINCT s.id) AS invoices,
      SUM(si."quantity") AS pieces,
      COUNT(*) FILTER (WHERE si."unitCost" IS NULL) AS missing_cost
    FROM "Sale" s
    JOIN "SaleItem" si ON si."saleId" = s.id
    CROSS JOIN bounds b
    WHERE ${saleFilter(accountId, storeId)}
  `);
  // TODO: subtract returns made that day (and their cost) if your schema stores returns separately.
  const r = rows[0];
  return { sales: r.sales ?? '0', cost: r.cost ?? '0', invoices: Number(r.invoices), pieces: Number(r.pieces ?? 0), missingCost: Number(r.missing_cost) > 0 };
}

// One grouped query per breakdown. Column names (paymentMethod, userId, discountTotal…) follow the
// POS schema; rename to match yours.
async function dayBreakdowns(accountId: string, date: string, tz: string, storeId: string | null) {
  const b = dayBounds(date, tz, null);
  const f = saleFilter(accountId, storeId);
  const [byStore, byPay, byStaff, top, byHour, disc] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`${b}
      SELECT st.id AS "storeId", st.name, SUM(si."unitSoldPrice" * si."quantity")::text AS sales,
             SUM((si."unitSoldPrice" - si."unitCost") * si."quantity")::text AS profit, COUNT(DISTINCT s.id) AS invoices
      FROM "Sale" s JOIN "SaleItem" si ON si."saleId" = s.id JOIN "Store" st ON st.id = s."storeId" CROSS JOIN bounds b
      WHERE ${f} GROUP BY st.id, st.name ORDER BY SUM(si."unitSoldPrice" * si."quantity") DESC`),
    prisma.$queryRaw<any[]>(Prisma.sql`${b}
      SELECT s."paymentMethod" AS method, SUM(s."total")::text AS sales, COUNT(*) AS invoices
      FROM "Sale" s CROSS JOIN bounds b WHERE ${f} GROUP BY s."paymentMethod"`),
    prisma.$queryRaw<any[]>(Prisma.sql`${b}
      SELECT u.id AS "userId", u.name, SUM(s."total")::text AS sales, COUNT(*) AS invoices
      FROM "Sale" s JOIN "User" u ON u.id = s."userId" CROSS JOIN bounds b
      WHERE ${f} GROUP BY u.id, u.name ORDER BY SUM(s."total") DESC`),
    prisma.$queryRaw<any[]>(Prisma.sql`${b}
      SELECT v.id AS "variantId", p.name, v.label AS variant, SUM(si."quantity") AS quantity,
             SUM(si."unitSoldPrice" * si."quantity")::text AS sales
      FROM "Sale" s JOIN "SaleItem" si ON si."saleId" = s.id JOIN "Variant" v ON v.id = si."variantId"
      JOIN "Product" p ON p.id = v."productId" CROSS JOIN bounds b
      WHERE ${f} GROUP BY v.id, p.name, v.label ORDER BY SUM(si."unitSoldPrice" * si."quantity") DESC LIMIT 5`),
    prisma.$queryRaw<any[]>(Prisma.sql`${b}
      SELECT EXTRACT(HOUR FROM s."createdAt" AT TIME ZONE ${tz})::int AS hour, SUM(s."total")::text AS sales
      FROM "Sale" s CROSS JOIN bounds b WHERE ${f} GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<any[]>(Prisma.sql`${b}
      SELECT COALESCE(SUM(s."discountTotal"), 0)::text AS discounts FROM "Sale" s CROSS JOIN bounds b WHERE ${f}`),
  ]);
  // TODO: returns { count, amountTotal } from your returns table, same bounds.
  return { byStore, byPay, byStaff, top, byHour, discounts: disc[0]?.discounts ?? '0', returns: { count: 0, amountTotal: '0.00' } };
}

function shiftDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function beirutNow(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute), hhmm: `${parts.hour}:${parts.minute}` };
}
const money = (s: string) => new Prisma.Decimal(s).toFixed(2);

businessRouter.get('/business/daily', async (req, res, next) => {
  try {
    const { accountId, role, timezone = 'Asia/Beirut' } = (req as unknown as AuthedReq).auth;
    const { date, storeId } = dailyQuery.parse(req.query);
    const store = await assertStore(accountId, storeId);
    const now = beirutNow(timezone);
    const live = date === now.date;
    const cut = live ? now.minute : null; // "by this time" for today, full days otherwise
    const lastWeekDate = shiftDays(date, -7);
    const [today, prev, lastWeek, parts, account] = await Promise.all([
      dayTotals(accountId, date, timezone, store),
      dayTotals(accountId, shiftDays(date, -1), timezone, store, cut),
      dayTotals(accountId, lastWeekDate, timezone, store, cut),
      dayBreakdowns(accountId, date, timezone, store),
      prisma.account.findUnique({ where: { id: accountId }, select: { exchangeRate: true } }),
    ]);
    const owner = role === 'OWNER';
    const profit = new Prisma.Decimal(today.sales).minus(today.cost);
    res.json({
      date,
      timezone,
      currency: 'USD',
      exchangeRate: account?.exchangeRate?.toString() ?? null,
      live,
      asOf: live ? now.hhmm : null,
      salesTotal: money(today.sales),
      costTotal: owner ? money(today.cost) : null,
      profitTotal: owner ? profit.toFixed(2) : null,
      costComplete: !today.missingCost,
      invoiceCount: today.invoices,
      piecesSold: today.pieces,
      discountsTotal: money(parts.discounts),
      returns: parts.returns,
      previousDay: { date: shiftDays(date, -1), salesTotal: money(prev.sales), invoiceCount: prev.invoices },
      sameWeekdayLastWeek: { date: lastWeekDate, salesTotal: money(lastWeek.sales), invoiceCount: lastWeek.invoices },
      byStore: store ? [] : parts.byStore.map((r) => ({ storeId: r.storeId, name: r.name, salesTotal: money(r.sales), profitTotal: owner ? money(r.profit) : null, invoiceCount: Number(r.invoices) })),
      paymentSplit: parts.byPay.map((r) => ({ method: r.method, salesTotal: money(r.sales), invoiceCount: Number(r.invoices) })),
      byStaff: parts.byStaff.map((r) => ({ userId: r.userId, name: r.name, salesTotal: money(r.sales), invoiceCount: Number(r.invoices) })),
      topProducts: parts.top.map((r) => ({ variantId: r.variantId, name: r.name, variant: r.variant, quantity: Number(r.quantity), salesTotal: money(r.sales) })),
      byHour: parts.byHour.map((r) => ({ hour: Number(r.hour), salesTotal: money(r.sales) })),
    });
  } catch (err) {
    next(err);
  }
});

businessRouter.get('/business/daily/invoices', async (req, res, next) => {
  try {
    const { accountId, timezone = 'Asia/Beirut' } = (req as unknown as AuthedReq).auth;
    const { date, storeId, method, q, cursor, limit } = invoicesQuery.parse(req.query);
    const store = await assertStore(accountId, storeId);
    const after = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { createdAt: string; id: string } : null;
    const [startAt, endAt] = await prisma.$queryRaw<Array<{ s: Date; e: Date }>>(Prisma.sql`
      SELECT (${date}::date)::timestamp AT TIME ZONE ${timezone} AS s, ((${date}::date) + 1)::timestamp AT TIME ZONE ${timezone} AS e
    `).then((r) => [r[0].s, r[0].e]);
    const num = q && /^#?\d+$/.test(q.trim()) ? Number(q.trim().replace('#', '')) : null;

    const rows = await prisma.sale.findMany({
      where: {
        accountId,
        createdAt: { gte: startAt, lt: endAt },
        ...(store ? { storeId: store } : {}),
        ...(method ? { paymentMethod: method } : {}),
        ...(num !== null ? { number: num } : {}),
        ...(after ? { OR: [{ createdAt: { lt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, number: true, createdAt: true, total: true, paymentMethod: true, voidedAt: true, customerName: true,
        staff: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      items: page.map((s) => ({
        id: s.id,
        number: s.number,
        createdAt: s.createdAt.toISOString(),
        itemCount: s._count.items,
        total: s.total.toFixed(2),
        paymentMethod: s.paymentMethod,
        status: s.voidedAt ? 'VOIDED' : 'COMPLETED',
        staff: s.staff,
        store: s.store,
        customerName: s.customerName,
      })),
      nextCursor: rows.length > limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url')
        : null,
    });
  } catch (err) {
    next(err);
  }
});
