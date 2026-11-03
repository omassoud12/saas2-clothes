// Stores of an Account. Today every Account has exactly one (the default store); it is created by the
// business_reports migration for existing accounts and here, on first use, for new ones.
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'

type Db = PrismaClient | Prisma.TransactionClient

export interface StoreRow { readonly id: string; readonly name: string; readonly isDefault: boolean }

export interface AccountContext {
  readonly accountId: string
  readonly name: string
  readonly timezone: string
  readonly baseCurrency: string
  readonly exchangeRate: string | null
  readonly stores: readonly StoreRow[]
}

export async function ensureDefaultStore(db: Db, accountId: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "Store" ("id", "accountId", "name", "isDefault", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), a."id", left(a."name", 160), true, now(), now() FROM "Account" a WHERE a."id" = ${accountId}::uuid
    ON CONFLICT ("accountId") WHERE "isDefault" DO NOTHING`
}

/** The Account's timezone, currency, rate and stores (the default store first). */
export async function loadAccountContext(db: Db, accountId: string): Promise<AccountContext> {
  let account = await readAccount(db, accountId)
  if (account && account.stores.length === 0) {
    await ensureDefaultStore(db, accountId)
    account = await readAccount(db, accountId)
  }
  if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
  return account
}

async function readAccount(db: Db, accountId: string): Promise<AccountContext | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: {
      id: true, name: true, timezone: true, baseCurrency: true, lbpPerUsd: true,
      stores: { select: { id: true, name: true, isDefault: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
  })
  if (!account) return null
  return {
    accountId: account.id, name: account.name, timezone: account.timezone, baseCurrency: account.baseCurrency,
    exchangeRate: account.lbpPerUsd === null ? null : account.lbpPerUsd.toFixed(2).replace(/\.00$/, ''),
    stores: account.stores,
  }
}

/**
 * The stores a report covers. Missing or "all" = every store of the account. Any other value must be one of
 * the account's stores; a store of another account (or an unknown id) is 403 STORE_FORBIDDEN.
 */
export function resolveStoreIds(context: AccountContext, storeId: unknown): string[] {
  if (storeId === undefined || storeId === null || storeId === '' || storeId === 'all') return context.stores.map((store) => store.id)
  if (typeof storeId !== 'string' || !context.stores.some((store) => store.id === storeId)) {
    throw new HttpError(403, 'STORE_FORBIDDEN', 'You do not have access to this store')
  }
  return [storeId]
}
