import { useEffect, useRef, useState } from 'react'
import {
  bootstrapOwnerAccount,
  createSubmissionGuard,
  verifyAuthenticatedSession,
} from '../auth/owner-flow.js'
import { supabase } from '../lib/supabase.js'

const initialForm = {
  firstName: '',
  lastName: '',
  accountName: '',
  baseCurrency: 'USD',
  employeeCode: '',
}

export function OwnerOnboardingPage() {
  const sessionCheckPromise = useRef(null)
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [pageState, setPageState] = useState('loading')
  const [form, setForm] = useState(initialForm)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!sessionCheckPromise.current) {
      sessionCheckPromise.current = verifyAuthenticatedSession({ supabase })
    }

    let active = true
    void sessionCheckPromise.current.then((result) => {
      if (!active) return
      if (result.ok) {
        setPageState('ready')
      } else if (result.code === 'SESSION_REQUIRED') {
        window.location.replace('/login')
      } else {
        setMessage(result.message)
        setPageState('error')
      }
    })

    return () => {
      active = false
    }
  }, [])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const guarded = await submissionGuard.run(async () => {
      setSubmitting(true)
      setMessage('')
      return bootstrapOwnerAccount({ supabase, input: form })
    })

    if (guarded.skipped) return

    const result = guarded.value
    if (result.ok) {
      window.location.replace('/pending-approval')
      return
    }

    if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
      window.location.replace('/login')
      return
    }

    setMessage(result.message)
    setSubmitting(false)
  }

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">Store setup</span>

        {pageState === 'loading' && (
          <>
            <h1>Checking your session…</h1>
            <div className="spinner" aria-label="Loading" />
          </>
        )}

        {pageState === 'error' && (
          <>
            <h1>Onboarding unavailable</h1>
            <p className="error-message" role="alert">{message}</p>
            <a className="button-link secondary" href="/login">Return to sign in</a>
          </>
        )}

        {pageState === 'ready' && (
          <>
            <h1>Tell us about your store</h1>
            <p>Your account will be submitted for platform approval.</p>
            <form onSubmit={handleSubmit} noValidate>
              <label htmlFor="first-name">First name</label>
              <input
                id="first-name"
                name="firstName"
                autoComplete="given-name"
                maxLength={100}
                value={form.firstName}
                onChange={updateField}
                disabled={submitting}
                required
              />

              <label htmlFor="last-name">Last name</label>
              <input
                id="last-name"
                name="lastName"
                autoComplete="family-name"
                maxLength={100}
                value={form.lastName}
                onChange={updateField}
                disabled={submitting}
                required
              />

              <label htmlFor="account-name">Store name</label>
              <input
                id="account-name"
                name="accountName"
                autoComplete="organization"
                maxLength={160}
                value={form.accountName}
                onChange={updateField}
                disabled={submitting}
                required
              />

              <label htmlFor="base-currency">Base currency</label>
              <select
                id="base-currency"
                name="baseCurrency"
                value={form.baseCurrency}
                onChange={updateField}
                disabled={submitting}
              >
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>

              <label htmlFor="employee-code">Employee code (optional)</label>
              <input
                id="employee-code"
                name="employeeCode"
                maxLength={50}
                value={form.employeeCode}
                onChange={updateField}
                disabled={submitting}
              />

              {message && <p className="error-message" role="alert">{message}</p>}
              <button type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit for approval'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
