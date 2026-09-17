import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { encodeHistoryCursor, encodeReconciliationCursor } from './inventory.schemas.js'
import type { HistoryQuery, InventoryAuditDependencies, MovementView, ReconciliationQuery, ReconciliationView } from './inventory.types.js'

const movementSelect = {
  id: true, type: true, quantityChange: true, createdAt: true, unitCost: true, note: true,
  variant: { select: {
    id: true, sku: true, color: true, size: true,
    product: { select: { id: true, name: true } },
  } },
  performedBy: { select: { firstName: true, lastName: true, employeeCode: true } },
} as const
const variantSelect = {
  id: true, sku: true, color: true, size: true, currentStock: true,
  product: { select: { id: true, name: true } },
} as const
type Movement = Prisma.InventoryMovementGetPayload<{ select: typeof movementSelect }>
type Variant = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>
type ReconciliationSqlRow = {
  id: string; sku: string; color: string | null; size: string | null
  currentStock: number; productId: string; productName: string
  ledgerStock: bigint; difference: bigint
}

function safeNumber(value: number | bigint): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new HttpError(503, 'INVENTORY_AUDIT_UNAVAILABLE', 'Inventory audit value exceeds the safe display range')
  return number
}

function reconciliationView(variant: Variant, ledgerStock: number): ReconciliationView {
  const difference = safeNumber(variant.currentStock - ledgerStock)
  return {
    variant: { id: variant.id, sku: variant.sku, color: variant.color, size: variant.size, product: variant.product },
    storedStock: variant.currentStock, ledgerStock, difference,
    status: difference === 0 ? 'RECONCILED' : 'MISMATCH',
  }
}

function sqlReconciliationView(row: ReconciliationSqlRow): ReconciliationView {
  const difference = safeNumber(row.difference)
  return {
    variant: { id: row.id, sku: row.sku, color: row.color, size: row.size, product: { id: row.productId, name: row.productName } },
    storedStock: row.currentStock, ledgerStock: safeNumber(row.ledgerStock), difference,
    status: difference === 0 ? 'RECONCILED' : 'MISMATCH',
  }
}

function movementView(movement: Movement, role: UserRole): MovementView {
  return {
    id: movement.id, type: movement.type, quantityChange: movement.quantityChange, createdAt: movement.createdAt,
    variant: { id: movement.variant.id, sku: movement.variant.sku, color: movement.variant.color, size: movement.variant.size },
    product: movement.variant.product,
    performer: {
      name: [movement.performedBy.firstName, movement.performedBy.lastName].filter(Boolean).join(' '),
      employeeCode: movement.performedBy.employeeCode,
    },
    ...(role === UserRole.OWNER ? { unitCost: movement.unitCost?.toFixed(4) ?? null, note: movement.note } : {}),
  }
}

export function createInventoryAuditDependencies(prisma: PrismaClient): InventoryAuditDependencies {
  async function verifyOwnership(accountId: string, productId?: string, variantId?: string): Promise<void> {
    if (productId) {
      const product = await prisma.product.findUnique({ where: { id_accountId: { id: productId, accountId } }, select: { id: true } })
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product does not exist')
    }
    if (variantId) {
      const variant = productId
        ? await prisma.productVariant.findUnique({ where: { id_productId_accountId: { id: variantId, productId, accountId } }, select: { id: true } })
        : await prisma.productVariant.findUnique({ where: { id_accountId: { id: variantId, accountId } }, select: { id: true } })
      if (!variant) throw new HttpError(404, 'VARIANT_NOT_FOUND', 'Variant does not exist')
    }
  }

  async function listMovements(accountId: string, role: UserRole, query: HistoryQuery) {
    await verifyOwnership(accountId, query.productId, query.variantId)
    const where: Prisma.InventoryMovementWhereInput = {
      accountId,
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.productId ? { variant: { productId: query.productId, accountId } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(query.cursor ? { OR: [
        { createdAt: { lt: query.cursor.createdAt } },
        { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
      ] } : {}),
    }
    const rows = await prisma.inventoryMovement.findMany({
      where, select: movementSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return {
      movements: page.map((row) => movementView(row, role)),
      nextCursor: rows.length > query.limit && last ? encodeHistoryCursor(last.createdAt, last.id) : null,
    }
  }

  async function reconcile(accountId: string, query: ReconciliationQuery) {
    await verifyOwnership(accountId, query.productId, query.variantId)
    if (query.status) {
      // A status filter depends on the ledger sum. Aggregate in PostgreSQL and
      // filter before LIMIT, so no matching Variant is silently omitted.
      const productFilter = query.productId ? Prisma.sql`AND v."productId" = ${query.productId}::uuid` : Prisma.empty
      const variantFilter = query.variantId ? Prisma.sql`AND v."id" = ${query.variantId}::uuid` : Prisma.empty
      const cursorFilter = query.cursor ? Prisma.sql`AND v."sku" > ${query.cursor}` : Prisma.empty
      const statusFilter = query.status === 'MISMATCH' ? Prisma.sql`"difference" <> 0` : Prisma.sql`"difference" = 0`
      const rows = await prisma.$queryRaw<ReconciliationSqlRow[]>(Prisma.sql`
        WITH candidate AS (
          SELECT v."id", v."sku", v."color", v."size", v."currentStock", p."id" AS "productId", p."name" AS "productName"
          FROM "ProductVariant" v
          JOIN "Product" p ON p."id" = v."productId" AND p."accountId" = v."accountId"
          WHERE v."accountId" = ${accountId}::uuid ${productFilter} ${variantFilter} ${cursorFilter}
        ), ledger AS (
          SELECT m."variantId", SUM(m."quantityChange")::bigint AS "ledgerStock"
          FROM "InventoryMovement" m
          JOIN candidate c ON c."id" = m."variantId"
          WHERE m."accountId" = ${accountId}::uuid
          GROUP BY m."variantId"
        ), computed AS (
          SELECT c.*, COALESCE(l."ledgerStock", 0)::bigint AS "ledgerStock",
            c."currentStock"::bigint - COALESCE(l."ledgerStock", 0)::bigint AS "difference"
          FROM candidate c LEFT JOIN ledger l ON l."variantId" = c."id"
        )
        SELECT * FROM computed WHERE ${statusFilter} ORDER BY "sku" ASC LIMIT ${query.limit + 1}
      `)
      const page = rows.slice(0, query.limit)
      return {
        variants: page.map(sqlReconciliationView),
        nextCursor: rows.length > query.limit && page.length ? encodeReconciliationCursor(page[page.length - 1].sku) : null,
      }
    }

    // Without a computed-status filter, page tenant Variants first, then sum
    // only that page's movement history via the (accountId, variantId) index.
    return prisma.$transaction(async (transaction) => {
      const rows = await transaction.productVariant.findMany({
        where: {
          accountId,
          ...(query.productId ? { productId: query.productId } : {}),
          ...(query.variantId ? { id: query.variantId } : {}),
          ...(query.cursor ? { sku: { gt: query.cursor } } : {}),
        },
        select: variantSelect, orderBy: { sku: 'asc' }, take: query.limit + 1,
      })
      const page = rows.slice(0, query.limit)
      const totals = page.length ? await transaction.inventoryMovement.groupBy({
        by: ['variantId'], where: { accountId, variantId: { in: page.map((row) => row.id) } },
        _sum: { quantityChange: true },
      }) : []
      const ledgerByVariant = new Map(totals.map((total) => [total.variantId, safeNumber(total._sum.quantityChange ?? 0)]))
      return {
        variants: page.map((row) => reconciliationView(row, ledgerByVariant.get(row.id) ?? 0)),
        nextCursor: rows.length > query.limit && page.length ? encodeReconciliationCursor(page[page.length - 1].sku) : null,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  return { listMovements, reconcile }
}
