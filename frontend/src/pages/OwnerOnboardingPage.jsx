import { useEffect, useRef, useState } from 'react'
import { friendlyAuthMessage, onboardingFieldErrors } from '../auth/auth-messages.js'
import { bootstrapOwnerAccount, createSubmissionGuard, loadOwnerOnboarding } from '../auth/owner-flow.js'
import { AuthLinkButton, AuthLogout, AuthNotice, AuthSelectField, AuthShell, AuthSubmit, AuthTextField, AuthWaiting } from '../components/auth/AuthShell.jsx'
import { supabase } from '../lib/supabase.js'
import { useDirtyState } from '../app/dirty-state.js'

const initialForm = { firstName: '', lastName: '', accountName: '', baseCurrency: 'USD', employeeCode: '' }

export function OwnerOnboardingPage() {
  const sessionCheckPromise = useRef(null)
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [pageState, setPageState] = useState('loading')
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const clearDirty = useDirtyState(Object.keys(initialForm).some(key => form[key] !== initialForm[key]))
  useEffect(() => {
    if (!sessionCheckPromise.current) sessionCheckPromise.current = loadOwnerOnboarding({ supabase })
    let active = true
    void sessionCheckPromise.current.then((result) => {
      if (!active) return
      if (result.ok && result.redirectTo) window.location.replace(result.redirectTo)
      else if (result.ok) setPageState('ready')
      else if (result.code === 'SESSION_REQUIRED' || result.status === 401) window.location.replace('/login')
      else { setMessage(friendlyAuthMessage(result)); setPageState('error') }
    })
    return () => { active = false }
  }, [])
  function updateField(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })) }
  async function handleSubmit(event) {
    event.preventDefault()
    const guarded = await submissionGuard.run(async () => { setSubmitting(true); setMessage(''); setErrors({}); return bootstrapOwnerAccount({ supabase, input: form }) })
    if (guarded.skipped) return
    const result = guarded.value
    if (result.ok) { clearDirty(); window.location.replace('/pending-approval'); return }
    if (result.code === 'SESSION_REQUIRED' || result.status === 401) { window.location.replace('/login'); return }
    // Answers that need fixing show under their field; anything else shows above the button.
    const fieldErrors = onboardingFieldErrors(result, form)
    if (Object.keys(fieldErrors).length) setErrors(fieldErrors)
    else setMessage(friendlyAuthMessage(result))
    setSubmitting(false)
  }
  const field = (name) => ({ name, value: form[name], onChange: updateField, disabled: submitting, error: errors[name] })
  return (
    <AuthShell title="Set up your shop" subtitle="Tell us about you and your shop. We check it, then turn your account on.">
      {pageState === 'loading' && <AuthWaiting label="Checking your account…" />}
      {pageState === 'error' && <div className="auth-stack"><AuthNotice>{message}</AuthNotice><AuthLinkButton href="/login">Back to log in</AuthLinkButton></div>}
      {pageState === 'ready' && <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field-row">
          <AuthTextField id="first-name" label="First name" autoComplete="given-name" maxLength={100} {...field('firstName')} />
          <AuthTextField id="last-name" label="Last name" autoComplete="family-name" maxLength={100} {...field('lastName')} />
        </div>
        <AuthTextField id="account-name" label="Shop name" autoComplete="organization" maxLength={160} {...field('accountName')} />
        <AuthSelectField id="base-currency" label="Main currency" hint="Your reports and totals use this currency." {...field('baseCurrency')}>
          <option value="USD">US dollar (USD)</option>
          <option value="LBP">Lebanese lira (LBP)</option>
        </AuthSelectField>
        <AuthTextField id="employee-code" label="Employee code (optional)" hint="Letters, numbers, - and _ only." autoComplete="off" maxLength={50} {...field('employeeCode')} />
        <AuthNotice>{message}</AuthNotice>
        <AuthSubmit busy={submitting} busyLabel="Sending…">Send for approval</AuthSubmit>
      </form>}
      <AuthLogout disabled={submitting} />
    </AuthShell>
  )
}
