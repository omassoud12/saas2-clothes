import { useState } from 'react'
import { PASSWORD_MIN_LENGTH } from '../auth/auth-flow.js'
import { createSubmissionGuard, requestOwnerSignup } from '../auth/owner-flow.js'
import { AuthAction, AuthLayout, FormMessage, Input, PasswordField } from '../components/auth/AuthLayout.jsx'
import { supabase } from '../lib/supabase.js'
import { useI18n } from '../i18n/I18nContext.js'

export function SignupPage() {
  const { t } = useI18n()
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '' })
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  function updateField(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })) }
  async function handleSubmit(event) {
    event.preventDefault()
    const guarded = await submissionGuard.run(async () => {
      setSubmitting(true); setMessage('')
      return requestOwnerSignup({ supabase, ...form, origin: window.location.origin })
    })
    if (guarded.skipped) return
    const result = guarded.value
    setSubmitting(false); setMessage(result.message)
    if (result.ok) { setForm((current) => ({ ...current, password: '', confirmPassword: '' })); setComplete(true) }
  }
  return (
    <AuthLayout eyebrow={complete ? t('Email confirmation') : t('Create your store')} title={complete ? t('Check your email') : t('Create an owner account')} description={complete ? t('We sent a confirmation link to the address you provided.') : t('Create your secure login first. Store details come after confirmation.')}>
      {complete ? (
        <div className="auth-confirmation-state">
          <span className="auth-state-mark auth-state-mark--success" aria-hidden="true">✓</span>
          <FormMessage kind="success">{t(message)}</FormMessage>
          <p>{t('Open the link in the email to verify your address. You will then continue to store setup.')}</p>
          <a className="ui-button ui-button--secondary auth-link-button" href="/login">{t('Return to sign in')}</a>
        </div>
      ) : (<>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Input id="signup-email" name="email" label={t('Email address')} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={updateField} disabled={submitting} required />
          <PasswordField id="signup-password" name="password" label={t('Password')} hint={t('Use at least {PASSWORD_MIN_LENGTH} characters.', { PASSWORD_MIN_LENGTH })} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={form.password} onChange={updateField} disabled={submitting} required />
          <PasswordField id="signup-confirm-password" name="confirmPassword" label={t('Confirm password')} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={form.confirmPassword} onChange={updateField} disabled={submitting} required />
          <FormMessage>{t(message)}</FormMessage>
          <AuthAction type="submit" disabled={submitting}>{submitting ? t('Creating account…') : t('Create owner account')}</AuthAction>
        </form>
        <p className="auth-link-row">{t('Already have an account?')} <a href="/login">{t('Sign in')}</a></p>
      </>)}
    </AuthLayout>
  )
}
