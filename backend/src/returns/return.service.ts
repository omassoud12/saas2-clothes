import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { InventoryMovementType, SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { canonicalReturnItems, returnFingerprint } from './return.schemas.js'
import type {
  ReturnDependencies,
  ReturnInput,
  ReturnTransaction,
  ReturnTransactionInput,
  ReturnView,
} from './return.types.js'

const returnIdempotencyIndex = 'SaleReturn_accountId_idempotencyKey_key'
const maxStock = 2_147_483_647

const persistedReturnSelect = {
  id: true,
  saleId: true,
  processedByName: true,
  processedByCode: true,
  reason: true,
  createdAt: true,
  requestFingerprint: true,
  items: {
    orderBy: { saleItemId: 'asc' as const },
    select: {
      saleItemId: true,
      variantId: true,
      quantity: true,
      refundAmount: true,
      saleItem: {
        select: {
          productId: true,
          productNameAtSale: true,
          categoryNameAtSale: true,
          skuAtSale: true,
          colorAtSale: true,
          sizeAtSale: true,
        },
      },
    },
  },
} as const

type PersistedReturn = Prisma.SaleReturnGetPayload<{ select: typeof persistedReturnSelect }>
type ReturnReader = Pick<PrismaClient, 'saleReturn'>
type LockedProcessor = {
  id: string
  processorName: string
  employeeCode: string | null
  role: UserRole
  isActive: boolean
}
type LockedSale = { id: string; status: SaleStatus }
type LockedSaleItem = {
  id: string
  saleId: string
  productId: string
  variantId: string
  quantity: number
  unitSoldPrice: Prisma.Decimal | string
  unitCostAtSale: Prisma.Decimal | string
}
type LockedVariant = { id: string; currentStock: number }

function saleNotFound(): HttpError {
  return new HttpError(404, 'RETURN_SALE_NOT_FOUND', 'Sale does not exist')
}

function itemUnavailable(): HttpError {
  return new HttpError(404, 'RETURN_SALE_ITEM_UNAVAILABLE', 'A requested SaleItem is unavailable')
}

function decimal(value: Prisma.Decimal | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)
}

function toView(record: PersistedReturn, idempotentReplay: boolean): ReturnView {
  let totalRefund = new Prisma.Decimal(0)
  const items = record.items.map((item) => {
    totalRefund = totalRefund.add(item.refundAmount)
    return {
      saleItemId: item.saleItemId,
      productId: item.saleItem.productId,
      variantId: item.variantId,
      productName: item.saleItem.productNameAtSale,
      categoryName: item.saleItem.categoryNameAtSale,
      sku: item.saleItem.skuAtSale,
      color: item.saleItem.colorAtSale,
      size: item.saleItem.sizeAtSale,
      quantity: item.quantity,
      refundAmount: item.refundAmount.toFixed(2),
    }
  })
  return {
    return: {
      id: record.id,
      saleId: record.saleId,
      createdAt: record.createdAt,
      reason: record.reason,
      processor: { name: record.processedByName, employeeCode: record.processedByCode },
      items,
      totalRefund: totalRefund.toFixed(2),
    },
    idempotentReplay,
  }
}

function assertFingerprint(record: PersistedReturn, fingerprint: string): void {
  if (record.requestFingerprint !== fingerprint) {
    throw new HttpError(409, 'RETURN_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different Return')
  }
}

function isReturnIdempotencyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  return target === returnIdempotencyIndex || error.meta?.constraint === returnIdempotencyIndex ||
    (Array.isArray(target) && target.length === 2 && target[0] === 'accountId' && target[1] === 'idempotencyKey')
}

async function findReturn(db: ReturnReader, accountId: string, idempotencyKey: string): Promise<PersistedReturn | null> {
  return db.saleReturn.findUnique({
    where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
    select: persistedReturnSelect,
  })
}

function replay(record: PersistedReturn, fingerprint: string): ReturnView {
  assertFingerprint(record, fingerprint)
  return toView(record, true)
}

/**
 * Transaction-scoped Return primitive. It does not open a nested transaction,
 * so a future Exchange flow can compose it inside its own outer transaction.
 */
export async function createReturnInTransaction(
  transaction: ReturnTransaction,
  operation: ReturnTransactionInput,
): Promise<ReturnView> {
  const { accountId, processedById, saleId, idempotencyKey, requestFingerprint, input } = operation
  const concurrentExisting = await findReturn(transaction as unknown as ReturnReader, accountId, idempotencyKey)
  if (concurrentExisting) return replay(concurrentExisting, requestFingerprint)

  const accounts = await transaction.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
  )
  if (!accounts[0]) {
    throw new HttpError(409, 'RETURN_ACCOUNT_UNAVAILABLE', 'Return Account is unavailable')
  }

  const processors = await transaction.$queryRaw<LockedProcessor[]>(
    Prisma.sql`SELECT "id", btrim(concat_ws(' ', "firstName", "lastName")) AS "processorName", "employeeCode", "role", "isActive" FROM "User" WHERE "id" = ${processedById}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
  )
  const processor = processors[0]
  if (!processor || !processor.isActive ||
      (processor.role !== UserRole.OWNER && processor.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'RETURN_PROCESSOR_UNAVAILABLE', 'Processor is not authorized to create Returns')
  }

  const sales = await transaction.$queryRaw<LockedSale[]>(
    Prisma.sql`SELECT "id", "status" FROM "Sale" WHERE "id" = ${saleId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
  )
  const sale = sales[0]
  if (!sale) throw saleNotFound()
  if (sale.status !== SaleStatus.COMPLETED) {
    throw new HttpError(409, 'RETURN_SALE_NOT_RETURNABLE', 'Sale is not returnable')
  }

  const items = canonicalReturnItems(input.items)
  const saleItemIds = items.map((item) => item.saleItemId)
  const lockedSaleItems = await transaction.$queryRaw<LockedSaleItem[]>(
    Prisma.sql`SELECT "id", "saleId", "productId", "variantId", "quantity", "unitSoldPrice", "unitCostAtSale" FROM "SaleItem" WHERE "accountId" = ${accountId}::uuid AND "saleId" = ${saleId}::uuid AND "id" IN (${Prisma.join(saleItemIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
  )
  if (lockedSaleItems.length !== saleItemIds.length) throw itemUnavailable()
  const saleItemById = new Map(lockedSaleItems.map((item) => [item.id, item]))

  const returned = await transaction.saleReturnItem.groupBy({
    by: ['saleItemId'],
    where: { accountId, saleId, saleItemId: { in: saleItemIds } },
    _sum: { quantity: true },
  })
  const returnedBySaleItem = new Map(returned.map((row) => [row.saleItemId, row._sum.quantity ?? 0]))
  for (const item of items) {
    const original = saleItemById.get(item.saleItemId)
    if (!original) throw itemUnavailable()
    const remaining = original.quantity - (returnedBySaleItem.get(item.saleItemId) ?? 0)
    if (item.quantity > remaining) {
      throw new HttpError(409, 'RETURN_QUANTITY_EXCEEDS_REMAINING', 'Return quantity exceeds the remaining quantity')
    }
  }

  const variantIds = [...new Set(lockedSaleItems.map((item) => item.variantId))].sort()
  const lockedVariants = await transaction.$queryRaw<LockedVariant[]>(
    Prisma.sql`SELECT "id", "currentStock" FROM "ProductVariant" WHERE "accountId" = ${accountId}::uuid AND "id" IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
  )
  if (lockedVariants.length !== variantIds.length) throw itemUnavailable()
  const quantityByVariant = new Map<string, number>()
  for (const item of items) {
    const original = saleItemById.get(item.saleItemId)!
    quantityByVariant.set(original.variantId, (quantityByVariant.get(original.variantId) ?? 0) + item.quantity)
  }
  for (const variant of lockedVariants) {
    const quantity = quantityByVariant.get(variant.id) ?? 0
    if (quantity > maxStock - variant.currentStock) {
      throw new HttpError(409, 'INVENTORY_STOCK_OVERFLOW', 'Return would exceed the stock limit')
    }
  }

  const header = await transaction.saleReturn.create({
    data: {
      accountId,
      saleId,
      processedById,
      processedByName: processor.processorName,
      processedByCode: processor.employeeCode,
      reason: input.reason,
      idempotencyKey,
      requestFingerprint,
    },
    select: { id: true },
  })

  const createdItems: { id: string; item: (typeof items)[number]; original: LockedSaleItem }[] = []
  for (const item of items) {
    const original = saleItemById.get(item.saleItemId)!
    const returnItem = await transaction.saleReturnItem.create({
      data: {
        accountId,
        returnId: header.id,
        saleId,
        saleItemId: original.id,
        variantId: original.variantId,
        quantity: item.quantity,
        refundAmount: decimal(original.unitSoldPrice).mul(item.quantity),
      },
      select: { id: true },
    })
    createdItems.push({ id: returnItem.id, item, original })
  }

  for (const [variantId, quantity] of quantityByVariant) {
    const incremented = await transaction.productVariant.updateMany({
      where: { id: variantId, accountId, currentStock: { lte: maxStock - quantity } },
      data: { currentStock: { increment: quantity } },
    })
    if (incremented.count !== 1) {
      throw new HttpError(409, 'INVENTORY_STOCK_OVERFLOW', 'Return would exceed the stock limit')
    }
  }

  for (const created of createdItems) {
    await transaction.inventoryMovement.create({
      data: {
        accountId,
        variantId: created.original.variantId,
        type: InventoryMovementType.RETURN,
        quantityChange: created.item.quantity,
        unitCost: decimal(created.original.unitCostAtSale),
        performedById: processedById,
        saleItemId: null,
        returnItemId: created.id,
        note: null,
        idempotencyKey: null,
        requestFingerprint: null,
      },
      select: { id: true },
    })
  }

  const persisted = await findReturn(transaction as unknown as ReturnReader, accountId, idempotencyKey)
  if (!persisted) throw new HttpError(500, 'RETURN_INTEGRITY_ERROR', 'Return record is incomplete')
  return toView(persisted, false)
}

export function createReturnDependencies(prisma: PrismaClient): ReturnDependencies {
  async function performReturn(
    accountId: string,
    processedById: string,
    saleId: string,
    idempotencyKey: string,
    input: ReturnInput,
  ): Promise<ReturnView> {
    const fingerprint = returnFingerprint(accountId, processedById, saleId, input)
    const existing = await findReturn(prisma, accountId, idempotencyKey)
    if (existing) return replay(existing, fingerprint)

    try {
      return await prisma.$transaction(
        (transaction) => createReturnInTransaction(transaction, {
          accountId,
          processedById,
          saleId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          input,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      )
    } catch (error) {
      if (isReturnIdempotencyViolation(error)) {
        // The losing transaction has fully rolled back before the winner is read.
        const winner = await findReturn(prisma, accountId, idempotencyKey)
        if (winner) return replay(winner, fingerprint)
        throw new HttpError(409, 'RETURN_CONFLICT', 'Return could not be completed')
      }
      throw error
    }
  }

  async function createReturn(
    accountId: string,
    processedById: string,
    saleId: string,
    idempotencyKey: string,
    input: ReturnInput,
  ): Promise<ReturnView> {
    try {
      return await performReturn(accountId, processedById, saleId, idempotencyKey, input)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'RETURN_UNAVAILABLE', 'Return could not be completed')
    }
  }

  return { createReturn }
}
