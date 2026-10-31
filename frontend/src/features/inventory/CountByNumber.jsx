import { useRef, useState } from 'react'
import { ColorSwatch } from '../products/ColorSwatch.jsx'
import { groupVariantsByColor } from '../products/product-options.js'
import { buildCountReview, formatDifference, submitCount } from './count-check-flow.js'

// Enter the real number for each size, review "system -> counted" and confirm once.
export function CountByNumber({ product, supabase, onDone }) {
  const [entries, setEntries] = useState({})
  const [step, setStep] = useState('enter')
  const [results, setResults] = useState({})
  const [message, setMessage] = useState('')
  const keys = useRef(new Map())
  const active = product.variants.filter((variant) => variant.isActive && product.isActive)
  const review = buildCountReview(active, entries)

  function operationFor(line) {
    const id = `${line.variantId}:${line.current}:${line.counted}`
    if (!keys.current.has(id)) keys.current.set(id, globalThis.crypto.randomUUID())
    return keys.current.get(id)
  }

  async function confirm() {
    setStep('saving'); setMessage('')
    const next = { ...results }
    for (const line of review.lines) {
      if (next[line.variantId]?.ok) continue
      const result = await submitCount({ supabase, variantId: line.variantId, operationId: operationFor(line), countedQuantity: line.counted, expectedStock: line.current })
      if (result.requiresLogin) { window.location.replace('/login'); return }
      next[line.variantId] = result
    }
    setResults(next)
    const failed = review.lines.filter((line) => !next[line.variantId]?.ok)
    if (failed.length === 0) {
      setStep('done'); setEntries({}); setResults({}); keys.current = new Map()
      onDone()
      return
    }
    setStep('review')
    setMessage(failed.some((line) => next[line.variantId]?.retryable)
      ? 'Some counts could not be confirmed. Press Try again: counts already saved will not be repeated.'
      : 'Some counts were not saved. See the lines marked below.')
    if (review.lines.some((line) => next[line.variantId]?.ok)) onDone()
  }

  if (!active.length) return null
  return <section className="product-panel count-by-number">
    <div className="product-section-intro"><h2>Count by number</h2><p>Type what you actually have on the shelf. Leave a size empty if you did not count it.</p></div>
    {step === 'done' && <p className="product-feedback" role="status">Count saved. Stock now matches what you counted.</p>}
    {(step === 'enter' || step === 'done') && <>
      {groupVariantsByColor(active).map(([color, variants]) => <section className="count-check-group" key={variants[0].id}>
        <h3><ColorSwatch name={color} />{color}</h3>
        {variants.map((variant) => <div className="count-by-number-row" key={variant.id}>
          <label htmlFor={`count-${variant.id}`}><strong>{variant.size || 'No size'}</strong><small>System: {variant.currentStock}</small></label>
          <input id={`count-${variant.id}`} inputMode="numeric" autoComplete="off" placeholder="Counted" value={entries[variant.id] ?? ''}
            aria-invalid={review.errors.has(variant.id)} onChange={(event) => { setStep('enter'); setEntries({ ...entries, [variant.id]: event.target.value }) }} />
          {review.errors.has(variant.id) && <p className="error-message" role="alert">{review.errors.get(variant.id)}</p>}
        </div>)}
      </section>)}
      <div className="product-actions"><button type="button" disabled={!review.ready} onClick={() => setStep('review')}>Review count</button></div>
    </>}
    {(step === 'review' || step === 'saving') && <div className="count-review" role="group" aria-label="Review count">
      <h3>Review before saving</h3>
      <ul className="count-review-list">{review.lines.map((line) => {
        const result = results[line.variantId]
        return <li key={line.variantId}>
          <span>{line.color} · {line.size}</span>
          <strong>{line.current} → {line.counted} <small className={line.difference > 0 ? 'is-more' : 'is-less'}>({formatDifference(line.difference)})</small></strong>
          {result?.ok && <small className="count-review-state">Saved</small>}
          {result && !result.ok && <small className="error-message" role="alert">{result.message}</small>}
        </li>
      })}</ul>
      {message && <p className="error-message" role="alert">{message}</p>}
      <div className="product-actions">
        <button type="button" disabled={step === 'saving'} aria-busy={step === 'saving'} onClick={confirm}>
          {step === 'saving' ? 'Saving…' : Object.keys(results).length ? 'Try again' : 'Confirm count'}</button>
        <button type="button" className="secondary-action" disabled={step === 'saving'} onClick={() => { setStep('enter'); setMessage('') }}>Back</button>
      </div>
    </div>}
  </section>
}
