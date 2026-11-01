import { useEffect, useRef, useState } from 'react'
import { requestPasswordRecovery } from '../auth/auth-flow.js'
import { friendlyAuthMessage, validateLogin } from '../auth/auth-messages.js'
import { createSubmissionGuard, resolveExistingSessionDestination, signInApplicationUser } from '../auth/owner-flow.js'
import { AuthNotice, AuthPasswordField, AuthShell, AuthSubmit, AuthTextField, AuthWaiting } from '../components/auth/AuthShell.jsx'
import { supabase } from '../lib/supabase.js'
import { useI18n } from '../i18n/I18nContext.js'

export function LoginPage() {
  const { t } = useI18n()
  const sessionPromise = useRef(null)
  const [actionGuard] = useState(() => createSubmissionGuard())
  const [pageState, setPageState] = useState('initializing')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('error')
  const [busyAction, setBusyAction] = useState(null)

  useEffect(() => {
    if (!sessionPromise.current) sessionPromise.current = resolveExistingSessionDestination({ supabase })
    let active = true
    void sessionPromise.current.then((result) => {
      if (!active) return
      if (result.ok && result.authenticated) window.location.replace(result.redirectTo)
      else {
        if (!result.ok && result.code !== 'SESSION_REQUIRED') setMessage(friendlyAuthMessage(result))
        setPageState('ready')
      }
    })
    return () => { active = false }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const fieldErrors = validateLogin({ email, password })
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) {
      setMessage('')
      return
    }
    const guarded = await actionGuard.run(async () => {
      setBusyAction('login')
      setMessage('')
      return signInApplicationUser({ supabase, email, password })
    })
    if (guarded.skipped) return
    const result = guarded.value
    if (result.ok) {
      setPassword('')
      window.location.replace(result.redirectTo)
      return
    }
    setMessage(friendlyAuthMessage(result))
    setMessageKind('error')
    setBusyAction(null)
  }

  async function handlePasswordRecovery() {
    const guarded = await actionGuard.run(async () => {
      setBusyAction('recovery')
      setMessage('')
      return requestPasswordRecovery({ supabase, email, origin: window.location.origin })
    })
    if (guarded.skipped) return
    const result = guarded.value
    if (result.code === 'INVALID_RECOVERY_EMAIL') {
      // The reset link goes to the email above, so the problem belongs under that field.
      setErrors({ email: 'Enter your email above, then tap Forgot password.' })
      setMessage('')
    } else {
      setErrors({})
      setMessage(friendlyAuthMessage(result))
      setMessageKind(result.ok ? 'success' : 'error')
    }
    setBusyAction(null)
  }

  const busy = Boolean(busyAction)

  return (
    <AuthShell
      title={t('Welcome back')}
      subtitle={t('Log in to your shop.')}
      seoTitle={t('Log in · SaaS2')}
      seoDescription={t('Log in to your SaaS2 shop account.')}
      footer={<>{t('New to SaaS2?')} <a href="/signup">{t('Create an account')}</a></>}
    >
      {pageState === 'initializing' ? <AuthWaiting label={t('Checking if you are already logged in…')} /> : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <AuthTextField
            id="email"
            label={t('Email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            error={errors.email}
          />
          <AuthPasswordField
            id="password"
            label={t('Password')}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            error={errors.password}
            extra={(
              <button type="button" className="field__link" disabled={busy} onClick={handlePasswordRecovery}>
                {busyAction === 'recovery' ? t('Sending link…') : t('Forgot password?')}
              </button>
            )}
          />
          <AuthNotice kind={messageKind}>{message}</AuthNotice>
          <AuthSubmit busy={busyAction === 'login'} busyLabel={t('Logging in…')} disabled={busy}>{t('Log in')}</AuthSubmit>
        </form>
      )}
    </AuthShell>
  )
}
