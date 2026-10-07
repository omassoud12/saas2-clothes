export const PASSWORD_MIN_LENGTH = 8
export const RECOVERY_REQUEST_MESSAGE =
  'If an account exists for this email, a password reset link has been sent.'

const passwordSetupMarkerKey = 'clothes.password-setup-session'
const passwordSetupWindowMs = 15 * 60 * 1000
const callbackKinds = new Set(['invite', 'recovery'])
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function resultError(code, message) {
  return Object.freeze({ ok: false, code, message })
}

export function buildFrontendUrl(origin, pathname) {
  try {
    const originUrl = new URL(origin)
    if (
      !['http:', 'https:'].includes(originUrl.protocol) ||
      originUrl.origin !== originUrl.href.replace(/\/$/, '') ||
      typeof pathname !== 'string' ||
      !pathname.startsWith('/')
    ) {
      return null
    }

    return new URL(pathname, originUrl).toString()
  } catch {
    return null
  }
}

export async function requestPasswordRecovery({ supabase, email, origin }) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

  if (
    !normalizedEmail ||
    normalizedEmail.length > 254 ||
    !emailPattern.test(normalizedEmail)
  ) {
    return resultError(
      'INVALID_RECOVERY_EMAIL',
      'Enter a valid email address.',
    )
  }

  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  const redirectTo = buildFrontendUrl(origin, '/auth/callback')
  if (!redirectTo) {
    return resultError(
      'INVALID_FRONTEND_ORIGIN',
      'Password recovery is unavailable from this location.',
    )
  }

  try {
    await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
  } catch {
    // Deliberately return the same neutral response as a successful request.
  }

  return Object.freeze({ ok: true, message: RECOVERY_REQUEST_MESSAGE })
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
      ...((!kind || callbackKinds.has(kind)) && url.searchParams.get('code') ? { hasCode: true } : {}),
    })
  } catch {
    return Object.freeze({ kind: null, hasError: true })
  }
}

export async function exchangePasswordSetupCode({ supabase, code, flowId }) {
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    )
    const user = data?.session?.user
    const kind = data?.redirectType === 'recovery'
      ? 'recovery'
      : user?.invited_at && user?.email_confirmed_at ? 'invite' : null
    if (!error && user?.id && kind) {
      return Object.freeze({ ok: true, kind, userId: user.id })
    }
  } catch {
    // Never expose the code, session, or provider error.
  }
  return resultError('INVITATION_INVALID', 'This invitation link is invalid or has expired.')
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
  exchangeCode,
}) {
  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  if (callback.hasError || (!callbackKinds.has(callback.kind) && !callback.hasCode)) {
    clearPasswordSetupMarker(storage)
    clearUrl()
    return resultError(
      'INVITATION_INVALID',
      'This invitation link is invalid or has expired.',
    )
  }

  let kind = callback.kind
  let exchangedUserId
  if (callback.hasCode) {
    let result
    try {
      result = await exchangeCode?.()
    } catch {
      result = null
    }
    if (!result?.ok || !callbackKinds.has(result.kind) || !result.userId || (kind && kind !== result.kind)) {
      clearPasswordSetupMarker(storage)
      clearUrl()
      return resultError('INVITATION_INVALID', 'This invitation link is invalid or has expired.')
    }
    kind = result.kind
    exchangedUserId = result.userId
  }

  let sessionResult
  try {
    sessionResult = await supabase.auth.getSession()
  } catch {
    sessionResult = { data: { session: null }, error: true }
  }

  const session = sessionResult.data?.session
  if (sessionResult.error || !session?.user?.id || (exchangedUserId && session.user.id !== exchangedUserId)) {
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
    kind,
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
