import { useEffect, useMemo, useState } from 'react'
import { formatMoneyCompact } from '../../lib/money.js'
import { loadSaleHistory } from './sale-flow.js'
import { loadSaleDetail } from './sale-lifecycle-flow.js'
import { receiptNumber, summarizeSales } from './pos-checkout.js'
import { buildReceipt } from './pos-receipt.js'
import { dateInputValue, HISTORY_PAGE_SIZE, HISTORY_RANGES, HISTORY_STATUSES, historyQuery, saleBadges, saleTimeText } from './history-flow.js'
import { PrintCopy, ReceiptView } from './SaleReceipt.jsx'
import { useReceiptActions } from './use-receipt-actions.js'
import { MockSalesSheet } from './MockSalesSheet.jsx'
import { plural } from './mock-sales-model.js'
import './mock-sales.css'

function goToLogin() { window.location.replace('/login') }

function Chips({ label, items, value, onChange }) {
  return <nav className="mock-pos-chips" aria-label={label}>
    {items.map((item) => <button key={item.id} type="button" aria-pressed={value === item.id} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </nav>
}

export function SaleRow({ sale, role, currency, withDay, onOpen }) {
  const badges = saleBadges(sale)
  const owner = role === 'OWNER'
  const money = (amount) => formatMoneyCompact(amount, sale.currency || currency)
  return <button type="button" className="mock-history-row" onClick={() => onOpen(sale.id)}
    aria-label={`Open receipt ${receiptNumber(sale.id)}`}>
    <span className="mock-history-main">
      <strong>{receiptNumber(sale.id)}</strong>
      <span>{plural(sale.totalUnits, 'item')} · {saleTimeText(sale.createdAt, { withDay })}</span>
      {owner && sale.seller?.name && <span>{sale.seller.name}</span>}
      {badges.length > 0 && <span className="mock-history-badges">{badges.map((badge) => <small key={badge.text} className={`mock-history-badge ${badge.tone}`}>{badge.text}</small>)}</span>}
    </span>
    {owner && <span className="mock-history-amount">
      <strong className={sale.status === 'VOIDED' ? 'is-struck' : ''}>{money(sale.totalAmount)}</strong>
      {sale.hasReturns === true && <small>−{money(sale.totalReturnedAmount)}</small>}
    </span>}
  </button>
}

function HistoryResults({ supabase, queryKey, role, currency, withDay, onOpen }) {
  const query = useMemo(() => JSON.parse(queryKey), [queryKey])
  const [state, setState] = useState({ kind: 'loading', sales: [], nextCursor: null, loadingMore: false, moreError: '', message: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void loadSaleHistory({ supabase, limit: HISTORY_PAGE_SIZE, ...query }).then((result) => {
      if (!active) return
      if (result.requiresLogin) { goToLogin(); return }
      setState(result.ok
        ? { kind: 'ready', sales: result.sales, nextCursor: result.nextCursor, loadingMore: false, moreError: '', message: '' }
        : { kind: 'error', sales: [], nextCursor: null, loadingMore: false, moreError: '', message: result.message })
    })
    return () => { active = false }
  }, [supabase, query, attempt])

  async function loadMore() {
    const cursor = state.nextCursor
    if (!cursor || state.loadingMore) return
    setState((current) => ({ ...current, loadingMore: true, moreError: '' }))
    const result = await loadSaleHistory({ supabase, limit: HISTORY_PAGE_SIZE, cursor, ...query })
    if (result.requiresLogin) { goToLogin(); return }
    setState((current) => {
      if (!result.ok) return { ...current, loadingMore: false, moreError: result.message }
      const known = new Set(current.sales.map((sale) => sale.id))
      return { ...current, loadingMore: false, sales: [...current.sales, ...result.sales.filter((sale) => !known.has(sale.id))], nextCursor: result.nextCursor }
    })
  }

  function retry() {
    setState((current) => ({ ...current, kind: 'loading' }))
    setAttempt((value) => value + 1)
  }

  if (state.kind === 'loading') return <div className="mock-pos-empty" role="status"><span className="mock-pos-spinner" /><p>Loading sales…</p></div>
  if (state.kind === 'error') return <div className="mock-pos-empty" role="alert"><strong>Sales could not load</strong><p>{state.message}</p>
    <button type="button" onClick={retry}>Try again</button></div>

  // A total is shown only when every sale of the period is on screen; otherwise it would be a partial figure.
  const complete = !state.nextCursor
  const summary = summarizeSales(state.sales, currency)
  const headline = !state.sales.length ? 'No sales'
    : complete ? (role === 'OWNER' ? `${plural(summary.count, 'sale')} · ${summary.total}` : plural(summary.count, 'sale'))
      : `${state.sales.length} loaded`
  return <section aria-label="Sales">
    <div className="mock-pos-list-heading"><h2>Sales</h2><span>{headline}</span></div>
    {!state.sales.length && <div className="mock-pos-empty"><strong>No sales found</strong><p>Try another period or status.</p></div>}
    <div className="mock-history-list">{state.sales.map((sale) => <SaleRow key={sale.id} sale={sale} role={role} currency={currency} withDay={withDay} onOpen={onOpen} />)}</div>
    {state.moreError && <p className="mock-pos-error" role="alert">{state.moreError}</p>}
    {state.nextCursor && <button type="button" className="mock-history-more" disabled={state.loadingMore} aria-busy={state.loadingMore} onClick={loadMore}>
      {state.loadingMore ? 'Loading…' : 'Load more'}</button>}
  </section>
}

function ReturnsNote({ sale, currency }) {
  const { returnSummary, status } = sale
  if (status === 'VOIDED' && sale.void) {
    return <p className="mock-history-status is-void"><strong>Voided</strong>
      <span>{saleTimeText(sale.void.voidedAt, { withDay: true })} · {sale.void.voidedByName}</span>
      <span>Reason: {sale.void.voidReason}</span></p>
  }
  if (!returnSummary.hasReturns) return null
  return <p className="mock-history-status is-returned"><strong>Returned</strong>
    <span>{plural(returnSummary.totalReturnedUnits, 'item')} · refund {formatMoneyCompact(returnSummary.totalReturnedAmount, currency)}</span></p>
}

function SaleDetailSheet({ supabase, saleId, currency, storeName, onClose }) {
  const [state, setState] = useState({ kind: 'loading', sale: null, message: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void loadSaleDetail({ supabase, saleId }).then((result) => {
      if (!active) return
      if (result.requiresLogin) { goToLogin(); return }
      setState(result.ok ? { kind: 'ready', sale: result.sale, message: '' } : { kind: 'error', sale: null, message: result.message })
    })
    return () => { active = false }
  }, [supabase, saleId, attempt])

  const receipt = useMemo(() => state.sale ? buildReceipt({ sale: state.sale, storeName }) : null, [state.sale, storeName])
  const { share, print, shareMessage, printRoot } = useReceiptActions(receipt ?? { number: '', lines: [], storeName: '' })

  return <MockSalesSheet title={receiptNumber(saleId)} subtitle={state.sale ? `Sold by ${state.sale.seller.name}` : 'Receipt'} onClose={onClose}
    footer={receipt && <div className="mock-pos-receipt-secondary">
      <button type="button" onClick={share}>Share on WhatsApp</button>
      <button type="button" onClick={print}>Print / PDF</button>
    </div>}>
    {state.kind === 'loading' && <div className="mock-pos-empty" role="status"><span className="mock-pos-spinner" /><p>Loading receipt…</p></div>}
    {state.kind === 'error' && <div className="mock-pos-empty" role="alert"><strong>Receipt could not load</strong><p>{state.message}</p>
      <button type="button" onClick={() => { setState({ kind: 'loading', sale: null, message: '' }); setAttempt((value) => value + 1) }}>Try again</button></div>}
    {state.sale && <>
      <ReturnsNote sale={state.sale} currency={state.sale.currency || currency} />
      <ReceiptView receipt={receipt} />
      {shareMessage && <p className="mock-pos-error" role="alert">{shareMessage}</p>}
      <PrintCopy receipt={receipt} printRoot={printRoot} />
    </>}
  </MockSalesSheet>
}

export function SalesHistory({ supabase, role = 'OWNER', currency = 'USD', storeName = '' }) {
  const [range, setRange] = useState('today')
  const [status, setStatus] = useState('all')
  const [customFrom, setCustomFrom] = useState(() => dateInputValue())
  const [customTo, setCustomTo] = useState(() => dateInputValue())
  const [refresh, setRefresh] = useState(0)
  const [openId, setOpenId] = useState(null)
  const built = historyQuery({ range, status, customFrom, customTo })
  const queryKey = built.ok ? JSON.stringify(built.query) : null

  return <div className="mock-pos-page mock-history-page">
    <div className="mock-pos-shell">
      <header className="mock-pos-header"><h1>Sales history</h1>
        <button type="button" className="mock-pos-today" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      </header>
      <Chips label="Period" items={HISTORY_RANGES} value={range} onChange={setRange} />
      {range === 'custom' && <div className="mock-history-dates">
        <label>From<input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label>
        <label>To<input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label>
      </div>}
      <Chips label="Status" items={HISTORY_STATUSES} value={status} onChange={setStatus} />
      {built.ok
        ? <HistoryResults key={`${queryKey}|${refresh}`} supabase={supabase} queryKey={queryKey} role={role} currency={currency}
          withDay={range === 'week' || range === 'custom'} onOpen={setOpenId} />
        : <p className="mock-pos-error" role="alert">{built.message}</p>}
    </div>
    {openId && <SaleDetailSheet key={openId} supabase={supabase} saleId={openId} currency={currency} storeName={storeName} onClose={() => setOpenId(null)} />}
  </div>
}
