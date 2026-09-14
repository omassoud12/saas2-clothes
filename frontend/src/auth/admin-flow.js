import {
  authenticatedApiRequest,
  fetchCurrentApplicationUser,
} from './owner-flow.js'

export const REJECTION_REASON_MAX_LENGTH = 2000
export const ADMIN_INITIAL_STATE = Object.freeze({
  kind: 'loading',
  accounts: Object.freeze([]),
})

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function resultError(code, message, status, extra = {}) {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(typeof status === 'number' ? { status } : {}),
    ...extra,
  })
}

function isText(value, maxLength) {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= maxLength
  )
}

function normalizePendingAccount(value) {
  const account = value?.account
  const owner = value?.owner

  if (
    !account ||
    !owner ||
    typeof account.id !== 'string' ||
    !uuidPattern.test(account.id) ||
    !isText(account.name, 160) ||
    typeof account.baseCurrency !== 'string' ||
    !/^[A-Z]{3}$/.test(account.baseCurrency) ||
    account.status !== 'PENDING' ||
    typeof account.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(account.createdAt)) ||
    !isText(owner.firstName, 100) ||
    !isText(owner.lastName, 100) ||
    !isText(owner.email, 254)
  ) {
    return null
  }

  return Object.freeze({
    account: Object.freeze({
      id: account.id.toLowerCase(),
      name: account.name,
      baseCurrency: account.baseCurrency,
      status: account.status,
      createdAt: account.createdAt,
    }),
    owner: Object.freeze({
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
    }),
  })
}

export function authorizeAdminProfile(profile) {
  if (profile?.user?.role !== 'SUPER_ADMIN' || profile.account !== null) {
    return resultError(
      'ADMIN_FORBIDDEN',
      'You are not authorized to access platform administration.',
      403,
    )
  }

  return Object.freeze({ ok: true, profile })
}

export async function loadPendingAccounts({
  supabase,
  fetchImpl = globalThis.fetch,
}) {
  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: '/api/admin/accounts/pending',
    method: 'GET',
    fallbackMessage: 'Pending accounts could not be loaded. Please try again.',
  })

  if (!result.ok) return result

  if (!Array.isArray(result.data?.accounts)) {
    return resultError(
      'INVALID_PENDING_ACCOUNTS_RESPONSE',
      'Pending accounts could not be loaded. Please try again.',
    )
  }

  const accounts = result.data.accounts.map(normalizePendingAccount)
  if (accounts.some((account) => account === null)) {
    return resultError(
      'INVALID_PENDING_ACCOUNTS_RESPONSE',
      'Pending accounts could not be loaded. Please try again.',
    )
  }

  return Object.freeze({ ok: true, accounts: Object.freeze(accounts) })
}

export async function initializeAdminDashboard({
  supabase,
  fetchImpl = globalThis.fetch,
}) {
  const profileResult = await fetchCurrentApplicationUser({
    supabase,
    fetchImpl,
  })
  if (!profileResult.ok) return profileResult

  const authorization = authorizeAdminProfile(profileResult.profile)
  if (!authorization.ok) return authorization

  const pendingResult = await loadPendingAccounts({ supabase, fetchImpl })
  if (!pendingResult.ok) return pendingResult

  return Object.freeze({
    ok: true,
    profile: authorization.profile,
    accounts: pendingResult.accounts,
  })
}

function normalizeAccountId(accountId) {
  return typeof accountId === 'string' && uuidPattern.test(accountId)
    ? accountId.toLowerCase()
    : null
}

function mapReviewFailure(result) {
  if (result.status === 409) {
    return resultError(
      result.code,
      'This account has already been reviewed. The pending list was refreshed.',
      409,
      { shouldRefresh: true },
    )
  }

  if (result.status === 404) {
    return resultError(
      result.code,
      'This account could not be found.',
      404,
    )
  }

  return result
}

export async function approvePendingAccount({
  supabase,
  fetchImpl = globalThis.fetch,
  accountId,
}) {
  const normalizedAccountId = normalizeAccountId(accountId)
  if (!normalizedAccountId) {
    return resultError(
      'INVALID_ACCOUNT_ID',
      'This account cannot be reviewed. Refresh the pending list.',
    )
  }

  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: `/api/admin/accounts/${encodeURIComponent(normalizedAccountId)}/approve`,
    method: 'PATCH',
    fallbackMessage: 'The account could not be approved. Please try again.',
  })

  if (!result.ok) return mapReviewFailure(result)
  if (
    result.status !== 200 ||
    result.data?.account?.id !== normalizedAccountId ||
    result.data.account.status !== 'ACTIVE'
  ) {
    return resultError(
      'INVALID_ACCOUNT_REVIEW_RESPONSE',
      'The approval result could not be confirmed. Refresh the pending list.',
      undefined,
      { shouldRefresh: true },
    )
  }

  return Object.freeze({ ok: true, accountId: normalizedAccountId })
}

export function validateRejectionReason(reason) {
  if (typeof reason !== 'string') {
    return resultError(
      'INVALID_REJECTION_REASON',
      'Enter a reason for rejecting this account.',
    )
  }

  const normalizedReason = reason.trim()
  if (!normalizedReason) {
    return resultError(
      'INVALID_REJECTION_REASON',
      'Enter a reason for rejecting this account.',
    )
  }

  if ([...normalizedReason].length > REJECTION_REASON_MAX_LENGTH) {
    return resultError(
      'INVALID_REJECTION_REASON',
      `Rejection reason must be ${REJECTION_REASON_MAX_LENGTH} characters or fewer.`,
    )
  }

  return Object.freeze({ ok: true, reason: normalizedReason })
}

export function createRejectionDraft(accountId) {
  const normalizedAccountId = normalizeAccountId(accountId)
  return normalizedAccountId
    ? Object.freeze({ accountId: normalizedAccountId, reason: '', error: '' })
    : null
}

export async function rejectPendingAccount({
  supabase,
  fetchImpl = globalThis.fetch,
  accountId,
  reason,
}) {
  const normalizedAccountId = normalizeAccountId(accountId)
  if (!normalizedAccountId) {
    return resultError(
      'INVALID_ACCOUNT_ID',
      'This account cannot be reviewed. Refresh the pending list.',
    )
  }

  const validation = validateRejectionReason(reason)
  if (!validation.ok) return validation

  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: `/api/admin/accounts/${encodeURIComponent(normalizedAccountId)}/reject`,
    method: 'PATCH',
    payload: { reason: validation.reason },
    fallbackMessage: 'The account could not be rejected. Please try again.',
  })

  if (!result.ok) return mapReviewFailure(result)
  if (
    result.status !== 200 ||
    result.data?.account?.id !== normalizedAccountId ||
    result.data.account.status !== 'REJECTED'
  ) {
    return resultError(
      'INVALID_ACCOUNT_REVIEW_RESPONSE',
      'The rejection result could not be confirmed. Refresh the pending list.',
      undefined,
      { shouldRefresh: true },
    )
  }

  return Object.freeze({ ok: true, accountId: normalizedAccountId })
}

export function removePendingAccount(accounts, accountId) {
  return Object.freeze(
    accounts.filter((item) => item.account.id !== accountId),
  )
}

export function createAccountActionGuard() {
  const pendingAccountIds = new Set()

  return Object.freeze({
    async run(accountId, operation) {
      if (pendingAccountIds.has(accountId)) {
        return Object.freeze({ skipped: true })
      }

      pendingAccountIds.add(accountId)
      try {
        return Object.freeze({ skipped: false, value: await operation() })
      } finally {
        pendingAccountIds.delete(accountId)
      }
    },
  })
}

export function formatRequestedAt(createdAt) {
  const date = new Date(createdAt)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : 'Unavailable'
}
