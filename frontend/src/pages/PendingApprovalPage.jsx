import { useEffect, useRef, useState } from 'react'
import {
  fetchCurrentApplicationUser,
  getPendingAccountView,
} from '../auth/owner-flow.js'
import { supabase } from '../lib/supabase.js'

export function PendingApprovalPage() {
  const profilePromise = useRef(null)
  const [state, setState] = useState({ kind: 'loading' })

  useEffect(() => {
    if (!profilePromise.current) {
      profilePromise.current = fetchCurrentApplicationUser({ supabase })
    }

    let active = true
    void profilePromise.current.then((result) => {
      if (!active) return

      if (!result.ok) {
        if (result.code === 'APPLICATION_USER_NOT_FOUND') {
          window.location.replace('/owner/onboarding')
        } else if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
          window.location.replace('/login')
        } else {
          setState({ kind: 'error', message: result.message })
        }
        return
      }

      const view = getPendingAccountView(result.profile)
      if (!view.ok) {
        setState({ kind: 'error', message: view.message })
      } else if (view.redirectTo) {
        window.location.replace(view.redirectTo)
      } else {
        setState({ kind: 'ready', profile: result.profile, view })
      }
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">Account access</span>

        {state.kind === 'loading' && (
          <>
            <h1>Loading account status…</h1>
            <div className="spinner" aria-label="Loading" />
          </>
        )}

        {state.kind === 'error' && (
          <>
            <h1>Status unavailable</h1>
            <p className="error-message" role="alert">{state.message}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </>
        )}

        {state.kind === 'ready' && (
          <>
            <span className={`status-chip status-${state.view.status.toLowerCase()}`}>
              {state.view.status}
            </span>
            <h1>{state.view.heading}</h1>
            <p>{state.view.message}</p>
            <dl className="account-summary">
              <div>
                <dt>Owner</dt>
                <dd>{state.profile.user.firstName} {state.profile.user.lastName}</dd>
              </div>
              <div>
                <dt>Store</dt>
                <dd>{state.profile.account.name}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{state.view.status}</dd>
              </div>
            </dl>
            {state.view.status === 'REJECTED' && (
              <div className="notice error-notice">
                <strong>Review note</strong>
                <p>{state.view.rejectionReason}</p>
              </div>
            )}
            <button type="button" onClick={() => window.location.reload()}>
              Refresh status
            </button>
          </>
        )}
      </section>
    </main>
  )
}
