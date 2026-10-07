import { useEffect, useRef, useState } from 'react'
import { loadReceiptHistory } from './stock-receipt-flow.js'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'

export function ReceiptHistory({ active, role, currency, refreshVersion }) {
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
  return <section className="product-panel inventory-history-panel"><div className="product-section-heading"><div className="inventory-section-title"><h2>Receipt history</h2><p>Store-wide purchased deliveries. The current API provides paginated receipts across all products.</p></div><button type="button" className="secondary-action" onClick={refresh}>Refresh</button></div>
    {!state ? <p role="status">Loading receipts…</p> : !state.ok ? <><p role="alert" className="error-message">{state.message}</p><button type="button" onClick={refresh}>Try again</button></> : <>
      {!state.receipts.length && <div className="inventory-empty"><h3>No receipts yet</h3><p>Received deliveries will appear here. Earlier stock changes are in Movement history.</p></div>}
      <div className="inventory-receipt-list">{state.receipts.map((receipt) => <details className="inventory-receipt-row" key={receipt.id}><summary><strong>{receipt.productName}</strong><span>{new Date(receipt.createdAt).toLocaleString()}</span><span>{receipt.totalQuantity} pieces</span>{role === 'OWNER' && <b>{formatMoney(receipt.totalCost, currency, 4)}</b>}</summary><div className="inventory-receipt-details"><p>Recorded by {receipt.actor}</p><ul>{receipt.items.map((item) => <li key={item.variantId}><strong>{item.color} / {item.size}</strong><span>+{item.quantity} received</span>{role === 'OWNER' && <span>{formatMoney(item.unitCost, currency, 4)} per piece</span>}</li>)}</ul></div></details>)}</div>
      {(page > 1 || state.hasMore) && <div className="product-actions inventory-history-pagination"><button className="secondary-action" disabled={page === 1} onClick={() => { setState(null); setPage(page - 1) }}>Previous receipts</button><span>Page {page}</span><button className="secondary-action" disabled={!state.hasMore} onClick={() => { setState(null); setPage(page + 1) }}>Next receipts</button></div>}
    </>}
  </section>
}
