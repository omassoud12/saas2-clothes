import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createSettingsDependencies, createSettingsRouter, parseExchangeRateInput } from './settings.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const warehouseA = '44444444-4444-4444-8444-444444444444'
const now = new Date('2026-10-01T00:00:00.000Z')

type Row = Record<string, any>

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return true
}

class AccountDouble {
  accounts = new Map<string, Row>([
    [accountA, { id: accountA, baseCurrency: 'USD', lbpPerUsd: null }],
    [accountB, { id: accountB, baseCurrency: 'LBP', lbpPerUsd: null }],
  ])
  locks: string[] = []

  asClient(): PrismaClient {
    const store = this
    const client = {
      account: {
        async findUnique({ where }: Row) { const row = store.accounts.get(where.id); return row ? { baseCurrency: row.baseCurrency, lbpPerUsd: row.lbpPerUsd } : null },
        async update({ where, data }: Row) {
          const row = store.accounts.get(where.id)!
          row.lbpPerUsd = data.lbpPerUsd
          return { baseCurrency: row.baseCurrency, lbpPerUsd: row.lbpPerUsd }
        },
      },
      async $queryRaw(sql: Prisma.Sql) {
        const values = sql.values as string[]
        store.locks.push(values[0])
        const row = store.accounts.get(values[0])
        return row ? [{ id: row.id, baseCurrency: row.baseCurrency }] : []
      },
      async $transaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> { return callback(client) },
    }
    return client as unknown as PrismaClient
  }
}

function auth(role: UserRole, accountId = accountA): AuthDependencies {
  const userId = role === UserRole.WAREHOUSE ? warehouseA : ownerA
  return {
    async verifyAccessToken() { return { id: userId, email: 'user@example.com', emailConfirmedAt: now.toISOString(), isAnonymous: false } },
    async findApplicationUser() { return { id: userId, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountId, isActive: true } },
    async findAccountById() { return { id: accountId, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null }, async bootstrapOwner() { throw Error('unused') },
  }
}

async function withServer(role: UserRole, store: AccountDouble, run: (base: string) => Promise<void>, accountId = accountA) {
  const app = express(); app.use(express.json())
  app.use('/api/settings', createSettingsRouter(auth(role, accountId), createSettingsDependencies(store.asClient())))
  app.use(errorHandler)
  const server = app.listen(0)
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`) }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('exchange rate input', () => {
  test('accepts a positive decimal with at most two places, or null to clear', () => {
    assert.equal(parseExchangeRateInput({ lbpPerUsd: '89500' }), '89500.00')
    assert.equal(parseExchangeRateInput({ lbpPerUsd: '89500.5' }), '89500.50')
    assert.equal(parseExchangeRateInput({ lbpPerUsd: null }), null)
  })

  test('rejects zero, negatives, too many places, huge values, numbers and extra fields', () => {
    for (const bad of [{ lbpPerUsd: '0' }, { lbpPerUsd: '0.00' }, { lbpPerUsd: '-5' }, { lbpPerUsd: '1.234' }, { lbpPerUsd: '1000000001' },
      { lbpPerUsd: 89500 }, { lbpPerUsd: '' }, { lbpPerUsd: 'abc' }, {}, { lbpPerUsd: '1', baseCurrency: 'EUR' }, [], 'x', null]) {
      assert.throws(() => parseExchangeRateInput(bad), (e) => expectHttp(e, 422, 'INVALID_EXCHANGE_RATE'))
    }
  })
})

describe('settings service and routes', () => {
  test('an OWNER sets, reads and clears the rate; the account row is locked first', async () => {
    const store = new AccountDouble()
    await withServer(UserRole.OWNER, store, async (base) => {
      const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' }
      assert.deepEqual(await (await fetch(`${base}/api/settings`, { headers })).json(), { settings: { baseCurrency: 'USD', lbpPerUsd: null } })
      const set = await fetch(`${base}/api/settings/exchange-rate`, { method: 'PUT', headers, body: JSON.stringify({ lbpPerUsd: '89500' }) })
      assert.equal(set.status, 200)
      assert.deepEqual(await set.json(), { settings: { baseCurrency: 'USD', lbpPerUsd: '89500.00' } })
      assert.deepEqual(store.locks, [accountA])
      assert.equal((await (await fetch(`${base}/api/settings`, { headers })).json() as Row).settings.lbpPerUsd, '89500.00')
      const cleared = await fetch(`${base}/api/settings/exchange-rate`, { method: 'PUT', headers, body: JSON.stringify({ lbpPerUsd: null }) })
      assert.equal((await cleared.json() as Row).settings.lbpPerUsd, null)
    })
  })

  test('a WAREHOUSE user can read the rate but not change it, and SUPER_ADMIN has no access', async () => {
    const store = new AccountDouble()
    store.accounts.get(accountA)!.lbpPerUsd = new Prisma.Decimal('90000')
    await withServer(UserRole.WAREHOUSE, store, async (base) => {
      const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' }
      assert.equal((await (await fetch(`${base}/api/settings`, { headers })).json() as Row).settings.lbpPerUsd, '90000.00')
      assert.equal((await fetch(`${base}/api/settings/exchange-rate`, { method: 'PUT', headers, body: JSON.stringify({ lbpPerUsd: '1' }) })).status, 403)
      assert.equal(store.accounts.get(accountA)!.lbpPerUsd.toFixed(2), '90000.00')
    })
    await withServer(UserRole.SUPER_ADMIN, store, async (base) => {
      assert.equal((await fetch(`${base}/api/settings`, { headers: { Authorization: 'Bearer test' } })).status, 403)
    })
  })

  test('an account that does not sell in USD cannot set a rate, and one account never reads another', async () => {
    const store = new AccountDouble()
    await withServer(UserRole.OWNER, store, async (base) => {
      const response = await fetch(`${base}/api/settings/exchange-rate`, { method: 'PUT', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ lbpPerUsd: '89500' }) })
      assert.equal(response.status, 409); assert.equal((await response.json() as Row).error.code, 'EXCHANGE_RATE_UNSUPPORTED_CURRENCY')
      assert.equal(store.accounts.get(accountB)!.lbpPerUsd, null)
    }, accountB)
    store.accounts.get(accountA)!.lbpPerUsd = new Prisma.Decimal('89500')
    await withServer(UserRole.OWNER, store, async (base) => {
      const body = await (await fetch(`${base}/api/settings`, { headers: { Authorization: 'Bearer test' } })).json() as Row
      assert.equal(body.settings.baseCurrency, 'LBP'); assert.equal(body.settings.lbpPerUsd, null, 'account B sees its own settings only')
    }, accountB)
  })
})
