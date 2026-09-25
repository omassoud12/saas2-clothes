import { useEffect, useRef, useState } from 'react'
import { requestPasswordRecovery } from '../auth/auth-flow.js'
import { createSubmissionGuard, resolveExistingSessionDestination, signInApplicationUser } from '../auth/owner-flow.js'
import { AuthAction, AuthLayout, AuthLoading, FormMessage, Input, PasswordField } from '../components/auth/AuthLayout.jsx'
import { supabase } from '../lib/supabase.js'

export function LoginPage() {
  const sessionPromise = useRef(null)
  const [actionGuard] = useState(() => createSubmissionGuard())
  const [pageState, setPageState] = useState('initializing')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('error')
  const [busyAction, setBusyAction] = useState(null)

  useEffect(() => {
    if (!sessionPromise.current) sessionPromise.current = resolveExistingSessionDestination({ supabase })
    let active = true
    void sessionPromise.current.then((result) => {
      if (!active) return
      if (result.ok && result.authenticated) window.location.replace(result.redirectTo)
      else {
        if (!result.ok && result.code !== 'SESSION_REQUIRED') setMessage(result.message)
        setPageState('ready')
      }
    })
    return () => { active = false }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const guarded = await actionGuard.run(async () => {
      setBusyAction('login')
      setMessage('')
      return signInApplicationUser({ supabase, email, password })
    })
    if (guarded.skipped) return
    const result = guarded.value
    if (result.ok) {
      setPassword('')
      window.location.replace(result.redirectTo)
      return
    }
    setMessage(result.message)
    setMessageKind('error')
    setBusyAction(null)
  }

  async function handlePasswordRecovery() {
    const guarded = await actionGuard.run(async () => {
      setBusyAction('recovery')
      setMessage('')
      return requestPasswordRecovery({ supabase, email, origin: window.location.origin })
    })
    if (guarded.skipped) return
    const result = guarded.value
    setMessage(result.message)
    setMessageKind(result.ok ? 'success' : 'error')
    setBusyAction(null)
  }

  return (
    <AuthLayout eyebrow="Welcome back" title="Sign in to your workspace" description="Use your confirmed business email and password.">
      {pageState === 'initializing' ? <AuthLoading label="Restoring your secure session" /> : (
        <>
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <Input id="email" label="Email address" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={Boolean(busyAction)} required />
            <PasswordField id="password" label="Password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={Boolean(busyAction)} required />
            <div className="auth-form-secondary-action"><button className="text-button" type="button" disabled={Boolean(busyAction)} onClick={handlePasswordRecovery}>{busyAction === 'recovery' ? 'Sending recovery email…' : 'Forgot password?'}</button></div>
            <FormMessage kind={messageKind}>{message}</FormMessage>
            <AuthAction type="submit" disabled={Boolean(busyAction)}>{busyAction === 'login' ? 'Signing in…' : 'Sign in'}</AuthAction>
          </form>
          <p className="auth-link-row">Opening a new store? <a href="/signup">Create an owner account</a></p>
        </>
      )}
    </AuthLayout>
  )
}
