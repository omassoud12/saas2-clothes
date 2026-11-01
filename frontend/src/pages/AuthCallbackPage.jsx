import { useEffect, useRef, useState } from 'react'
import { completeAuthCallback } from '../auth/auth-flow.js'
import { friendlyAuthMessage } from '../auth/auth-messages.js'
import { AuthLinkButton, AuthNotice, AuthShell, AuthWaiting } from '../components/auth/AuthShell.jsx'
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
    void callbackPromise.current.then((result) => { if (active && !result.ok) setError(friendlyAuthMessage(result)) })
    return () => { active = false }
  }, [])
  return (
    <AuthShell
      title={error ? t('This link does not work') : t('Checking your link')}
      subtitle={error ? t('You cannot use this link to choose a password.') : t('One moment, then you can choose your password.')}
    >
      {error
        ? <div className="auth-stack"><AuthNotice>{error}</AuthNotice><AuthLinkButton href="/login">{t('Back to log in')}</AuthLinkButton></div>
        : <AuthWaiting label={t('Checking your link…')} />}
    </AuthShell>
  )
}
