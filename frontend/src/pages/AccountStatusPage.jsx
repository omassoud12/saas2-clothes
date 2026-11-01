import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCOUNT_STATUS_VIEW, friendlyAuthMessage } from '../auth/auth-messages.js'
import { fetchCurrentApplicationUser, getApplicationDestination, getPendingAccountView } from '../auth/owner-flow.js'
import { logoutBusinessApp } from '../app/app-flow.js'
import { AuthLogout, AuthNotice, AuthShell, AuthSubmit, AuthWaiting } from '../components/auth/AuthShell.jsx'
import { supabase } from '../lib/supabase.js'

export function AccountStatusPage({ mode }) {
  const initialLoad = useRef(null)
  const [state, setState] = useState({ kind: 'loading' })
  const [checking, setChecking] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const loadProfile = useCallback(async () => {
    const result = await fetchCurrentApplicationUser({ supabase })
    if (!result.ok) {
      if (result.code === 'APPLICATION_USER_NOT_FOUND') window.location.replace('/owner/onboarding')
      else if (result.code === 'SESSION_REQUIRED' || result.status === 401) window.location.replace('/login')
      else setState({ kind: 'error', message: friendlyAuthMessage(result) })
      return
    }

    const view = getPendingAccountView(result.profile)
    if (!view.ok) setState({ kind: 'error', message: friendlyAuthMessage(view) })
    else if (view.redirectTo) window.location.replace(view.redirectTo)
    else {
      const destination = getApplicationDestination(result.profile)
      const isInactive = ['REJECTED', 'SUSPENDED'].includes(view.status)
      if ((mode === 'pending' && isInactive) || (mode === 'inactive' && !isInactive)) {
        window.location.replace(destination.redirectTo)
      } else setState({ kind: 'ready', profile: result.profile, view })
    }
  }, [mode])

  useEffect(() => {
    if (!initialLoad.current) initialLoad.current = loadProfile()
  }, [loadProfile])

  async function checkStatus() {
    if (checking) return
    setChecking(true)
    await loadProfile()
    setChecking(false)
  }

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    const result = await logoutBusinessApp({ supabase, redirect: (path) => window.location.replace(path) })
    if (!result.ok) { setState({ kind: 'error', message: friendlyAuthMessage(result) }); setLoggingOut(false) }
  }

  const inactive = mode === 'inactive'
  const shown = state.kind === 'ready' ? ACCOUNT_STATUS_VIEW[state.view.status] : null
  const title = shown?.title ?? (inactive ? 'Your shop is not active' : 'We are checking your shop')
  const subtitle = shown?.text ?? (inactive ? 'You and your staff cannot use SaaS2 right now.' : 'We will turn your account on soon.')

  return (
    <AuthShell title={title} subtitle={subtitle}>
      {state.kind === 'loading' && <><AuthWaiting label="Checking your account…" /><AuthLogout /></>}
      {state.kind === 'error' && <div className="auth-stack">
        <AuthNotice>{state.message}</AuthNotice>
        <AuthSubmit type="button" busy={checking} busyLabel="Checking…" onClick={checkStatus}>Try again</AuthSubmit>
        <AuthSubmit type="button" className="btn btn--outline btn--block" busy={loggingOut} busyLabel="Logging out…" onClick={logout}>Log out</AuthSubmit>
      </div>}
      {state.kind === 'ready' && <div className="auth-stack">
        <dl className="auth-summary">
          <div><dt>Owner</dt><dd>{state.profile.user.firstName} {state.profile.user.lastName}</dd></div>
          <div><dt>Shop</dt><dd>{state.profile.account.name}</dd></div>
          <div><dt>Status</dt><dd><span className={`auth-status auth-status--${state.view.status.toLowerCase()}`}>{shown?.label ?? state.view.status}</span></dd></div>
        </dl>
        {state.view.status === 'REJECTED' && state.view.rejectionReason && <div className="auth-note"><strong>Note from our team</strong><p>{state.view.rejectionReason}</p></div>}
        <AuthSubmit type="button" busy={checking} busyLabel="Checking…" disabled={loggingOut} onClick={checkStatus}>Check again</AuthSubmit>
        <AuthSubmit type="button" className="btn btn--outline btn--block" busy={loggingOut} busyLabel="Logging out…" disabled={checking} onClick={logout}>Log out</AuthSubmit>
      </div>}
    </AuthShell>
  )
}
