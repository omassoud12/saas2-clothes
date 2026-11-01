import { useEffect, useState } from 'react'
import { useLogout } from '../../app/useLogout.js'
import { HeroSilk } from '../../site/components/HeroSilk.jsx'
import { CheckIcon } from '../../site/components/Icons.jsx'
import { loadSiteFonts } from '../../site/site-router.js'
import { useSeo } from '../../site/useSeo.js'

// The frame of every sign-in screen, from design-reference/saas2-site (AuthLayout): a silk panel
// (top band on phones, left half on wide screens) and a stitched card holding the form.
// It sits in the public site's .site scope so its styles never reach the app.
export function AuthShell({ title, subtitle, children, footer, seoTitle, seoDescription }) {
  useSeo(seoTitle ?? `${title} · SaaS2`, seoDescription ?? subtitle ?? title)
  useEffect(() => { loadSiteFonts() }, [])

  return (
    <div className="site" dir="ltr" lang="en">
      <div className="auth">
        <aside className="auth__aside">
          <HeroSilk fill />
          <div className="auth__aside-inner">
            <a href="/" className="auth__brand" aria-label="SaaS2 home">
              <span className="brand__mark">S2</span>
              <span className="brand__name">SaaS2</span>
            </a>
            <p className="auth__quote">Your shop, ready when you are.</p>
            <div className="glass auth__glass" aria-hidden="true">
              <span className="glass__label">Sales today</span>
              <span className="glass__value">$184 · 9 receipts</span>
            </div>
          </div>
        </aside>

        <main className="auth__main" id="content">
          <div className="auth-card">
            <h1 className="auth-card__title">{title}</h1>
            {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
            {children}
            {footer && <p className="auth-card__footer">{footer}</p>}
          </div>
        </main>
      </div>
    </div>
  )
}

const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined

export function AuthTextField({ id, label, error, hint, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type="text"
        {...props}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(error && `${id}-error`, hint && !error && `${id}-hint`)}
      />
      {hint && !error && <p className="field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field__error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

export function AuthPasswordField({ id, label, error, hint, extra, disabled, ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="field">
      <div className="field__top">
        <label htmlFor={id}>{label}</label>
        {extra}
      </div>
      <div className="field__wrap">
        <input
          id={id}
          name={id}
          {...props}
          type={visible ? 'text' : 'password'}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(error && `${id}-error`, hint && !error && `${id}-hint`)}
        />
        <button
          type="button"
          className="field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-controls={id}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          disabled={disabled}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && !error && <p className="field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field__error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

export function AuthSelectField({ id, label, error, hint, children, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={id}
        {...props}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(error && `${id}-error`, hint && !error && `${id}-hint`)}
      >
        {children}
      </select>
      {hint && !error && <p className="field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field__error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

// Log out from a sign-in screen; the same logout as the app's LogoutAction.
export function AuthLogout({ disabled = false }) {
  const { loggingOut, logoutError, logout } = useLogout()
  return (
    <div className="auth-logout">
      <AuthSubmit type="button" className="btn btn--outline btn--block" busy={loggingOut} busyLabel="Logging out…" disabled={disabled} onClick={logout}>Log out</AuthSubmit>
      <AuthNotice>{logoutError ? 'We could not log you out. Try again.' : ''}</AuthNotice>
    </div>
  )
}

// The main button: a spinner and the busy label while the form is being sent.
export function AuthSubmit({ busy, busyLabel, children, disabled, type = 'submit', className = 'btn btn--primary btn--block', ...props }) {
  return (
    <button type={type} className={className} disabled={busy || disabled} aria-busy={busy} {...props}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {busy ? busyLabel : children}
    </button>
  )
}

// A message for the whole form (wrong password, no connection, email sent...).
export function AuthNotice({ kind = 'error', children }) {
  if (!children) return null
  return <p className={`auth-notice auth-notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>
}

// A finished step (email sent, password saved): a green check, the message, then any actions.
export function AuthDone({ message, children }) {
  return (
    <div className="success auth-done">
      <span className="success__icon"><CheckIcon /></span>
      <AuthNotice kind="success">{message}</AuthNotice>
      {children}
    </div>
  )
}

// A full-width secondary action that leaves the page (Back to log in...).
export function AuthLinkButton({ href, children }) {
  return <a className="btn btn--outline btn--block" href={href}>{children}</a>
}

export function AuthWaiting({ label }) {
  return (
    <p className="auth-waiting" role="status">
      <span className="spinner spinner--dark" aria-hidden="true" />
      {label}
    </p>
  )
}
