import { useEffect, useRef, useState } from 'react'
import {
  fetchCurrentApplicationUser,
  getApplicationDestination,
} from '../auth/owner-flow.js'
import { supabase } from '../lib/supabase.js'
import { useI18n } from '../i18n/I18nContext.js'

export function AuthenticatedStatusPage({ destination }) {
  const { t } = useI18n()
  const profilePromise = useRef(null)
  const [state, setState] = useState({ kind: 'loading' })

  useEffect(() => {
    if (!profilePromise.current) {
      profilePromise.current = fetchCurrentApplicationUser({ supabase })
    }

    let active = true
    void profilePromise.current.then((result) => {
      if (!active) return

      if (!result.ok) {
        if (result.code === 'APPLICATION_USER_NOT_FOUND') {
          window.location.replace('/owner/onboarding')
        } else if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
          window.location.replace('/login')
        } else {
          setState({ kind: 'error', message: result.message })
        }
        return
      }

      const route = getApplicationDestination(result.profile)
      if (!route.ok) {
        setState({ kind: 'error', message: route.message })
      } else if (route.redirectTo !== destination) {
        window.location.replace(route.redirectTo)
      } else {
        setState({ kind: 'ready', profile: result.profile })
      }
    })

    return () => {
      active = false
    }
  }, [destination])

  const isAdmin = destination === '/admin'

  return (
    <main>
      <section className="card auth-card" aria-live="polite">
        <span className="eyebrow">
          {isAdmin ? t('Platform administration') : t('Authenticated application')}
        </span>
        {state.kind === 'loading' && (
          <>
            <h1>{t('Checking access…')}</h1>
            <div className="spinner" aria-label={t('Loading')} />
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1>{t('Access unavailable')}</h1>
            <p className="error-message" role="alert">{t(state.message)}</p>
          </>
        )}
        {state.kind === 'ready' && (
          <>
            <h1>{isAdmin ? t('Admin access verified') : t('Account active')}</h1>
            <p>
              {t('Signed in as {firstName} {lastName}.', { firstName: state.profile.user.firstName, lastName: state.profile.user.lastName })}
            </p>
            <p>
              {isAdmin
                ? t('Account approval tools can be added here next.')
                : t('Your store is approved. The business dashboard can be connected here next.')}
            </p>
          </>
        )}
      </section>
    </main>
  )
}
