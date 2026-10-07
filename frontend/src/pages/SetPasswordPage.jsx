import { useEffect, useRef, useState } from 'react'
import { PASSWORD_MIN_LENGTH, updateInvitedUserPassword, verifyPasswordSetupSession } from '../auth/auth-flow.js'
import { AuthAction, AuthLayout, AuthLoading, FormMessage, PasswordField } from '../components/auth/AuthLayout.jsx'
import { supabase } from '../lib/supabase.js'
import { LogoutAction } from '../components/auth/LogoutAction.jsx'
import { useDirtyState } from '../app/dirty-state.js'

export function SetPasswordPage() {
  const sessionCheckPromise = useRef(null)
  const redirectTimer = useRef(null)
  const submissionLock = useRef(false)
  const [pageState, setPageState] = useState('loading')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const clearDirty = useDirtyState(Boolean(newPassword || confirmPassword))
  useEffect(() => {
    if (!sessionCheckPromise.current) sessionCheckPromise.current = verifyPasswordSetupSession({ supabase, storage: window.sessionStorage })
    let active = true
    void sessionCheckPromise.current.then((result) => { if (!active) return; if (result.ok) setPageState('ready'); else { setMessage(result.message); setPageState('error') } })
    return () => { active = false; if (redirectTimer.current) window.clearTimeout(redirectTimer.current) }
  }, [])
  async function handleSubmit(event) {
    event.preventDefault(); if (submissionLock.current) return
    submissionLock.current = true; setSubmitting(true); setMessage('')
    const result = await updateInvitedUserPassword({ supabase, storage: window.sessionStorage, newPassword, confirmPassword })
    if (!result.ok) { setMessage(result.message); submissionLock.current = false; setSubmitting(false); return }
    clearDirty(); setNewPassword(''); setConfirmPassword(''); setPageState('success'); setMessage('Your password is ready. Redirecting you to sign in…')
    redirectTimer.current = window.setTimeout(() => window.location.replace(result.redirectTo), 1200)
  }
  const title = pageState === 'success' ? 'Password updated' : pageState === 'error' ? 'Password setup unavailable' : 'Choose your password'
  return <AuthLayout eyebrow="Account security" title={title} description="Invitation sessions are verified before a password can be changed.">
    {pageState === 'loading' && <AuthLoading label="Preparing secure password setup" />}
    {pageState === 'error' && <div className="auth-status-stack"><FormMessage>{message}</FormMessage><a className="ui-button ui-button--secondary auth-link-button" href="/login">Return to sign in</a></div>}
    {pageState === 'success' && <div className="auth-confirmation-state"><span className="auth-state-mark auth-state-mark--success" aria-hidden="true">✓</span><FormMessage kind="success">{message}</FormMessage></div>}
    {pageState === 'ready' && <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <PasswordField id="new-password" label="New password" hint={`Use at least ${PASSWORD_MIN_LENGTH} characters.`} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={submitting} required />
      <PasswordField id="confirm-password" label="Confirm password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting} required />
      <FormMessage>{message}</FormMessage><AuthAction type="submit" disabled={submitting}>{submitting ? 'Updating…' : 'Set password'}</AuthAction>
    </form>}
    {pageState === 'ready' && <LogoutAction disabled={submitting} />}
  </AuthLayout>
}
