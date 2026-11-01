import { useState } from 'react'
import { PASSWORD_MIN_LENGTH } from '../auth/auth-flow.js'
import { fieldErrorFor, friendlyAuthMessage } from '../auth/auth-messages.js'
import { createSubmissionGuard, requestOwnerSignup } from '../auth/owner-flow.js'
import { AuthDone, AuthLinkButton, AuthNotice, AuthPasswordField, AuthShell, AuthSubmit, AuthTextField } from '../components/auth/AuthShell.jsx'
import { supabase } from '../lib/supabase.js'
import { useI18n } from '../i18n/I18nContext.js'

export function SignupPage() {
  const { t } = useI18n()
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
        title={t('Check your email')}
        subtitle={t('We sent a link to {email}.', { email: form.email.trim() })}
        seoTitle={t('Check your email · SaaS2')}
        seoDescription={t('Confirm your email to finish creating your SaaS2 shop account.')}
      >
        <div className="auth-form">
          <AuthDone message={message}>
            <p className="muted">{t('After you confirm, you will add your name and your shop.')}</p>
            <AuthLinkButton href="/login">{t('Back to log in')}</AuthLinkButton>
          </AuthDone>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={t('Create your shop account')}
      subtitle={t('Set up in a few minutes. No card needed.')}
      seoTitle={t('Create your shop account · SaaS2')}
      seoDescription={t('Create a SaaS2 account for your clothing shop.')}
      footer={<>{t('Already have an account?')} <a href="/login">{t('Log in')}</a></>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <AuthTextField id="signup-email" name="email" label={t('Email')} type="email" inputMode="email" autoComplete="email" value={form.email} onChange={updateField} disabled={submitting} error={errors.email} />
        <AuthPasswordField id="signup-password" name="password" label={t('Password')} hint={t('At least {count} characters.', { count: PASSWORD_MIN_LENGTH })} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={form.password} onChange={updateField} disabled={submitting} error={errors.password} />
        <AuthPasswordField id="signup-confirm-password" name="confirmPassword" label={t('Type the password again')} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={form.confirmPassword} onChange={updateField} disabled={submitting} error={errors.confirmPassword} />
        <AuthNotice>{message}</AuthNotice>
        <AuthSubmit busy={submitting} busyLabel={t('Creating account…')}>{t('Create account')}</AuthSubmit>
        <p className="auth-form__legal">{t('By creating an account you agree to the')} <a href="#terms">{t('Terms')}</a> {t('and')} <a href="#privacy">{t('Privacy policy')}</a>.</p>
      </form>
    </AuthShell>
  )
}
