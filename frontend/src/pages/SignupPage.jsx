import { useState } from 'react'
import { PASSWORD_MIN_LENGTH } from '../auth/auth-flow.js'
import {
  createSubmissionGuard,
  requestOwnerSignup,
} from '../auth/owner-flow.js'
import { supabase } from '../lib/supabase.js'

export function SignupPage() {
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()

    const guarded = await submissionGuard.run(async () => {
      setSubmitting(true)
      setMessage('')
      return requestOwnerSignup({
        supabase,
        email,
        password,
        confirmPassword,
        origin: window.location.origin,
      })
    })

    if (guarded.skipped) return

    const result = guarded.value
    setSubmitting(false)
    setMessage(result.message)

    if (result.ok) {
      setPassword('')
      setConfirmPassword('')
      setComplete(true)
    }
  }

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">Create your store</span>
        <h1>Owner signup</h1>
        <p>Create your secure login first. Store details come after email confirmation.</p>

        {complete ? (
          <>
            <p className="success-message" role="status">{message}</p>
            <a className="button-link secondary" href="/login">Return to sign in</a>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              required
            />

            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />

            <label htmlFor="signup-confirm-password">Confirm password</label>
            <input
              id="signup-confirm-password"
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
              {submitting ? 'Creating account…' : 'Create owner account'}
            </button>
          </form>
        )}

        {!complete && (
          <p className="auth-link-row">
            Already have an account? <a href="/login">Sign in</a>
          </p>
        )}
      </section>
    </main>
  )
}
