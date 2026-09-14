import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ADMIN_INITIAL_STATE,
  approvePendingAccount,
  createAccountActionGuard,
  createRejectionDraft,
  initializeAdminDashboard,
  loadPendingAccounts,
  rejectPendingAccount,
  removePendingAccount,
  REJECTION_REASON_MAX_LENGTH,
  validateRejectionReason,
} from './admin-flow.js'

const userId = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'
const accessToken = 'synthetic-test-access-token'

const superAdminProfile = Object.freeze({
  user: {
    id: userId,
    firstName: 'Ada',
    lastName: 'Admin',
    role: 'SUPER_ADMIN',
    isActive: true,
  },
  account: null,
})

const ownerProfile = Object.freeze({
  user: {
    id: userId,
    firstName: 'Omar',
    lastName: 'Owner',
    role: 'OWNER',
    isActive: true,
  },
  account: {
    id: accountId,
    name: 'Owner Store',
    status: 'PENDING',
    rejectionReason: null,
  },
})

const pendingAccount = Object.freeze({
  account: {
    id: accountId,
    name: 'Cedar Clothes',
    baseCurrency: 'USD',
    status: 'PENDING',
    createdAt: '2026-09-14T10:00:00.000Z',
  },
  owner: {
    id: userId,
    firstName: 'Omar',
    lastName: 'Owner',
    email: 'owner@example.com',
  },
})

function createSupabase({ missingSession = false } = {}) {
  return {
    auth: {
      async getSession() {
        return {
          data: {
            session: missingSession
              ? null
              : {
                  access_token: accessToken,
                  user: {
                    id: userId,
                    user_metadata: { role: 'SUPER_ADMIN' },
                  },
                },
          },
          error: null,
        }
      },
    },
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

describe('admin authorization', () => {
  test('rejects unauthenticated access before any API request', async () => {
    const requests = []
    const result = await initializeAdminDashboard({
      supabase: createSupabase({ missingSession: true }),
      fetchImpl: async (...request) => {
        requests.push(request)
        return jsonResponse(500, {})
      },
    })

    assert.equal(result.code, 'SESSION_REQUIRED')
    assert.deepEqual(requests, [])
  })

  test('uses the server profile and prevents an OWNER from loading admin data', async () => {
    const requests = []
    const result = await initializeAdminDashboard({
      supabase: createSupabase(),
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return jsonResponse(200, ownerProfile)
      },
    })

    assert.equal(result.code, 'ADMIN_FORBIDDEN')
    assert.equal(result.status, 403)
    assert.deepEqual(requests.map(({ url }) => url), ['/api/auth/me'])
  })

  test('allows a tenantless SUPER_ADMIN and then loads pending data', async () => {
    const requests = []
    const result = await initializeAdminDashboard({
      supabase: createSupabase(),
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return url === '/api/auth/me'
          ? jsonResponse(200, superAdminProfile)
          : jsonResponse(200, { accounts: [pendingAccount] })
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.profile.user.role, 'SUPER_ADMIN')
    assert.equal(result.profile.account, null)
    assert.deepEqual(requests.map(({ url }) => url), [
      '/api/auth/me',
      '/api/admin/accounts/pending',
    ])
  })
})

describe('pending Account list', () => {
  test('starts in a loading state', () => {
    assert.deepEqual(ADMIN_INITIAL_STATE, { kind: 'loading', accounts: [] })
  })

  test('returns the safe fields needed to render pending Accounts', async () => {
    const requests = []
    const result = await loadPendingAccounts({
      supabase: createSupabase(),
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return jsonResponse(200, { accounts: [pendingAccount] })
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.accounts, [
      {
        account: pendingAccount.account,
        owner: {
          firstName: 'Omar',
          lastName: 'Owner',
          email: 'owner@example.com',
        },
      },
    ])
    assert.equal(Object.hasOwn(result.accounts[0].owner, 'id'), false)
    assert.equal(requests[0].url, '/api/admin/accounts/pending')
    assert.equal(requests[0].options.method, 'GET')
  })

  test('supports an empty pending list', async () => {
    const result = await loadPendingAccounts({
      supabase: createSupabase(),
      fetchImpl: async () => jsonResponse(200, { accounts: [] }),
    })

    assert.deepEqual(result, { ok: true, accounts: [] })
  })

  test('returns a safe error when the API fails', async () => {
    const result = await loadPendingAccounts({
      supabase: createSupabase(),
      fetchImpl: async () =>
        jsonResponse(500, {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'private database detail',
          },
        }),
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'INTERNAL_SERVER_ERROR')
    assert.doesNotMatch(result.message, /private|database/i)
  })
})

describe('Account approval', () => {
  test('calls the approval endpoint without reviewer, status, or body authority', async () => {
    const requests = []
    const result = await approvePendingAccount({
      supabase: createSupabase(),
      accountId,
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return jsonResponse(200, {
          account: { id: accountId, status: 'ACTIVE' },
        })
      },
    })

    assert.deepEqual(result, { ok: true, accountId })
    assert.equal(
      requests[0].url,
      `/api/admin/accounts/${accountId}/approve`,
    )
    assert.equal(requests[0].options.method, 'PATCH')
    assert.equal(Object.hasOwn(requests[0].options, 'body'), false)
    assert.equal(
      requests[0].options.headers.Authorization,
      `Bearer ${accessToken}`,
    )
  })

  test('blocks a duplicate action for the same Account', async () => {
    const guard = createAccountActionGuard()
    let completeFirst
    let operationCount = 0
    const first = guard.run(
      accountId,
      () =>
        new Promise((resolve) => {
          operationCount += 1
          completeFirst = resolve
        }),
    )
    const duplicate = await guard.run(accountId, async () => {
      operationCount += 1
    })

    assert.deepEqual(duplicate, { skipped: true })
    assert.equal(operationCount, 1)
    completeFirst({ ok: true })
    assert.deepEqual(await first, {
      skipped: false,
      value: { ok: true },
    })
  })

  test('removes a successfully reviewed Account from the pending list', () => {
    assert.deepEqual(removePendingAccount([pendingAccount], accountId), [])
  })

  test('marks a 409 response for a safe pending-list refresh', async () => {
    const result = await approvePendingAccount({
      supabase: createSupabase(),
      accountId,
      fetchImpl: async () =>
        jsonResponse(409, {
          error: { code: 'ACCOUNT_ALREADY_REVIEWED', message: 'private' },
        }),
    })

    assert.equal(result.code, 'ACCOUNT_ALREADY_REVIEWED')
    assert.equal(result.shouldRefresh, true)
    assert.doesNotMatch(result.message, /private/i)
  })

  test('handles a missing Account safely', async () => {
    const result = await approvePendingAccount({
      supabase: createSupabase(),
      accountId,
      fetchImpl: async () =>
        jsonResponse(404, {
          error: { code: 'ACCOUNT_NOT_FOUND', message: 'private' },
        }),
    })

    assert.equal(result.code, 'ACCOUNT_NOT_FOUND')
    assert.equal(result.status, 404)
    assert.match(result.message, /could not be found/i)
  })
})

describe('Account rejection', () => {
  test('creates a blank rejection draft when the form is opened', () => {
    assert.deepEqual(createRejectionDraft(accountId), {
      accountId,
      reason: '',
      error: '',
    })
  })

  test('rejects a blank reason', () => {
    const result = validateRejectionReason('   ')
    assert.equal(result.code, 'INVALID_REJECTION_REASON')
  })

  test('rejects a reason longer than 2000 characters', () => {
    const result = validateRejectionReason(
      'x'.repeat(REJECTION_REASON_MAX_LENGTH + 1),
    )
    assert.equal(result.code, 'INVALID_REJECTION_REASON')
  })

  test('sends only the trimmed rejection reason', async () => {
    const requests = []
    const result = await rejectPendingAccount({
      supabase: createSupabase(),
      accountId,
      reason: '  Documents are incomplete.  ',
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return jsonResponse(200, {
          account: { id: accountId, status: 'REJECTED' },
        })
      },
    })

    assert.deepEqual(result, { ok: true, accountId })
    assert.equal(
      requests[0].url,
      `/api/admin/accounts/${accountId}/reject`,
    )
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      reason: 'Documents are incomplete.',
    })
    assert.deepEqual(Object.keys(JSON.parse(requests[0].options.body)), [
      'reason',
    ])
  })

  test('blocks a duplicate rejection submission', async () => {
    const guard = createAccountActionGuard()
    let completeFirst
    let operationCount = 0
    const first = guard.run(
      accountId,
      () =>
        new Promise((resolve) => {
          operationCount += 1
          completeFirst = resolve
        }),
    )
    const duplicate = await guard.run(accountId, async () => {
      operationCount += 1
    })

    assert.deepEqual(duplicate, { skipped: true })
    assert.equal(operationCount, 1)
    completeFirst({ ok: true })
    await first
  })
})

describe('admin security', () => {
  test('does not log the session token while authorizing or loading Accounts', async () => {
    const logged = []
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error
    console.log = (...values) => logged.push(values)
    console.warn = (...values) => logged.push(values)
    console.error = (...values) => logged.push(values)

    try {
      await initializeAdminDashboard({
        supabase: createSupabase(),
        fetchImpl: async (url) =>
          url === '/api/auth/me'
            ? jsonResponse(200, superAdminProfile)
            : jsonResponse(200, { accounts: [] }),
      })
    } finally {
      console.log = originalLog
      console.warn = originalWarn
      console.error = originalError
    }

    assert.deepEqual(logged, [])
  })
})
