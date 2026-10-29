import { useEffect, useRef } from 'react'

export function MockSalesSheet({ title, subtitle, onClose, children, footer, className = '' }) {
  const closeRef = useRef(null)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const escape = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape) }
  }, [onClose])

  return <div className="mock-pos-scrim" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className={`mock-pos-sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby="mock-sheet-title">
      <div className="mock-pos-sheet-grip" aria-hidden="true" />
      <header className="mock-pos-sheet-header">
        <div><h2 id="mock-sheet-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button ref={closeRef} type="button" className="mock-pos-icon-button" aria-label={`Close ${title}`} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="mock-pos-sheet-body">{children}</div>
      {footer && <footer className="mock-pos-sheet-footer">{footer}</footer>}
    </section>
  </div>
}
