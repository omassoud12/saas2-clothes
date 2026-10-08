import { useEffect, useId, useRef, useState } from 'react'

export function ProductActionsMenu({ label, items, children, className = '' }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return undefined
    root.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()
    function outside(event) { if (!root.current?.contains(event.target)) setOpen(false) }
    function escape(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    root.current?.addEventListener('keydown', escape)
    const node = root.current
    return () => { document.removeEventListener('pointerdown', outside); node?.removeEventListener('keydown', escape) }
  }, [open])

  function menuKey(event) {
    if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); setOpen(false); trigger.current?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...root.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
  }

  return <div ref={root} className={`product-context-menu ${className}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={trigger} type="button" className="product-menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}><span aria-hidden="true">•••</span></button>
    {open && <div id={menuId} className="product-menu-panel" role="menu" aria-label={label} onKeyDown={menuKey}>
      {items.map(item => <button key={item.label} role="menuitem" tabIndex={-1} type="button" disabled={item.disabled} className={item.danger ? 'product-danger-button' : ''} onClick={() => { setOpen(false); trigger.current?.focus(); item.action() }}>{item.label}</button>)}
      {children && <div className="product-menu-context" role="none">{children}</div>}
    </div>}
  </div>
}
