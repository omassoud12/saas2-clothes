import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { returnFingerprint } from '../returns/return.schemas.js'
import { createReturnInTransaction } from '../returns/return.service.js'
import type { ReturnTransactionInput, ReturnView } from '../returns/return.types.js'
import { saleFingerprint } from '../sales/sale.schemas.js'
import { createSaleInTransaction } from '../sales/sale.service.js'
import type {
  SaleInput,
  SaleOperationMetadata,
  SaleTransaction,
  SaleTransactionContext,
  SaleTransactionResult,
} from '../sales/sale.types.js'
import {
  deterministicExchangeChildKey,
  exchangeAdvisoryKey,
  exchangeFingerprint,
} from './exchange.schemas.js'
import type { ExchangeDependencies, ExchangeInput, ExchangeView } from './exchange.types.js'

const exchangeIdempotencyIndex = 'Exchange_accountId_idempotencyKey_key'

const persistedExchangeSelect = {
  id: true,
  requestFingerprint: true,
  createdAt: true,
  saleReturn: {
    select: {
      id: true,
      saleId: true,
      processedByName: true,
      processedByCode: true,
      reason: true,
      createdAt: true,
      sale: { select: { currency: true } },
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
    },
  },
  newSale: {
    select: {
      id: true,
      status: true,
      subtotal: true,
      totalAmount: true,
      sellerNameAtSale: true,
      sellerCodeAtSale: true,
      createdAt: true,
      items: {
        orderBy: { id: 'asc' as const },
        select: {
          id: true,
          productId: true,
          variantId: true,
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
    },
  },
} as const

type PersistedExchange = Prisma.ExchangeGetPayload<{ select: typeof persistedExchangeSelect }>
type ExchangeReader = Pick<PrismaClient, 'exchange'>
type LockedAccount = { id: string; baseCurrency: string }
type LockedActor = { id: string; role: UserRole; isActive: boolean }
type LockedOriginalSale = { id: string; status: SaleStatus; currency: string }
type AdvisoryReturnItem = { id: string; variantId: string }
type AdvisoryReplacementVariant = { id: string; productId: string }
type LockedReturnItem = { id: string; variantId: string }

interface ExchangePrimitives {
  createReturn(transaction: SaleTransaction, operation: ReturnTransactionInput): Promise<ReturnView>
  createSale(
    transaction: SaleTransaction,
    context: SaleTransactionContext,
    input: SaleInput,
    operation: SaleOperationMetadata,
  ): Promise<SaleTransactionResult>
}

const defaultPrimitives: ExchangePrimitives = {
  createReturn: createReturnInTransaction,
  createSale: createSaleInTransaction,
}

function isExchangeIdempotencyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  return target === exchangeIdempotencyIndex || error.meta?.constraint === exchangeIdempotencyIndex ||
    (error.meta?.modelName === 'Exchange' && Array.isArray(target) && target.length === 2 &&
      target[0] === 'accountId' && target[1] === 'idempotencyKey')
}

async function findExchange(
  db: ExchangeReader,
  accountId: string,
  idempotencyKey: string,
): Promise<PersistedExchange | null> {
  return db.exchange.findUnique({
    where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
    select: persistedExchangeSelect,
  })
}

function exchangeConflict(): HttpError {
  return new HttpError(409, 'EXCHANGE_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different Exchange')
}

function toView(record: PersistedExchange, fingerprint: string, idempotentReplay: boolean): ExchangeView {
  if (record.requestFingerprint !== fingerprint) throw exchangeConflict()
  let totalRefund = new Prisma.Decimal(0)
  const returnedItems = record.saleReturn.items.map((item) => {
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
    exchange: {
      id: record.id,
      createdAt: record.createdAt,
      originalSaleId: record.saleReturn.saleId,
      currency: record.saleReturn.sale.currency,
      return: {
        id: record.saleReturn.id,
        createdAt: record.saleReturn.createdAt,
        reason: record.saleReturn.reason,
        processor: {
          name: record.saleReturn.processedByName,
          employeeCode: record.saleReturn.processedByCode,
        },
        totalRefund: totalRefund.toFixed(2),
        items: returnedItems,
      },
      replacementSale: {
        id: record.newSale.id,
        status: record.newSale.status,
        createdAt: record.newSale.createdAt,
        seller: { name: record.newSale.sellerNameAtSale, employeeCode: record.newSale.sellerCodeAtSale },
        subtotal: record.newSale.subtotal.toFixed(2),
        totalAmount: record.newSale.totalAmount.toFixed(2),
        items: record.newSale.items.map((item) => ({
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
      differenceAmount: record.newSale.totalAmount.sub(totalRefund).toFixed(2),
    },
    idempotentReplay,
  }
}

export function createExchangeDependencies(
  prisma: PrismaClient,
  primitives: ExchangePrimitives = defaultPrimitives,
): ExchangeDependencies {
  async function performExchange(
    accountId: string,
    actorId: string,
    originalSaleId: string,
    idempotencyKey: string,
    input: ExchangeInput,
  ): Promise<ExchangeView> {
    const fingerprint = exchangeFingerprint(accountId, actorId, originalSaleId, input)
    const existing = await findExchange(prisma, accountId, idempotencyKey)
    if (existing) return toView(existing, fingerprint, true)

    const returnChildKey = deterministicExchangeChildKey(idempotencyKey, 'return')
    const saleChildKey = deterministicExchangeChildKey(idempotencyKey, 'sale')
    const returnInput = { reason: input.reason, items: input.returnItems }
    const saleInput = { items: input.replacementItems }

    try {
      const outcome = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${exchangeAdvisoryKey(accountId, idempotencyKey)})`,
        )

        const concurrent = await findExchange(transaction, accountId, idempotencyKey)
        if (concurrent) return { record: concurrent, replay: true }

        // Resolve the complete lock set without treating these reads as authority.
        const returnItemIds = input.returnItems.map((item) => item.saleItemId)
        const replacementVariantIds = input.replacementItems.map((item) => item.variantId)
        const advisoryOriginalSale = await transaction.sale.findUnique({
          where: { id_accountId: { id: originalSaleId, accountId } },
          select: { id: true },
        })
        if (!advisoryOriginalSale) throw new HttpError(404, 'RETURN_SALE_NOT_FOUND', 'Sale does not exist')
        const advisoryReturnItems = await transaction.saleItem.findMany({
          where: { accountId, saleId: originalSaleId, id: { in: returnItemIds } },
          select: { id: true, variantId: true },
        }) as AdvisoryReturnItem[]
        if (advisoryReturnItems.length !== returnItemIds.length) {
          throw new HttpError(404, 'RETURN_SALE_ITEM_UNAVAILABLE', 'A requested SaleItem is unavailable')
        }
        const advisoryReplacementVariants = await transaction.productVariant.findMany({
          where: { accountId, id: { in: replacementVariantIds } },
          select: { id: true, productId: true },
        }) as AdvisoryReplacementVariant[]
        if (advisoryReplacementVariants.length !== replacementVariantIds.length) {
          throw new HttpError(404, 'SALE_VARIANT_UNAVAILABLE', 'A requested Variant is unavailable')
        }
        const replacementProductIds = [...new Set(advisoryReplacementVariants.map((item) => item.productId))].sort()
        const variantIds = [...new Set([
          ...advisoryReturnItems.map((item) => item.variantId),
          ...replacementVariantIds,
        ])].sort()

        const accounts = await transaction.$queryRaw<LockedAccount[]>(
          Prisma.sql`SELECT "id", "baseCurrency" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
        )
        const account = accounts[0]
        if (!account || !/^[A-Z]{3}$/.test(account.baseCurrency)) {
          throw new HttpError(409, 'EXCHANGE_ACCOUNT_UNAVAILABLE', 'Exchange Account is unavailable')
        }
        const actors = await transaction.$queryRaw<LockedActor[]>(
          Prisma.sql`SELECT "id", "role", "isActive" FROM "User" WHERE "id" = ${actorId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
        )
        const actor = actors[0]
        if (!actor || !actor.isActive || (actor.role !== UserRole.OWNER && actor.role !== UserRole.WAREHOUSE)) {
          throw new HttpError(403, 'EXCHANGE_ACTOR_UNAVAILABLE', 'Actor is not authorized to create Exchanges')
        }
        const originalSales = await transaction.$queryRaw<LockedOriginalSale[]>(
          Prisma.sql`SELECT "id", "status", "currency" FROM "Sale" WHERE "id" = ${originalSaleId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
        )
        const originalSale = originalSales[0]
        if (!originalSale) throw new HttpError(404, 'RETURN_SALE_NOT_FOUND', 'Sale does not exist')
        if (originalSale.status !== SaleStatus.COMPLETED) {
          throw new HttpError(409, 'RETURN_SALE_NOT_RETURNABLE', 'Sale is not returnable')
        }
        const lockedReturnItems = await transaction.$queryRaw<LockedReturnItem[]>(
          Prisma.sql`SELECT "id", "variantId" FROM "SaleItem" WHERE "accountId" = ${accountId}::uuid AND "saleId" = ${originalSaleId}::uuid AND "id" IN (${Prisma.join(returnItemIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
        )
        if (lockedReturnItems.length !== returnItemIds.length) {
          throw new HttpError(404, 'RETURN_SALE_ITEM_UNAVAILABLE', 'A requested SaleItem is unavailable')
        }
        const authoritativeReturnVariants = new Map(lockedReturnItems.map((item) => [item.id, item.variantId]))
        if (advisoryReturnItems.some((item) => authoritativeReturnVariants.get(item.id) !== item.variantId)) {
          throw new HttpError(409, 'EXCHANGE_CONFLICT', 'Exchange inputs changed during processing')
        }
        const lockedProducts = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "id" FROM "Product" WHERE "accountId" = ${accountId}::uuid AND "id" IN (${Prisma.join(replacementProductIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
        )
        if (lockedProducts.length !== replacementProductIds.length) {
          throw new HttpError(404, 'SALE_VARIANT_UNAVAILABLE', 'A requested Variant is unavailable')
        }
        const lockedVariants = await transaction.$queryRaw<{ id: string; productId: string }[]>(
          Prisma.sql`SELECT "id", "productId" FROM "ProductVariant" WHERE "accountId" = ${accountId}::uuid AND "id" IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
        )
        if (lockedVariants.length !== variantIds.length) {
          throw new HttpError(404, 'SALE_VARIANT_UNAVAILABLE', 'A requested Variant is unavailable')
        }
        const lockedProductByVariant = new Map(lockedVariants.map((variant) => [variant.id, variant.productId]))
        if (advisoryReplacementVariants.some((variant) =>
          lockedProductByVariant.get(variant.id) !== variant.productId)) {
          throw new HttpError(409, 'EXCHANGE_CONFLICT', 'Exchange inputs changed during processing')
        }
        if (originalSale.currency !== account.baseCurrency) {
          throw new HttpError(409, 'EXCHANGE_CURRENCY_MISMATCH', 'Original and replacement Sales must use the same currency')
        }

        const returned = await primitives.createReturn(transaction, {
          accountId,
          processedById: actorId,
          saleId: originalSaleId,
          idempotencyKey: returnChildKey,
          requestFingerprint: returnFingerprint(accountId, actorId, originalSaleId, returnInput),
          input: returnInput,
        })
        const replacement = await primitives.createSale(
          transaction,
          { accountId, soldById: actorId },
          saleInput,
          {
            idempotencyKey: saleChildKey,
            requestFingerprint: saleFingerprint(accountId, actorId, saleInput.items),
          },
        )
        await transaction.exchange.create({
          data: {
            accountId,
            returnId: returned.return.id,
            newSaleId: replacement.id,
            idempotencyKey,
            requestFingerprint: fingerprint,
          },
          select: { id: true },
        })
        const persisted = await findExchange(transaction, accountId, idempotencyKey)
        if (!persisted) throw new HttpError(500, 'EXCHANGE_INTEGRITY_ERROR', 'Exchange record is incomplete')
        return { record: persisted, replay: false }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
      return toView(outcome.record, fingerprint, outcome.replay)
    } catch (error) {
      if (isExchangeIdempotencyViolation(error)) {
        const winner = await findExchange(prisma, accountId, idempotencyKey)
        if (winner) return toView(winner, fingerprint, true)
        throw new HttpError(409, 'EXCHANGE_CONFLICT', 'Exchange could not be completed')
      }
      throw error
    }
  }

  async function createExchange(
    accountId: string,
    actorId: string,
    originalSaleId: string,
    idempotencyKey: string,
    input: ExchangeInput,
  ): Promise<ExchangeView> {
    try {
      return await performExchange(accountId, actorId, originalSaleId, idempotencyKey, input)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'EXCHANGE_UNAVAILABLE', 'Exchange could not be completed')
    }
  }

  return { createExchange }
}
