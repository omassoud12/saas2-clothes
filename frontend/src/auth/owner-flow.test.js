import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  bootstrapOwnerAccount,
  completeSignupCallback,
  createOwnerBootstrapPayload,
  createSubmissionGuard,
  getApplicationDestination,
  getPendingAccountView,
  inspectSignupCallbackUrl,
  loadOwnerOnboarding,
  OWNER_SIGNUP_MESSAGE,
  requestOwnerSignup,
  resolveExistingSessionDestination,
  resolvePostLoginDestination,
  signInApplicationUser,
  verifyAuthenticatedSession,
} from './owner-flow.js'

const confirmedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email_confirmed_at: '2026-09-14T12:00:00.000Z',
}

function createSupabase(options = {}) {
  const calls = { signUp: [], signIn: [], getSession: 0 }
  const client = {
    auth: {
      async signInWithPassword(input) {
        calls.signIn.push(input)
        if (options.signInThrows) throw new Error('private network detail')
        return {
          data: {},
          error: options.signInError ? new Error('private provider detail') : null,
        }
      },
      async signUp(input) {
        calls.signUp.push(input)
        if (options.signupThrows) throw new Error('private signup detail')
        return {
          data: {},
          error: options.signupError ? new Error('private signup detail') : null,
        }
      },
      async getSession() {
        calls.getSession += 1
        if (options.sessionThrows) throw new Error('private session detail')
        return {
          data: {
            session: options.missingSession
              ? null
              : {
                  access_token: 'test-access-token',
                  user: options.unconfirmedUser
                    ? { ...confirmedUser, email_confirmed_at: null }
                    : confirmedUser,
                },
          },
          error: options.sessionError ? new Error('private session detail') : null,
        }
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

function ownerProfile(status, overrides = {}) {
  return {
    user: {
      id: confirmedUser.id,
      firstName: 'Ada',
      lastName: 'Owner',
      role: 'OWNER',
      isActive: true,
    },
    account: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Ada Store',
      status,
      rejectionReason: null,
      ...overrides,
    },
  }
}

describe('OWNER signup', () => {
  test('normalizes a valid request and sends no application metadata', async () => {
    const { client, calls } = createSupabase()
    const result = await requestOwnerSignup({
      supabase: client,
      email: ' OWNER@Example.COM ',
      password: 'strong-pass-1',
      confirmPassword: 'strong-pass-1',
      origin: 'http://localhost:5173',
    })

    assert.deepEqual(result, { ok: true, message: OWNER_SIGNUP_MESSAGE })
    assert.deepEqual(calls.signUp, [
      {
        email: 'owner@example.com',
        password: 'strong-pass-1',
        options: {
          emailRedirectTo: 'http://localhost:5173/auth/signup-callback',
        },
      },
    ])
    assert.equal(Object.hasOwn(calls.signUp[0].options, 'data'), false)
  })

  test('rejects an invalid email without calling Supabase', async () => {
    const { client, calls } = createSupabase()
    const result = await requestOwnerSignup({
      supabase: client,
      email: 'invalid-email',
      password: 'strong-pass-1',
      confirmPassword: 'strong-pass-1',
      origin: 'http://localhost:5173',
    })

    assert.equal(result.code, 'INVALID_SIGNUP_EMAIL')
    assert.deepEqual(calls.signUp, [])
  })

  test('rejects mismatched passwords without calling Supabase', async () => {
    const { client, calls } = createSupabase()
    const result = await requestOwnerSignup({
      supabase: client,
      email: 'owner@example.com',
      password: 'strong-pass-1',
      confirmPassword: 'strong-pass-2',
      origin: 'http://localhost:5173',
    })

    assert.equal(result.code, 'SIGNUP_PASSWORD_MISMATCH')
    assert.deepEqual(calls.signUp, [])
  })

  test('handles a Supabase signup error without leaking provider details', async () => {
    const { client } = createSupabase({ signupError: true })
    const result = await requestOwnerSignup({
      supabase: client,
      email: 'owner@example.com',
      password: 'strong-pass-1',
      confirmPassword: 'strong-pass-1',
      origin: 'http://localhost:5173',
    })

    assert.equal(result.code, 'OWNER_SIGNUP_FAILED')
    assert.doesNotMatch(result.message, /private|registered|provider/i)
  })

  test('submission guard prevents a concurrent second request', async () => {
    const guard = createSubmissionGuard()
    let releaseFirst
    let requestCount = 0
    const first = guard.run(
      () =>
        new Promise((resolve) => {
          requestCount += 1
          releaseFirst = resolve
        }),
    )
    const second = await guard.run(async () => {
      requestCount += 1
    })

    assert.deepEqual(second, { skipped: true })
    assert.equal(requestCount, 1)
    releaseFirst('complete')
    assert.deepEqual(await first, { skipped: false, value: 'complete' })
  })
})

describe('signup confirmation callback', () => {
  test('accepts a confirmed session and redirects to onboarding', async () => {
    const { client } = createSupabase()
    let cleaned = false
    let destination
    const result = await completeSignupCallback({
      supabase: client,
      callback: { hasError: false, hasConfirmationParameters: true },
      clearUrl() {
        cleaned = true
      },
      navigate(path) {
        destination = path
      },
      fetchImpl: async () =>
        jsonResponse(403, { error: { code: 'APPLICATION_USER_NOT_FOUND' } }),
    })

    assert.deepEqual(result, { ok: true, redirectTo: '/owner/onboarding' })
    assert.equal(cleaned, true)
    assert.equal(destination, '/owner/onboarding')
  })

  test('rejects invalid and expired confirmation callbacks safely', async () => {
    const invalidClient = createSupabase()
    const invalid = await completeSignupCallback({
      supabase: invalidClient.client,
      callback: { hasError: true, hasConfirmationParameters: true },
      clearUrl() {},
      navigate() {},
    })
    const expired = await completeSignupCallback({
      supabase: createSupabase({ missingSession: true }).client,
      callback: { hasError: false, hasConfirmationParameters: true },
      clearUrl() {},
      navigate() {},
    })

    assert.equal(invalid.code, 'SIGNUP_CONFIRMATION_INVALID')
    assert.equal(invalidClient.calls.getSession, 0)
    assert.equal(expired.code, 'SIGNUP_CONFIRMATION_SESSION_MISSING')
  })

  test('recognizes callback intent without returning or logging tokens', async () => {
    const secret = 'callback-secret-value'
    const callback = inspectSignupCallbackUrl(
      `http://localhost:5173/auth/signup-callback#type=signup&access_token=${secret}`,
    )
    const originalLog = console.log
    const originalError = console.error
    const logged = []
    console.log = (...values) => logged.push(values)
    console.error = (...values) => logged.push(values)

    try {
      await completeSignupCallback({
        supabase: createSupabase().client,
        callback,
        clearUrl() {},
        navigate() {},
        fetchImpl: async () =>
          jsonResponse(403, { error: { code: 'APPLICATION_USER_NOT_FOUND' } }),
      })
    } finally {
      console.log = originalLog
      console.error = originalError
    }

    assert.deepEqual(callback, {
      hasError: false,
      hasConfirmationParameters: true,
    })
    assert.doesNotMatch(JSON.stringify(callback), new RegExp(secret))
    assert.deepEqual(logged, [])
  })
})

describe('OWNER onboarding', () => {
  test('allows only an authenticated unprovisioned identity to see the form', async () => {
    const result = await loadOwnerOnboarding({
      supabase: createSupabase().client,
      fetchImpl: async () => jsonResponse(403, { error: { code: 'APPLICATION_USER_NOT_FOUND' } }),
    })
    assert.deepEqual(result, { ok: true })
  })

  for (const [role, status, redirectTo] of [
    ['SUPER_ADMIN', null, '/admin'],
    ['OWNER', 'ACTIVE', '/app'],
    ['WAREHOUSE', 'ACTIVE', '/app'],
    ['OWNER', 'PENDING', '/pending-approval'],
    ['OWNER', 'REJECTED', '/account-inactive'],
    ['WAREHOUSE', 'SUSPENDED', '/account-inactive'],
  ]) {
    test(`routes provisioned ${role}/${status} away from onboarding`, async () => {
      const result = await loadOwnerOnboarding({
        supabase: createSupabase().client,
        fetchImpl: async () => jsonResponse(200, { user: { role }, account: status ? { status } : null }),
      })
      assert.deepEqual(result, { ok: true, redirectTo })
    })
  }

  for (const [status, code] of [[401, 'INVALID_ACCESS_TOKEN'], [403, 'USER_INACTIVE'], [500, 'APPLICATION_USER_NOT_FOUND']]) {
    test(`does not show onboarding for ${status}/${code}`, async () => {
      const result = await loadOwnerOnboarding({
        supabase: createSupabase().client,
        fetchImpl: async () => jsonResponse(status, { error: { code } }),
      })
      assert.equal(result.ok, false)
      assert.equal(result.code, code)
    })
  }

  test('does not show onboarding without a session or after a network failure', async () => {
    let requested = false
    const result = await loadOwnerOnboarding({
      supabase: createSupabase({ missingSession: true }).client,
      fetchImpl: async () => { requested = true },
    })
    assert.equal(result.code, 'SESSION_REQUIRED')
    assert.equal(requested, false)
    assert.equal((await loadOwnerOnboarding({
      supabase: createSupabase().client,
      fetchImpl: async () => { throw new Error('private network detail') },
    })).ok, false)
  })

  test('blocks unauthenticated access', async () => {
    const result = await verifyAuthenticatedSession({
      supabase: createSupabase({ missingSession: true }).client,
    })

    assert.equal(result.code, 'SESSION_REQUIRED')
  })

  test('normalizes the valid payload and excludes injected privileged fields', () => {
    const result = createOwnerBootstrapPayload({
      firstName: ' Ada ',
      lastName: ' Owner ',
      accountName: ' Ada Store ',
      baseCurrency: 'usd',
      employeeCode: ' owner_1 ',
      role: 'SUPER_ADMIN',
      accountId: 'attacker-account',
      userId: 'attacker-user',
      isActive: false,
      status: 'ACTIVE',
      reviewedById: 'attacker-reviewer',
      reviewedAt: '2026-09-14T12:00:00Z',
    })

    assert.deepEqual(result, {
      ok: true,
      payload: {
        firstName: 'Ada',
        lastName: 'Owner',
        accountName: 'Ada Store',
        baseCurrency: 'USD',
        employeeCode: 'OWNER_1',
      },
    })
  })

  for (const status of [201, 200]) {
    test(`treats backend ${status} as a successful bootstrap`, async () => {
      const requests = []
      const result = await bootstrapOwnerAccount({
        supabase: createSupabase().client,
        fetchImpl: async (url, options) => {
          requests.push({ url, options })
          return jsonResponse(status, {
            user: { role: 'OWNER' },
            account: { status: 'PENDING' },
          })
        },
        input: {
          firstName: 'Ada',
          lastName: 'Owner',
          accountName: 'Ada Store',
          baseCurrency: 'LBP',
          employeeCode: '',
        },
      })

      assert.deepEqual(result, { ok: true, status })
      assert.equal(requests[0].url, '/api/auth/bootstrap-owner')
      assert.equal(requests[0].options.method, 'POST')
      assert.equal(
        requests[0].options.headers.Authorization,
        'Bearer test-access-token',
      )
      assert.deepEqual(JSON.parse(requests[0].options.body), {
        firstName: 'Ada',
        lastName: 'Owner',
        accountName: 'Ada Store',
        baseCurrency: 'LBP',
      })
    })
  }

  test('shows a safe backend error', async () => {
    const result = await bootstrapOwnerAccount({
      supabase: createSupabase().client,
      fetchImpl: async () =>
        jsonResponse(500, {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'private database detail',
          },
        }),
      input: {
        firstName: 'Ada',
        lastName: 'Owner',
        accountName: 'Ada Store',
        baseCurrency: 'USD',
      },
    })

    assert.equal(result.ok, false)
    assert.doesNotMatch(result.message, /private|database/i)
  })
})

test('account status pages send a tenantless SUPER_ADMIN to admin without throwing', () => {
  assert.deepEqual(getPendingAccountView({ user: { role: 'SUPER_ADMIN' }, account: null }), {
    ok: true, redirectTo: '/admin',
  })
  assert.equal(getPendingAccountView({ user: { role: 'OWNER' }, account: null }).ok, false)
})

describe('pending approval state', () => {
  test('presents the PENDING state', () => {
    const view = getPendingAccountView(ownerProfile('PENDING'))
    assert.equal(view.status, 'PENDING')
    assert.match(view.message, /waiting/i)
  })

  test('presents a REJECTED state with the server reason', () => {
    const view = getPendingAccountView(
      ownerProfile('REJECTED', { rejectionReason: 'Documents incomplete' }),
    )
    assert.equal(view.status, 'REJECTED')
    assert.equal(view.rejectionReason, 'Documents incomplete')
  })

  test('presents the SUSPENDED state', () => {
    const view = getPendingAccountView(ownerProfile('SUSPENDED'))
    assert.equal(view.status, 'SUSPENDED')
    assert.match(view.message, /suspended/i)
  })

  test('redirects an ACTIVE Account away from the pending page', () => {
    assert.deepEqual(getPendingAccountView(ownerProfile('ACTIVE')), {
      ok: true,
      redirectTo: '/app',
    })
  })
})

describe('login submission and session restore', () => {
  test('normalizes credentials and resolves an active OWNER destination', async () => {
    const { client, calls } = createSupabase()
    const result = await signInApplicationUser({
      supabase: client,
      email: ' OWNER@Example.COM ',
      password: 'secure-password',
      fetchImpl: async () => jsonResponse(200, ownerProfile('ACTIVE')),
    })

    assert.deepEqual(calls.signIn, [{ email: 'owner@example.com', password: 'secure-password' }])
    assert.deepEqual(result, { ok: true, redirectTo: '/app' })
  })

  test('keeps provider and network failures distinct and safe', async () => {
    const rejected = await signInApplicationUser({
      supabase: createSupabase({ signInError: true }).client,
      email: 'owner@example.com',
      password: 'incorrect',
    })
    const unavailable = await signInApplicationUser({
      supabase: createSupabase({ signInThrows: true }).client,
      email: 'owner@example.com',
      password: 'secret',
    })

    assert.equal(rejected.code, 'LOGIN_REJECTED')
    assert.match(rejected.message, /not accepted/i)
    assert.equal(unavailable.code, 'AUTH_SERVICE_UNAVAILABLE')
    assert.match(unavailable.message, /connection/i)
    assert.doesNotMatch(`${rejected.message} ${unavailable.message}`, /private|provider/i)
  })

  test('returns an unauthenticated state without requesting a profile', async () => {
    let requested = false
    const result = await resolveExistingSessionDestination({
      supabase: createSupabase({ missingSession: true }).client,
      fetchImpl: async () => { requested = true },
    })

    assert.deepEqual(result, { ok: true, authenticated: false })
    assert.equal(requested, false)
  })

  test('restores an active session through the authoritative profile', async () => {
    const result = await resolveExistingSessionDestination({
      supabase: createSupabase().client,
      fetchImpl: async () => jsonResponse(200, ownerProfile('ACTIVE')),
    })

    assert.deepEqual(result, { ok: true, redirectTo: '/app', authenticated: true })
  })
})

describe('login routing', () => {
  const expectedRoutes = [
    [
      { user: { role: 'SUPER_ADMIN' }, account: null },
      '/admin',
    ],
    [ownerProfile('PENDING'), '/pending-approval'],
    [ownerProfile('ACTIVE'), '/app'],
    [ownerProfile('REJECTED'), '/account-inactive'],
    [ownerProfile('SUSPENDED'), '/account-inactive'],
  ]

  for (const [profile, expectedRoute] of expectedRoutes) {
    test(`routes ${profile.user.role} ${profile.account?.status ?? ''} to ${expectedRoute}`, () => {
      assert.deepEqual(getApplicationDestination(profile), {
        ok: true,
        redirectTo: expectedRoute,
      })
    })
  }

  test('routes a confirmed but unprovisioned identity to OWNER onboarding', async () => {
    const result = await resolvePostLoginDestination({
      supabase: createSupabase().client,
      fetchImpl: async () =>
        jsonResponse(403, {
          error: { code: 'APPLICATION_USER_NOT_FOUND', message: 'safe' },
        }),
    })

    assert.deepEqual(result, { ok: true, redirectTo: '/owner/onboarding' })
  })

  for (const failure of [
    {
      name: 'invalid or expired access token',
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    },
    { name: 'inactive application User', status: 403, code: 'USER_INACTIVE' },
    {
      name: 'unprovisioned code with the wrong status',
      status: 500,
      code: 'APPLICATION_USER_NOT_FOUND',
    },
    { name: 'unrelated server error', status: 500, code: 'INTERNAL_SERVER_ERROR' },
  ]) {
    test(`does not route ${failure.name} to onboarding`, async () => {
      const result = await resolvePostLoginDestination({
        supabase: createSupabase().client,
        fetchImpl: async () =>
          jsonResponse(failure.status, {
            error: { code: failure.code, message: 'safe' },
          }),
      })

      assert.equal(result.ok, false)
      assert.notEqual(result.redirectTo, '/owner/onboarding')
    })
  }

  test('does not route a network failure to onboarding', async () => {
    const result = await resolvePostLoginDestination({
      supabase: createSupabase().client,
      fetchImpl: async () => {
        throw new Error('private network detail')
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'API_UNAVAILABLE')
    assert.notEqual(result.redirectTo, '/owner/onboarding')
  })
})
