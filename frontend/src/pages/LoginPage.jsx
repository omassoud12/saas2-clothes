import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return

    if (!supabase || !email.trim() || !password) {
      setMessage('Enter your email and password.')
      return
    }

    setSubmitting(true)
    setMessage('')
    let error
    try {
      const result = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      error = result.error
    } catch {
      error = true
    }

    if (error) {
      setMessage('Sign in failed. Check your credentials and try again.')
      setSubmitting(false)
      return
    }

    setPassword('')
    window.location.replace('/')
  }

  return (
    <main>
      <section className="card auth-card">
        <span className="eyebrow">Welcome back</span>
        <h1>Sign in</h1>
        <p>Use the password you created from your secure invitation.</p>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
          />
          {message && <p className="error-message" role="alert">{message}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
