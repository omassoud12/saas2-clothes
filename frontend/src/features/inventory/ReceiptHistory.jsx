import { useEffect, useState } from 'react'
import { loadReceiptHistory } from './stock-receipt-flow.js'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'

export function ReceiptHistory({ role, currency, refreshVersion }) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState(null)
  useEffect(() => {
    let active = true
    loadReceiptHistory({ supabase, page }).then((result) => { if (active) setState(result) })
    return () => { active = false }
  }, [page, refreshVersion])
  return <section className="product-panel inventory-history-panel"><div className="inventory-section-title"><h2>Receipt history</h2><p>Purchased deliveries recorded for your products.</p></div>
    {!state ? <p role="status">Loading receipts…</p> : !state.ok ? <p role="alert" className="error-message">{state.message}</p> : <>
      {!state.receipts.length && <div className="inventory-empty"><h3>No receipts yet</h3><p>Received deliveries will appear here. Earlier stock changes are in Movement history.</p></div>}
      <div className="inventory-receipt-list">{state.receipts.map((receipt) => <details className="inventory-receipt-row" key={receipt.id}><summary><strong>{receipt.productName}</strong><span>{new Date(receipt.createdAt).toLocaleString()}</span><span>{receipt.totalQuantity} pieces</span>{role === 'OWNER' && <b>{formatMoney(receipt.totalCost, currency, 4)}</b>}</summary><div className="inventory-receipt-details"><p>Recorded by {receipt.actor} · Receipt {receipt.id}</p><ul>{receipt.items.map((item) => <li key={item.variantId}><strong>{item.color} / {item.size}</strong><span>+{item.quantity} received</span>{role === 'OWNER' && <span>{formatMoney(item.unitCost, currency, 4)} per piece</span>}</li>)}</ul></div></details>)}</div>
      {(page > 1 || state.hasMore) && <div className="product-actions inventory-history-pagination"><button className="secondary-action" disabled={page === 1} onClick={() => { setState(null); setPage(page - 1) }}>Previous receipts</button><span>Page {page}</span><button className="secondary-action" disabled={!state.hasMore} onClick={() => { setState(null); setPage(page + 1) }}>Next receipts</button></div>}
    </>}
  </section>
}
