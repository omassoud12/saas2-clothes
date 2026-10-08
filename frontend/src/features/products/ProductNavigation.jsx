import { useEffect, useRef } from 'react'

export function ProductNavigation({ role, section, onSelect }) {
  const tabs = useRef(null)
  const sections = [['overview', 'Overview'], ['stock', 'Stock'], ...(role === 'OWNER' ? [['restock', 'Restock']] : []), ['count', 'Count Check'], ['movements', 'Movements'], ['receipts', 'Receipts']]
  useEffect(() => { tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [section])
  function keyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...tabs.current.querySelectorAll('[role="tab"]')]
    const index = buttons.indexOf(event.target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
    buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return <nav className="product-section-nav" aria-label="Product management sections"><div ref={tabs} role="tablist" aria-label="Product sections" onKeyDown={keyboard}>
    {sections.map(([key, label]) => <button type="button" role="tab" key={key} id={`product-section-${key}`} aria-controls={`product-panel-${key}`} aria-selected={section === key} tabIndex={section === key ? 0 : -1} className={section === key ? 'is-current' : ''} onClick={() => onSelect(key)}>{label}</button>)}
  </div></nav>
}
