import { useId, useState } from 'react'
import { Button, Card, Input, LoadingState } from '../ui/index.jsx'
import { useI18n } from '../../i18n/I18nContext.js'
import { LanguageSwitch } from '../../i18n/LanguageSwitch.jsx'

export function AuthLayout({ children, description, eyebrow, title }) {
  const { t } = useI18n()
  return (
    <main className="auth-page">
      <div className="auth-layout">
        <LanguageSwitch className="auth-language" />
        <section className="auth-context" aria-label={t('SaaS2 Clothes')}>
          <a className="auth-brand" href="/">{t('SaaS2 Clothes')}</a>
          <div>
            <span className="eyebrow">{t('Secure business workspace')}</span>
            <h2>{t('Run store operations with a clear, controlled account.')}</h2>
            <p>{t('Authentication, tenant access, and business permissions stay intentionally separate.')}</p>
          </div>
          <small>{t('Protected access for owners and warehouse teams.')}</small>
        </section>
        <Card className="auth-panel" aria-live="polite">
          <header className="auth-header">
            <span className="eyebrow">{t(eyebrow)}</span>
            <h1>{t(title)}</h1>
            {description && <p>{t(description)}</p>}
          </header>
          {children}
        </Card>
      </div>
    </main>
  )
}

export function PasswordField({ error, hint, id: suppliedId, label, ...props }) {
  const { t } = useI18n()
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const [visible, setVisible] = useState(false)
  const descriptionId = error || hint ? `${id}-description` : undefined

  return (
    <div className="ui-field">
      <label htmlFor={id}>{t(label)}</label>
      <div className="auth-password-field">
        <input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={descriptionId}
          aria-invalid={Boolean(error)}
        />
        <button
          className="auth-password-toggle"
          type="button"
          aria-controls={id}
          aria-label={visible ? t('Hide {toLowerCase}', { toLowerCase: label.toLowerCase() }) : t('Show {toLowerCase}', { toLowerCase: label.toLowerCase() })}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          disabled={props.disabled}
        >
          {visible ? t('Hide') : t('Show')}
        </button>
      </div>
      {(error || hint) && (
        <small id={descriptionId} className={error ? 'ui-field-error' : undefined} role={error ? 'alert' : undefined}>
          {error || t(hint)}
        </small>
      )}
    </div>
  )
}

export function FormMessage({ children, kind = 'error' }) {
  if (!children) return null
  return (
    <p className={`auth-message auth-message--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}

export function AuthLoading({ label }) {
  const { t } = useI18n()
  return <LoadingState label={t(label)} />
}

export function AuthAction({ children, ...props }) {
  return <Button className="auth-primary-action" {...props}>{children}</Button>
}

export { Input }
