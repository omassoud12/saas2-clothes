import { useEffect, useRef, useState } from 'react'
import {
  fetchCurrentApplicationUser,
  getApplicationDestination,
} from '../auth/owner-flow.js'
import { supabase } from '../lib/supabase.js'

export function AuthenticatedStatusPage({ destination }) {
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

      const route = getApplicationDestination(result.profile)
      if (!route.ok) {
        setState({ kind: 'error', message: route.message })
      } else if (route.redirectTo !== destination) {
        window.location.replace(route.redirectTo)
      } else {
        setState({ kind: 'ready', profile: result.profile })
      }
    })

    return () => {
      active = false
    }
  }, [destination])

  const isAdmin = destination === '/admin'

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">
          {isAdmin ? 'Platform administration' : 'Authenticated application'}
        </span>
        {state.kind === 'loading' && (
          <>
            <h1>Checking access…</h1>
            <div className="spinner" aria-label="Loading" />
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1>Access unavailable</h1>
            <p className="error-message" role="alert">{state.message}</p>
          </>
        )}
        {state.kind === 'ready' && (
          <>
            <h1>{isAdmin ? 'Admin access verified' : 'Account active'}</h1>
            <p>
              Signed in as {state.profile.user.firstName} {state.profile.user.lastName}.
            </p>
            <p>
              {isAdmin
                ? 'Account approval tools can be added here next.'
                : 'Your store is approved. The business dashboard can be connected here next.'}
            </p>
          </>
        )}
      </section>
    </main>
  )
}
