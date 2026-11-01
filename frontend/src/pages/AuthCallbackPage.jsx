import { useEffect, useRef, useState } from 'react'
import { completeAuthCallback } from '../auth/auth-flow.js'
import { friendlyAuthMessage } from '../auth/auth-messages.js'
import { AuthLinkButton, AuthNotice, AuthShell, AuthWaiting } from '../components/auth/AuthShell.jsx'
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
    void callbackPromise.current.then((result) => { if (active && !result.ok) setError(friendlyAuthMessage(result)) })
    return () => { active = false }
  }, [])
  return (
    <AuthShell
      title={error ? 'This link does not work' : 'Checking your link'}
      subtitle={error ? 'You cannot use this link to choose a password.' : 'One moment, then you can choose your password.'}
    >
      {error
        ? <div className="auth-stack"><AuthNotice>{error}</AuthNotice><AuthLinkButton href="/login">Back to log in</AuthLinkButton></div>
        : <AuthWaiting label="Checking your link…" />}
    </AuthShell>
  )
}
