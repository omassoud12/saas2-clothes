import { fetchCurrentApplicationUser } from '../auth/owner-flow.js'

const tenantRoles = new Set(['OWNER', 'WAREHOUSE'])
const inactiveStatuses = new Set(['REJECTED', 'SUSPENDED'])

function resultError(code, message, extra = {}) {
  return Object.freeze({ ok: false, code, message, ...extra })
}

export function authorizeBusinessProfile(profile) {
  const role = profile?.user?.role
  const account = profile?.account

  if (role === 'SUPER_ADMIN') {
    return account === null
      ? Object.freeze({ ok: false, redirectTo: '/admin' })
      : resultError(
          'INVALID_APPLICATION_PROFILE',
          'Your application profile is inconsistent.',
        )
  }

  if (!tenantRoles.has(role) || !account) {
    return resultError(
      'INVALID_APPLICATION_PROFILE',
      'Your application profile is incomplete.',
    )
  }

  if (account.status === 'PENDING') {
    return Object.freeze({ ok: false, redirectTo: '/pending-approval' })
  }

  if (inactiveStatuses.has(account.status)) {
    return Object.freeze({ ok: false, redirectTo: '/account-inactive' })
  }

  if (account.status !== 'ACTIVE') {
    return resultError(
      'INVALID_ACCOUNT_STATUS',
      'Your account has an unsupported status.',
    )
  }

  return Object.freeze({ ok: true, profile })
}

export async function loadBusinessAppProfile({
  supabase,
  fetchImpl = globalThis.fetch,
}) {
  const result = await fetchCurrentApplicationUser({ supabase, fetchImpl })

  if (!result.ok) {
    if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
      return Object.freeze({ ok: false, redirectTo: '/login' })
    }

    if (
      result.status === 403 &&
      result.code === 'APPLICATION_USER_NOT_FOUND'
    ) {
      return Object.freeze({ ok: false, redirectTo: '/owner/onboarding' })
    }

    return result
  }

  return authorizeBusinessProfile(result.profile)
}

export function getBusinessShellIdentity(profile) {
  return Object.freeze({
    storeName: profile.account.name,
    userName: `${profile.user.firstName} ${profile.user.lastName}`.trim(),
    role: profile.user.role,
  })
}

export async function logoutBusinessApp({ supabase, redirect }) {
  if (!supabase) {
    return resultError(
      'SUPABASE_NOT_CONFIGURED',
      'Sign out is unavailable. Please refresh and try again.',
    )
  }

  try {
    const result = await supabase.auth.signOut()
    if (result.error) {
      return resultError(
        'SIGN_OUT_FAILED',
        'Sign out could not be completed. Please try again.',
      )
    }
  } catch {
    return resultError(
      'SIGN_OUT_FAILED',
      'Sign out could not be completed. Please try again.',
    )
  }

  redirect('/login')
  return Object.freeze({ ok: true, redirectTo: '/login' })
}
