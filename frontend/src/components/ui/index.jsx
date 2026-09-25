import { forwardRef, useEffect, useId, useRef } from 'react'

function classes(...values) {
  return values.filter(Boolean).join(' ')
}

export const Button = forwardRef(function Button(
  { className, tone = 'primary', type = 'button', ...props },
  ref,
) {
  return (
    <button
      className={classes('ui-button', `ui-button--${tone}`, className)}
      ref={ref}
      type={type}
      {...props}
    />
  )
})

function Field({ children, descriptionId, error, hint, id, label }) {
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <small id={descriptionId}>{hint}</small>}
      {error && <small id={descriptionId} className="ui-field-error" role="alert">{error}</small>}
    </div>
  )
}

export function Input({ error, hint, id: suppliedId, label, ...props }) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const descriptionId = error || hint ? `${id}-description` : undefined
  return (
    <Field descriptionId={descriptionId} error={error} hint={hint} id={id} label={label}>
      <input id={id} aria-describedby={descriptionId} aria-invalid={Boolean(error)} {...props} />
    </Field>
  )
}

export function Select({ children, error, hint, id: suppliedId, label, ...props }) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const descriptionId = error || hint ? `${id}-description` : undefined
  return (
    <Field descriptionId={descriptionId} error={error} hint={hint} id={id} label={label}>
      <select id={id} aria-describedby={descriptionId} aria-invalid={Boolean(error)} {...props}>{children}</select>
    </Field>
  )
}

export function Card({ as: Element = 'section', className, ...props }) {
  return <Element className={classes('ui-card', className)} {...props} />
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}

export function PageHeader({ actions, description, eyebrow, title }) {
  return (
    <header className="business-page-heading ui-page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}

export function EmptyState({ action, description, icon = '+', title }) {
  return (
    <div className="ui-state ui-empty-state">
      <span className="ui-state-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="ui-state-action">{action}</div>}
    </div>
  )
}

export function LoadingSpinner({ label = 'Loading' }) {
  return <span className="ui-spinner" role="status" aria-label={label} />
}

export function LoadingState({ label = 'Loading workspace' }) {
  return (
    <div className="ui-state" aria-live="polite">
      <LoadingSpinner label={label} />
      <p>{label}</p>
    </div>
  )
}

export function Skeleton({ className }) {
  return <span className={classes('ui-skeleton', className)} aria-hidden="true" />
}

export function ErrorState({ action, description, title = 'Something went wrong' }) {
  return (
    <div className="ui-state ui-error-state" role="alert">
      <span className="ui-state-icon" aria-hidden="true">!</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="ui-state-action">{action}</div>}
    </div>
  )
}

export function TableContainer({ children, label = 'Data table' }) {
  return (
    <div className="ui-table-container" role="region" aria-label={label} tabIndex="0">
      {children}
    </div>
  )
}

export function Modal({ children, description, onClose, open, title }) {
  const titleId = useId()
  const descriptionId = useId()
  const closeButton = useRef(null)
  const dialog = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement
    closeButton.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return

      const focusable = dialog.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose, open])

  if (!open) return null
  return (
    <div className="ui-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="ui-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <Button ref={closeButton} tone="ghost" aria-label="Close dialog" onClick={onClose}>
            &times;
          </Button>
        </header>
        {children}
      </section>
    </div>
  )
}
