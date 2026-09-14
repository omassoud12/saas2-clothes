import { useEffect, useRef, useState } from 'react'
import {
  authCallbackContext,
  supabase,
} from '../lib/supabase.js'
import { completeAuthCallback } from '../auth/auth-flow.js'

export function AuthCallbackPage() {
  const callbackPromise = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!callbackPromise.current) {
      callbackPromise.current = completeAuthCallback({
        supabase,
        callback: authCallbackContext,
        storage: window.sessionStorage,
        clearUrl: () =>
          window.history.replaceState(null, '', '/auth/callback'),
        navigate: (path) => window.location.replace(path),
      })
    }

    let active = true
    void callbackPromise.current.then((result) => {
      if (active && !result.ok) setError(result.message)
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">Secure invitation</span>
        {error ? (
          <>
            <h1>Invitation unavailable</h1>
            <p className="error-message" role="alert">{error}</p>
            <a className="button-link secondary" href="/login">Return to sign in</a>
          </>
        ) : (
          <>
            <h1>Checking your invitation…</h1>
            <p>Please wait while we verify your secure Supabase session.</p>
            <div className="spinner" aria-label="Loading" />
          </>
        )}
      </section>
    </main>
  )
}
