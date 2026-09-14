import { useRef, useState } from 'react'
import { requestPasswordRecovery } from '../auth/auth-flow.js'
import { resolvePostLoginDestination } from '../auth/owner-flow.js'
import { supabase } from '../lib/supabase.js'

export function LoginPage() {
  const actionLock = useRef(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('error')
  const [busyAction, setBusyAction] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    if (actionLock.current) return

    if (!supabase || !email.trim() || !password) {
      setMessage('Enter your email and password.')
      setMessageKind('error')
      return
    }

    actionLock.current = true
    setBusyAction('login')
    setMessage('')
    let signInResult
    try {
      signInResult = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
    } catch {
      signInResult = { error: true }
    }

    if (signInResult.error) {
      setMessage('Sign in failed. Check your credentials and try again.')
      setMessageKind('error')
      actionLock.current = false
      setBusyAction(null)
      return
    }

    setPassword('')
    const destination = await resolvePostLoginDestination({ supabase })
    if (!destination.ok) {
      setMessage(destination.message)
      setMessageKind('error')
      actionLock.current = false
      setBusyAction(null)
      return
    }

    window.location.replace(destination.redirectTo)
  }

  async function handlePasswordRecovery() {
    if (actionLock.current) return

    actionLock.current = true
    setBusyAction('recovery')
    setMessage('')
    const result = await requestPasswordRecovery({
      supabase,
      email,
      origin: window.location.origin,
    })
    setMessage(result.message)
    setMessageKind(result.ok ? 'success' : 'error')
    actionLock.current = false
    setBusyAction(null)
  }

  return (
    <main>
      <section className="card auth-card">
        <span className="eyebrow">Welcome back</span>
        <h1>Sign in</h1>
        <p>Use your confirmed email address and password.</p>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={Boolean(busyAction)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={Boolean(busyAction)}
            required
          />
          <button
            className="text-button"
            type="button"
            disabled={Boolean(busyAction)}
            onClick={handlePasswordRecovery}
          >
            {busyAction === 'recovery' ? 'Sending…' : 'Forgot password?'}
          </button>
          {message && (
            <p
              className={messageKind === 'success' ? 'success-message' : 'error-message'}
              role={messageKind === 'success' ? 'status' : 'alert'}
            >
              {message}
            </p>
          )}
          <button type="submit" disabled={Boolean(busyAction)}>
            {busyAction === 'login' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="auth-link-row">
          Opening a new store? <a href="/signup">Create an owner account</a>
        </p>
      </section>
    </main>
  )
}
