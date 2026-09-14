import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  completeAuthCallback,
  inspectAuthCallbackUrl,
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
  const calls = { getSession: 0, updateUser: [], signOut: 0 }
  const client = {
    auth: {
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
  test('recognizes invite and recovery callback intent without returning tokens', () => {
    assert.deepEqual(
      inspectAuthCallbackUrl('https://app.example/auth/callback#type=invite&access_token=hidden'),
      { kind: 'invite', hasError: false },
    )
    assert.deepEqual(
      inspectAuthCallbackUrl('https://app.example/auth/callback?type=recovery&code=hidden'),
      { kind: 'recovery', hasError: false },
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
