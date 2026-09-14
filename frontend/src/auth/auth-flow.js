export const PASSWORD_MIN_LENGTH = 8

const passwordSetupMarkerKey = 'clothes.password-setup-session'
const passwordSetupWindowMs = 15 * 60 * 1000
const callbackKinds = new Set(['invite', 'recovery'])

function resultError(code, message) {
  return Object.freeze({ ok: false, code, message })
}

export function inspectAuthCallbackUrl(href) {
  try {
    const url = new URL(href)
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
    const readParameter = (name) =>
      url.searchParams.get(name) ?? fragment.get(name)
    const kind = readParameter('type')
    const hasError = Boolean(
      readParameter('error') ||
        readParameter('error_code') ||
        readParameter('error_description'),
    )

    return Object.freeze({
      kind: callbackKinds.has(kind) ? kind : null,
      hasError,
    })
  } catch {
    return Object.freeze({ kind: null, hasError: true })
  }
}

function writePasswordSetupMarker(storage, userId, kind, now) {
  storage.setItem(
    passwordSetupMarkerKey,
    JSON.stringify({ userId, kind, expiresAt: now + passwordSetupWindowMs }),
  )
}

function readPasswordSetupMarker(storage, now) {
  try {
    const value = JSON.parse(storage.getItem(passwordSetupMarkerKey) ?? 'null')

    if (
      !value ||
      typeof value.userId !== 'string' ||
      !callbackKinds.has(value.kind) ||
      typeof value.expiresAt !== 'number' ||
      value.expiresAt <= now
    ) {
      return null
    }

    return value
  } catch {
    return null
  }
}

export function clearPasswordSetupMarker(storage) {
  storage.removeItem(passwordSetupMarkerKey)
}

async function getEligibleSession(supabase, storage, now) {
  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  const marker = readPasswordSetupMarker(storage, now)
  if (!marker) {
    return resultError(
      'PASSWORD_SETUP_SESSION_REQUIRED',
      'Open a valid invitation link before setting a password.',
    )
  }

  let sessionResult
  try {
    sessionResult = await supabase.auth.getSession()
  } catch {
    return resultError(
      'PASSWORD_SETUP_SESSION_INVALID',
      'The invitation session is invalid or has expired.',
    )
  }

  const session = sessionResult.data?.session
  if (
    sessionResult.error ||
    !session?.user?.id ||
    session.user.id !== marker.userId
  ) {
    clearPasswordSetupMarker(storage)
    return resultError(
      'PASSWORD_SETUP_SESSION_INVALID',
      'The invitation session is invalid or has expired.',
    )
  }

  return Object.freeze({ ok: true, session })
}

export async function completeAuthCallback({
  supabase,
  callback,
  storage,
  navigate,
  clearUrl,
  now = Date.now(),
}) {
  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  if (callback.hasError || !callbackKinds.has(callback.kind)) {
    clearPasswordSetupMarker(storage)
    clearUrl()
    return resultError(
      'INVITATION_INVALID',
      'This invitation link is invalid or has expired.',
    )
  }

  let sessionResult
  try {
    sessionResult = await supabase.auth.getSession()
  } catch {
    sessionResult = { data: { session: null }, error: true }
  }

  const session = sessionResult.data?.session
  if (sessionResult.error || !session?.user?.id) {
    clearPasswordSetupMarker(storage)
    clearUrl()
    return resultError(
      'INVITATION_SESSION_MISSING',
      'This invitation link is invalid or has expired.',
    )
  }

  writePasswordSetupMarker(
    storage,
    session.user.id,
    callback.kind,
    now,
  )
  clearUrl()
  navigate('/set-password')
  return Object.freeze({ ok: true, redirectTo: '/set-password' })
}

export async function verifyPasswordSetupSession({
  supabase,
  storage,
  now = Date.now(),
}) {
  const result = await getEligibleSession(supabase, storage, now)
  return result.ok
    ? Object.freeze({ ok: true })
    : result
}

export function validateNewPassword(newPassword, confirmPassword) {
  if (!newPassword || !confirmPassword) {
    return resultError(
      'PASSWORD_REQUIRED',
      'Enter and confirm your new password.',
    )
  }

  if (newPassword !== confirmPassword) {
    return resultError('PASSWORD_MISMATCH', 'Passwords do not match.')
  }

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return resultError(
      'PASSWORD_TOO_SHORT',
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    )
  }

  return Object.freeze({ ok: true })
}

export async function updateInvitedUserPassword({
  supabase,
  storage,
  newPassword,
  confirmPassword,
  now = Date.now(),
}) {
  const validation = validateNewPassword(newPassword, confirmPassword)
  if (!validation.ok) return validation

  const eligibleSession = await getEligibleSession(supabase, storage, now)
  if (!eligibleSession.ok) return eligibleSession

  let updateResult
  try {
    updateResult = await supabase.auth.updateUser({ password: newPassword })
  } catch {
    return resultError(
      'PASSWORD_UPDATE_FAILED',
      'Password could not be updated. Check the password policy and try again.',
    )
  }

  if (updateResult.error) {
    return resultError(
      'PASSWORD_UPDATE_FAILED',
      'Password could not be updated. Check the password policy and try again.',
    )
  }

  clearPasswordSetupMarker(storage)

  try {
    const signOutResult = await supabase.auth.signOut()
    if (signOutResult.error) {
      return resultError(
        'SIGN_OUT_FAILED',
        'Password was updated, but automatic sign out failed. Close this page before signing in again.',
      )
    }
  } catch {
    return resultError(
      'SIGN_OUT_FAILED',
      'Password was updated, but automatic sign out failed. Close this page before signing in again.',
    )
  }

  return Object.freeze({ ok: true, redirectTo: '/login' })
}
