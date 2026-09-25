import { useId, useState } from 'react'
import { Button, Card, Input, LoadingState } from '../ui/index.jsx'

export function AuthLayout({ children, description, eyebrow, title }) {
  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-context" aria-label="SaaS2 Clothes">
          <a className="auth-brand" href="/">SaaS2 Clothes</a>
          <div>
            <span className="eyebrow">Secure business workspace</span>
            <h2>Run store operations with a clear, controlled account.</h2>
            <p>Authentication, tenant access, and business permissions stay intentionally separate.</p>
          </div>
          <small>Protected access for owners and warehouse teams.</small>
        </section>
        <Card className="auth-panel" aria-live="polite">
          <header className="auth-header">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            {description && <p>{description}</p>}
          </header>
          {children}
        </Card>
      </div>
    </main>
  )
}

export function PasswordField({ error, hint, id: suppliedId, label, ...props }) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const [visible, setVisible] = useState(false)
  const descriptionId = error || hint ? `${id}-description` : undefined

  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
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
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          disabled={props.disabled}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {(error || hint) && (
        <small id={descriptionId} className={error ? 'ui-field-error' : undefined} role={error ? 'alert' : undefined}>
          {error || hint}
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
  return <LoadingState label={label} />
}

export function AuthAction({ children, ...props }) {
  return <Button className="auth-primary-action" {...props}>{children}</Button>
}

export { Input }
