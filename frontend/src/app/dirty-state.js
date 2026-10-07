import { useEffect, useRef } from 'react'
const drafts = new Set()
let approvedUntil = 0
export function clearDiscardedChanges() {
  for (const draft of drafts) draft.current = false
}
export function confirmDiscardChanges() {
  if (Date.now() < approvedUntil || ![...drafts].some(draft => draft.current)) return true
  if (!window.confirm('Discard unsaved changes?')) return false
  approvedUntil = Date.now() + 100
  return true
}
export function useDirtyState(dirty) {
  const state = useRef(dirty)
  useEffect(() => { state.current = dirty }, [dirty])
  useEffect(() => {
    drafts.add(state)
    const mountedUrl = window.location.href
    function back(event) {
      if (!confirmDiscardChanges()) { window.history.pushState(null, '', mountedUrl); event.stopImmediatePropagation() }
    }
    function unload(event) { if (state.current) { event.preventDefault(); event.returnValue = 'Unsaved changes' } }
    function followLink(event) {
      const link = event.target.closest?.('a[href]')
      if (link && !link.getAttribute('href').startsWith('#') && !confirmDiscardChanges()) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('popstate', back, true)
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', followLink, true)
    return () => { drafts.delete(state); window.removeEventListener('popstate', back, true); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', followLink, true) }
  }, [])
  return () => { state.current = false }
}
