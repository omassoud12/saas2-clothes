import { useEffect, useRef } from 'react'

// Native modal dialogs keep background controls inert and contain keyboard focus.
export function SaleDialog({ children, titleId, className = '', onClose, locked = false }) {
  const dialog = useRef(null)
  useEffect(() => {
    const node = dialog.current
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node.showModal()
    return () => {
      node.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  return <dialog ref={dialog} className={`sale-dialog ${className}`} aria-labelledby={titleId} aria-modal="true"
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
      if (!focusable.length) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus() }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus() }
    }}
    onCancel={(event) => { event.preventDefault(); if (!locked) onClose() }}>
    {children}
  </dialog>
}
