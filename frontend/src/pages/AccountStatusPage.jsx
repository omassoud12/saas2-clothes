import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCurrentApplicationUser, getApplicationDestination, getPendingAccountView } from '../auth/owner-flow.js'
import { logoutBusinessApp } from '../app/app-flow.js'
import { AuthAction, AuthLayout, AuthLoading, FormMessage } from '../components/auth/AuthLayout.jsx'
import { Button } from '../components/ui/index.jsx'
import { supabase } from '../lib/supabase.js'
import { LogoutAction } from '../components/auth/LogoutAction.jsx'

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
      else setState({ kind: 'error', message: result.message })
      return
    }

    const view = getPendingAccountView(result.profile)
    if (!view.ok) setState({ kind: 'error', message: view.message })
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
    if (!result.ok) { setState({ kind: 'error', message: result.message }); setLoggingOut(false) }
  }

  const inactive = mode === 'inactive'
  return (
    <AuthLayout eyebrow="Account access" title={inactive ? 'Store access is inactive' : 'Approval is in progress'} description={inactive ? 'This store is not currently available to its team.' : 'Your request exists and is waiting for platform approval.'}>
      {state.kind === 'loading' && <><AuthLoading label="Checking your account status" /><LogoutAction /></>}
      {state.kind === 'error' && <div className="auth-status-stack"><FormMessage>{state.message}</FormMessage><AuthAction onClick={checkStatus} disabled={checking}>{checking ? 'Checking…' : 'Try again'}</AuthAction><Button tone="ghost" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></div>}
      {state.kind === 'ready' && <div className="auth-status-stack">
        <span className={`status-chip status-${state.view.status.toLowerCase()}`}>{state.view.status}</span>
        <div className="auth-status-copy"><h2>{state.view.heading}</h2><p>{inactive ? state.view.message : 'Business features remain locked until the account is approved.'}</p></div>
        <dl className="account-summary">
          <div><dt>Owner</dt><dd>{state.profile.user.firstName} {state.profile.user.lastName}</dd></div>
          <div><dt>Store</dt><dd>{state.profile.account.name}</dd></div>
          <div><dt>Status</dt><dd>{state.view.status}</dd></div>
        </dl>
        {state.view.status === 'REJECTED' && state.view.rejectionReason && <div className="auth-review-note"><strong>Review note</strong><p>{state.view.rejectionReason}</p></div>}
        <div className="auth-status-actions"><AuthAction onClick={checkStatus} disabled={checking || loggingOut}>{checking ? 'Checking status…' : 'Check status'}</AuthAction><Button tone="secondary" onClick={logout} disabled={checking || loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></div>
      </div>}
    </AuthLayout>
  )
}
