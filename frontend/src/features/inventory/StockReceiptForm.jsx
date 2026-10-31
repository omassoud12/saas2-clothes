import { useEffect, useRef, useState } from 'react'
import { useDirtyState, confirmDiscardChanges } from '../../app/dirty-state.js'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'
import { uploadProductImage } from '../products/product-flow.js'
import { VariantQuantityMatrix } from './VariantQuantityMatrix.jsx'
import { ReceiptSteps, ReceiptReview, InventoryFeedback } from './ReceiptPresentation.jsx'
import { buildReceipt, buildReceivingSetup, submitReceipt } from './stock-receipt-flow.js'
import { prepareReceipt, lockReceipt, markReceiptOutcome, settleReceipt } from './stock-receipt-recovery.js'
import { RECEIPT_OUTCOME } from './stock-receipt-outcome.js'
import { useI18n } from '../../i18n/I18nContext.js'

export function StockReceiptForm({ product, definition, imageFile, profile, scope, onSaved, onCancel, onEditDefinition, onTerminal, blocked }) {
  const { t } = useI18n()
  const [quantities, setQuantities] = useState({})
  const [cost, setCost] = useState('')
  // "Different cost per size": each received size may have its own cost; the cost above is the default for the others.
  const [perLine, setPerLine] = useState(false)
  const [lineCosts, setLineCosts] = useState({})
  const [review, setReview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [savedResult, setSavedResult] = useState(null)
  const running = useRef(false)
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [])
  const clearDirty = useDirtyState(Boolean(definition || cost || Object.values(quantities).some(Boolean) || Object.values(lineCosts).some(Boolean)))
  const owner = profile.user.role === 'OWNER'
  const variants = definition?.options ?? product.variants

  async function upload(result) {
    if (imageFile) {
      const photo = await uploadProductImage({ supabase, productId: result.productId, file: imageFile })
      if (!photo.ok) { setMessage({kind:'pending',text:t('Product saved. Photo upload failed: {message}. Retry photo only or finish without it.', { message: photo.message })}); return }
    }
    clearDirty(); onSaved(result)
  }
  async function save(receive) {
    if (running.current || blocked) return
    const saveOnly = !receive
    const operationLabel = saveOnly ? 'product save' : 'receiving request'
    let payload, summary
    if (receive) {
      summary = buildReceipt(variants, quantities, cost, Boolean(definition), perLine ? lineCosts : {})
      if (!summary.ok) { setMessage({kind:'error',text:summary.message}); return }
    }
    if (definition) {
      const setup = buildReceivingSetup(definition, profile.user.role, summary?.payload ?? null)
      if (!setup.ok) { setMessage({kind:'error',text:setup.message}); return }
      payload = setup.payload
    } else payload = { productId: product.id, ...summary.payload }
    if (!review || review.receive !== receive) { setReview({ receive, payload, summary }); setMessage(null); return }
    running.current = true; setBusy(true); setMessage(null)
    let record = null
    try {
      record = await prepareReceipt(scope, { path: definition ? '/api/inventory/product-setups' : '/api/inventory/receipts', payload: review.payload })
      const locked = await lockReceipt(scope, record, async () => {
        const result = await submitReceipt({ supabase, ...record })
        if (!result.ok) {
          if (result.preservePending) await markReceiptOutcome(scope, record, result)
          else await settleReceipt(scope, record)
          if (result.requiresLogin) { window.location.replace('/login'); return }
          if (result.requiresAccountReview) { window.location.replace('/pending-approval'); return }
          if (result.outcome === RECEIPT_OUTCOME.TERMINAL_REJECTION) {
            setReview(null); clearDirty(); onTerminal?.(result); return
          }
          if (result.outcome === RECEIPT_OUTCOME.CORRECTABLE_REJECTION) setReview(null)
          const guidance = result.outcome === RECEIPT_OUTCOME.UNCERTAIN
            ? ` The original ${operationLabel} is preserved; retry that exact operation below.`
            : result.outcome === RECEIPT_OUTCOME.CONFLICT
              ? ' Review the pending operation below before continuing.'
              : ''
          setMessage({kind:result.preservePending?'pending':'error',text:`${result.message}${guidance}`})
          return
        }
        await settleReceipt(scope, record)
        setSavedResult(result); clearDirty(); await upload(result)
      })
      if (!locked.acquired) setMessage({kind:'pending',text:t('Another tab is confirming this {operationLabel}. Wait for it to finish.', { operationLabel })})
    } catch { setMessage({kind:record?'pending':'error',text:(record ? t('The original {operationLabel} remains preserved.', { operationLabel }) : `${saveOnly?'Product save':'Receiving'} could not start. Resolve pending operations and check browser storage.`)}) }
    finally { running.current = false; setBusy(false) }
  }
  if (savedResult) return <section className="product-panel receipt-photo-retry"><h2>{t('Product saved; photo needs attention')}</h2><InventoryFeedback kind="pending">{t(message?.text)}</InventoryFeedback><div className="product-actions"><button disabled={busy} onClick={async () => { setBusy(true); try { await upload(savedResult) } finally { setBusy(false) } }}>{t('Retry photo only')}</button><button className="secondary-action" onClick={() => { clearDirty(); onSaved(savedResult) }}>{t('Finish without photo')}</button></div></section>
  const receivedVariants = variants.filter((variant) => /^[1-9]\d*$/.test(String(quantities[variant.id ?? variant.sku] ?? '').trim()))
  const preview = owner && (cost || (perLine && Object.values(lineCosts).some(Boolean))) && Object.values(quantities).some(Boolean) ? buildReceipt(variants, quantities, cost, Boolean(definition), perLine ? lineCosts : {}) : null
  return <section className="product-panel receipt-form"><ReceiptSteps owner={owner} newProduct={Boolean(definition)} current={review ? owner ? (definition ? 2 : 1) : 1 : definition ? 1 : 0} />{!review && (definition ? <h2 ref={heading} tabIndex={-1}>{definition.name}</h2> : <div className="receipt-product-context"><h2 ref={heading} tabIndex={-1}>{definition ? definition.name : product.name}</h2>{!definition && <p>{t('{length} variants · Current stock', { length: variants.length })} {variants.reduce((total, variant) => total + variant.currentStock, 0)}</p>}</div>)}
    {review ? <ReceiptReview review={review} name={definition ? definition.name : product.name} variants={variants} currency={profile.account?.baseCurrency} /> : owner ? <><VariantQuantityMatrix variants={variants} quantities={quantities} disabled={busy || blocked} onChange={(key, value) => { setQuantities({ ...quantities, [key]: value }); setReview(null); setMessage(null) }} />
      <div className="receipt-cost-row"><div><label htmlFor="receipt-cost">{t('Purchase cost per piece ({baseCurrency})', { baseCurrency: profile.account?.baseCurrency })}</label><input id="receipt-cost" inputMode="decimal" value={cost} disabled={busy || blocked} onChange={(event) => { setCost(event.target.value); setReview(null); setMessage(null) }} /><small>{perLine ? t('Used for any size without its own cost below.') : t('One cost for all received pieces.')}</small>
        <label className="receipt-perline-toggle" htmlFor="receipt-per-line"><input id="receipt-per-line" type="checkbox" checked={perLine} disabled={busy || blocked} onChange={(event) => { setPerLine(event.target.checked); setReview(null); setMessage(null) }} />{t('Different cost per size')}</label>
        {perLine && receivedVariants.length > 0 && <div className="receipt-line-costs">{receivedVariants.map((variant) => { const key = variant.id ?? variant.sku; return <div key={key}><label htmlFor={'line-cost-' + key}>{variant.color || t('No color')} / {variant.size || t('No size')} · {quantities[key]} {t('pcs')}</label><input id={'line-cost-' + key} inputMode="decimal" placeholder={cost || t('Cost')} value={lineCosts[key] ?? ''} disabled={busy || blocked} onChange={(event) => { setLineCosts({ ...lineCosts, [key]: event.target.value }); setReview(null); setMessage(null) }} /></div> })}</div>}</div><div className="receipt-live-summary" role="status"><strong>{definition ? t('Live receipt preview') : t('Delivery summary')}</strong>{preview?.ok ? <><span>{!definition && t('Receiving: ')}{t('{totalQuantity} pieces · {length} options', { totalQuantity: preview.totalQuantity, length: preview.payload.items.length })}</span><span hidden={Boolean(definition) || preview.payload.unitCost === undefined}>{t('Unit cost:')} {preview.payload.unitCost !== undefined && formatMoney(preview.payload.unitCost, profile.account?.baseCurrency, 4)}</span><b>{!definition && <small>{t('Total purchase')}</small>}{formatMoney(preview.totalCost, profile.account?.baseCurrency, 4)}</b></> : <span>{t('Enter quantities and cost to see the exact total.')}</span>}</div></div></> : <p>{t('Review this product definition before saving it with zero stock.')}</p>}
    {message && <InventoryFeedback kind={message.kind}>{t(message.text)}</InventoryFeedback>}
    <div className="product-actions receipt-form-actions">{owner && (!review || review.receive) && <button aria-label={!definition && review?.receive ? t('Confirm receiving') : undefined} disabled={busy || blocked || !profile.account?.baseCurrency} onClick={() => save(true)}>{busy ? t('Saving…') : review?.receive ? definition ? t('Confirm receiving') : t('Confirm Restock') : t('Review receipt')}</button>}
      {review && !review.receive && <button disabled={busy || blocked} onClick={() => save(false)}>{busy ? t('Saving…') : t('Confirm product only')}</button>}
      {definition && !review && <button className={owner ? "secondary-action" : ""} disabled={busy || blocked} onClick={() => save(false)}>{t('Save product only')}</button>}
      {review && <button className="secondary-action" disabled={busy} onClick={() => { setReview(null); setMessage(null) }}>{t('Back / edit quantities')}</button>}
      {definition && !review && onEditDefinition && <button className="secondary-action" disabled={busy} onClick={() => { setReview(null); onEditDefinition() }}>{t('Back to product')}</button>}
      {!review && <button className="secondary-action" disabled={busy} onClick={() => { if (confirmDiscardChanges()) { clearDirty(); onCancel() } }}>{t('Cancel')}</button>}</div>
  </section>
}
