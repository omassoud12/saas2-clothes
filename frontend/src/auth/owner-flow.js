import { buildFrontendUrl, PASSWORD_MIN_LENGTH } from './auth-flow.js'

export const OWNER_SIGNUP_MESSAGE =
  'Check your email to confirm your address and continue setting up your store.'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const employeeCodePattern = /^[A-Z0-9][A-Z0-9_-]*$/
const accountStatuses = new Set([
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
])

function resultError(code, message, status) {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(typeof status === 'number' ? { status } : {}),
  })
}

export function createSubmissionGuard() {
  let pending = false

  return Object.freeze({
    async run(operation) {
      if (pending) return Object.freeze({ skipped: true })

      pending = true
      try {
        return Object.freeze({ skipped: false, value: await operation() })
      } finally {
        pending = false
      }
    },
  })
}

export async function requestOwnerSignup({
  supabase,
  email,
  password,
  confirmPassword,
  origin,
}) {
  const normalizedEmail =
    typeof email === 'string' ? email.trim().toLowerCase() : ''

  if (
    !normalizedEmail ||
    normalizedEmail.length > 254 ||
    !emailPattern.test(normalizedEmail)
  ) {
    return resultError('INVALID_SIGNUP_EMAIL', 'Enter a valid email address.')
  }

  if (!password || !confirmPassword) {
    return resultError(
      'SIGNUP_PASSWORD_REQUIRED',
      'Enter and confirm your password.',
    )
  }

  if (password !== confirmPassword) {
    return resultError('SIGNUP_PASSWORD_MISMATCH', 'Passwords do not match.')
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return resultError(
      'SIGNUP_PASSWORD_TOO_SHORT',
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    )
  }

  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  const emailRedirectTo = buildFrontendUrl(origin, '/auth/signup-callback')
  if (!emailRedirectTo) {
    return resultError(
      'INVALID_FRONTEND_ORIGIN',
      'Signup is unavailable from this location.',
    )
  }

  try {
    const result = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { emailRedirectTo },
    })

    if (result.error) {
      return resultError(
        'OWNER_SIGNUP_FAILED',
        'Signup could not be completed. Please try again.',
      )
    }
  } catch {
    return resultError(
      'OWNER_SIGNUP_FAILED',
      'Signup could not be completed. Please try again.',
    )
  }

  return Object.freeze({ ok: true, message: OWNER_SIGNUP_MESSAGE })
}

function readCallbackParameter(url, name) {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  return url.searchParams.get(name) ?? fragment.get(name)
}

export function inspectSignupCallbackUrl(href) {
  try {
    const url = new URL(href)
    const readParameter = (name) => readCallbackParameter(url, name)
    const type = readParameter('type')
    const hasError = Boolean(
      readParameter('error') ||
        readParameter('error_code') ||
        readParameter('error_description'),
    )
    const hasConfirmationParameters = Boolean(
      readParameter('code') ||
        readParameter('token_hash') ||
        readParameter('access_token') ||
        type === 'signup' ||
        type === 'email',
    )

    return Object.freeze({ hasError, hasConfirmationParameters })
  } catch {
    return Object.freeze({ hasError: true, hasConfirmationParameters: false })
  }
}

async function readAuthenticatedSession(supabase) {
  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  let result
  try {
    result = await supabase.auth.getSession()
  } catch {
    return resultError(
      'SESSION_REQUIRED',
      'Sign in with a confirmed email address to continue.',
    )
  }

  const session = result.data?.session
  if (
    result.error ||
    !session?.user?.id ||
    typeof session.access_token !== 'string' ||
    !session.access_token
  ) {
    return resultError(
      'SESSION_REQUIRED',
      'Sign in with a confirmed email address to continue.',
    )
  }

  return Object.freeze({ ok: true, session })
}

export async function completeSignupCallback({
  supabase,
  callback,
  clearUrl,
  navigate,
}) {
  if (!supabase) {
    clearUrl()
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Authentication is not configured for this application.',
    )
  }

  if (callback.hasError || !callback.hasConfirmationParameters) {
    clearUrl()
    return resultError(
      'SIGNUP_CONFIRMATION_INVALID',
      'This confirmation link is invalid or has expired.',
    )
  }

  const sessionResult = await readAuthenticatedSession(supabase)
  clearUrl()

  if (
    !sessionResult.ok ||
    !sessionResult.session.user.email_confirmed_at
  ) {
    return resultError(
      'SIGNUP_CONFIRMATION_SESSION_MISSING',
      'This confirmation link is invalid or has expired.',
    )
  }

  navigate('/owner/onboarding')
  return Object.freeze({ ok: true, redirectTo: '/owner/onboarding' })
}

export async function verifyAuthenticatedSession({ supabase }) {
  const result = await readAuthenticatedSession(supabase)
  return result.ok ? Object.freeze({ ok: true }) : result
}

function readRequiredText(input, field, maxLength) {
  const value = input?.[field]
  if (typeof value !== 'string' || !value.trim()) {
    return resultError(
      'OWNER_ONBOARDING_INVALID',
      'Complete all required onboarding fields.',
    )
  }

  const normalized = value.trim()
  if (normalized.length > maxLength) {
    return resultError(
      'OWNER_ONBOARDING_INVALID',
      'One or more onboarding fields are too long.',
    )
  }

  return Object.freeze({ ok: true, value: normalized })
}

export function createOwnerBootstrapPayload(input) {
  const firstName = readRequiredText(input, 'firstName', 100)
  if (!firstName.ok) return firstName

  const lastName = readRequiredText(input, 'lastName', 100)
  if (!lastName.ok) return lastName

  const accountName = readRequiredText(input, 'accountName', 160)
  if (!accountName.ok) return accountName

  const baseCurrency =
    typeof input?.baseCurrency === 'string'
      ? input.baseCurrency.trim().toUpperCase()
      : ''
  if (!['USD', 'LBP'].includes(baseCurrency)) {
    return resultError(
      'OWNER_ONBOARDING_INVALID',
      'Choose a supported base currency.',
    )
  }

  const payload = {
    firstName: firstName.value,
    lastName: lastName.value,
    accountName: accountName.value,
    baseCurrency,
  }
  const employeeCode =
    typeof input?.employeeCode === 'string'
      ? input.employeeCode.trim().toUpperCase()
      : ''

  if (employeeCode) {
    if (
      employeeCode.length > 50 ||
      !employeeCodePattern.test(employeeCode)
    ) {
      return resultError(
        'OWNER_ONBOARDING_INVALID',
        'Employee code may contain only letters, numbers, hyphens, or underscores.',
      )
    }

    payload.employeeCode = employeeCode
  }

  return Object.freeze({ ok: true, payload: Object.freeze(payload) })
}

async function parseResponseJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function safeApiError(response, body, fallbackMessage) {
  const code =
    typeof body?.error?.code === 'string' && body.error.code.length <= 100
      ? body.error.code
      : 'API_REQUEST_FAILED'

  if (response.status === 401) {
    return resultError(
      code,
      'Your session has expired. Sign in again.',
      response.status,
    )
  }

  if (response.status === 429) {
    return resultError(
      code,
      'Too many attempts. Please wait and try again.',
      response.status,
    )
  }

  return resultError(code, fallbackMessage, response.status)
}

export async function authenticatedApiRequest({
  supabase,
  fetchImpl,
  path,
  method,
  payload,
  fallbackMessage,
}) {
  const sessionResult = await readAuthenticatedSession(supabase)
  if (!sessionResult.ok) return sessionResult

  let response
  try {
    response = await fetchImpl(path, {
      method,
      headers: {
        Authorization: `Bearer ${sessionResult.session.access_token}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    })
  } catch {
    return resultError('API_UNAVAILABLE', fallbackMessage)
  }

  const body = await parseResponseJson(response)
  if (!response.ok) return safeApiError(response, body, fallbackMessage)

  return Object.freeze({ ok: true, status: response.status, data: body })
}

export async function bootstrapOwnerAccount({
  supabase,
  fetchImpl = globalThis.fetch,
  input,
}) {
  const validation = createOwnerBootstrapPayload(input)
  if (!validation.ok) return validation

  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: '/api/auth/bootstrap-owner',
    method: 'POST',
    payload: validation.payload,
    fallbackMessage: 'Store setup could not be completed. Please try again.',
  })

  if (!result.ok) return result
  if (![200, 201].includes(result.status)) {
    return resultError(
      'OWNER_BOOTSTRAP_UNEXPECTED_RESPONSE',
      'Store setup could not be completed. Please try again.',
    )
  }

  return Object.freeze({ ok: true, status: result.status })
}

export async function fetchCurrentApplicationUser({
  supabase,
  fetchImpl = globalThis.fetch,
}) {
  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: '/api/auth/me',
    method: 'GET',
    fallbackMessage: 'Your account status could not be loaded. Please try again.',
  })

  if (!result.ok) return result
  if (!result.data?.user || !Object.hasOwn(result.data, 'account')) {
    return resultError(
      'INVALID_PROFILE_RESPONSE',
      'Your account status could not be loaded. Please try again.',
    )
  }

  return Object.freeze({ ok: true, profile: result.data })
}

export function getApplicationDestination(profile) {
  const role = profile?.user?.role
  const account = profile?.account

  if (role === 'SUPER_ADMIN') {
    return account === null
      ? Object.freeze({ ok: true, redirectTo: '/admin' })
      : resultError(
          'INVALID_APPLICATION_PROFILE',
          'Your application profile is inconsistent.',
        )
  }

  if (!['OWNER', 'WAREHOUSE'].includes(role) || !account) {
    return resultError(
      'INVALID_APPLICATION_PROFILE',
      'Your application profile is incomplete.',
    )
  }

  if (!accountStatuses.has(account.status)) {
    return resultError(
      'INVALID_ACCOUNT_STATUS',
      'Your account has an unsupported status.',
    )
  }

  return Object.freeze({
    ok: true,
    redirectTo:
      account.status === 'ACTIVE' ? '/app' : '/pending-approval',
  })
}

export function getPendingAccountView(profile) {
  const destination = getApplicationDestination(profile)
  if (!destination.ok || destination.redirectTo !== '/pending-approval') {
    return destination
  }

  const status = profile.account.status
  if (status === 'PENDING') {
    return Object.freeze({
      ok: true,
      status,
      heading: 'Approval pending',
      message: 'Your store is waiting for platform approval.',
    })
  }

  if (status === 'REJECTED') {
    return Object.freeze({
      ok: true,
      status,
      heading: 'Account not approved',
      message: 'Your store application was not approved.',
      rejectionReason:
        typeof profile.account.rejectionReason === 'string'
          ? profile.account.rejectionReason
          : '',
    })
  }

  return Object.freeze({
    ok: true,
    status,
    heading: 'Account suspended',
    message: 'Access to this store is currently suspended.',
  })
}

export async function resolvePostLoginDestination({
  supabase,
  fetchImpl = globalThis.fetch,
}) {
  const result = await fetchCurrentApplicationUser({ supabase, fetchImpl })

  if (
    !result.ok &&
    result.status === 403 &&
    result.code === 'APPLICATION_USER_NOT_FOUND'
  ) {
    return Object.freeze({ ok: true, redirectTo: '/owner/onboarding' })
  }

  return result.ok ? getApplicationDestination(result.profile) : result
}
