import { useState } from 'react'
import { useDirtyState } from '../../app/dirty-state.js'
import { setOpeningCost } from './product-flow.js'
import { supabase } from '../../lib/supabase.js'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

export function OpeningCostForm({ product, variant, currency, onSaved }) {
  const [open, setOpen] = useState(false)
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clearDirty = useDirtyState(open && (cost !== '' || busy))
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(cost) || !/[1-9]/.test(cost)) { setError('Enter a positive purchase cost with up to four decimal places.'); return }
    setBusy(true); setError('')
    try {
      const result = await setOpeningCost({ supabase, productId: product.id, variantId: variant.id, unitCost: cost })
      if (redirectIfNeeded(result)) return
      if (result.ok) { clearDirty(); setOpen(false); setCost(''); onSaved() }
      else setError(result.message)
    } finally { setBusy(false) }
  }
  return <div>{!open ? <button type="button" className="secondary-action" onClick={() => setOpen(true)}>Set cost</button> : <form onSubmit={submit}>
    <label htmlFor={`opening-cost-${variant.id}`}>Purchase cost per piece{currency ? ` (${currency})` : ''}</label>
    <input id={`opening-cost-${variant.id}`} autoFocus required inputMode="decimal" maxLength={19} value={cost} disabled={busy} onChange={(event) => setCost(event.target.value)} />
    <small>Sets current purchase cost. Quantity and historical sale costs stay unchanged.</small>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="product-actions"><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save cost'}</button><button disabled={busy} type="button" className="secondary-action" onClick={() => { if (cost && !window.confirm('Discard this unsaved purchase cost?')) return; clearDirty(); setOpen(false); setCost(''); setError('') }}>Cancel</button></div>
  </form>}</div>
}

