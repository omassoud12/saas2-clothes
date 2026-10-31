import { useEffect, useRef, useState } from 'react'
import { completeAuthCallback } from '../auth/auth-flow.js'
import { AuthLayout, AuthLoading, FormMessage } from '../components/auth/AuthLayout.jsx'
import { authCallbackContext, exchangeAuthCallbackCode, supabase } from '../lib/supabase.js'
import { useI18n } from '../i18n/I18nContext.js'

export function AuthCallbackPage() {
  const { t } = useI18n()
  const callbackPromise = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!callbackPromise.current) callbackPromise.current = completeAuthCallback({
      supabase,
      callback: authCallbackContext,
      exchangeCode: exchangeAuthCallbackCode,
      storage: window.sessionStorage,
      clearUrl: () => window.history.replaceState(null, '', '/auth/callback'),
      navigate: (path) => window.location.replace(path),
    })
    let active = true
    void callbackPromise.current.then((result) => { if (active && !result.ok) setError(result.message) })
    return () => { active = false }
  }, [])
  return <AuthLayout eyebrow={t('Secure invitation')} title={error ? t('Invitation unavailable') : t('Checking your invitation')} description={error ? t('This link cannot be used to continue password setup.') : t('We are securely verifying your invitation before continuing.')}>
    {error ? <div className="auth-status-stack"><FormMessage>{error}</FormMessage><a className="ui-button ui-button--secondary auth-link-button" href="/login">{t('Return to sign in')}</a></div> : <AuthLoading label={t('Verifying your invitation session')} />}
  </AuthLayout>
}
