import { useEffect, useRef, useState } from 'react'
import { completeAuthCallback } from '../auth/auth-flow.js'
import { AuthLayout, AuthLoading, FormMessage } from '../components/auth/AuthLayout.jsx'
import { authCallbackContext, exchangeAuthCallbackCode, supabase } from '../lib/supabase.js'

export function AuthCallbackPage() {
  const callbackPromise = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!callbackPromise.current) callbackPromise.current = completeAuthCallback({
      supabase,
      callback: authCallbackContext,
      exchangeCode: exchangeAuthCallbackCode,
      storage: window.sessionStorage,
      clearUrl: () => window.history.replaceState(null, '', '/auth/callback'),
      navigate: (path) => window.location.replace(path),
    })
    let active = true
    void callbackPromise.current.then((result) => { if (active && !result.ok) setError(result.message) })
    return () => { active = false }
  }, [])
  return <AuthLayout eyebrow="Secure invitation" title={error ? 'Invitation unavailable' : 'Checking your invitation'} description={error ? 'This link cannot be used to continue password setup.' : 'We are securely verifying your invitation before continuing.'}>
    {error ? <div className="auth-status-stack"><FormMessage>{error}</FormMessage><a className="ui-button ui-button--secondary auth-link-button" href="/login">Return to sign in</a></div> : <AuthLoading label="Verifying your invitation session" />}
  </AuthLayout>
}
