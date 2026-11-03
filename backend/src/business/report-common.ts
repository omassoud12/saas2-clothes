// Pieces shared by the Daily, Weekly, Monthly and Yearly services. Every number comes from day-totals.ts.
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { UserRole } from '../generated/prisma/enums.js'
import type { AuthContext } from '../auth/auth.types.js'
import { isCalendarDate, shiftDate, shopNow, type ShopNow } from './business-dates.js'
import { loadAccountContext, resolveStoreIds, type AccountContext } from './business-stores.js'
import { rangeTotals, type BusinessScope, type DayNumbers, type RangeTotals, type StaffNumbers, type VariantNumbers } from './day-totals.js'

type Money = Prisma.Decimal
export const fmt = (value: Money): string => value.toFixed(2)

export interface ReportContext {
  readonly prisma: PrismaClient
  readonly account: AccountContext
  readonly scope: BusinessScope
  readonly isOwner: boolean
  readonly now: ShopNow
  readonly storeKey: string
}

export interface BusinessOptions {
  /** Injectable clock for tests. */
  readonly clock?: () => Date
}

export function validationError(message: string): HttpError {
  return new HttpError(422, 'VALIDATION_ERROR', message)
}

export function tenantOf(auth: AuthContext | undefined): { accountId: string; role: UserRole } {
  if (!auth?.accountId) throw new HttpError(403, 'TENANT_REQUIRED', 'An active store account is required')
  return { accountId: auth.accountId, role: auth.role }
}

export async function reportContext(prisma: PrismaClient, auth: AuthContext | undefined, storeId: unknown, options: BusinessOptions): Promise<ReportContext> {
  const { accountId, role } = tenantOf(auth)
  const account = await loadAccountContext(prisma, accountId)
  const storeIds = resolveStoreIds(account, storeId)
  let now: ShopNow
  try {
    now = shopNow(account.timezone, options.clock?.() ?? new Date())
  } catch {
    throw new HttpError(500, 'ACCOUNT_TIMEZONE_INVALID', 'The account timezone is not valid')
  }
  return {
    prisma, account, now,
    scope: { accountId, timezone: account.timezone, storeIds },
    isOwner: role === UserRole.OWNER,
    storeKey: storeIds.length === account.stores.length ? 'all' : storeIds.join(','),
  }
}

export function parseDateParam(value: unknown, name: string, today: string): string {
  if (!isCalendarDate(value)) throw validationError(`${name} must be a date YYYY-MM-DD`)
  if (value > today) throw validationError(`${name} cannot be in the future`)
  return value
}

export function ownerMoney(ctx: ReportContext, value: Money): string | null {
  return ctx.isOwner ? fmt(value) : null
}

export function paymentSplit(day: DayNumbers) {
  return [
    { method: 'CASH', salesTotal: fmt(day.cashTotal), invoiceCount: day.cashCount },
    { method: 'WHISH', salesTotal: fmt(day.whishTotal), invoiceCount: day.whishCount },
  ]
}

/** Staff rows (names from User), sorted by sales. Every staff member works in the account's store(s). */
export async function staffRows(ctx: ReportContext, staff: Map<string, StaffNumbers>) {
  if (!staff.size) return []
  const users = await ctx.prisma.user.findMany({
    where: { accountId: ctx.scope.accountId, id: { in: [...staff.keys()] } },
    select: { id: true, firstName: true, lastName: true },
  })
  const names = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]))
  const storeNames = ctx.account.stores.filter((store) => ctx.scope.storeIds.includes(store.id)).map((store) => store.name).sort()
  return [...staff.entries()]
    .map(([id, value]) => ({
      id, name: names.get(id) ?? 'Former staff', storeNames,
      salesTotal: fmt(value.salesTotal), profitTotal: ownerMoney(ctx, value.salesTotal.sub(value.costTotal)), invoiceCount: value.invoiceCount,
    }))
    .sort((a, b) => Number(b.salesTotal) - Number(a.salesTotal))
}

export function variantLabel(color: string | null, size: string | null): string {
  return `${color ?? 'Standard'} · ${size ? `Size ${size}` : 'One size'}`
}

/** Every product sold in the period, grouped by product with its variants, sorted by sales. */
export async function productRows(ctx: ReportContext, variants: Map<string, VariantNumbers>) {
  const sold = [...variants.entries()].filter(([, value]) => value.quantity > 0)
  if (!sold.length) return []
  const info = await ctx.prisma.productVariant.findMany({
    where: { accountId: ctx.scope.accountId, id: { in: sold.map(([id]) => id) } },
    select: { id: true, color: true, size: true, product: { select: { id: true, name: true, category: { select: { name: true } } } } },
  })
  const byId = new Map(info.map((variant) => [variant.id, variant]))
  const products = new Map<string, { id: string; name: string; category: string; quantity: number; sales: Money; cost: Money; variants: { id: string; label: string; quantity: number; sales: Money; cost: Money }[] }>()
  for (const [variantId, value] of sold) {
    const variant = byId.get(variantId)
    if (!variant) continue
    const product = products.get(variant.product.id) ?? { id: variant.product.id, name: variant.product.name, category: variant.product.category.name, quantity: 0, sales: new Prisma.Decimal(0), cost: new Prisma.Decimal(0), variants: [] }
    product.quantity += value.quantity
    product.sales = product.sales.add(value.salesTotal)
    product.cost = product.cost.add(value.costTotal)
    product.variants.push({ id: variantId, label: variantLabel(variant.color, variant.size), quantity: value.quantity, sales: value.salesTotal, cost: value.costTotal })
    products.set(product.id, product)
  }
  return [...products.values()]
    .map((product) => ({
      id: product.id, name: product.name, category: product.category, quantity: product.quantity,
      salesTotal: fmt(product.sales), profitTotal: ownerMoney(ctx, product.sales.sub(product.cost)),
      variants: product.variants.sort((a, b) => b.quantity - a.quantity).map((variant) => ({
        id: variant.id, label: variant.label, quantity: variant.quantity, salesTotal: fmt(variant.sales), profitTotal: ownerMoney(ctx, variant.sales.sub(variant.cost)),
      })),
    }))
    .sort((a, b) => Number(b.salesTotal) - Number(a.salesTotal))
}

/**
 * Expected sales for a day: the average of the last 4 FINISHED days with the same weekday (never a future
 * day). `history` must cover today−28 … today−1. A closed day is expected to sell nothing.
 */
export function forecastFor(date: string, today: string, history: RangeTotals): Money {
  if (history.closed.has(date)) return new Prisma.Decimal(0)
  let base = shiftDate(date, -7)
  while (base >= today) base = shiftDate(base, -7)
  let sum = new Prisma.Decimal(0)
  for (let week = 0; week < 4; week += 1) sum = sum.add(history.days.get(shiftDate(base, -7 * week))?.salesTotal ?? 0)
  return sum.div(4).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

export async function forecastHistory(ctx: ReportContext): Promise<RangeTotals> {
  return rangeTotals(ctx.prisma, ctx.scope, shiftDate(ctx.now.date, -28), shiftDate(ctx.now.date, -1), { today: ctx.now.date, breakdowns: false })
}

/** The sales target for the period: the store's own target, or for "all" the account target or the sum of store targets. */
export async function targetFor(ctx: ReportContext, period: 'WEEK' | 'MONTH', periodStart: string): Promise<{ salesTotal: string } | null> {
  const rows = await ctx.prisma.$queryRaw<{ store: string | null; amount: string }[]>(Prisma.sql`
    SELECT "storeId"::text AS store, "amount"::text AS amount FROM "SalesTarget"
    WHERE "accountId" = ${ctx.scope.accountId}::uuid AND "period" = ${period}::"SalesTargetPeriod" AND "periodStart" = ${periodStart}::date`)
  const all = ctx.storeKey === 'all'
  const accountTarget = rows.find((row) => row.store === null)
  if (all && accountTarget) return { salesTotal: fmt(new Prisma.Decimal(accountTarget.amount)) }
  const storeRows = rows.filter((row) => row.store !== null && ctx.scope.storeIds.includes(row.store))
  if (!storeRows.length) return all || ctx.scope.storeIds.length !== 1 || !accountTarget || ctx.account.stores.length !== 1 ? null : { salesTotal: fmt(new Prisma.Decimal(accountTarget.amount)) }
  return { salesTotal: fmt(storeRows.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0))) }
}

export const DEAD_STOCK_BASIS_DAYS = 30

/** Stock right now (current stock × current unit cost) with what each variant sold in the last 30 finished days. */
export async function stockNow(ctx: ReportContext, maxSold: number) {
  const sold = await rangeTotals(ctx.prisma, ctx.scope, shiftDate(ctx.now.date, -DEAD_STOCK_BASIS_DAYS), shiftDate(ctx.now.date, -1), { today: ctx.now.date })
  const variants = await ctx.prisma.productVariant.findMany({
    where: { accountId: ctx.scope.accountId, isActive: true, currentStock: { gt: 0 }, product: { isActive: true } },
    select: { id: true, color: true, size: true, currentStock: true, lastPurchaseCost: true, product: { select: { name: true } } },
  })
  let stockUnits = 0
  let stockValue = new Prisma.Decimal(0)
  const slow = []
  for (const variant of variants) {
    const value = (variant.lastPurchaseCost ?? new Prisma.Decimal(0)).mul(variant.currentStock).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    stockUnits += variant.currentStock
    stockValue = stockValue.add(value)
    const soldLastNDays = sold.variants.get(variant.id)?.quantity ?? 0
    if (soldLastNDays <= maxSold) slow.push({ variant, soldLastNDays, value })
  }
  const lastSold = slow.length ? await ctx.prisma.$queryRaw<{ v: string; d: string }[]>(Prisma.sql`
    SELECT si."variantId"::text AS v, MAX((s."createdAt" AT TIME ZONE ${ctx.scope.timezone})::date)::text AS d
    FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" AND s."accountId" = si."accountId"
    WHERE si."accountId" = ${ctx.scope.accountId}::uuid AND s."status" = 'COMPLETED' AND si."variantId" = ANY(${slow.map((row) => row.variant.id)}::uuid[])
    GROUP BY si."variantId"`) : []
  const lastSoldBy = new Map(lastSold.map((row) => [row.v, row.d]))
  const items = slow
    .map(({ variant, soldLastNDays, value }) => ({
      id: variant.id, name: variant.product.name, variant: variantLabel(variant.color, variant.size), stock: variant.currentStock,
      soldLastNDays, lastSoldDate: lastSoldBy.get(variant.id) ?? null, stockValue: ownerMoney(ctx, value), _value: value,
    }))
    .sort((a, b) => Number(b._value.sub(a._value)) || b.stock - a.stock)
  const deadValue = items.filter((item) => item.soldLastNDays === 0).reduce((sum, item) => sum.add(item._value), new Prisma.Decimal(0))
  return {
    stockUnits,
    stockValue: ownerMoney(ctx, stockValue),
    deadStockValue: ownerMoney(ctx, deadValue),
    items: items.map(({ _value, ...item }) => item),
  }
}
