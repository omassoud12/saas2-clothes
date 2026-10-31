import { Router, type RequestHandler } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, InventoryMovementType, UserRole } from '../generated/prisma/enums.js'

// Count check by the actual number: the owner counts a variant on the shelf, types what is there, and the system stores
// one ADJUSTMENT movement for the difference. The request carries the stock the owner saw (expectedStock): if the stock
// changed in the meantime nothing is written and the owner reviews again.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const maxCountedQuantity = 2_147_483_647

export interface CountCheckInput {
  readonly countedQuantity: number
  readonly expectedStock: number
}

export interface CountCheckView {
  readonly count: {
    readonly variantId: string
    readonly previousStock: number
    readonly countedQuantity: number
    readonly difference: number
    readonly currentStock: number
  }
  readonly idempotentReplay: boolean
}

export interface CountCheckDependencies {
  countVariant(accountId: string, userId: string, variantId: string, operationId: string, input: CountCheckInput): Promise<CountCheckView>
}

function invalid(message: string): never {
  throw new HttpError(422, 'INVALID_COUNT_CHECK', message)
}

export function parseCountCheckInput(body: unknown): CountCheckInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Count check input must be an object')
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== 'countedQuantity' && key !== 'expectedStock')) invalid('Only countedQuantity and expectedStock are allowed')
  for (const name of ['countedQuantity', 'expectedStock'] as const) {
    const value = input[name]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maxCountedQuantity) {
      invalid(`${name} must be a whole number from 0 to ${maxCountedQuantity}`)
    }
  }
  return { countedQuantity: input.countedQuantity as number, expectedStock: input.expectedStock as number }
}

export function parseCountVariantId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new HttpError(422, 'INVALID_VARIANT_ID', 'variantId must be a UUID')
  return value.toLowerCase()
}

export function parseCountIdempotencyKey(headers: Record<string, unknown>, rawHeaders: readonly string[]): string {
  let count = 0
  for (let index = 0; index < rawHeaders.length; index += 2) if (rawHeaders[index]?.toLowerCase() === 'idempotency-key') count += 1
  const value = headers['idempotency-key']
  if (count === 0 || value === undefined) throw new HttpError(400, 'COUNT_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')
  if (count !== 1 || typeof value !== 'string' || !uuidPattern.test(value)) throw new HttpError(400, 'COUNT_IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be one UUID')
  return value.toLowerCase()
}

export function countNote(expectedStock: number, countedQuantity: number): string {
  return `Count check: expected ${expectedStock}, counted ${countedQuantity}.`
}

type LockedActor = { id: string; role: UserRole; isActive: boolean }
type LockedVariant = {
  id: string
  productId: string
  currentStock: number
  lastPurchaseCost: Prisma.Decimal | string | null
  isActive: boolean
  productActive: boolean
}

export function createCountCheckDependencies(prisma: PrismaClient): CountCheckDependencies {
  async function perform(accountId: string, userId: string, variantId: string, operationId: string, input: CountCheckInput): Promise<CountCheckView> {
    return prisma.$transaction(async (transaction) => {
      const actors = await transaction.$queryRaw<LockedActor[]>(
        Prisma.sql`SELECT "id", "role", "isActive" FROM "User" WHERE "id" = ${userId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
      )
      const actor = actors[0]
      if (!actor || !actor.isActive || actor.role !== UserRole.OWNER) {
        throw new HttpError(403, 'COUNT_ACTOR_UNAVAILABLE', 'Only an active OWNER may correct stock')
      }

      const rows = await transaction.$queryRaw<LockedVariant[]>(
        Prisma.sql`SELECT v."id", v."productId", v."currentStock", v."lastPurchaseCost", v."isActive", p."isActive" AS "productActive"
          FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId" AND p."accountId" = v."accountId"
          WHERE v."id" = ${variantId}::uuid AND v."accountId" = ${accountId}::uuid FOR UPDATE OF v`,
      )
      const variant = rows[0]
      if (!variant) throw new HttpError(404, 'VARIANT_NOT_FOUND', 'Variant does not exist')

      const difference = input.countedQuantity - input.expectedStock
      const prior = await transaction.inventoryMovement.findFirst({
        where: { id: operationId, accountId },
        select: { variantId: true, performedById: true, type: true, quantityChange: true, note: true },
      })
      if (prior) {
        if (prior.variantId !== variantId || prior.performedById !== userId || prior.type !== InventoryMovementType.ADJUSTMENT ||
            prior.quantityChange !== difference || prior.note !== countNote(input.expectedStock, input.countedQuantity)) {
          throw new HttpError(409, 'COUNT_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used for a different count')
        }
        return {
          count: { variantId, previousStock: input.expectedStock, countedQuantity: input.countedQuantity, difference, currentStock: variant.currentStock },
          idempotentReplay: true,
        }
      }

      if (!variant.isActive || !variant.productActive) throw new HttpError(409, 'COUNT_VARIANT_INACTIVE', 'Only active items can be counted')
      if (variant.currentStock !== input.expectedStock) {
        throw new HttpError(409, 'COUNT_STOCK_CHANGED', 'The stock changed since you looked at it. Review the current number and count again.')
      }
      if (difference === 0) {
        return {
          count: { variantId, previousStock: variant.currentStock, countedQuantity: input.countedQuantity, difference: 0, currentStock: variant.currentStock },
          idempotentReplay: false,
        }
      }

      const updated = await transaction.productVariant.updateMany({
        where: { id: variantId, accountId, currentStock: input.expectedStock },
        data: { currentStock: input.countedQuantity },
      })
      if (updated.count !== 1) throw new HttpError(409, 'COUNT_STOCK_CHANGED', 'The stock changed since you looked at it. Review the current number and count again.')
      await transaction.inventoryMovement.create({
        data: {
          id: operationId,
          accountId,
          variantId,
          type: InventoryMovementType.ADJUSTMENT,
          quantityChange: difference,
          unitCost: variant.lastPurchaseCost === null ? null : new Prisma.Decimal(variant.lastPurchaseCost),
          performedById: userId,
          note: countNote(input.expectedStock, input.countedQuantity),
        },
        select: { id: true },
      })
      return {
        count: { variantId, previousStock: input.expectedStock, countedQuantity: input.countedQuantity, difference, currentStock: input.countedQuantity },
        idempotentReplay: false,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  async function countVariant(accountId: string, userId: string, variantId: string, operationId: string, input: CountCheckInput): Promise<CountCheckView> {
    try {
      return await perform(accountId, userId, variantId, operationId, input)
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'COUNT_IDEMPOTENCY_CONFLICT', 'This count was already submitted')
      }
      throw new HttpError(503, 'COUNT_UNAVAILABLE', 'The count could not be saved')
    }
  }

  return { countVariant }
}

export function createCountCheckRouter(auth: AuthDependencies, counts: CountCheckDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER))
  const handler: RequestHandler = async (request, response, next) => {
    try {
      const context = request.auth
      if (!context?.accountId || context.accountStatus !== AccountStatus.ACTIVE || context.role !== UserRole.OWNER) {
        throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active owner is required')
      }
      const result = await counts.countVariant(
        context.accountId,
        context.userId,
        parseCountVariantId(request.params.variantId),
        parseCountIdempotencyKey(request.headers, request.rawHeaders),
        parseCountCheckInput(request.body),
      )
      response.status(result.idempotentReplay || result.count.difference === 0 ? 200 : 201).json(result)
    } catch (error) { next(error) }
  }
  router.post('/variants/:variantId/count-check', handler)
  return router
}
