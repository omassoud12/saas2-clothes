// Product cost: "bought 12 for $96 → $8 each".
//   POST /api/products/:productId/cost-entries   (EDIT_PRODUCT_COST; addToStock also needs INVENTORY)
//   GET  /api/products/:productId/cost-history   (EDIT_PRODUCT_COST or VIEW_COST_PROFIT)
//   GET  /api/products/missing-cost              (EDIT_PRODUCT_COST or VIEW_COST_PROFIT)
// The server computes the unit cost, updates the chosen variants' current cost and writes the CostEntry and
// its audit row in ONE transaction; stock is added through the existing stock-receipt flow. Old sales keep
// the cost snapshot they were sold with (SaleItem.unitCostAtSale never changes).
import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import type { AuthContext } from '../auth/auth.types.js'
import { hasPermission } from '../access/permissions.js'
import { writeAudit } from '../audit/audit.js'
import { loadAccountContext, resolveStoreIds } from '../business/business-stores.js'
import { shiftDate, shopNow } from '../business/business-dates.js'
import { variantLabel } from '../business/report-common.js'
import type { ReceiptDependencies } from '../receipts/receipt.service.js'

const MONEY = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_QUANTITY = 100_000

function invalid(message: string): never {
  throw new HttpError(422, 'VALIDATION_ERROR', message)
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') invalid(`${field} must be text`)
  const text = value.normalize('NFC').trim()
  if ([...text].length > max) invalid(`${field} must be ${max} characters or fewer`)
  return text || null
}

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`${field} is not valid`)
  return value.toLowerCase()
}

/** totalCost / quantity, rounded half up to 2 decimals. */
export function unitCostOf(totalCost: string | number | Prisma.Decimal, quantity: number): Prisma.Decimal {
  return new Prisma.Decimal(totalCost).div(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/** Split `quantity` pieces over the variants as evenly as possible (the first ones get the extra pieces). */
export function splitEvenly(quantity: number, variantIds: readonly string[]): Map<string, number> {
  const base = Math.floor(quantity / variantIds.length)
  const extra = quantity % variantIds.length
  return new Map(variantIds.map((id, index) => [id, base + (index < extra ? 1 : 0)]))
}

export interface CostEntryInput {
  readonly variantIds: string[] | null
  readonly quantity: number
  readonly totalCost: string
  readonly supplierName: string | null
  readonly note: string | null
  readonly addToStock: { readonly storeId: string | null; readonly perVariant: Map<string, number> | null } | null
}

export function parseCostEntryInput(body: unknown): CostEntryInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('The cost entry must be an object')
  const input = body as Record<string, unknown>
  const allowed = ['variantIds', 'quantity', 'totalCost', 'supplierName', 'note', 'addToStock']
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid('Unsupported cost entry fields')
  const quantity = input.quantity
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) invalid(`quantity must be a whole number from 1 to ${MAX_QUANTITY}`)
  if (typeof input.totalCost !== 'string' || !MONEY.test(input.totalCost) || !new Prisma.Decimal(input.totalCost).gt(0)) invalid('totalCost must be an amount above 0 with at most 2 decimals')
  if (unitCostOf(input.totalCost, quantity).lt(new Prisma.Decimal('0.01'))) invalid('The cost of one piece must be at least 0.01')
  let variantIds: string[] | null = null
  if (input.variantIds !== undefined && input.variantIds !== null) {
    if (!Array.isArray(input.variantIds) || input.variantIds.length > 200) invalid('variantIds must be a list')
    variantIds = [...new Set(input.variantIds.map((id) => parseUuid(id, 'variantIds')))]
    if (!variantIds.length) variantIds = null
  }
  let addToStock: CostEntryInput['addToStock'] = null
  if (input.addToStock !== undefined && input.addToStock !== null) {
    const stock = input.addToStock as Record<string, unknown>
    if (typeof stock !== 'object' || Array.isArray(stock) || Object.keys(stock).some((key) => !['storeId', 'perVariant'].includes(key))) invalid('addToStock must be { storeId, perVariant? }')
    const storeId = stock.storeId === undefined || stock.storeId === null ? null : parseUuid(stock.storeId, 'addToStock.storeId')
    let perVariant: Map<string, number> | null = null
    if (stock.perVariant !== undefined && stock.perVariant !== null) {
      if (!Array.isArray(stock.perVariant) || !stock.perVariant.length || stock.perVariant.length > 200) invalid('addToStock.perVariant must be a list')
      perVariant = new Map()
      for (const row of stock.perVariant as unknown[]) {
        const item = row as Record<string, unknown>
        if (!item || typeof item !== 'object') invalid('addToStock.perVariant is not valid')
        const id = parseUuid(item.variantId, 'addToStock.perVariant.variantId')
        if (typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > MAX_QUANTITY || perVariant.has(id)) invalid('addToStock.perVariant is not valid')
        perVariant.set(id, item.quantity)
      }
      const sum = [...perVariant.values()].reduce((total, value) => total + value, 0)
      if (sum !== quantity) invalid('The pieces per variant must add up to quantity')
    }
    addToStock = { storeId, perVariant }
  }
  return {
    variantIds, quantity, totalCost: new Prisma.Decimal(input.totalCost).toFixed(2), addToStock,
    supplierName: optionalText(input.supplierName, 'supplierName', 200),
    note: optionalText(input.note, 'note', 1000),
  }
}

function member(auth: AuthContext | undefined): { accountId: string; userId: string } {
  if (!auth?.accountId) throw new HttpError(403, 'TENANT_REQUIRED', 'An active store account is required')
  return { accountId: auth.accountId, userId: auth.userId }
}

const entrySelect = {
  id: true, quantity: true, totalCost: true, unitCost: true, supplierName: true, note: true, addedToStock: true, storeId: true,
  variantId: true, variantIds: true, createdAt: true, createdBy: { select: { firstName: true, lastName: true } },
} as const
type EntryRow = Prisma.CostEntryGetPayload<{ select: typeof entrySelect }>

/** productVariantIds: the active variants of the product, to tell whether the entry covered all of them. */
function entryView(row: EntryRow, productVariantIds: readonly string[]) {
  return {
    id: row.id, createdAt: row.createdAt.toISOString(), quantity: row.quantity, totalCost: row.totalCost.toFixed(2), unitCost: row.unitCost.toFixed(2),
    supplierName: row.supplierName, note: row.note, addedToStock: row.addedToStock, storeId: row.storeId,
    appliesTo: row.variantIds.length === 1 ? 'VARIANT' as const : 'VARIANTS' as const,
    allVariants: row.variantId === null && productVariantIds.length > 0 && productVariantIds.every((id) => row.variantIds.includes(id)),
    variantIds: row.variantIds, createdBy: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
  }
}

export interface CostDependencies {
  addCostEntry(auth: AuthContext | undefined, productId: string, body: unknown, ip?: string): Promise<object>
  costHistory(auth: AuthContext | undefined, productId: string, query: Record<string, unknown>): Promise<object>
  missingCost(auth: AuthContext | undefined, query: Record<string, unknown>): Promise<object>
}

export function createCostDependencies(prisma: PrismaClient, receipts: Pick<ReceiptDependencies, 'receiveWithin'>, hooks: { afterChange?: (accountId: string) => void; clock?: () => Date } = {}): CostDependencies {
  return {
    async addCostEntry(auth, productIdParam, body, ip) {
      const { accountId, userId } = member(auth)
      const productId = parseUuid(productIdParam, 'productId')
      const input = parseCostEntryInput(body)
      if (input.addToStock && !hasPermission(auth, 'INVENTORY')) throw new HttpError(403, 'PERMISSION_FORBIDDEN', 'Adding stock needs access to inventory')
      if (input.addToStock?.storeId) {
        // A store must belong to this account (403 otherwise).
        resolveStoreIds(await loadAccountContext(prisma, accountId), input.addToStock.storeId)
      }
      const unitCost = unitCostOf(input.totalCost, input.quantity)
      const result = await prisma.$transaction(async (tx) => {
        const product = await tx.$queryRaw<{ isActive: boolean }[]>(Prisma.sql`
          SELECT "isActive" FROM "Product" WHERE "id" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`)
        if (!product.length) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product is unavailable')
        const variants = await tx.productVariant.findMany({
          where: { accountId, productId, isActive: true },
          select: { id: true, color: true, size: true, lastPurchaseCost: true },
          orderBy: { id: 'asc' },
        })
        const chosen = input.variantIds
          ? input.variantIds.map((id) => variants.find((variant) => variant.id === id) ?? (() => { throw new HttpError(404, 'VARIANT_NOT_FOUND', 'A chosen variant is not part of this product') })())
          : variants
        if (!chosen.length) throw new HttpError(409, 'PRODUCT_HAS_NO_VARIANTS', 'The product has no active variant')
        const chosenIds = chosen.map((variant) => variant.id).sort()
        const now = new Date()
        await tx.productVariant.updateMany({
          where: { accountId, productId, id: { in: chosenIds } },
          data: { lastPurchaseCost: unitCost, costUpdatedAt: now },
        })
        let receipt: object | null = null
        if (input.addToStock) {
          const pieces = input.addToStock.perVariant ?? splitEvenly(input.quantity, chosenIds)
          for (const id of pieces.keys()) if (!chosenIds.includes(id)) throw new HttpError(422, 'VALIDATION_ERROR', 'Stock can only be added to the chosen variants')
          const items = [...pieces.entries()].filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })).sort((a, b) => a.id.localeCompare(b.id))
          receipt = await receipts.receiveWithin(tx, accountId, userId, productId, randomUUID(), { unitCost: unitCost.toFixed(4), items })
        }
        const entry = await tx.costEntry.create({
          data: {
            accountId, productId, variantId: input.variantIds && chosenIds.length === 1 ? chosenIds[0]! : null, variantIds: chosenIds,
            quantity: input.quantity, totalCost: input.totalCost, unitCost, supplierName: input.supplierName, note: input.note,
            addedToStock: input.addToStock !== null, storeId: input.addToStock?.storeId ?? null, createdById: userId,
          },
          select: entrySelect,
        })
        await writeAudit(tx, {
          accountId, actorId: userId, action: 'product.cost.set', targetType: 'Product', targetId: productId, ip,
          before: { variants: chosen.map((variant) => ({ id: variant.id, unitCost: variant.lastPurchaseCost?.toFixed(2) ?? null })) },
          after: { unitCost: unitCost.toFixed(2), variantIds: chosenIds, quantity: input.quantity, totalCost: input.totalCost, addedToStock: input.addToStock !== null, costEntryId: entry.id },
        })
        return { entry: entryView(entry, variants.map((variant) => variant.id)), variantsUpdated: chosenIds.length, receipt }
      }, { timeout: 15_000 })
      hooks.afterChange?.(accountId)
      return { unitCost: unitCost.toFixed(2), variantsUpdated: result.variantsUpdated, entry: result.entry, stockReceipt: result.receipt }
    },

    async costHistory(auth, productIdParam, query) {
      const { accountId } = member(auth)
      const productId = parseUuid(productIdParam, 'productId')
      const limit = query.limit === undefined ? 20 : Number(query.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid('limit must be 1 to 50')
      let cursor: { createdAt: Date; id: string } | null = null
      if (query.cursor !== undefined && query.cursor !== '') {
        try {
          const raw = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString('utf8')) as { c: string; i: string }
          if (typeof raw.c !== 'string' || Number.isNaN(Date.parse(raw.c)) || !UUID.test(raw.i)) throw new Error('bad')
          cursor = { createdAt: new Date(raw.c), id: raw.i }
        } catch { invalid('cursor is not valid') }
      }
      const product = await prisma.product.findFirst({
        where: { id: productId, accountId },
        select: { id: true, name: true, variants: { where: { isActive: true }, select: { id: true, sku: true, barcode: true, color: true, size: true, lastPurchaseCost: true, costUpdatedAt: true, currentStock: true }, orderBy: [{ color: 'asc' }, { size: 'asc' }] } },
      })
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product is unavailable')
      const rows = await prisma.costEntry.findMany({
        where: {
          accountId, productId,
          ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
        },
        select: entrySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      })
      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return {
        product: {
          id: product.id, name: product.name,
          variants: product.variants.map((variant) => ({
            id: variant.id, label: variantLabel(variant.color, variant.size), sku: variant.sku, barcode: variant.barcode, currentStock: variant.currentStock,
            unitCost: variant.lastPurchaseCost ? variant.lastPurchaseCost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : null,
            costUpdatedAt: variant.costUpdatedAt?.toISOString() ?? null,
          })),
        },
        items: page.map((row) => entryView(row, product.variants.map((variant) => variant.id))),
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ c: last.createdAt.toISOString(), i: last.id })).toString('base64url') : null,
      }
    },

    async missingCost(auth, query) {
      const { accountId } = member(auth)
      const account = await loadAccountContext(prisma, accountId)
      resolveStoreIds(account, query.storeId)
      const today = shopNow(account.timezone, hooks.clock?.() ?? new Date()).date
      const since = shiftDate(today, -30)
      // Active variants with no current cost, with what each sold without a cost in the last 30 days.
      const rows = await prisma.$queryRaw<{ product_id: string; product_name: string; variant_id: string; color: string | null; size: string | null; stock: number; sold: string | null; pieces: bigint | null }[]>(Prisma.sql`
        WITH missing AS (
          SELECT v."id", v."productId", v."color", v."size", v."currentStock"
          FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId" AND p."accountId" = v."accountId"
          WHERE v."accountId" = ${accountId}::uuid AND v."isActive" AND p."isActive" AND v."lastPurchaseCost" IS NULL
        ), sold AS (
          SELECT si."variantId", SUM(si."lineTotal") AS total, SUM(si."quantity") AS pieces
          FROM "Sale" s JOIN "SaleItem" si ON si."saleId" = s."id" AND si."accountId" = s."accountId"
          WHERE s."accountId" = ${accountId}::uuid AND s."status" = 'COMPLETED'
            AND s."createdAt" >= (${since}::date::timestamp AT TIME ZONE ${account.timezone})
            AND si."unitCostAtSale" IS NULL AND si."variantId" IN (SELECT "id" FROM missing)
          GROUP BY si."variantId"
        )
        SELECT m."productId"::text AS product_id, p."name" AS product_name, m."id"::text AS variant_id, m."color", m."size", m."currentStock" AS stock,
               sold.total::text AS sold, sold.pieces AS pieces
        FROM missing m JOIN "Product" p ON p."id" = m."productId" LEFT JOIN sold ON sold."variantId" = m."id"`)
      const products = new Map<string, { id: string; name: string; salesWithoutCost: Prisma.Decimal; piecesWithoutCost: number; stock: number; variants: { id: string; label: string; currentStock: number }[] }>()
      for (const row of rows) {
        const product = products.get(row.product_id) ?? { id: row.product_id, name: row.product_name, salesWithoutCost: new Prisma.Decimal(0), piecesWithoutCost: 0, stock: 0, variants: [] }
        product.salesWithoutCost = product.salesWithoutCost.add(row.sold ?? 0)
        product.piecesWithoutCost += Number(row.pieces ?? 0)
        product.stock += row.stock
        product.variants.push({ id: row.variant_id, label: variantLabel(row.color, row.size), currentStock: row.stock })
        products.set(row.product_id, product)
      }
      const items = [...products.values()]
        .sort((a, b) => b.salesWithoutCost.cmp(a.salesWithoutCost) || b.stock - a.stock || a.name.localeCompare(b.name))
        .slice(0, 100)
        .map((product) => ({ ...product, salesWithoutCost: product.salesWithoutCost.toFixed(2) }))
      return { since, productCount: products.size, items }
    },
  }
}
