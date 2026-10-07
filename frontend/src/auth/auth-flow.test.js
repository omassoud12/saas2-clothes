import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  completeAuthCallback,
  exchangePasswordSetupCode,
  inspectAuthCallbackUrl,
  RECOVERY_REQUEST_MESSAGE,
  requestPasswordRecovery,
  updateInvitedUserPassword,
  validateNewPassword,
  verifyPasswordSetupSession,
} from './auth-flow.js'

const userId = '11111111-1111-4111-8111-111111111111'
const now = Date.parse('2026-09-14T12:00:00.000Z')

class MemoryStorage {
  values = new Map()

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, value)
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

function createSupabase(options = {}) {
  const calls = {
    getSession: 0,
    resetPasswordForEmail: [],
    updateUser: [],
    signOut: 0,
  }
  const client = {
    auth: {
      async resetPasswordForEmail(email, settings) {
        calls.resetPasswordForEmail.push({ email, settings })
        if (options.recoveryThrows) throw new Error('private recovery detail')
        return {
          data: {},
          error: options.recoveryError ? new Error('private recovery detail') : null,
        }
      },
      async getSession() {
        calls.getSession += 1
        return {
          data: {
            session: options.missingSession ? null : { user: { id: userId } },
          },
          error: options.sessionError ? new Error('private session detail') : null,
        }
      },
      async updateUser(value) {
        calls.updateUser.push(value)
        return {
          data: {},
          error: options.updateError ? new Error('private policy detail') : null,
        }
      },
      async signOut() {
        calls.signOut += 1
        return { error: options.signOutError ? new Error('private detail') : null }
      },
    },
  }

  return { client, calls }
}

describe('password recovery request', () => {
  test('normalizes email and derives the callback from the frontend origin', async () => {
    const { client, calls } = createSupabase()

    const result = await requestPasswordRecovery({
      supabase: client,
      email: ' ADMIN@Example.COM ',
      origin: 'http://localhost:5173',
    })

    assert.deepEqual(result, { ok: true, message: RECOVERY_REQUEST_MESSAGE })
    assert.deepEqual(calls.resetPasswordForEmail, [
      {
        email: 'admin@example.com',
        settings: { redirectTo: 'http://localhost:5173/auth/callback' },
      },
    ])
  })

  test('rejects invalid email without calling Supabase', async () => {
    const { client, calls } = createSupabase()
    const result = await requestPasswordRecovery({
      supabase: client,
      email: 'not-an-email',
      origin: 'http://localhost:5173',
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVALID_RECOVERY_EMAIL')
    assert.deepEqual(calls.resetPasswordForEmail, [])
  })

  for (const failureMode of ['returned', 'thrown']) {
    test(`handles a ${failureMode} Supabase error with the neutral response`, async () => {
      const { client } = createSupabase({
        recoveryError: failureMode === 'returned',
        recoveryThrows: failureMode === 'thrown',
      })

      const result = await requestPasswordRecovery({
        supabase: client,
        email: 'admin@example.com',
        origin: 'http://localhost:5173',
      })

      assert.deepEqual(result, { ok: true, message: RECOVERY_REQUEST_MESSAGE })
      assert.doesNotMatch(result.message, /private|registered/i)
    })
  }
})

async function establishInvitation(storage, client, callback = { kind: 'invite', hasError: false }) {
  return completeAuthCallback({
    supabase: client,
    callback,
    storage,
    now,
    clearUrl() {},
    navigate() {},
  })
}

describe('invitation callback', () => {
  test('recognizes a code-only callback without exposing the code', () => {
    assert.deepEqual(inspectAuthCallbackUrl('https://app.example/auth/callback?code=private-code'), {
      kind: null, hasError: false, hasCode: true,
    })
    assert.deepEqual(inspectAuthCallbackUrl('https://app.example/auth/callback?type=signup&code=private-code'), {
      kind: null, hasError: false,
    })
  })

  for (const kind of ['invite', 'recovery']) {
    test(`exchanges a code-only ${kind} through the SDK before allowing password setup`, async () => {
      const { client } = createSupabase()
      const calls = []
      client.auth.exchangeCodeForSession = async (...args) => {
        calls.push(args)
        return {
          data: {
            redirectType: kind === 'recovery' ? 'recovery' : null,
            session: { user: { id: userId, invited_at: kind === 'invite' ? '2026-09-14' : null, email_confirmed_at: '2026-09-14' } },
          },
          error: null,
        }
      }
      const storage = new MemoryStorage()
      const result = await completeAuthCallback({
        supabase: client,
        callback: inspectAuthCallbackUrl('https://app.example/auth/callback?code=private-code'),
        exchangeCode: () => exchangePasswordSetupCode({ supabase: client, code: 'private-code', flowId: 'flow-id' }),
        storage, now, navigate() {}, clearUrl() {},
      })
      assert.deepEqual(calls, [['private-code', { flowId: 'flow-id' }]])
      assert.deepEqual(result, { ok: true, redirectTo: '/set-password' })
      assert.equal((await verifyPasswordSetupSession({ supabase: client, storage, now })).ok, true)
      assert.doesNotMatch(JSON.stringify(result) + JSON.stringify([...storage.values]), /private-code/)
    })
  }

  test('a failed code exchange never falls back to an existing signed-in session', async () => {
    const { client, calls } = createSupabase()
    client.auth.exchangeCodeForSession = async () => ({ data: null, error: new Error('private code detail') })
    const storage = new MemoryStorage()
    await establishInvitation(storage, client)
    calls.getSession = 0
    let cleaned = false
    const result = await completeAuthCallback({
      supabase: client, callback: { kind: null, hasError: false, hasCode: true },
      exchangeCode: () => exchangePasswordSetupCode({ supabase: client, code: 'expired-code' }),
      storage, now, navigate() { assert.fail('must not navigate') }, clearUrl() { cleaned = true },
    })
    assert.equal(result.code, 'INVITATION_INVALID')
    assert.equal(calls.getSession, 0)
    assert.equal(storage.values.size, 0)
    assert.equal(cleaned, true)
  })

  test('does not allow a signup or OAuth code to establish a password setup session', async () => {
    const { client } = createSupabase()
    client.auth.exchangeCodeForSession = async () => ({
      data: { redirectType: null, session: { user: { id: userId, email_confirmed_at: '2026-09-14' } } }, error: null,
    })
    assert.equal((await exchangePasswordSetupCode({ supabase: client, code: 'signup-code' })).ok, false)
  })

  test('rejects a code callback if the active identity differs from the exchanged identity', async () => {
    const { client } = createSupabase()
    const storage = new MemoryStorage()
    const result = await completeAuthCallback({
      supabase: client, callback: { kind: null, hasError: false, hasCode: true },
      exchangeCode: async () => ({ ok: true, kind: 'recovery', userId: 'another-user' }),
      storage, now, navigate() { assert.fail('must not navigate') }, clearUrl() {},
    })
    assert.equal(result.code, 'INVITATION_SESSION_MISSING')
    assert.equal(storage.values.size, 0)
  })

  test('rejects conflicting callback intent and never exchanges a callback containing an error', async () => {
    const { client } = createSupabase()
    for (const callback of [
      { kind: 'invite', hasCode: true, hasError: false },
      { kind: null, hasCode: true, hasError: true },
    ]) {
      let exchanged = false
      const storage = new MemoryStorage()
      const result = await completeAuthCallback({
        supabase: client, callback, storage, now, clearUrl() {},
        navigate() { assert.fail('must not navigate') },
        exchangeCode: async () => { exchanged = true; return { ok: true, kind: 'recovery', userId } },
      })
      assert.equal(result.code, 'INVITATION_INVALID')
      assert.equal(exchanged, !callback.hasError)
      assert.equal(storage.values.size, 0)
    }
  })

  test('recognizes invite and recovery callback intent without returning tokens', () => {
    assert.deepEqual(
      inspectAuthCallbackUrl('https://app.example/auth/callback#type=invite&access_token=hidden'),
      { kind: 'invite', hasError: false },
    )
    assert.deepEqual(
      inspectAuthCallbackUrl('https://app.example/auth/callback?type=recovery&code=hidden'),
      { kind: 'recovery', hasError: false, hasCode: true },
    )
  })

  test('accepts a valid invitation session and redirects to set-password', async () => {
    const storage = new MemoryStorage()
    const { client } = createSupabase()
    let cleaned = false
    let destination

    const result = await completeAuthCallback({
      supabase: client,
      callback: { kind: 'invite', hasError: false },
      storage,
      now,
      clearUrl() {
        cleaned = true
      },
      navigate(path) {
        destination = path
      },
    })

    assert.deepEqual(result, { ok: true, redirectTo: '/set-password' })
    assert.equal(cleaned, true)
    assert.equal(destination, '/set-password')
    assert.equal(
      (await verifyPasswordSetupSession({ supabase: client, storage, now })).ok,
      true,
    )
  })

  test('reuses the same callback and set-password flow for recovery', async () => {
    const storage = new MemoryStorage()
    const { client, calls } = createSupabase()
    const callback = await establishInvitation(storage, client, {
      kind: 'recovery',
      hasError: false,
    })
    const passwordUpdate = await updateInvitedUserPassword({
      supabase: client,
      storage,
      newPassword: 'strong-pass-1',
      confirmPassword: 'strong-pass-1',
      now,
    })

    assert.deepEqual(callback, { ok: true, redirectTo: '/set-password' })
    assert.deepEqual(passwordUpdate, { ok: true, redirectTo: '/login' })
    assert.equal(calls.updateUser.length, 1)
    assert.equal(calls.signOut, 1)
  })

  test('rejects an invalid callback safely', async () => {
    const storage = new MemoryStorage()
    const { client, calls } = createSupabase()
    const result = await establishInvitation(storage, client, {
      kind: 'invite',
      hasError: true,
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVITATION_INVALID')
    assert.equal(calls.getSession, 0)
  })

  test('rejects a callback with a missing session', async () => {
    const storage = new MemoryStorage()
    const { client } = createSupabase({ missingSession: true })
    const result = await establishInvitation(storage, client)

    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVITATION_SESSION_MISSING')
  })
})

describe('set-password flow', () => {
  test('rejects a random visit without a callback-bound session', async () => {
    const storage = new MemoryStorage()
    const { client, calls } = createSupabase()
    const result = await verifyPasswordSetupSession({ supabase: client, storage, now })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'PASSWORD_SETUP_SESSION_REQUIRED')
    assert.equal(calls.getSession, 0)
  })

  test('rejects an expired invitation marker', async () => {
    const storage = new MemoryStorage()
    const { client } = createSupabase()
    await establishInvitation(storage, client)

    const result = await verifyPasswordSetupSession({
      supabase: client,
      storage,
      now: now + 16 * 60 * 1000,
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'PASSWORD_SETUP_SESSION_REQUIRED')
  })

  test('rejects password mismatch', () => {
    const result = validateNewPassword('strong-pass-1', 'strong-pass-2')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'PASSWORD_MISMATCH')
  })

  test('rejects a weak password', () => {
    const result = validateNewPassword('short', 'short')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'PASSWORD_TOO_SHORT')
  })

  test('updates Supabase directly, signs out, and returns the login redirect', async () => {
    const storage = new MemoryStorage()
    const { client, calls } = createSupabase()
    await establishInvitation(storage, client)

    const result = await updateInvitedUserPassword({
      supabase: client,
      storage,
      newPassword: 'strong-pass-1',
      confirmPassword: 'strong-pass-1',
      now,
    })

    assert.deepEqual(result, { ok: true, redirectTo: '/login' })
    assert.deepEqual(calls.updateUser, [{ password: 'strong-pass-1' }])
    assert.equal(calls.signOut, 1)
    assert.equal(
      (await verifyPasswordSetupSession({ supabase: client, storage, now })).ok,
      false,
    )
  })

  test('shows a safe Supabase update error without internal details', async () => {
    const storage = new MemoryStorage()
    const { client } = createSupabase({ updateError: true })
    await establishInvitation(storage, client)

    const result = await updateInvitedUserPassword({
      supabase: client,
      storage,
      newPassword: 'strong-pass-1',
      confirmPassword: 'strong-pass-1',
      now,
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'PASSWORD_UPDATE_FAILED')
    assert.doesNotMatch(result.message, /private|token|password value/i)
  })

  test('does not log callback credentials or passwords', async () => {
    const storage = new MemoryStorage()
    const { client } = createSupabase()
    const originalLog = console.log
    const originalError = console.error
    const logged = []
    console.log = (...values) => logged.push(values)
    console.error = (...values) => logged.push(values)

    try {
      await establishInvitation(storage, client)
      await updateInvitedUserPassword({
        supabase: client,
        storage,
        newPassword: 'strong-pass-1',
        confirmPassword: 'strong-pass-1',
        now,
      })
    } finally {
      console.log = originalLog
      console.error = originalError
    }

    assert.deepEqual(logged, [])
  })
})
