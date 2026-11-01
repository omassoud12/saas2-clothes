import { useEffect, useRef, useState } from 'react'
import { friendlyAuthMessage } from '../auth/auth-messages.js'
import { completeSignupCallback } from '../auth/owner-flow.js'
import { AuthLinkButton, AuthNotice, AuthShell, AuthWaiting } from '../components/auth/AuthShell.jsx'
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
    void callbackPromise.current.then((result) => { if (active && !result.ok) setError(friendlyAuthMessage(result)) })
    return () => { active = false }
  }, [])
  return (
    <AuthShell
      title={error ? t('This link does not work') : t('Confirming your email')}
      subtitle={error ? t('We could not confirm your email with this link.') : t('One moment, then you can set up your shop.')}
    >
      {error
        ? <div className="auth-stack"><AuthNotice>{error}</AuthNotice><AuthLinkButton href="/signup">{t('Sign up again')}</AuthLinkButton></div>
        : <AuthWaiting label={t('Confirming your email…')} />}
    </AuthShell>
  )
}
