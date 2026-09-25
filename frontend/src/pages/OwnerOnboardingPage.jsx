import { useEffect, useRef, useState } from 'react'
import { bootstrapOwnerAccount, createSubmissionGuard, verifyAuthenticatedSession } from '../auth/owner-flow.js'
import { AuthAction, AuthLayout, AuthLoading, FormMessage, Input } from '../components/auth/AuthLayout.jsx'
import { Select } from '../components/ui/index.jsx'
import { supabase } from '../lib/supabase.js'

const initialForm = { firstName: '', lastName: '', accountName: '', baseCurrency: 'USD', employeeCode: '' }

export function OwnerOnboardingPage() {
  const sessionCheckPromise = useRef(null)
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [pageState, setPageState] = useState('loading')
  const [form, setForm] = useState(initialForm)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (!sessionCheckPromise.current) sessionCheckPromise.current = verifyAuthenticatedSession({ supabase })
    let active = true
    void sessionCheckPromise.current.then((result) => {
      if (!active) return
      if (result.ok) setPageState('ready')
      else if (result.code === 'SESSION_REQUIRED') window.location.replace('/login')
      else { setMessage(result.message); setPageState('error') }
    })
    return () => { active = false }
  }, [])
  function updateField(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })) }
  async function handleSubmit(event) {
    event.preventDefault()
    const guarded = await submissionGuard.run(async () => { setSubmitting(true); setMessage(''); return bootstrapOwnerAccount({ supabase, input: form }) })
    if (guarded.skipped) return
    const result = guarded.value
    if (result.ok) { window.location.replace('/pending-approval'); return }
    if (result.code === 'SESSION_REQUIRED' || result.status === 401) { window.location.replace('/login'); return }
    setMessage(result.message); setSubmitting(false)
  }
  return <AuthLayout eyebrow="Store setup" title="Set up your store" description="Add the essentials, then submit the account for platform approval.">
    {pageState === 'loading' && <AuthLoading label="Checking your secure session" />}
    {pageState === 'error' && <div className="auth-status-stack"><FormMessage>{message}</FormMessage><a className="ui-button ui-button--secondary auth-link-button" href="/login">Return to sign in</a></div>}
    {pageState === 'ready' && <form className="auth-form auth-onboarding-form" onSubmit={handleSubmit} noValidate>
      <div className="auth-form-grid">
        <Input id="first-name" name="firstName" label="First name" autoComplete="given-name" maxLength={100} value={form.firstName} onChange={updateField} disabled={submitting} required />
        <Input id="last-name" name="lastName" label="Last name" autoComplete="family-name" maxLength={100} value={form.lastName} onChange={updateField} disabled={submitting} required />
      </div>
      <Input id="account-name" name="accountName" label="Store name" autoComplete="organization" maxLength={160} value={form.accountName} onChange={updateField} disabled={submitting} required />
      <Select id="base-currency" name="baseCurrency" label="Base currency" hint="This becomes the store's financial reporting currency." value={form.baseCurrency} onChange={updateField} disabled={submitting}><option value="USD">USD</option><option value="LBP">LBP</option></Select>
      <Input id="employee-code" name="employeeCode" label="Employee code (optional)" hint="Letters, numbers, hyphens, and underscores only." maxLength={50} value={form.employeeCode} onChange={updateField} disabled={submitting} />
      <FormMessage>{message}</FormMessage>
      <AuthAction type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit for approval'}</AuthAction>
    </form>}
  </AuthLayout>
}
