import { Router, type RequestHandler } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

// Account settings. For now: the USD -> LBP exchange rate (Lebanese pounds per 1 US dollar) used by the till.
export interface SettingsView {
  readonly settings: {
    readonly baseCurrency: string
    /** Lebanese pounds per 1 USD, two decimals; null until the OWNER sets it. */
    readonly lbpPerUsd: string | null
  }
}

export interface SettingsDependencies {
  getSettings(accountId: string): Promise<SettingsView>
  setExchangeRate(accountId: string, lbpPerUsd: string | null): Promise<SettingsView>
}

export const maxLbpPerUsd = 1_000_000_000
const ratePattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/

export function parseExchangeRateInput(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_EXCHANGE_RATE', 'Exchange rate input must be an object')
  }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== 'lbpPerUsd') || !Object.hasOwn(input, 'lbpPerUsd')) {
    throw new HttpError(422, 'INVALID_EXCHANGE_RATE', 'Only lbpPerUsd is allowed')
  }
  if (input.lbpPerUsd === null) return null
  if (typeof input.lbpPerUsd !== 'string' || !ratePattern.test(input.lbpPerUsd)) {
    throw new HttpError(422, 'INVALID_EXCHANGE_RATE', 'lbpPerUsd must be a decimal string with at most two places, or null to clear it')
  }
  const rate = new Prisma.Decimal(input.lbpPerUsd)
  if (!rate.gt(0) || rate.gt(maxLbpPerUsd)) {
    throw new HttpError(422, 'INVALID_EXCHANGE_RATE', `lbpPerUsd must be greater than 0 and at most ${maxLbpPerUsd}`)
  }
  return rate.toFixed(2)
}

export function createSettingsDependencies(prisma: PrismaClient): SettingsDependencies {
  const select = { baseCurrency: true, lbpPerUsd: true } as const
  const view = (account: { baseCurrency: string; lbpPerUsd: Prisma.Decimal | null }): SettingsView => ({
    settings: { baseCurrency: account.baseCurrency, lbpPerUsd: account.lbpPerUsd === null ? null : account.lbpPerUsd.toFixed(2) },
  })

  async function getSettings(accountId: string): Promise<SettingsView> {
    try {
      const account = await prisma.account.findUnique({ where: { id: accountId }, select })
      if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return view(account)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SETTINGS_UNAVAILABLE', 'Settings are temporarily unavailable')
    }
  }

  async function setExchangeRate(accountId: string, lbpPerUsd: string | null): Promise<SettingsView> {
    try {
      return await prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<{ id: string; baseCurrency: string }[]>(
          Prisma.sql`SELECT "id", "baseCurrency" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
        )
        const account = rows[0]
        if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
        if (account.baseCurrency !== 'USD') {
          throw new HttpError(409, 'EXCHANGE_RATE_UNSUPPORTED_CURRENCY', 'The exchange rate is only used by accounts that sell in USD')
        }
        const updated = await transaction.account.update({
          where: { id: accountId },
          data: { lbpPerUsd: lbpPerUsd === null ? null : new Prisma.Decimal(lbpPerUsd) },
          select,
        })
        return view(updated)
      })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SETTINGS_UNAVAILABLE', 'Settings are temporarily unavailable')
    }
  }

  return { getSettings, setExchangeRate }
}

function tenant(auth: Express.Request['auth']): { accountId: string } {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
      (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active tenant is required')
  }
  return { accountId: auth.accountId }
}

export function createSettingsRouter(auth: AuthDependencies, settings: SettingsDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))

  const read: RequestHandler = async (request, response, next) => {
    try { response.json(await settings.getSettings(tenant(request.auth).accountId)) } catch (error) { next(error) }
  }
  const write: RequestHandler = async (request, response, next) => {
    try {
      const { accountId } = tenant(request.auth)
      response.json(await settings.setExchangeRate(accountId, parseExchangeRateInput(request.body)))
    } catch (error) { next(error) }
  }
  router.get('/', read)
  router.put('/exchange-rate', requireRole(UserRole.OWNER), write)
  return router
}
