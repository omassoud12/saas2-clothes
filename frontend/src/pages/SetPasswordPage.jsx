import { useEffect, useRef, useState } from 'react'
import { PASSWORD_MIN_LENGTH, updateInvitedUserPassword, verifyPasswordSetupSession } from '../auth/auth-flow.js'
import { fieldErrorFor, friendlyAuthMessage } from '../auth/auth-messages.js'
import { AuthDone, AuthLinkButton, AuthLogout, AuthNotice, AuthPasswordField, AuthShell, AuthSubmit, AuthWaiting } from '../components/auth/AuthShell.jsx'
import { supabase } from '../lib/supabase.js'
import { useDirtyState } from '../app/dirty-state.js'
import { useI18n } from '../i18n/I18nContext.js'

export function SetPasswordPage() {
  const { t } = useI18n()
  const sessionCheckPromise = useRef(null)
  const redirectTimer = useRef(null)
  const submissionLock = useRef(false)
  const [pageState, setPageState] = useState('loading')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const clearDirty = useDirtyState(Boolean(newPassword || confirmPassword))
  useEffect(() => {
    if (!sessionCheckPromise.current) sessionCheckPromise.current = verifyPasswordSetupSession({ supabase, storage: window.sessionStorage })
    let active = true
    void sessionCheckPromise.current.then((result) => { if (!active) return; if (result.ok) setPageState('ready'); else { setMessage(friendlyAuthMessage(result)); setPageState('error') } })
    return () => { active = false; if (redirectTimer.current) window.clearTimeout(redirectTimer.current) }
  }, [])
  async function handleSubmit(event) {
    event.preventDefault(); if (submissionLock.current) return
    submissionLock.current = true; setSubmitting(true); setMessage(''); setErrors({})
    const result = await updateInvitedUserPassword({ supabase, storage: window.sessionStorage, newPassword, confirmPassword })
    if (!result.ok) {
      // Problems with one field show under that field; anything else shows above the button.
      const fieldError = fieldErrorFor(result, { newPassword })
      if (fieldError) setErrors({ [fieldError.field]: fieldError.text })
      else setMessage(friendlyAuthMessage(result))
      submissionLock.current = false; setSubmitting(false); return
    }
    clearDirty(); setNewPassword(''); setConfirmPassword(''); setPageState('success'); setMessage('Your password is saved. Taking you to log in…')
    redirectTimer.current = window.setTimeout(() => window.location.replace(result.redirectTo), 1200)
  }
  const title = pageState === 'success' ? t('Password saved') : pageState === 'error' ? t('This link does not work') : t('Choose your password')
  const subtitle = pageState === 'error' ? t('You cannot use this link to choose a password.') : t('You will use it with your email to log in.')
  return (
    <AuthShell title={title} subtitle={subtitle}>
      {pageState === 'loading' && <AuthWaiting label={t('Checking your link…')} />}
      {pageState === 'error' && <div className="auth-stack"><AuthNotice>{message}</AuthNotice><AuthLinkButton href="/login">{t('Back to log in')}</AuthLinkButton></div>}
      {pageState === 'success' && <div className="auth-stack"><AuthDone message={message} /></div>}
      {pageState === 'ready' && <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <AuthPasswordField id="new-password" label={t('New password')} hint={t('At least {count} characters.', { count: PASSWORD_MIN_LENGTH })} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={submitting} error={errors.password} />
        <AuthPasswordField id="confirm-password" label={t('Type the password again')} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting} error={errors.confirmPassword} />
        <AuthNotice>{message}</AuthNotice>
        <AuthSubmit busy={submitting} busyLabel={t('Saving…')}>{t('Save password')}</AuthSubmit>
      </form>}
      {pageState === 'ready' && <AuthLogout disabled={submitting} />}
    </AuthShell>
  )
}
