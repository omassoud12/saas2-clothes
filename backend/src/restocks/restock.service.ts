import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { InventoryMovementType } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { restockFingerprint } from './restock.schemas.js'
import type { RestockDependencies, RestockInput, RestockView } from './restock.types.js'

const maxStock = 2_147_483_647
const restockIdempotencyIndex = 'InventoryMovement_accountId_restock_idempotencyKey_key'
const movementSelect = {
  id: true,
  variantId: true,
  quantityChange: true,
  unitCost: true,
  note: true,
  createdAt: true,
  requestFingerprint: true,
} as const
const variantSelect = { id: true, currentStock: true, lastPurchaseCost: true } as const
type Movement = Prisma.InventoryMovementGetPayload<{ select: typeof movementSelect }>
type Variant = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>
type ReadDb = Pick<PrismaClient, 'productVariant' | 'inventoryMovement'>

function productNotFound(): HttpError {
  return new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product does not exist')
}

function variantNotFound(): HttpError {
  return new HttpError(404, 'VARIANT_NOT_FOUND', 'Variant does not exist')
}

function result(movement: Movement, variant: Variant, idempotentReplay: boolean): RestockView {
  if (movement.unitCost === null) {
    throw new HttpError(500, 'RESTOCK_INTEGRITY_ERROR', 'Restock record is incomplete')
  }
  return {
    restock: {
      id: movement.id,
      variantId: movement.variantId,
      quantity: movement.quantityChange,
      unitCost: movement.unitCost.toFixed(4),
      note: movement.note,
      createdAt: movement.createdAt,
    },
    // This is current state, not an historical stock-after snapshot.
    variant: {
      id: variant.id,
      currentStock: variant.currentStock,
      lastPurchaseCost: variant.lastPurchaseCost?.toFixed(4) ?? null,
    },
    idempotentReplay,
  }
}

function assertFingerprint(movement: Movement, fingerprint: string): void {
  if (movement.requestFingerprint !== fingerprint) {
    throw new HttpError(409, 'RESTOCK_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different Restock')
  }
}

function isRestockIdempotencyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  return target === restockIdempotencyIndex || error.meta?.constraint === restockIdempotencyIndex ||
    (Array.isArray(target) && target.length === 2 && target[0] === 'accountId' && target[1] === 'idempotencyKey')
}

export function createRestockDependencies(prisma: PrismaClient): RestockDependencies {
  async function findMovement(db: ReadDb, accountId: string, idempotencyKey: string): Promise<Movement | null> {
    return db.inventoryMovement.findFirst({
      where: { accountId, type: InventoryMovementType.RESTOCK, idempotencyKey },
      select: movementSelect,
    })
  }

  async function currentVariant(db: ReadDb, accountId: string, productId: string, variantId: string): Promise<Variant> {
    const variant = await db.productVariant.findUnique({
      where: { id_productId_accountId: { id: variantId, productId, accountId } },
      select: variantSelect,
    })
    if (!variant) throw variantNotFound()
    return variant
  }

  async function replay(db: ReadDb, movement: Movement, fingerprint: string, accountId: string, productId: string, variantId: string): Promise<RestockView> {
    assertFingerprint(movement, fingerprint)
    return result(movement, await currentVariant(db, accountId, productId, variantId), true)
  }

  async function performRestock(
    accountId: string,
    performedById: string,
    productId: string,
    variantId: string,
    idempotencyKey: string,
    input: RestockInput,
  ): Promise<RestockView> {
    // Keep cross-tenant and wrong-product resources indistinguishable from missing ones,
    // including on a replay. New requests recheck under row locks below.
    const product = await prisma.product.findUnique({
      where: { id_accountId: { id: productId, accountId } },
      select: { id: true },
    })
    if (!product) throw productNotFound()
    await currentVariant(prisma, accountId, productId, variantId)

    const fingerprint = restockFingerprint(accountId, performedById, variantId, input)
    const existing = await findMovement(prisma, accountId, idempotencyKey)
    if (existing) return replay(prisma, existing, fingerprint, accountId, productId, variantId)

    try {
      return await prisma.$transaction(async (transaction) => {
        const concurrentExisting = await findMovement(transaction, accountId, idempotencyKey)
        if (concurrentExisting) return replay(transaction, concurrentExisting, fingerprint, accountId, productId, variantId)

        // Always lock Product before Variant. Catalog UPDATEs take ordinary row
        // locks, so active-state checks remain valid until this transaction ends.
        const lockedProducts = await transaction.$queryRaw<{ id: string; isActive: boolean }[]>(
          Prisma.sql`SELECT "id", "isActive" FROM "Product" WHERE "id" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
        )
        const lockedProduct = lockedProducts[0]
        if (!lockedProduct) throw productNotFound()
        if (!lockedProduct.isActive) throw new HttpError(409, 'PRODUCT_INACTIVE', 'Product must be active to Restock')

        const lockedVariants = await transaction.$queryRaw<{ id: string; isActive: boolean; currentStock: number }[]>(
          Prisma.sql`SELECT "id", "isActive", "currentStock" FROM "ProductVariant" WHERE "id" = ${variantId}::uuid AND "productId" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
        )
        const lockedVariant = lockedVariants[0]
        if (!lockedVariant) throw variantNotFound()
        if (!lockedVariant.isActive) throw new HttpError(409, 'VARIANT_INACTIVE', 'Variant must be active to Restock')
        if (lockedVariant.currentStock > maxStock - input.quantity) {
          throw new HttpError(409, 'RESTOCK_STOCK_OVERFLOW', 'Restock would exceed the stock limit')
        }

        const variant = await transaction.productVariant.update({
          where: { id_productId_accountId: { id: variantId, productId, accountId } },
          data: {
            currentStock: { increment: input.quantity },
            lastPurchaseCost: new Prisma.Decimal(input.unitCost),
          },
          select: variantSelect,
        })
        const movement = await transaction.inventoryMovement.create({
          data: {
            accountId,
            variantId,
            type: InventoryMovementType.RESTOCK,
            quantityChange: input.quantity,
            unitCost: new Prisma.Decimal(input.unitCost),
            performedById,
            saleItemId: null,
            returnItemId: null,
            note: input.note,
            idempotencyKey,
            requestFingerprint: fingerprint,
          },
          select: movementSelect,
        })
        return result(movement, variant, false)
      })
    } catch (error) {
      if (isRestockIdempotencyViolation(error)) {
        // A competing transaction may have committed this key after our pre-read.
        // Prisma rolled back our stock/cost update before this query runs.
        const winner = await findMovement(prisma, accountId, idempotencyKey)
        if (winner) return replay(prisma, winner, fingerprint, accountId, productId, variantId)
        throw new HttpError(409, 'RESTOCK_CONFLICT', 'Restock could not be completed')
      }
      throw error
    }
  }

  async function restock(
    accountId: string,
    performedById: string,
    productId: string,
    variantId: string,
    idempotencyKey: string,
    input: RestockInput,
  ): Promise<RestockView> {
    try {
      return await performRestock(accountId, performedById, productId, variantId, idempotencyKey, input)
    } catch (error) {
      if (error instanceof HttpError) throw error
      // Do not forward or log Prisma details, SQL text, or sensitive cost input.
      throw new HttpError(503, 'RESTOCK_UNAVAILABLE', 'Restock could not be completed')
    }
  }

  return { restock }
}
