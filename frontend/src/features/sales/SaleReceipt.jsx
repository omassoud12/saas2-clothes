import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { buildReceipt } from './pos-receipt.js'
import { useReceiptActions } from './use-receipt-actions.js'
import { MockSalesSheet } from './MockSalesSheet.jsx'

export function ReceiptView({ receipt, className = '' }) {
  return <article className={`mock-pos-receipt ${className}`} aria-label={`Receipt ${receipt.number}`}>
    {receipt.storeName && <h3 className="mock-pos-receipt-store">{receipt.storeName}</h3>}
    <p className="mock-pos-receipt-meta"><span>Receipt {receipt.number}</span>{receipt.dateText && <time dateTime={receipt.isoDate}>{receipt.dateText}</time>}</p>
    <ul className="mock-pos-receipt-lines">{receipt.lines.map(line => <li key={line.id}>
      <div><strong>{line.name}</strong>{line.detail && <span>{line.detail}</span>}<span>{line.quantity} × {line.unitPrice}</span></div>
      <b>{line.lineTotal}</b>
    </li>)}</ul>
    <dl className="mock-pos-receipt-totals">
      {receipt.discount && <>
        <div><dt>Subtotal</dt><dd>{receipt.subtotal}</dd></div>
        <div><dt>Discount{receipt.discountPercent ? ` (${receipt.discountPercent}%)` : ''}</dt><dd>−{receipt.discount}</dd></div>
      </>}
      <div className="is-total"><dt>Total</dt><dd>{receipt.total}</dd></div>
    </dl>
    <p className="mock-pos-receipt-thanks">Thank you!</p>
  </article>
}

// The printed copy of a receipt, rendered into the print root from useReceiptActions.
export function PrintCopy({ receipt, printRoot }) {
  return printRoot ? createPortal(<ReceiptView receipt={receipt} className="is-print" />, printRoot) : null
}

export function SaleCompletedSheet({ completed, storeName = '', onNewSale }) {
  const receipt = useMemo(() => buildReceipt({ sale: completed.sale, summary: completed.summary, storeName }), [completed, storeName])
  const { share, print, shareMessage, printRoot } = useReceiptActions(receipt)

  return <MockSalesSheet title="Sale completed" subtitle={`Receipt ${receipt.number}`} onClose={onNewSale}
    footer={<div className="mock-pos-receipt-actions">
      <div className="mock-pos-receipt-secondary">
        <button type="button" onClick={share}>Share on WhatsApp</button>
        <button type="button" onClick={print}>Print / PDF</button>
      </div>
      <button type="button" className="mock-pos-primary" onClick={onNewSale}>New sale</button>
    </div>}>
    <div className="mock-pos-sale-done"><span aria-hidden="true">✓</span>
      <p>{completed.replay ? 'Confirmed from the original attempt.' : 'The sale was saved.'}</p></div>
    <ReceiptView receipt={receipt} />
    {shareMessage && <p className="mock-pos-error" role="alert">{shareMessage}</p>}
    <PrintCopy receipt={receipt} printRoot={printRoot} />
  </MockSalesSheet>
}
