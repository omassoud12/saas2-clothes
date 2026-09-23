import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { InventoryMovementType, SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { canonicalSaleItems, encodeSaleCursor, saleFingerprint } from './sale.schemas.js'
import type { SaleDependencies, SaleDetailView, SaleHistoryQuery, SaleInput, SaleView, SaleVoidInput, SaleVoidView } from './sale.types.js'

const saleIdempotencyIndex = 'Sale_accountId_idempotencyKey_key'
const maxMoney = new Prisma.Decimal('9999999999999999.99')
const maxStock = 2_147_483_647
const persistedSaleSelect = {
  id: true,
  status: true,
  currency: true,
  subtotal: true,
  totalAmount: true,
  createdAt: true,
  sellerNameAtSale: true,
  sellerCodeAtSale: true,
  requestFingerprint: true,
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      productNameAtSale: true,
      categoryNameAtSale: true,
      skuAtSale: true,
      colorAtSale: true,
      sizeAtSale: true,
      quantity: true,
      unitSoldPrice: true,
      lineTotal: true,
    },
  },
} as const
const historySaleSelect = {
  id: true, status: true, currency: true, subtotal: true, totalAmount: true, createdAt: true,
  sellerNameAtSale: true, sellerCodeAtSale: true,
  _count: { select: { items: true } },
} as const
const detailSaleSelect = {
  id: true, status: true, currency: true, subtotal: true, totalAmount: true, createdAt: true,
  sellerNameAtSale: true, sellerCodeAtSale: true,
  voidedAt: true, voidedByName: true, voidedByCode: true, voidReason: true,
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true, productId: true, variantId: true,
      productNameAtSale: true, categoryNameAtSale: true, skuAtSale: true,
      colorAtSale: true, sizeAtSale: true, quantity: true,
      unitSoldPrice: true, unitCostAtSale: true, lineTotal: true,
    },
  },
} as const
const voidSaleSelect = {
  id: true, status: true, currency: true, subtotal: true, totalAmount: true, createdAt: true,
  sellerNameAtSale: true, sellerCodeAtSale: true,
  voidedAt: true, voidedById: true, voidedByName: true, voidedByCode: true, voidReason: true,
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true, productId: true, variantId: true,
      productNameAtSale: true, categoryNameAtSale: true, skuAtSale: true,
      colorAtSale: true, sizeAtSale: true, quantity: true,
      unitSoldPrice: true, lineTotal: true,
    },
  },
} as const
const voidItemSelect = {
  id: true, productId: true, variantId: true, quantity: true, unitCostAtSale: true,
} as const

type PersistedSale = Prisma.SaleGetPayload<{ select: typeof persistedSaleSelect }>
type HistorySale = Prisma.SaleGetPayload<{ select: typeof historySaleSelect }>
type DetailSale = Prisma.SaleGetPayload<{ select: typeof detailSaleSelect }>
type DetailReturnAggregate = {
  readonly saleItemId: string
  readonly _sum: { readonly quantity: number | null; readonly refundAmount: Prisma.Decimal | null }
}
type PersistedVoidSale = Prisma.SaleGetPayload<{ select: typeof voidSaleSelect }>
type VoidSaleItem = Prisma.SaleItemGetPayload<{ select: typeof voidItemSelect }>
type SaleReader = Pick<PrismaClient, 'sale'>
type AdvisoryVariant = { id: string; productId: string }
type LockedAccount = { id: string; baseCurrency: string }
type LockedSeller = {
  id: string
  sellerName: string
  employeeCode: string | null
  role: UserRole
  isActive: boolean
}
type LockedProduct = { id: string; categoryId: string; name: string; isActive: boolean }
type LockedVariant = {
  id: string
  productId: string
  sku: string
  color: string | null
  size: string | null
  sellingPrice: Prisma.Decimal | string | null
  lastPurchaseCost: Prisma.Decimal | string | null
  currentStock: number
  isActive: boolean
}
type LockedVoidActor = {
  id: string
  voidedByName: string
  employeeCode: string | null
  role: UserRole
  isActive: boolean
}
type LockedVoidSale = {
  id: string
  status: SaleStatus
  voidedById: string | null
  voidReason: string | null
}
type LockedVoidVariant = { id: string; currentStock: number }

function unavailable(): HttpError {
  return new HttpError(404, 'SALE_VARIANT_UNAVAILABLE', 'A requested Variant is unavailable')
}

function toView(sale: PersistedSale, idempotentReplay: boolean): SaleView {
  return {
    sale: {
      id: sale.id,
      status: sale.status,
      currency: sale.currency,
      subtotal: sale.subtotal.toFixed(2),
      totalAmount: sale.totalAmount.toFixed(2),
      createdAt: sale.createdAt,
      seller: { name: sale.sellerNameAtSale, employeeCode: sale.sellerCodeAtSale },
      items: sale.items.map((item) => ({
        id: item.id,
        productName: item.productNameAtSale,
        categoryName: item.categoryNameAtSale,
        sku: item.skuAtSale,
        color: item.colorAtSale,
        size: item.sizeAtSale,
        quantity: item.quantity,
        unitSoldPrice: item.unitSoldPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
    },
    idempotentReplay,
  }
}

function assertFingerprint(sale: PersistedSale, fingerprint: string): void {
  if (sale.requestFingerprint !== fingerprint) {
    throw new HttpError(409, 'SALE_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different Sale')
  }
}

function isSaleIdempotencyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  return target === saleIdempotencyIndex || error.meta?.constraint === saleIdempotencyIndex ||
    (Array.isArray(target) && target.length === 2 && target[0] === 'accountId' && target[1] === 'idempotencyKey')
}

function decimal(value: Prisma.Decimal | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)
}

function safeUnits(value: number | bigint): number {
  const units = Number(value)
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new HttpError(503, 'SALES_HISTORY_UNAVAILABLE', 'Sale history value exceeds the safe display range')
  }
  return units
}

function detailView(
  sale: DetailSale,
  role: UserRole,
  returnCount: number,
  returnAggregates: readonly DetailReturnAggregate[],
): SaleDetailView {
  let totalCOGS = new Prisma.Decimal(0)
  let totalReturnedUnits = 0
  let totalReturnedAmount = new Prisma.Decimal(0)
  const returnedBySaleItem = new Map<string, number>()
  for (const aggregate of returnAggregates) {
    const returnedQuantity = safeUnits(aggregate._sum.quantity ?? 0)
    returnedBySaleItem.set(aggregate.saleItemId, returnedQuantity)
    totalReturnedUnits = safeUnits(totalReturnedUnits + returnedQuantity)
    totalReturnedAmount = totalReturnedAmount.add(aggregate._sum.refundAmount ?? 0)
  }
  const items = sale.items.map((item) => {
    const returnedQuantity = returnedBySaleItem.get(item.id) ?? 0
    const base = {
      id: item.id, productId: item.productId, variantId: item.variantId,
      productName: item.productNameAtSale, categoryName: item.categoryNameAtSale,
      sku: item.skuAtSale, color: item.colorAtSale, size: item.sizeAtSale,
      quantity: item.quantity, unitSoldPrice: item.unitSoldPrice.toFixed(2), lineTotal: item.lineTotal.toFixed(2),
      returnedQuantity, remainingReturnableQuantity: item.quantity - returnedQuantity,
    }
    if (role !== UserRole.OWNER) return base
    const lineCost = item.unitCostAtSale.mul(item.quantity)
    totalCOGS = totalCOGS.add(lineCost)
    return {
      ...base,
      unitCostAtSale: item.unitCostAtSale.toFixed(4),
      lineCost: lineCost.toFixed(4),
      lineGrossProfit: item.lineTotal.sub(lineCost).toFixed(4),
    }
  })
  let voidInfo: SaleDetailView['sale']['void'] = null
  if (sale.status === SaleStatus.VOIDED) {
    if (!sale.voidedAt || !sale.voidedByName || !sale.voidReason) {
      throw new HttpError(500, 'SALE_HISTORY_INTEGRITY_ERROR', 'Sale void history is incomplete')
    }
    voidInfo = {
      voidedAt: sale.voidedAt,
      voidedByName: sale.voidedByName,
      voidedByCode: sale.voidedByCode,
      voidReason: sale.voidReason,
    }
  }
  return {
    sale: {
      id: sale.id, status: sale.status, currency: sale.currency,
      subtotal: sale.subtotal.toFixed(2), totalAmount: sale.totalAmount.toFixed(2), createdAt: sale.createdAt,
      seller: { name: sale.sellerNameAtSale, employeeCode: sale.sellerCodeAtSale },
      void: voidInfo,
      returnSummary: {
        hasReturns: returnCount > 0,
        returnCount,
        totalReturnedUnits,
        totalReturnedAmount: totalReturnedAmount.toFixed(2),
      },
      items,
      ...(role === UserRole.OWNER ? {
        economics: {
          totalCOGS: totalCOGS.toFixed(4),
          grossProfit: sale.totalAmount.sub(totalCOGS).toFixed(4),
        },
      } : {}),
    },
  }
}

function voidView(sale: PersistedVoidSale, idempotentReplay: boolean): SaleVoidView {
  if (sale.status !== SaleStatus.VOIDED || !sale.voidedAt || !sale.voidedById ||
      !sale.voidedByName || !sale.voidReason) {
    throw new HttpError(500, 'SALE_VOID_INTEGRITY_ERROR', 'Sale Void history is incomplete')
  }
  return {
    sale: {
      id: sale.id,
      status: SaleStatus.VOIDED,
      currency: sale.currency,
      subtotal: sale.subtotal.toFixed(2),
      totalAmount: sale.totalAmount.toFixed(2),
      createdAt: sale.createdAt,
      seller: { name: sale.sellerNameAtSale, employeeCode: sale.sellerCodeAtSale },
      void: {
        voidedAt: sale.voidedAt,
        voidedByName: sale.voidedByName,
        voidedByCode: sale.voidedByCode,
        reason: sale.voidReason,
      },
      items: sale.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productNameAtSale,
        categoryName: item.categoryNameAtSale,
        sku: item.skuAtSale,
        color: item.colorAtSale,
        size: item.sizeAtSale,
        quantity: item.quantity,
        unitSoldPrice: item.unitSoldPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
    },
    idempotentReplay,
  }
}

export function createSaleDependencies(prisma: PrismaClient): SaleDependencies {
  async function findSale(db: SaleReader, accountId: string, idempotencyKey: string): Promise<PersistedSale | null> {
    return db.sale.findUnique({
      where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
      select: persistedSaleSelect,
    })
  }

  function replay(sale: PersistedSale, fingerprint: string): SaleView {
    assertFingerprint(sale, fingerprint)
    return toView(sale, true)
  }

  async function performSale(accountId: string, soldById: string, idempotencyKey: string, input: SaleInput): Promise<SaleView> {
    const items = canonicalSaleItems(input.items)
    const fingerprint = saleFingerprint(accountId, soldById, items)
    const existing = await findSale(prisma, accountId, idempotencyKey)
    if (existing) return replay(existing, fingerprint)

    const variantIds = items.map((item) => item.variantId)
    const advisory = await prisma.productVariant.findMany({
      where: { accountId, id: { in: variantIds } },
      select: { id: true, productId: true },
    }) as AdvisoryVariant[]
    if (advisory.length !== variantIds.length) throw unavailable()
    const productIds = [...new Set(advisory.map((variant) => variant.productId))].sort()

    try {
      return await prisma.$transaction(async (transaction) => {
        const concurrentExisting = await findSale(transaction, accountId, idempotencyKey)
        if (concurrentExisting) return replay(concurrentExisting, fingerprint)

        const accounts = await transaction.$queryRaw<LockedAccount[]>(
          Prisma.sql`SELECT "id", "baseCurrency" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
        )
        const account = accounts[0]
        if (!account || !/^[A-Z]{3}$/.test(account.baseCurrency)) {
          throw new HttpError(409, 'SALE_ACCOUNT_UNAVAILABLE', 'Sale Account is unavailable')
        }

        const sellers = await transaction.$queryRaw<LockedSeller[]>(
          Prisma.sql`SELECT "id", btrim(concat_ws(' ', "firstName", "lastName")) AS "sellerName", "employeeCode", "role", "isActive" FROM "User" WHERE "id" = ${soldById}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
        )
        const seller = sellers[0]
        if (!seller || !seller.isActive || (seller.role !== UserRole.OWNER && seller.role !== UserRole.WAREHOUSE)) {
          throw new HttpError(403, 'SALE_SELLER_UNAVAILABLE', 'Seller is not authorized to create Sales')
        }

        const lockedProducts = await transaction.$queryRaw<LockedProduct[]>(
          Prisma.sql`SELECT "id", "categoryId", "name", "isActive" FROM "Product" WHERE "accountId" = ${accountId}::uuid AND "id" IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
        )
        if (lockedProducts.length !== productIds.length) throw unavailable()
        const productById = new Map(lockedProducts.map((product) => [product.id, product]))
        if (lockedProducts.some((product) => !product.isActive)) {
          throw new HttpError(409, 'SALE_PRODUCT_INACTIVE', 'Every Product in a Sale must be active')
        }

        const categoryIds = [...new Set(lockedProducts.map((product) => product.categoryId))]
        const categories = await transaction.category.findMany({
          where: { accountId, id: { in: categoryIds } },
          select: { id: true, name: true },
        })
        if (categories.length !== categoryIds.length) throw unavailable()
        const categoryById = new Map(categories.map((category) => [category.id, category]))

        const lockedVariants = await transaction.$queryRaw<LockedVariant[]>(
          Prisma.sql`SELECT "id", "productId", "sku", "color", "size", "sellingPrice", "lastPurchaseCost", "currentStock", "isActive" FROM "ProductVariant" WHERE "accountId" = ${accountId}::uuid AND "id" IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
        )
        if (lockedVariants.length !== variantIds.length) throw unavailable()
        const variantById = new Map(lockedVariants.map((variant) => [variant.id, variant]))

        let subtotal = new Prisma.Decimal(0)
        const trustedLines = items.map((item) => {
          const variant = variantById.get(item.variantId)
          if (!variant) throw unavailable()
          const advisoryVariant = advisory.find((candidate) => candidate.id === item.variantId)
          if (!advisoryVariant || advisoryVariant.productId !== variant.productId) throw unavailable()
          const product = productById.get(variant.productId)
          if (!product) throw unavailable()
          const category = categoryById.get(product.categoryId)
          if (!category) throw unavailable()
          if (!variant.isActive) throw new HttpError(409, 'SALE_VARIANT_INACTIVE', 'Every Variant in a Sale must be active')
          if (variant.lastPurchaseCost === null) {
            throw new HttpError(409, 'SALE_COST_UNAVAILABLE', 'A requested Variant has no purchase cost')
          }
          const unitSoldPrice = new Prisma.Decimal(item.unitSoldPrice)
          if (seller.role === UserRole.WAREHOUSE) {
            if (variant.sellingPrice === null) {
              throw new HttpError(409, 'SALE_VARIANT_NOT_PRICED', 'A requested Variant has no catalog price')
            }
            if (!decimal(variant.sellingPrice).equals(unitSoldPrice)) {
              throw new HttpError(409, 'SALE_PRICE_CHANGED', 'A requested Variant price has changed')
            }
          }
          if (variant.currentStock < item.quantity) {
            throw new HttpError(409, 'INSUFFICIENT_STOCK', 'A requested Variant has insufficient stock')
          }
          const lineTotal = unitSoldPrice.mul(item.quantity)
          if (lineTotal.decimalPlaces() > 2 || lineTotal.gt(maxMoney)) {
            throw new HttpError(422, 'SALE_TOTAL_OVERFLOW', 'Sale total exceeds the supported monetary range')
          }
          subtotal = subtotal.add(lineTotal)
          if (subtotal.gt(maxMoney)) {
            throw new HttpError(422, 'SALE_TOTAL_OVERFLOW', 'Sale total exceeds the supported monetary range')
          }
          return { item, variant, product, category, unitSoldPrice, unitCostAtSale: decimal(variant.lastPurchaseCost), lineTotal }
        })

        const sale = await transaction.sale.create({
          data: {
            accountId,
            soldById,
            idempotencyKey,
            requestFingerprint: fingerprint,
            sellerNameAtSale: seller.sellerName,
            sellerCodeAtSale: seller.employeeCode,
            status: SaleStatus.COMPLETED,
            currency: account.baseCurrency,
            subtotal,
            totalAmount: subtotal,
          },
          select: { id: true },
        })

        for (const line of trustedLines) {
          const saleItem = await transaction.saleItem.create({
            data: {
              accountId,
              saleId: sale.id,
              productId: line.product.id,
              variantId: line.variant.id,
              categoryId: line.category.id,
              productNameAtSale: line.product.name,
              categoryNameAtSale: line.category.name,
              skuAtSale: line.variant.sku,
              colorAtSale: line.variant.color,
              sizeAtSale: line.variant.size,
              quantity: line.item.quantity,
              unitSoldPrice: line.unitSoldPrice,
              unitCostAtSale: line.unitCostAtSale,
              lineTotal: line.lineTotal,
            },
            select: { id: true },
          })
          const decremented = await transaction.productVariant.updateMany({
            where: {
              id: line.variant.id,
              accountId,
              productId: line.product.id,
              currentStock: { gte: line.item.quantity },
            },
            data: { currentStock: { decrement: line.item.quantity } },
          })
          if (decremented.count !== 1) {
            throw new HttpError(409, 'INSUFFICIENT_STOCK', 'A requested Variant has insufficient stock')
          }
          await transaction.inventoryMovement.create({
            data: {
              accountId,
              variantId: line.variant.id,
              type: InventoryMovementType.SALE,
              quantityChange: -line.item.quantity,
              unitCost: line.unitCostAtSale,
              performedById: soldById,
              saleItemId: saleItem.id,
              returnItemId: null,
              note: null,
              idempotencyKey: null,
              requestFingerprint: null,
            },
            select: { id: true },
          })
        }

        const persisted = await findSale(transaction, accountId, idempotencyKey)
        if (!persisted) throw new HttpError(500, 'SALE_INTEGRITY_ERROR', 'Sale record is incomplete')
        return toView(persisted, false)
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    } catch (error) {
      if (isSaleIdempotencyViolation(error)) {
        const winner = await findSale(prisma, accountId, idempotencyKey)
        if (winner) return replay(winner, fingerprint)
        throw new HttpError(409, 'SALE_CONFLICT', 'Sale could not be completed')
      }
      throw error
    }
  }

  async function createSale(accountId: string, soldById: string, idempotencyKey: string, input: SaleInput): Promise<SaleView> {
    try {
      return await performSale(accountId, soldById, idempotencyKey, input)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SALE_UNAVAILABLE', 'Sale could not be completed')
    }
  }

  async function listSales(accountId: string, query: SaleHistoryQuery) {
    try {
      const where: Prisma.SaleWhereInput = {
        accountId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.soldById ? { soldById: query.soldById } : {}),
        ...(query.from || query.to ? {
          createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) },
        } : {}),
        ...(query.cursor ? { OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ] } : {}),
      }
      const rows = await prisma.sale.findMany({
        where, select: historySaleSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
      })
      const page = rows.slice(0, query.limit)
      const totals = page.length ? await prisma.saleItem.groupBy({
        by: ['saleId'],
        where: { accountId, saleId: { in: page.map((sale) => sale.id) } },
        _sum: { quantity: true },
      }) : []
      const unitsBySale = new Map(totals.map((total) => [total.saleId, safeUnits(total._sum.quantity ?? 0)]))
      const last = page.at(-1)
      return {
        sales: page.map((sale: HistorySale) => ({
          id: sale.id, status: sale.status, currency: sale.currency,
          subtotal: sale.subtotal.toFixed(2), totalAmount: sale.totalAmount.toFixed(2), createdAt: sale.createdAt,
          seller: { name: sale.sellerNameAtSale, employeeCode: sale.sellerCodeAtSale },
          itemCount: sale._count.items,
          totalUnits: unitsBySale.get(sale.id) ?? 0,
        })),
        nextCursor: rows.length > query.limit && last ? encodeSaleCursor(last.createdAt, last.id) : null,
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SALES_HISTORY_UNAVAILABLE', 'Sales history is temporarily unavailable')
    }
  }

  async function getSale(accountId: string, role: UserRole, saleId: string): Promise<SaleDetailView> {
    try {
      const sale = await prisma.sale.findUnique({
        where: { id_accountId: { id: saleId, accountId } },
        select: detailSaleSelect,
      })
      if (!sale) throw new HttpError(404, 'SALE_NOT_FOUND', 'Sale does not exist')
      const [returnCount, returnAggregates] = await Promise.all([
        prisma.saleReturn.count({ where: { accountId, saleId } }),
        prisma.saleReturnItem.groupBy({
          by: ['saleItemId'],
          where: { accountId, saleId },
          _sum: { quantity: true, refundAmount: true },
        }),
      ])
      return detailView(sale, role, returnCount, returnAggregates)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SALES_HISTORY_UNAVAILABLE', 'Sales history is temporarily unavailable')
    }
  }

  async function persistedVoidSale(db: SaleReader, accountId: string, saleId: string): Promise<PersistedVoidSale> {
    const sale = await db.sale.findUnique({
      where: { id_accountId: { id: saleId, accountId } },
      select: voidSaleSelect,
    })
    if (!sale) throw new HttpError(404, 'SALE_NOT_FOUND', 'Sale does not exist')
    return sale
  }

  async function performVoid(
    accountId: string,
    voidedById: string,
    saleId: string,
    input: SaleVoidInput,
  ): Promise<SaleVoidView> {
    return prisma.$transaction(async (transaction) => {
      const accounts = await transaction.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
      )
      if (!accounts[0]) throw new HttpError(409, 'SALE_VOID_ACCOUNT_UNAVAILABLE', 'Sale Account is unavailable')

      const actors = await transaction.$queryRaw<LockedVoidActor[]>(
        Prisma.sql`SELECT "id", btrim(concat_ws(' ', "firstName", "lastName")) AS "voidedByName", "employeeCode", "role", "isActive" FROM "User" WHERE "id" = ${voidedById}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
      )
      const actor = actors[0]
      if (!actor || !actor.isActive || actor.role !== UserRole.OWNER) {
        throw new HttpError(403, 'SALE_VOID_ACTOR_UNAVAILABLE', 'Only an active OWNER may Void a Sale')
      }

      const sales = await transaction.$queryRaw<LockedVoidSale[]>(
        Prisma.sql`SELECT "id", "status", "voidedById", "voidReason" FROM "Sale" WHERE "id" = ${saleId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
      )
      const sale = sales[0]
      if (!sale) throw new HttpError(404, 'SALE_NOT_FOUND', 'Sale does not exist')
      if (sale.status === SaleStatus.VOIDED) {
        if (sale.voidedById !== voidedById || sale.voidReason !== input.reason) {
          throw new HttpError(409, 'SALE_VOID_CONFLICT', 'Sale was already Void-ed with different details')
        }
        return voidView(await persistedVoidSale(transaction, accountId, saleId), true)
      }
      if (sale.status !== SaleStatus.COMPLETED) {
        throw new HttpError(409, 'SALE_VOID_NOT_ALLOWED', 'Sale cannot be Void-ed')
      }

      const existingReturn = await transaction.saleReturn.findFirst({
        where: { accountId, saleId },
        select: { id: true },
      })
      if (existingReturn) {
        throw new HttpError(409, 'SALE_VOID_HAS_RETURNS', 'A Sale with Returns cannot be Void-ed')
      }

      // SaleItems are immutable database history, so the Sale row lock plus a
      // tenant-qualified read is sufficient; Variant locks below protect stock.
      const items = await transaction.saleItem.findMany({
        where: { accountId, saleId },
        select: voidItemSelect,
        orderBy: { id: 'asc' },
      })
      if (items.length === 0) {
        throw new HttpError(409, 'SALE_VOID_NO_ITEMS', 'A Sale without items cannot be Void-ed')
      }

      const variantIds = [...new Set(items.map((item) => item.variantId))].sort()
      const variants = await transaction.$queryRaw<LockedVoidVariant[]>(
        Prisma.sql`SELECT "id", "currentStock" FROM "ProductVariant" WHERE "accountId" = ${accountId}::uuid AND "id" IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
      )
      if (variants.length !== variantIds.length) {
        throw new HttpError(409, 'SALE_VOID_VARIANT_UNAVAILABLE', 'Historical Sale inventory is unavailable')
      }

      const quantityByVariant = new Map<string, number>()
      for (const item of items) {
        quantityByVariant.set(item.variantId, (quantityByVariant.get(item.variantId) ?? 0) + item.quantity)
      }
      for (const variant of variants) {
        const quantity = quantityByVariant.get(variant.id) ?? 0
        if (quantity > maxStock - variant.currentStock) {
          throw new HttpError(409, 'INVENTORY_STOCK_OVERFLOW', 'Sale Void would exceed the stock limit')
        }
      }

      // Safe sequence: restore stock, append every reversal movement, then let
      // the final Sale transition trigger re-check Return exclusion.
      for (const [variantId, quantity] of quantityByVariant) {
        const incremented = await transaction.productVariant.updateMany({
          where: { id: variantId, accountId, currentStock: { lte: maxStock - quantity } },
          data: { currentStock: { increment: quantity } },
        })
        if (incremented.count !== 1) {
          throw new HttpError(409, 'INVENTORY_STOCK_OVERFLOW', 'Sale Void would exceed the stock limit')
        }
      }

      for (const item of items) {
        await transaction.inventoryMovement.create({
          data: {
            accountId,
            variantId: item.variantId,
            type: InventoryMovementType.SALE_VOID,
            quantityChange: item.quantity,
            unitCost: item.unitCostAtSale,
            performedById: voidedById,
            saleItemId: item.id,
            returnItemId: null,
            note: null,
            idempotencyKey: null,
            requestFingerprint: null,
          },
          select: { id: true },
        })
      }

      await transaction.sale.update({
        where: { id_accountId: { id: saleId, accountId } },
        data: {
          status: SaleStatus.VOIDED,
          voidedAt: new Date(),
          voidedById,
          voidedByName: actor.voidedByName,
          voidedByCode: actor.employeeCode,
          voidReason: input.reason,
        },
        select: { id: true },
      })

      return voidView(await persistedVoidSale(transaction, accountId, saleId), false)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  async function voidSale(
    accountId: string,
    voidedById: string,
    saleId: string,
    input: SaleVoidInput,
  ): Promise<SaleVoidView> {
    try {
      return await performVoid(accountId, voidedById, saleId, input)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SALE_VOID_UNAVAILABLE', 'Sale could not be Void-ed')
    }
  }

  return { createSale, listSales, getSale, voidSale }
}
