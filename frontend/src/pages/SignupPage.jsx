import { useState } from 'react'
import { PASSWORD_MIN_LENGTH } from '../auth/auth-flow.js'
import { fieldErrorFor, friendlyAuthMessage } from '../auth/auth-messages.js'
import { createSubmissionGuard, requestOwnerSignup } from '../auth/owner-flow.js'
import { AuthDone, AuthLinkButton, AuthNotice, AuthPasswordField, AuthShell, AuthSubmit, AuthTextField } from '../components/auth/AuthShell.jsx'
import { supabase } from '../lib/supabase.js'

export function SignupPage() {
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  function updateField(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })) }
  async function handleSubmit(event) {
    event.preventDefault()
    const guarded = await submissionGuard.run(async () => {
      setSubmitting(true); setMessage(''); setErrors({})
      return requestOwnerSignup({ supabase, ...form, origin: window.location.origin })
    })
    if (guarded.skipped) return
    const result = guarded.value
    setSubmitting(false)
    // Problems with one field show under that field; anything else shows above the button.
    const fieldError = fieldErrorFor(result, form)
    if (fieldError) setErrors({ [fieldError.field]: fieldError.text })
    else setMessage(friendlyAuthMessage(result))
    if (result.ok) { setForm((current) => ({ ...current, password: '', confirmPassword: '' })); setComplete(true) }
  }

  if (complete) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a link to ${form.email.trim()}.`}
        seoTitle="Check your email · SaaS2"
        seoDescription="Confirm your email to finish creating your SaaS2 shop account."
      >
        <div className="auth-form">
          <AuthDone message={message}>
            <p className="muted">After you confirm, you will add your name and your shop.</p>
            <AuthLinkButton href="/login">Back to log in</AuthLinkButton>
          </AuthDone>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your shop account"
      subtitle="Set up in a few minutes. No card needed."
      seoTitle="Create your shop account · SaaS2"
      seoDescription="Create a SaaS2 account for your clothing shop."
      footer={<>Already have an account? <a href="/login">Log in</a></>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <AuthTextField id="signup-email" name="email" label="Email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={updateField} disabled={submitting} error={errors.email} />
        <AuthPasswordField id="signup-password" name="password" label="Password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={form.password} onChange={updateField} disabled={submitting} error={errors.password} />
        <AuthPasswordField id="signup-confirm-password" name="confirmPassword" label="Type the password again" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={form.confirmPassword} onChange={updateField} disabled={submitting} error={errors.confirmPassword} />
        <AuthNotice>{message}</AuthNotice>
        <AuthSubmit busy={submitting} busyLabel="Creating account…">Create account</AuthSubmit>
        <p className="auth-form__legal">By creating an account you agree to the <a href="#terms">Terms</a> and <a href="#privacy">Privacy policy</a>.</p>
      </form>
    </AuthShell>
  )
}
