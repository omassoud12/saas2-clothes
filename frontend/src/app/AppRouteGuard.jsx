import { useEffect, useRef, useState } from 'react'
import { loadBusinessAppProfile } from './app-flow.js'
import { AppLayout } from './AppLayout.jsx'
import { supabase } from '../lib/supabase.js'

export function AppRouteGuard({ pathname, navigate }) {
  const profilePromise = useRef(null)
  const [state, setState] = useState({ kind: 'loading' })

  useEffect(() => {
    if (!profilePromise.current) {
      profilePromise.current = loadBusinessAppProfile({ supabase })
    }

    let active = true
    void profilePromise.current.then((result) => {
      if (!active) return

      if (result.ok) {
        setState({ kind: 'ready', profile: result.profile })
      } else if (result.redirectTo) {
        window.location.replace(result.redirectTo)
      } else {
        setState({ kind: 'error', message: result.message })
      }
    })

    return () => {
      active = false
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <main>
        <section className="card auth-card" aria-live="polite">
          <span className="eyebrow">Store workspace</span>
          <h1>Opening your workspace...</h1>
          <div className="spinner" aria-label="Loading" />
        </section>
      </main>
    )
  }

  if (state.kind === 'error') {
    return (
      <main>
        <section className="card auth-card">
          <span className="eyebrow">Store workspace</span>
          <h1>Workspace unavailable</h1>
          <p className="error-message" role="alert">{state.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    )
  }

  return (
    <AppLayout
      pathname={pathname}
      navigate={navigate}
      profile={state.profile}
    />
  )
}
