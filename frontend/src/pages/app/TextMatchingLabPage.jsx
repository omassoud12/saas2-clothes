import { useEffect, useState, useSyncExternalStore } from 'react'
import { Badge, Button, Card, LoadingSpinner, PageHeader } from '../../components/ui/index.jsx'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'
import { ROUTES } from '../../app/routes.js'
import { NotFoundPage } from '../NotFoundPage.jsx'
import {
  canUseMatchingLab, createTextMatchingController, MATCH_EXAMPLE, MATCH_FIELD_LABELS,
  MATCH_STATUS_LABELS, MATCH_TEXT_MAX_LENGTH,
} from '../../features/voice-sales/text-matching-flow.js'
import { createVoiceRecordingController } from '../../features/voice-sales/voice-recording-flow.js'
import '../../features/voice-sales/text-matching-lab.css'

const attributeFields = ['productType', 'color', 'size', 'quantity', 'material', 'neckline', 'fit', 'pattern']
const fieldLabel = field => MATCH_FIELD_LABELS[field] || field
const toneForStatus = status => status === 'MATCHED' ? 'success' : status === 'INVALID_INPUT' || status === 'INSUFFICIENT_STOCK' ? 'danger' : 'neutral'

function FieldList({ fields, empty = 'None' }) {
  return fields.length ? <ul className="matching-lab-tags">{fields.map(field => <li key={field}>{fieldLabel(field)}</li>)}</ul> : <p className="matching-lab-muted">{empty}</p>
}

function TokenList({ tokens, empty }) {
  return tokens.length ? <ul className="matching-lab-tags">{tokens.map((row, index) => <li key={`${row.index}-${index}`} dir="auto">{row.token}</li>)}</ul> : <p className="matching-lab-muted">{empty}</p>
}

function CandidatePreview({ candidate, label }) {
  return <article className="matching-lab-candidate" aria-label={label}>
    <span className="eyebrow">{label}</span>
    <h3 dir="auto">{candidate.productName}</h3>
    <p className="matching-lab-muted" dir="auto">{candidate.categoryName}</p>
    <dl className="matching-lab-facts">
      <div><dt>Color</dt><dd dir="auto">{candidate.color ?? 'No color defined'}</dd></div>
      <div><dt>Size</dt><dd>{candidate.size ?? 'No size defined'}</dd></div>
      <div><dt>Explicit quantity</dt><dd>{candidate.quantity ?? 'Not supplied'}</dd></div>
      <div><dt>Selling price</dt><dd>{candidate.sellingPrice === null ? 'Not priced' : formatMoney(candidate.sellingPrice, candidate.currency)}</dd></div>
      <div><dt>Available stock</dt><dd>{candidate.availableStock}</dd></div>
    </dl>
    <p className="matching-lab-notice">Confirmation required. This preview does not reserve stock or complete a sale.</p>
    {candidate.missingFields.length > 0 && <div><h4>Missing information</h4><FieldList fields={candidate.missingFields} /></div>}
    {candidate.unresolvedConstraints.length > 0 && <div><h4>Unverified constraints</h4><FieldList fields={candidate.unresolvedConstraints} /></div>}
    <details className="matching-lab-details"><summary>Match evidence ({candidate.evidence.length})</summary>
      <ul className="matching-lab-evidence">{candidate.evidence.map((row, index) => <li key={index}>
        <strong>{fieldLabel(row.field)}</strong><span>{row.source.replaceAll('_', ' ')}</span>
        <span dir="auto">Requested: {row.requested}</span><span dir="auto">Catalog: {row.actual ?? 'Unavailable'}</span>
      </li>)}</ul>
      <p className="matching-lab-muted">Product ID: {candidate.productId}<br />Variant ID: {candidate.variantId}</p>
    </details>
  </article>
}

function ParserPreview({ parser, idPrefix = 'matching' }) {
  const titleId = `${idPrefix}-parser-title`
  return <Card className="matching-lab-panel" aria-labelledby={titleId}>
    <div className="matching-lab-section-heading"><h2 id={titleId}>Parser Result</h2><Badge>{parser.status.replaceAll('_', ' ')}</Badge></div>
    <h3>Normalized sentence</h3><p className="matching-lab-sentence" dir="auto">{parser.normalizedText || 'No valid normalized text'}</p>
    {parser.requestIntents?.length > 0 && <div className="matching-lab-notice">
      <h3>Request intent</h3>
      {parser.requestIntents.map((intent, index) => <dl className="matching-lab-attributes" key={`${intent.canonicalIntent}-${index}`}>
        <div><dt>Request Intent</dt><dd><strong>{intent.canonicalIntent}</strong></dd></div>
        <div><dt>Recognized expression</dt><dd dir="auto"><strong>{intent.matchedExpression}</strong></dd></div>
        <div><dt>Polarity</dt><dd><strong>{intent.polarity === 'affirmative' ? 'Affirmative' : 'Negated'}</strong></dd></div>
        <div><dt>Language evidence</dt><dd>{intent.languageEvidence.replaceAll('_', ' ')}</dd></div>
      </dl>)}
      <p>Recognition only. An add request does not change the cart, stock, or sales.</p>
    </div>}
    {parser.commonExpressionMatches?.length > 0 && <div className="matching-lab-notice">
      <h3>Expression &amp; intent cues</h3>
      {parser.commonExpressionMatches.map((row, index) => <p key={index} dir="auto">
        {row.span.text}: {row.candidates.join(' / ')} · {row.status.replaceAll('_', ' ')} · {row.role.replaceAll('_', ' ')} · {row.polarity}
      </p>)}
      <p>Recognition only. These cues do not authorize checkout, cart changes, payment, cancellation or stock changes.</p>
      {!parser.commonExpressionSafety?.salePreviewAllowed && <p>This sentence needs clarification before a sale preview.</p>}
    </div>}
    <dl className="matching-lab-attributes">{[...attributeFields, ...['sourceProductType', 'sourceColorId', 'sourceSizeId', 'sourceMaterial', 'sourceNecklineShape', 'sourceCollarType'].filter(field => parser[field])].map(field => {
      const row = parser[field] || parser.attributes[field]
      const label = field === 'sourceProductType' ? 'Clothing concept' : field === 'sourceColorId' ? 'Color / shade concept' : field === 'sourceSizeId' ? 'Size concept' : field === 'sourceMaterial' ? 'Material concept' : field === 'sourceNecklineShape' ? 'Neckline shape' : field === 'sourceCollarType' ? 'Collar type' : fieldLabel(field)
      return <div key={field}><dt>{label}</dt><dd>
        <strong>{row.status === 'resolved' ? String(row.value) : row.status === 'missing' ? 'Not supplied' : 'Needs clarification'}</strong>
        <small>{row.status}{row.source ? ` · ${row.source}` : ''}</small>
        {row.status !== 'resolved' && row.candidates.length > 0 && <span>Alternatives: {row.candidates.join(' / ')}</span>}
        {row.evidence.length > 0 && <details><summary>Parser evidence</summary><ul>{row.evidence.map((item, index) => <li key={index}>
          <span dir="auto">{item.span.text}</span> — {item.source}, {item.rule}
        </li>)}</ul></details>}
      </dd></div>
    })}</dl>
    {parser.quantityIntent && <div className="matching-lab-notice">
      <h3>Quantity intent</h3>
      <p>{parser.quantityIntent.intent.replaceAll('_', ' ')} · {parser.quantityIntent.status.replaceAll('_', ' ')}</p>
      <p>Order units: {parser.quantityIntent.orderUnits ?? 'Unresolved'} · Unit: {parser.quantityIntent.unitId ?? (parser.quantityIntent.unitCandidates.join(' / ') || 'Unresolved')}</p>
      <p>Verified sellable units: {parser.quantityIntent.resolvedPieces ?? 'Unresolved'}</p>
      {parser.quantityIntent.needsCatalogMetadata && <p>Packaging or unit mapping requires verified catalog metadata.</p>}
      {parser.quantityIntent.reasons.map((reason, index) => <p key={index}>{reason}</p>)}
    </div>}
    {parser.materialCandidates?.length > 0 && <div className="matching-lab-notice">
      <h3>Materials &amp; fabric descriptors</h3>
      {parser.materialCandidates.map((row, index) => <p key={index} dir="auto">{row.text}: {[...row.fabrics, ...row.modifiers].join(' / ')} · {row.status.replaceAll('_', ' ')}{!row.constrainsCatalog && ' · Role needs context'}</p>)}
      <p>Language descriptors require catalog evidence. Composition and certification are unverified.</p>
      {parser.materialComposition?.map((row, index) => <p key={`composition-${index}`}>{row.percentage ?? 'Invalid'}% · {row.candidates.join(' / ') || 'Unbound component'} · {row.status} · Unverified</p>)}
    </div>}
    {parser.patternCandidates?.length > 0 && <div className="matching-lab-notice">
      <h3>Patterns &amp; prints</h3>
      <p>Catalog evidence is required. Motifs and print techniques do not prove fabric composition.</p>
      {parser.patternCandidates.map((row, index) => <p key={index} dir="auto">{row.text}: {[...row.patterns, ...row.modifiers].join(' / ')} · {row.polarity === 'negated' ? 'Excluded' : 'Requested'} · {row.role.replaceAll('_', ' ')}{(!row.constrainsCatalog || row.status === 'context_required') && ' · Needs context'}</p>)}
    </div>}
    {parser.fitCutCandidates?.length > 0 && <div className="matching-lab-notice">
      <h3>Fits &amp; cuts — independent axes</h3>
      <dl className="matching-lab-attributes">{Object.entries(parser.sourceFitCuts ?? {}).filter(([, row]) => row.status !== 'missing').map(([axis, row]) =>
        <div key={axis}><dt>{axis.replaceAll('_', ' ')}</dt><dd>{row.value ?? row.candidates.join(' / ')} · {row.status}</dd></div>)}</dl>
      {parser.fitCutCandidates.map((row, index) => <p key={index} dir="auto">{row.text}: {[...row.styles, ...row.modifiers].join(' / ')} · {row.polarity} · {row.role.replaceAll('_', ' ')}{!row.constrainsCatalog && ' · Needs context'}</p>)}
      <p>Cut descriptors need catalog evidence. Oversized is a fit, not an XL size. Negated descriptions never authorize a sale.</p>
    </div>}
    {parser.necklineCandidates?.length > 0 && <div className="matching-lab-notice">
      <h3>Necklines, collars &amp; modifiers</h3>
      {parser.necklineCandidates.map((row, index) => <p key={index} dir="auto">{row.text}: {[...row.shapes, ...row.collars, ...row.modifiers, ...row.externalRoles].join(' / ')} · {row.status.replaceAll('_', ' ')}{!row.constrainsCatalog && ' · Role needs context'}</p>)}
      <p>Separate language concepts. Product-name evidence is required; ambiguous labels do not prove one interpretation.</p>
    </div>}
    <h3>Missing parser attributes</h3><FieldList fields={parser.missingInformation} />
    <h3>Unresolved parser attributes</h3><FieldList fields={parser.unresolvedInformation} />
    <h3>Unknown words</h3><TokenList tokens={parser.unrecognizedTokens} empty="No unrecognized words" />
    <h3>Brand / model residual words</h3><TokenList tokens={parser.productNameResidualTokens} empty="No residual name words" />
    <h3>Parser ambiguities</h3>
    {parser.ambiguities.length ? <ul className="matching-lab-warnings">{parser.ambiguities.map((issue, index) => <li key={index}>
      <strong>{issue.kind.replaceAll('_', ' ')}</strong><p>{issue.message}</p><span dir="auto">“{issue.span.text}”</span>
      {issue.alternatives.length > 0 && <p>Alternatives: {issue.alternatives.map(item => `${fieldLabel(item.field)}: ${item.value}`).join(' / ')}</p>}
    </li>)}</ul> : <p className="matching-lab-muted">No parser ambiguities</p>}
  </Card>
}

function CatalogPreview({ result, idPrefix = 'matching' }) {
  const titleId = `${idPrefix}-catalog-title`
  const remaining = result.candidates.filter(row => row.variantId !== result.match?.variantId)
  const notQueried = ['UNSUPPORTED_MULTIPLE_ITEMS', 'INVALID_TEXT', 'PARSER_ATTRIBUTE_CONFLICT', 'PRODUCT_IDENTITY_REQUIRED', 'PARSER_REQUIRES_CLARIFICATION', 'COMMON_EXPRESSION_REQUIRES_CLARIFICATION'].includes(result.reason)
  return <Card className="matching-lab-panel" aria-labelledby={titleId}>
    <div className="matching-lab-section-heading"><h2 id={titleId}>Catalog Matching Result</h2><Badge tone={toneForStatus(result.status)}>{MATCH_STATUS_LABELS[result.status]}</Badge></div>
    <p className="matching-lab-reason">{result.status} · {result.reason.replaceAll('_', ' ')}</p>
    <div className="matching-lab-coverage"><strong>Catalog coverage</strong>
      <span>{result.catalog.scannedVariants} eligible variants scanned this request.</span>
      <span>{notQueried ? 'Catalog not queried: resolve the input or parser issues first.' : result.catalog.truncated ? 'Coverage limited: additional catalog records were not scanned. Uniqueness is unverified.' : 'Reader coverage complete for this request.'}</span>
      <span>{result.catalog.candidateCount} plausible candidates{result.catalog.candidatesTruncated ? `; displaying only ${result.candidates.length}.` : '.'}</span>
    </div>
    <h3>Missing matching information</h3><FieldList fields={result.missingFields} />
    <h3>Matched Product Preview</h3>
    {result.match ? <CandidatePreview candidate={result.match} label={result.status === 'MATCHED' ? 'Supported match — confirm later' : 'Identified variant — insufficient stock'} />
      : <p className="matching-lab-muted">No confirmed product selection. Review the information below.</p>}
    <h3>Alternative candidates</h3>
    {remaining.length ? <div className="matching-lab-candidate-list">{remaining.map(row => <CandidatePreview key={row.variantId} candidate={row} label="Candidate — unconfirmed" />)}</div>
      : <p className="matching-lab-muted">No alternative candidates</p>}
    <h3>Suggestions</h3><p className="matching-lab-muted">Suggestions are possible name similarities, never confirmed matches.</p>
    {result.suggestions.length ? <div className="matching-lab-candidate-list">{result.suggestions.map(row => <CandidatePreview key={row.variantId} candidate={row} label="Suggestion only — unconfirmed" />)}</div>
      : <p className="matching-lab-muted">No suggestions</p>}
  </Card>
}

function MultiItemPreview({ result, confirmedItems, onItemConfirm }) {
  const allConfirmed = result.items.every(item => confirmedItems.includes(item.index))
  return <section className="matching-lab-multi" aria-labelledby="matching-multi-title">
    <Card className="matching-lab-multi-summary">
      <div className="matching-lab-section-heading"><div><span className="eyebrow">Independent read-only requests</span><h2 id="matching-multi-title">{result.items.length} items detected</h2></div>
        <Badge tone={allConfirmed ? 'success' : 'neutral'}>{allConfirmed ? 'Every item reviewed' : 'Review each item'}</Badge></div>
      <p>Each card was parsed and matched independently. Confirmation below records review only; it does not add to cart, reserve stock or create a sale.</p>
      {result.segmentation.removedConversationalExpressions.length > 0 && <p className="matching-lab-muted" dir="auto">
        Conversational expressions ignored: {result.segmentation.removedConversationalExpressions.join(' · ')}
      </p>}
    </Card>
    {result.items.map(item => {
      const confirmed = confirmedItems.includes(item.index)
      const idPrefix = `matching-item-${item.index}`
      return <article className="matching-lab-item" key={item.index} aria-labelledby={`${idPrefix}-title`}>
        <Card className="matching-lab-item-heading">
          <div className="matching-lab-section-heading"><div><span className="eyebrow">Item {item.index + 1}</span><h2 id={`${idPrefix}-title`} dir="auto">{item.segment.text}</h2></div>
            <Badge tone={toneForStatus(item.result.status)}>{MATCH_STATUS_LABELS[item.result.status]}</Badge></div>
        </Card>
        <div className="matching-lab-results"><ParserPreview parser={item.result.parser} idPrefix={idPrefix} />
          <CatalogPreview result={item.result} idPrefix={idPrefix} /></div>
        <Card className="matching-lab-item-confirmation">
          <div><strong>{confirmed ? `Item ${item.index + 1} reviewed` : `Review item ${item.index + 1}`}</strong>
            <p className="matching-lab-muted">Confirm this item separately after checking its transcript, constraints and live catalog evidence.</p></div>
          <Button onClick={() => onItemConfirm(item.index)} disabled={confirmed}>{confirmed ? 'Reviewed' : 'Confirm item review'}</Button>
        </Card>
      </article>
    })}
  </section>
}

function VoiceRecorderPanel({ voice, onStart, onStop, onCancel, onRetry, onEdit, onConfirm, onRun, matchingPending }) {
  const busy = ['requesting', 'recording', 'transcribing'].includes(voice.phase)
  const seconds = (voice.elapsedMs / 1000).toFixed(1)
  return <Card className="matching-lab-voice" aria-labelledby="voice-recorder-title">
    <div className="matching-lab-section-heading"><div><span className="eyebrow">Optional voice input</span><h2 id="voice-recorder-title">Record a sales request</h2></div>
      <Badge tone={voice.phase === 'error' ? 'danger' : voice.phase === 'confirmed' ? 'success' : 'neutral'}>{voice.phase.replaceAll('_', ' ')}</Badge></div>
    <p className="matching-lab-muted">Record up to 30 seconds. Audio is sent for transcription only after you stop. Review every word before matching.</p>
    {!voice.supported && <div className="matching-lab-error" role="alert">Voice recording is not supported in this browser.</div>}
    <div className="matching-lab-actions">
      {!busy && !['review', 'confirmed'].includes(voice.phase) && <Button onClick={onStart} disabled={!voice.supported}>Start recording</Button>}
      {voice.phase === 'recording' && <Button onClick={onStop}>Stop recording · {seconds}s</Button>}
      {busy && <Button tone="secondary" onClick={onCancel}>Cancel</Button>}
      {voice.canRetry && <Button onClick={onRetry}>Retry transcription</Button>}
      {['error', 'review', 'confirmed'].includes(voice.phase) && <Button tone="ghost" onClick={onCancel}>Discard recording</Button>}
    </div>
    <div className="matching-lab-live-message" role="status" aria-live="polite">
      {voice.phase === 'requesting' ? 'Waiting for microphone permission…' : voice.phase === 'recording' ? `Recording… ${seconds} seconds`
        : voice.phase === 'transcribing' ? 'Transcribing securely…' : voice.phase === 'review' ? 'Transcript ready for review.'
          : voice.phase === 'confirmed' ? 'Transcript confirmed. You may run catalog matching.' : 'Recorder ready.'}
    </div>
    {voice.error && <div className="matching-lab-error" role="alert"><strong>Voice input unavailable</strong><p>{voice.error.message}</p></div>}
    {['review', 'confirmed'].includes(voice.phase) && <div className="matching-lab-transcript">
      <label htmlFor="voice-transcript">Editable transcript</label>
      <textarea id="voice-transcript" rows={3} dir="auto" maxLength={MATCH_TEXT_MAX_LENGTH} value={voice.transcriptText}
        onChange={event => onEdit(event.target.value)} disabled={voice.phase === 'confirmed'} />
      <div className="matching-lab-input-meta"><small>Correct product, color, size and quantity before confirming.</small><small>{voice.transcriptText.length} / {MATCH_TEXT_MAX_LENGTH}</small></div>
      {voice.phase === 'review' ? <Button onClick={onConfirm}>Confirm transcript</Button>
        : <div className="matching-lab-actions"><Button onClick={onRun} disabled={matchingPending}>Run catalog match</Button><Button tone="secondary" onClick={() => onEdit(voice.transcriptText)}>Edit transcript</Button></div>}
    </div>}
  </Card>
}

export function TextMatchingLabView({ state, voice, onTextChange, onSubmit, onReset, onExample, onVoiceStart,
  onVoiceStop, onVoiceCancel, onVoiceRetry, onVoiceEdit, onVoiceConfirm, onVoiceRun, onItemConfirm = () => {}, remainingSeconds = 0 }) {
  return <div className="matching-lab">
    <PageHeader eyebrow="Development only · Read-only" title="Voice Sale — Text Matching Lab"
      description="Test a sentence against your store’s catalog. Nothing is added to the cart or sold." />
    {voice && <VoiceRecorderPanel voice={voice} onStart={onVoiceStart} onStop={onVoiceStop} onCancel={onVoiceCancel}
      onRetry={onVoiceRetry} onEdit={onVoiceEdit} onConfirm={onVoiceConfirm} onRun={onVoiceRun} matchingPending={state.pending} />}
    <Card className="matching-lab-input">
      <form onSubmit={onSubmit} aria-label="Test a sales sentence" aria-busy={state.pending}>
        <label htmlFor="matching-sentence">Sales sentence</label>
        <textarea id="matching-sentence" rows={3} dir="auto" maxLength={MATCH_TEXT_MAX_LENGTH}
          value={state.text} onChange={event => onTextChange(event.target.value)} placeholder={MATCH_EXAMPLE}
          aria-describedby="matching-sentence-hint matching-character-count" aria-invalid={Boolean(state.error?.code === 'INVALID_MATCH_TEXT')} />
        <div className="matching-lab-input-meta"><small id="matching-sentence-hint">Arabic, English and Arabizi. Include the product name, color, size and quantity.</small><small id="matching-character-count">{state.text.length} / {MATCH_TEXT_MAX_LENGTH}</small></div>
        <div className="matching-lab-actions">
          <Button type="submit" disabled={state.pending || remainingSeconds > 0}>{state.pending ? <><LoadingSpinner label="Testing match" /> Testing…</> : remainingSeconds > 0 ? `Wait ${remainingSeconds}s` : 'Test Match'}</Button>
          <Button tone="secondary" onClick={onReset}>Reset</Button>
          <Button tone="ghost" disabled={state.pending} onClick={onExample}>Use example</Button>
        </div>
        <p className="matching-lab-notice">Only Test Match sends a request. Preview results can change as stock and prices change.</p>
      </form>
      {state.error && <div className="matching-lab-error" role="alert"><strong>Unable to test this sentence</strong><p>{state.error.message}</p>
        {remainingSeconds > 0 && <p>Try again in {remainingSeconds} seconds.</p>}
        {state.error.requiresLogin && <a className="text-link" href={ROUTES.login}>Sign in again</a>}
      </div>}
    </Card>
    <div role="status" aria-live="polite" className="matching-lab-live-message">
      {state.pending ? 'Testing your sentence against the catalog…' : state.result ? MATCH_STATUS_LABELS[state.result.status] : 'Ready for a manual test.'}
    </div>
    {state.result ? state.result.items
      ? <MultiItemPreview result={state.result} confirmedItems={state.confirmedItems ?? []} onItemConfirm={onItemConfirm} />
      : <div className="matching-lab-results"><ParserPreview parser={state.result.parser} /><CatalogPreview result={state.result} /></div>
      : !state.pending && !state.error && <Card className="matching-lab-empty"><h2>Start with one product</h2><p>Write a sentence, then choose Test Match. Your parser output and catalog evidence will appear here.</p><p dir="auto">{MATCH_EXAMPLE}</p></Card>}
  </div>
}

function AuthorizedMatchingLab() {
  const [controller] = useState(() => createTextMatchingController({ supabase }))
  const [voiceController] = useState(() => createVoiceRecordingController({ supabase }))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const voice = useSyncExternalStore(voiceController.subscribe, voiceController.getSnapshot, voiceController.getSnapshot)
  const [now, setNow] = useState(Date.now)
  const remainingSeconds = Math.max(0, Math.ceil((state.retryAt - now) / 1000))
  useEffect(() => () => { controller.invalidate(); voiceController.invalidate() }, [controller, voiceController])
  useEffect(() => {
    if (!state.retryAt) return undefined
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= state.retryAt) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [state.retryAt])
  function handleSubmit(event) { event.preventDefault(); void controller.submit() }
  function confirmTranscript() { const result = voiceController.confirmTranscript(); if (result.ok) controller.setText(result.text) }
  function changeText(value) {
    controller.setText(value)
    if (voice.phase === 'confirmed' && value !== voice.confirmedText) voiceController.editTranscript(value)
  }
  function runConfirmedTranscript() { controller.setText(voice.confirmedText); void controller.submit() }
  return <TextMatchingLabView state={state} voice={voice} onTextChange={changeText} onSubmit={handleSubmit}
    onReset={controller.reset} onExample={() => controller.setText(MATCH_EXAMPLE)} remainingSeconds={remainingSeconds}
    onVoiceStart={() => void voiceController.start()} onVoiceStop={voiceController.stop} onVoiceCancel={voiceController.cancel}
    onVoiceRetry={() => void voiceController.retry()} onVoiceEdit={voiceController.editTranscript}
    onVoiceConfirm={confirmTranscript} onVoiceRun={runConfirmedTranscript} onItemConfirm={controller.confirmItem} />
}

export function TextMatchingLabPage({ profile }) {
  if (!import.meta.env.DEV || !canUseMatchingLab(profile)) return <NotFoundPage />
  return <AuthorizedMatchingLab key={`${profile.account.id}:${profile.user.id}:${profile.user.role}`} />
}
