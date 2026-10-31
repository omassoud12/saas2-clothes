import { useEffect, useRef, useState } from 'react'
import { completeSignupCallback } from '../auth/owner-flow.js'
import { AuthLayout, AuthLoading, FormMessage } from '../components/auth/AuthLayout.jsx'
import { signupCallbackContext, supabase } from '../lib/supabase.js'
import { useI18n } from '../i18n/I18nContext.js'

export function SignupCallbackPage() {
  const { t } = useI18n()
  const callbackPromise = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!callbackPromise.current) callbackPromise.current = completeSignupCallback({
      supabase,
      callback: signupCallbackContext,
      clearUrl: () => window.history.replaceState(null, '', '/auth/signup-callback'),
      navigate: (path) => window.location.replace(path),
    })
    let active = true
    void callbackPromise.current.then((result) => { if (active && !result.ok) setError(result.message) })
    return () => { active = false }
  }, [])
  return <AuthLayout eyebrow={t('Email confirmation')} title={error ? t('Confirmation unavailable') : t('Confirming your email')} description={error ? t('The link could not establish a valid confirmation session.') : t('We are securely verifying your account before continuing.')}>
    {error ? <div className="auth-status-stack"><FormMessage>{error}</FormMessage><a className="ui-button ui-button--secondary auth-link-button" href="/signup">{t('Return to signup')}</a></div> : <AuthLoading label={t('Verifying your confirmation session')} />}
  </AuthLayout>
}
