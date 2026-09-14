import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import {
  PASSWORD_MIN_LENGTH,
  updateInvitedUserPassword,
  verifyPasswordSetupSession,
} from '../auth/auth-flow.js'

export function SetPasswordPage() {
  const sessionCheckPromise = useRef(null)
  const redirectTimer = useRef(null)
  const submissionLock = useRef(false)
  const [pageState, setPageState] = useState('loading')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!sessionCheckPromise.current) {
      sessionCheckPromise.current = verifyPasswordSetupSession({
        supabase,
        storage: window.sessionStorage,
      })
    }

    let active = true
    void sessionCheckPromise.current.then((result) => {
      if (!active) return
      if (result.ok) {
        setPageState('ready')
      } else {
        setMessage(result.message)
        setPageState('error')
      }
    })

    return () => {
      active = false
      if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
    }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (submissionLock.current) return

    submissionLock.current = true
    setSubmitting(true)
    setMessage('')
    const result = await updateInvitedUserPassword({
      supabase,
      storage: window.sessionStorage,
      newPassword,
      confirmPassword,
    })

    if (!result.ok) {
      setMessage(result.message)
      submissionLock.current = false
      setSubmitting(false)
      return
    }

    setNewPassword('')
    setConfirmPassword('')
    setPageState('success')
    setMessage('Your password is ready. Redirecting you to sign in…')
    redirectTimer.current = window.setTimeout(
      () => window.location.replace(result.redirectTo),
      1200,
    )
  }

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">Account security</span>
        {pageState === 'loading' && (
          <>
            <h1>Preparing password setup…</h1>
            <p>We’re checking your invitation session.</p>
            <div className="spinner" aria-label="Loading" />
          </>
        )}

        {pageState === 'error' && (
          <>
            <h1>Password setup unavailable</h1>
            <p className="error-message" role="alert">{message}</p>
            <a className="button-link secondary" href="/login">Return to sign in</a>
          </>
        )}

        {pageState === 'success' && (
          <>
            <h1>Password updated</h1>
            <p className="success-message" role="status">{message}</p>
          </>
        )}

        {pageState === 'ready' && (
          <>
            <h1>Choose your password</h1>
            <p>Use at least {PASSWORD_MIN_LENGTH} characters. You’ll sign in again after setup.</p>
            <form onSubmit={handleSubmit} noValidate>
              <label htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={submitting}
                required
              />

              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={submitting}
                required
              />

              {message && <p className="error-message" role="alert">{message}</p>}
              <button type="submit" disabled={submitting}>
                {submitting ? 'Updating…' : 'Set password'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
