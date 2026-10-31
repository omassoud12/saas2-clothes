import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMoney } from '../../lib/money.js'
import { requestTextMatch } from '../voice-sales/text-matching-flow.js'
import { createVoiceRecordingController } from '../voice-sales/voice-recording-flow.js'
import { SaleDialog } from './SaleDialog.jsx'
import {
  createVoiceCartAddGuard, createVoiceReviewItems, revalidateVoiceReview, selectFreshVoiceTranscript,
} from './voice-sale-pos-flow.js'
import { useI18n } from '../../i18n/I18nContext.js'

const statusLabels = {
  MATCHED: 'Matched', AMBIGUOUS: 'Choose a variant', INCOMPLETE: 'Needs more information',
  NOT_FOUND: 'Not found', INSUFFICIENT_STOCK: 'Insufficient stock', INVALID_INPUT: 'Invalid input',
}

function initialDecisions(items) {
  return Object.fromEntries(items.map(item => [item.index, {
    variantId: item.defaultVariantId, confirmed: false, excluded: false,
  }]))
}

function attribute(item, name) {
  const value = item.parser?.attributes?.[name]?.value
  if ((value === null || value === undefined) && name === 'productType') {
    const sourceValue = item.parser?.sourceProductType?.value
    if (sourceValue !== null && sourceValue !== undefined) return String(sourceValue)
  }
  return value === null || value === undefined ? 'Missing' : String(value)
}

function evidence(item) {
  const residual = Array.isArray(item.parser?.productNameResidualTokens)
    ? item.parser.productNameResidualTokens.map(row => ({ token: row.token, index: row.index })) : []
  // Material descriptors commonly form part of a merchant's catalog name
  // (for example "بنطلون كتان"). Keep the typed material attribute while also
  // showing the employee the exact spoken catalog-name evidence.
  const materials = Array.isArray(item.parser?.attributes?.material?.evidence)
    ? item.parser.attributes.material.evidence.map(row => ({ token: row.span.text, index: row.span.startToken })) : []
  const tokens = [...residual, ...materials].sort((left, right) => left.index - right.index)
    .filter((row, index, all) => all.findIndex(candidate => candidate.index === row.index && candidate.token === row.token) === index)
  return tokens.length ? tokens.map(row => row.token).join(' ') : 'None'
}

const fieldLabel = field => ({ productType: 'product type', product_name: 'product name', category: 'category', color: 'color', size: 'size',
  quantity: 'quantity', material: 'material', neckline: 'neckline', fit: 'fit', pattern: 'pattern' })[field] || field

function DiscoveryGroups({ item, decision, onDecision }) {
  const { t } = useI18n()
  if (!item.discovery) return null
  const groups = [['exactVerified', 'Exact verified matches'], ['strongCandidates', 'Strong candidates — details required'],
    ['alternatives', 'Alternatives — requested details differ']]
  return <div className="voice-pos-discovery">{groups.map(([key, label]) => item.discovery[key].length > 0
    && <fieldset key={key} className={`voice-pos-candidates is-${key}`}><legend>{t(label)}</legend>
      {item.discovery[key].map(candidate => <label key={candidate.variantId} className="voice-pos-candidate is-discovery">
        <input type="radio" name={`voice-item-${item.index}`} value={candidate.variantId}
          checked={decision?.variantId === candidate.variantId} disabled={decision?.excluded}
          onChange={() => onDecision({ variantId: candidate.variantId, confirmed: false, excluded: false })} />
        {candidate.imageUrl && <img className="voice-pos-candidate-image" src={candidate.imageUrl} alt="" />}
        <span><strong>{candidate.productName}</strong><small>{candidate.categoryName} · {candidate.sku}{candidate.barcode ? ` · ${candidate.barcode}` : ''} · {[candidate.color, candidate.size].filter(Boolean).join(' / ') || t('Standard')}</small>
          {candidate.matchedAttributes.length > 0 && <small className="is-match">{t('Matches: {join}', { join: candidate.matchedAttributes.map(fieldLabel).join(', ') })}</small>}
          {candidate.unverifiedAttributes.length > 0 && <small>{t('Needs details: {join}', { join: candidate.unverifiedAttributes.map(fieldLabel).join(', ') })}</small>}
          {candidate.differences.length > 0 && <small className="is-difference">{t('Differs:')} {candidate.differences.map(row => `${fieldLabel(row.field)} (${row.actual || 'not verified'})`).join(', ')}</small>}
        </span>
        <span><strong>{candidate.sellingPrice ? formatMoney(candidate.sellingPrice, candidate.currency) : t('Price unavailable')}</strong>
          <small>{t('{availableStock} in stock', { availableStock: candidate.availableStock })}{candidate.quantity ? t(' · Qty {quantity}', { quantity: candidate.quantity }) : ''}</small></span>
      </label>)}
    </fieldset>)}</div>
}

export function VoiceControls({ controller, voice }) {
  const { t } = useI18n()
  const seconds = Math.ceil((voice.elapsedMs || 0) / 1000)
  if (!voice.supported) return <p className="voice-pos-note">{t('Microphone recording is unavailable in this browser. Typed matching is ready.')}</p>
  return <div className="voice-pos-recorder" aria-label={t('Voice recording controls')} aria-busy={['requesting', 'transcribing'].includes(voice.phase)}>
    {voice.phase === 'recording' ? <>
      <button type="button" onClick={() => controller.stop()}>{t('Stop recording')}</button>
      <button type="button" className="secondary-action" onClick={() => controller.cancel()}>{t('Cancel')}</button>
      <span role="status">{t('Recording… {seconds}s / 30s', { seconds })}</span>
    </> : <button type="button" className="secondary-action" disabled={['requesting', 'transcribing'].includes(voice.phase)} onClick={() => controller.start()}>
      {voice.phase === 'requesting' ? t('Requesting microphone…') : voice.phase === 'transcribing' ? t('Transcribing…') : t('Start recording')}
    </button>}
    {voice.phase === 'requesting' && <span role="status">{t('Preparing the microphone...')}</span>}
    {voice.phase === 'transcribing' && <span role="status">{t('Uploading audio securely. Transcribing...')}</span>}
    {voice.canRetry && <button type="button" className="secondary-action" onClick={() => controller.retry()}>{t('Retry transcription')}</button>}
    {voice.error && <p className="error-message" role="alert">{t(voice.error.message)}</p>}
    {voice.phase === 'review' && <span role="status">{t('Transcript ready. Review and edit the request text below.')}</span>}
  </div>
}

export function ReviewCard({ item, decision, onDecision }) {
  const { t } = useI18n()
  const canConfirm = Boolean(decision?.variantId) && item.candidates.some(row => row.variantId === decision.variantId)
  const category = item.discovery?.categoryResolution
  const categoryText = category?.status === 'RESOLVED' && category.candidates.length === 1
    ? category.candidates[0].categoryName
    : category?.status === 'AMBIGUOUS' ? category.candidates.map(row => row.categoryName).join(', ')
      : category?.status === 'PARTIAL' && category.candidates.length ? `${category.candidates.map(row => row.categoryName).join(', ')} (partial catalog)`
        : 'Unresolved'
  return <article className={`voice-pos-item is-${item.status.toLowerCase()}`}>
    <div className="voice-pos-item-heading">
      <div><span className="eyebrow">{t('Item {value}', { value: item.index + 1 })}</span><h3>{item.text || t('Requested item')}</h3></div>
      <span className="voice-pos-status">{statusLabels[item.status] || item.status}</span>
    </div>
    <dl className="voice-pos-attributes">
      <div><dt>{t('Product type')}</dt><dd>{attribute(item, 'productType')}</dd></div>
      <div><dt>{t('Catalog category')}</dt><dd>{categoryText}</dd></div>
      <div><dt>{t('Brand / model evidence')}</dt><dd>{evidence(item)}</dd></div>
      <div><dt>{t('Color')}</dt><dd>{attribute(item, 'color')}</dd></div>
      <div><dt>{t('Size')}</dt><dd>{attribute(item, 'size')}</dd></div>
      <div><dt>{t('Quantity')}</dt><dd>{attribute(item, 'quantity')}</dd></div>
    </dl>
    {(item.missingFields.length > 0 || item.ambiguities.length > 0) && <div className="voice-pos-issues">
      {item.missingFields.length > 0 && <p><strong>{t('Missing information:')}</strong> {item.missingFields.join(', ')}</p>}
      {item.ambiguities.length > 0 && <p><strong>{t('Ambiguities:')}</strong> {item.ambiguities.map(row => row.message || row.kind).join(', ')}</p>}
    </div>}
    {!item.discovery && (item.candidates.length > 0 ? <fieldset className="voice-pos-candidates">
      <legend>{item.status === 'AMBIGUOUS' ? t('Choose the correct catalog variant') : t('Catalog match')}</legend>
      {item.candidates.map(candidate => <label key={candidate.variantId} className="voice-pos-candidate">
        <input type="radio" name={`voice-item-${item.index}`} value={candidate.variantId}
          checked={decision?.variantId === candidate.variantId} disabled={decision?.excluded}
          onChange={() => onDecision({ variantId: candidate.variantId, confirmed: false, excluded: false })} />
        <span><strong>{candidate.productName}</strong><small>{candidate.sku} · {[candidate.color, candidate.size].filter(Boolean).join(' / ') || t('Standard')}</small></span>
        <span><strong>{formatMoney(candidate.sellingPrice, candidate.currency)}</strong><small>{t('{availableStock} in stock · Qty {quantity}', { availableStock: candidate.availableStock, quantity: candidate.quantity })}</small></span>
      </label>)}
    </fieldset> : <p className="voice-pos-warning">{t('This item cannot be added. Edit the request and match again, or exclude it.')}</p>)}
    <DiscoveryGroups item={item} decision={decision} onDecision={onDecision} />
    {!item.canSelect && item.discovery && <p className="voice-pos-warning">{t('Choose a candidate for review, then add the missing details to the request and match again before confirming it.')}</p>}
    <div className="voice-pos-item-actions">
      <label><input type="checkbox" checked={decision?.excluded === true}
        onChange={event => onDecision({ variantId: decision?.variantId || item.defaultVariantId, confirmed: false, excluded: event.target.checked })} /> {t('Exclude this item')}</label>
      <label><input type="checkbox" checked={decision?.confirmed === true} disabled={decision?.excluded || !canConfirm}
        onChange={event => onDecision({ ...decision, confirmed: event.target.checked })} /> {t('Confirm this item')}</label>
    </div>
  </article>
}

export function VoiceSaleDialog({ supabase, onClose, onAdd }) {
  const { t } = useI18n()
  const [recorder] = useState(() => createVoiceRecordingController({ supabase }))
  const [voice, setVoice] = useState(recorder.getSnapshot())
  const [text, setText] = useState('')
  const [originalTranscript, setOriginalTranscript] = useState('')
  const [confirmedText, setConfirmedText] = useState('')
  const [result, setResult] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [pending, setPending] = useState(false)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [addGuard] = useState(createVoiceCartAddGuard)
  const appliedTranscriptRevision = useRef(0)
  const items = useMemo(() => createVoiceReviewItems(result), [result])

  useEffect(() => recorder.subscribe(() => setVoice(recorder.getSnapshot())), [recorder])
  useEffect(() => () => recorder.invalidate(), [recorder])
  useEffect(() => {
    const transcript = selectFreshVoiceTranscript(voice, appliedTranscriptRevision.current)
    if (!transcript) return
    appliedTranscriptRevision.current = transcript.revision
    setText(transcript.text)
    setOriginalTranscript(transcript.originalText)
    setConfirmedText('')
    setResult(null)
    setDecisions({})
    setMessage({ kind: 'info', text: t('Transcript ready. Review or edit it, then confirm the text.') })
  }, [voice, t])

  function edit(next) {
    setText(next.slice(0, 4096)); setConfirmedText(''); setResult(null); setDecisions({}); setMessage(null)
    if (voice.phase === 'review') recorder.editTranscript(next)
  }

  function confirm() {
    const clean = text.trim()
    if (!clean) { setMessage({ kind: 'error', text: t('Enter or record a request first.') }); return }
    setText(clean); setConfirmedText(clean); setResult(null); setDecisions({}); setMessage({ kind: 'success', text: t('Text confirmed. Run catalog match.') })
  }

  async function match() {
    if (!confirmedText || pending) return
    setPending(true); setMessage(null)
    const response = await requestTextMatch({ supabase, text: confirmedText })
    setPending(false)
    if (!response.ok) { setMessage({ kind: 'error', text: response.message }); return }
    const nextItems = createVoiceReviewItems(response.result)
    setResult(response.result); setDecisions(initialDecisions(nextItems))
    setMessage({ kind: 'info', text: `Review ${nextItems.length} item${nextItems.length === 1 ? '' : 's'} independently.` })
  }

  async function addToCart() {
    const guarded = await addGuard.run(async () => {
      setAdding(true); setMessage(null)
      const checked = await revalidateVoiceReview({ supabase, text: confirmedText, items, decisions })
      if (!checked.ok) {
        if (checked.stale) {
          setResult(checked.result); setDecisions(initialDecisions(checked.items))
        }
        setMessage({ kind: 'error', text: checked.message }); return checked
      }
      const added = onAdd(checked.selected)
      if (!added.ok) { setMessage({ kind: 'error', text: added.message }); return added }
      onClose()
      return added
    })
    if (!guarded.skipped) setAdding(false)
  }

  const locked = pending || adding || ['requesting', 'recording', 'transcribing'].includes(voice.phase)
  return <SaleDialog titleId="voice-sale-title" className="voice-sale-dialog" locked={locked} onClose={onClose}>
    <header className="sale-dialog-header"><div className="sale-dialog-copy"><span className="eyebrow">{t('Assisted sale')}</span><h2 id="voice-sale-title">{t('Voice sale')}</h2><p>{t('Review every item before adding it to the current cart.')}</p></div><button type="button" className="secondary-action sale-close" disabled={locked} aria-label={t('Close voice sale')} onClick={onClose}>×</button></header>
    <div className="voice-pos-body">
      <VoiceControls controller={recorder} voice={voice} />
      <label className="voice-pos-transcript" htmlFor="voice-sale-text"><span>{t('Request text')}</span>
        <textarea id="voice-sale-text" dir="auto" maxLength="4096" rows="3" value={text} disabled={locked} placeholder={t('Type or record the customer request…')} onChange={event => edit(event.target.value)} />
      </label>
      {originalTranscript && <details className="voice-pos-original-transcript">
        <summary>{t('Original transcript')}</summary><p dir="auto">{originalTranscript}</p>
      </details>}
      <div className="voice-pos-primary-actions">
        <button type="button" className="secondary-action" disabled={locked || !text.trim()} onClick={confirm}>{confirmedText === text.trim() && confirmedText ? t('Text confirmed') : t('Confirm text')}</button>
        <button type="button" disabled={locked || !confirmedText || confirmedText !== text.trim()} onClick={match}>{pending ? t('Matching…') : t('Match catalog')}</button>
      </div>
      {message && <p className={message.kind === 'error' ? 'error-message' : `${message.kind}-message`} role={message.kind === 'error' ? 'alert' : 'status'}>{t(message.text)}</p>}
      {items.length > 0 && <section className="voice-pos-review" aria-label={t('Voice sale item review')}>
        {items.map(item => <ReviewCard key={item.index} item={item} decision={decisions[item.index] || {}}
          onDecision={next => setDecisions(current => ({ ...current, [item.index]: next }))} />)}
      </section>}
    </div>
    {items.length > 0 && <footer className="voice-pos-footer"><p>{t('Price and stock are checked again before the cart changes.')}</p><button type="button" disabled={locked} onClick={addToCart}>{adding ? t('Rechecking catalog…') : t('Add confirmed items to cart')}</button></footer>}
  </SaleDialog>
}
