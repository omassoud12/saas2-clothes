import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  authorizeBusinessProfile,
  getBusinessShellIdentity,
  loadBusinessAppProfile,
  logoutBusinessApp,
} from './app-flow.js'
import {
  getAppNavigation,
  isNavigationItemActive,
  resolveAppRoute,
} from './app-navigation.js'
import { isBusinessPath, normalizePathname, ROUTES } from './routes.js'

const userId = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'

function createProfile(role, status = 'ACTIVE') {
  return {
    user: {
      id: userId,
      firstName: 'Omar',
      lastName: 'Massoud',
      role,
      isActive: true,
    },
    account:
      role === 'SUPER_ADMIN'
        ? null
        : {
            id: accountId,
            name: 'Cedar Clothes',
            status,
            rejectionReason: null,
          },
  }
}

function createSupabase({ missingSession = false, signOutError = false } = {}) {
  const calls = { signOut: 0 }
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: missingSession
              ? null
              : {
                  access_token: 'synthetic-test-access-token',
                  user: {
                    id: userId,
                    user_metadata: {
                      role: 'SUPER_ADMIN',
                      accountId: 'client-controlled-account',
                    },
                  },
                },
          },
          error: null,
        }
      },
      async signOut() {
        calls.signOut += 1
        return { error: signOutError ? new Error('private detail') : null }
      },
    },
  }

  return { client, calls }
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

describe('business app guard', () => {
  test('redirects an unauthenticated session to login', async () => {
    const requests = []
    const result = await loadBusinessAppProfile({
      supabase: createSupabase({ missingSession: true }).client,
      fetchImpl: async (...request) => {
        requests.push(request)
        return jsonResponse(500, {})
      },
    })

    assert.deepEqual(result, { ok: false, redirectTo: '/login' })
    assert.deepEqual(requests, [])
  })

  test('redirects SUPER_ADMIN to the separate admin area', () => {
    assert.deepEqual(authorizeBusinessProfile(createProfile('SUPER_ADMIN')), {
      ok: false,
      redirectTo: '/admin',
    })
  })

  for (const [status, redirectTo] of [
    ['PENDING', '/pending-approval'],
    ['REJECTED', '/account-inactive'],
    ['SUSPENDED', '/account-inactive'],
  ]) {
    test(`redirects an OWNER with a ${status} Account to its status page`, () => {
      assert.deepEqual(authorizeBusinessProfile(createProfile('OWNER', status)), {
        ok: false,
        redirectTo,
      })
    })
  }

  for (const role of ['OWNER', 'WAREHOUSE']) {
    test(`allows an ACTIVE ${role}`, () => {
      const profile = createProfile(role)
      assert.deepEqual(authorizeBusinessProfile(profile), {
        ok: true,
        profile,
      })
    })
  }

  test('does not misclassify a network failure as unauthorized', async () => {
    const result = await loadBusinessAppProfile({
      supabase: createSupabase().client,
      fetchImpl: async () => {
        throw new Error('private network detail')
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'API_UNAVAILABLE')
    assert.equal(Object.hasOwn(result, 'redirectTo'), false)
    assert.doesNotMatch(result.message, /private|network detail/i)
  })
})

describe('business app navigation', () => {
  test('shows every business module to OWNER', () => {
    assert.deepEqual(
      getAppNavigation('OWNER').map(({ key }) => key),
      [
        'dashboard',
        'products',
        'categories',
        'inventory',
        'sales',
        'returns',
        'exchanges',
        'expenses',
        'reports',
      ],
    )
  })

  test('hides Expenses and Reports from WAREHOUSE', () => {
    assert.deepEqual(
      getAppNavigation('WAREHOUSE').map(({ key }) => key),
      ['dashboard', 'products', 'categories', 'inventory', 'sales', 'returns', 'exchanges'],
    )
  })

  test('marks only the exact current navigation route active', () => {
    assert.equal(
      isNavigationItemActive('/app/products', '/app/products'),
      true,
    )
    assert.equal(
      isNavigationItemActive('/app/inventory', '/app/products'),
      false,
    )
  })

  test('redirects /app to /app/dashboard', () => {
    const result = resolveAppRoute('/app', 'OWNER')
    assert.equal(result.route.key, 'dashboard')
    assert.equal(result.redirectTo, '/app/dashboard')
  })

  test('does not route WAREHOUSE directly to an OWNER-only module', () => {
    const result = resolveAppRoute('/app/expenses', 'WAREHOUSE')
    assert.equal(result.route.key, 'dashboard')
    assert.equal(result.redirectTo, '/app/dashboard')
  })

  test('keeps public and business paths centralized and normalized', () => {
    assert.equal(normalizePathname('/app/products///'), ROUTES.products)
    assert.equal(isBusinessPath(ROUTES.exchanges), true)
    assert.equal(isBusinessPath(ROUTES.login), false)
  })

  test('does not expose tenant navigation to SUPER_ADMIN', () => {
    assert.deepEqual(getAppNavigation('SUPER_ADMIN'), [])
  })
})

describe('business shell profile and logout', () => {
  test('uses store and user names from the backend profile', async () => {
    const backendProfile = createProfile('OWNER')
    const { client } = createSupabase()
    const result = await loadBusinessAppProfile({
      supabase: client,
      fetchImpl: async () => jsonResponse(200, backendProfile),
    })

    assert.equal(result.ok, true)
    assert.deepEqual(getBusinessShellIdentity(result.profile), {
      storeName: 'Cedar Clothes',
      userName: 'Omar Massoud',
      role: 'OWNER',
    })
    assert.equal(result.profile.account.id, accountId)
  })

  test('calls Supabase signOut and redirects to login', async () => {
    const { client, calls } = createSupabase()
    const redirects = []
    const result = await logoutBusinessApp({
      supabase: client,
      redirect: (path) => redirects.push(path),
    })

    assert.deepEqual(result, { ok: true, redirectTo: '/login' })
    assert.equal(calls.signOut, 1)
    assert.deepEqual(redirects, ['/login'])
  })
})
