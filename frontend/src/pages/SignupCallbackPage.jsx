import { useEffect, useRef, useState } from 'react'
import { completeSignupCallback } from '../auth/owner-flow.js'
import { signupCallbackContext, supabase } from '../lib/supabase.js'

export function SignupCallbackPage() {
  const callbackPromise = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!callbackPromise.current) {
      callbackPromise.current = completeSignupCallback({
        supabase,
        callback: signupCallbackContext,
        clearUrl: () =>
          window.history.replaceState(null, '', '/auth/signup-callback'),
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
        <span className="eyebrow">Email confirmation</span>
        {error ? (
          <>
            <h1>Confirmation unavailable</h1>
            <p className="error-message" role="alert">{error}</p>
            <a className="button-link secondary" href="/signup">Return to signup</a>
          </>
        ) : (
          <>
            <h1>Confirming your email…</h1>
            <p>Please wait while Supabase verifies your session.</p>
            <div className="spinner" aria-label="Loading" />
          </>
        )}
      </section>
    </main>
  )
}
