import { useEffect, useRef, useState } from 'react'
import { loadReceiptHistory } from './stock-receipt-flow.js'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'
import { ProductLoading } from '../products/ProductLoading.jsx'
import { useI18n } from '../../i18n/I18nContext.js'

export function ReceiptHistory({ active, role, currency, refreshVersion }) {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const [state, setState] = useState(null)
  const [version, setVersion] = useState(0)
  const loadedKey = useRef('')
  useEffect(() => {
    const key = `${page}:${refreshVersion}:${version}`
    if (!active || loadedKey.current === key) return undefined
    const controller = new AbortController()
    let current = true
    setState(null)
    void loadReceiptHistory({ supabase, page, signal: controller.signal }).then((result) => {
      if (!current || result.aborted) return
      loadedKey.current = key
      setState(result)
    })
    return () => { current = false; controller.abort() }
  }, [active, page, refreshVersion, version])
  function refresh() { loadedKey.current = ''; setState(null); setVersion((value) => value + 1) }
  return <section className="product-panel inventory-history-panel"><div className="product-section-heading"><div className="inventory-section-title"><span className="eyebrow">{t('Purchased stock')}</span><h2>{t('Receipt history')}</h2><p>{t('Store-wide deliveries across all products.')}</p></div><button type="button" className="text-button" onClick={refresh}>{t('Refresh')}</button></div>
    {!state ? <ProductLoading label={t('Loading receipts…')} /> : !state.ok ? <><p role="alert" className="error-message">{t(state.message)}</p><button type="button" onClick={refresh}>{t('Try again')}</button></> : <>
      {!state.receipts.length && <div className="inventory-empty"><h3>{t('No receipts yet')}</h3><p>{t('Received deliveries will appear here. Earlier stock changes are in Movement history.')}</p></div>}
      <div className="inventory-receipt-list">{state.receipts.map((receipt) => <details className="inventory-receipt-row" key={receipt.id}><summary><strong>{receipt.productName}</strong><span>{new Date(receipt.createdAt).toLocaleString()}</span><span>{t('{totalQuantity} pieces', { totalQuantity: receipt.totalQuantity })}</span>{role === 'OWNER' && <b>{formatMoney(receipt.totalCost, currency, 4)}</b>}</summary><div className="inventory-receipt-details"><p>{t('Recorded by {actor}', { actor: receipt.actor })}</p><ul>{receipt.items.map((item) => <li key={item.variantId}><strong>{item.color} / {item.size}</strong><span>{t('+{quantity} received', { quantity: item.quantity })}</span>{role === 'OWNER' && <span>{t('{formatMoney} per piece', { formatMoney: formatMoney(item.unitCost, currency, 4) })}</span>}</li>)}</ul></div></details>)}</div>
      {(page > 1 || state.hasMore) && <div className="product-actions inventory-history-pagination"><button className="secondary-action" disabled={page === 1} onClick={() => { setState(null); setPage(page - 1) }}>{t('Previous receipts')}</button><span>{t('Page {page}', { page })}</span><button className="secondary-action" disabled={!state.hasMore} onClick={() => { setState(null); setPage(page + 1) }}>{t('Next receipts')}</button></div>}
    </>}
  </section>
}
