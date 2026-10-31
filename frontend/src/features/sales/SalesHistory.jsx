import { useEffect, useMemo, useState } from 'react'
import { formatMoneyCompact } from '../../lib/money.js'
import { loadSaleHistory, markSalePaid } from './sale-flow.js'
import { loadSaleDetail } from './sale-lifecycle-flow.js'
import { receiptLabel, summarizeSales } from './pos-checkout.js'
import { buildReceipt } from './pos-receipt.js'
import { dateInputValue, HISTORY_PAGE_SIZE, HISTORY_PAYMENTS, HISTORY_RANGES, HISTORY_STATUSES, historyQuery, saleBadges, saleTimeText } from './history-flow.js'
import { PrintCopy, ReceiptView } from './SaleReceipt.jsx'
import { useReceiptActions } from './use-receipt-actions.js'
import { MockSalesSheet } from './MockSalesSheet.jsx'
import { plural } from './mock-sales-model.js'
import './mock-sales.css'
import { useI18n } from '../../i18n/I18nContext.js'

function goToLogin() { window.location.replace('/login') }

function Chips({ label, items, value, onChange }) {
  const { t } = useI18n()
  return <nav className="mock-pos-chips" aria-label={t(label)}>
    {items.map((item) => <button key={item.id} type="button" aria-pressed={value === item.id} onClick={() => onChange(item.id)}>{t(item.label)}</button>)}
  </nav>
}

export function SaleRow({ sale, role, currency, withDay, onOpen }) {
  const { t, locale } = useI18n()
  const badges = saleBadges(sale)
  const owner = role === 'OWNER'
  const money = (amount) => formatMoneyCompact(amount, sale.currency || currency)
  return <button type="button" className="mock-history-row" onClick={() => onOpen(sale.id)}
    aria-label={t('Open receipt {receiptLabel}', { receiptLabel: receiptLabel(sale) })}>
    <span className="mock-history-main">
      <strong>{receiptLabel(sale)}</strong>
      <span>{plural(sale.totalUnits, 'item', t)} · {saleTimeText(sale.createdAt, { withDay, locale })}</span>
      {sale.customerName && <span>{sale.customerName}</span>}
      {owner && sale.seller?.name && <span>{sale.seller.name}</span>}
      {badges.length > 0 && <span className="mock-history-badges">{badges.map((badge) => <small key={badge.text} className={`mock-history-badge ${badge.tone}`}>{t(badge.text)}</small>)}</span>}
    </span>
    {owner && <span className="mock-history-amount">
      <strong className={sale.status === 'VOIDED' ? 'is-struck' : ''}>{money(sale.totalAmount)}</strong>
      {sale.hasReturns === true && <small>−{money(sale.totalReturnedAmount)}</small>}
    </span>}
  </button>
}

function HistoryResults({ supabase, queryKey, role, currency, withDay, onOpen }) {
  const { t } = useI18n()
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

  if (state.kind === 'loading') return <div className="mock-pos-empty" role="status"><span className="mock-pos-spinner" /><p>{t('Loading sales…')}</p></div>
  if (state.kind === 'error') return <div className="mock-pos-empty" role="alert"><strong>{t('Sales could not load')}</strong><p>{t(state.message)}</p>
    <button type="button" onClick={retry}>{t('Try again')}</button></div>

  // A total is shown only when every sale of the period is on screen; otherwise it would be a partial figure.
  const complete = !state.nextCursor
  const summary = summarizeSales(state.sales, currency)
  const headline = !state.sales.length ? 'No sales'
    : complete ? (role === 'OWNER' ? `${plural(summary.count, 'sale', t)} · ${summary.total}` : plural(summary.count, 'sale', t))
      : `${state.sales.length} loaded`
  return <section aria-label={t('Sales')}>
    <div className="mock-pos-list-heading"><h2>{t('Sales')}</h2><span>{headline}</span></div>
    {!state.sales.length && <div className="mock-pos-empty"><strong>{t('No sales found')}</strong><p>{t('Try another period or status.')}</p></div>}
    <div className="mock-history-list">{state.sales.map((sale) => <SaleRow key={sale.id} sale={sale} role={role} currency={currency} withDay={withDay} onOpen={onOpen} />)}</div>
    {state.moreError && <p className="mock-pos-error" role="alert">{state.moreError}</p>}
    {state.nextCursor && <button type="button" className="mock-history-more" disabled={state.loadingMore} aria-busy={state.loadingMore} onClick={loadMore}>
      {state.loadingMore ? t('Loading…') : t('Load more')}</button>}
  </section>
}

function DebtNote({ sale }) {
  const { t, locale } = useI18n()
  const commercial = sale.commercial
  if (commercial?.paymentMethod !== 'DEBT') return null
  return <p className={`mock-history-status ${commercial.paidAt ? 'is-paid' : 'is-debt'}`}>
    <strong>{commercial.paidAt ? t('Debt paid') : t('Unpaid debt')}</strong>
    {commercial.customer && <span>{commercial.customer.name}{commercial.customer.phone ? ` · ${commercial.customer.phone}` : ''}</span>}
    {commercial.paidAt && <span>{saleTimeText(commercial.paidAt, { withDay: true, locale })}{commercial.paidBy ? ` · ${commercial.paidBy.name}` : ''}</span>}
  </p>
}

function ReturnsNote({ sale, currency }) {
  const { t, locale } = useI18n()
  const { returnSummary, status } = sale
  if (status === 'VOIDED' && sale.void) {
    return <p className="mock-history-status is-void"><strong>{t('Voided')}</strong>
      <span>{saleTimeText(sale.void.voidedAt, { withDay: true, locale })} · {sale.void.voidedByName}</span>
      <span>{t('Reason: {voidReason}', { voidReason: sale.void.voidReason })}</span></p>
  }
  if (!returnSummary.hasReturns) return null
  return <p className="mock-history-status is-returned"><strong>{t('Returned')}</strong>
    <span>{t('{plural} · refund {formatMoneyCompact}', { plural: plural(returnSummary.totalReturnedUnits, 'item', t), formatMoneyCompact: formatMoneyCompact(returnSummary.totalReturnedAmount, currency) })}</span></p>
}

function SaleDetailSheet({ supabase, saleId, role, currency, storeName, onChanged, onClose }) {
  const { t, locale } = useI18n()
  const [state, setState] = useState({ kind: 'loading', sale: null, message: '' })
  const [attempt, setAttempt] = useState(0)
  const [paying, setPaying] = useState({ step: 'idle', message: '' })
  useEffect(() => {
    let active = true
    void loadSaleDetail({ supabase, saleId }).then((result) => {
      if (!active) return
      if (result.requiresLogin) { goToLogin(); return }
      setState(result.ok ? { kind: 'ready', sale: result.sale, message: '' } : { kind: 'error', sale: null, message: result.message })
    })
    return () => { active = false }
  }, [supabase, saleId, attempt])

  const receipt = useMemo(() => state.sale ? buildReceipt({ sale: state.sale, storeName, t, locale }) : null, [state.sale, storeName, t, locale])
  const { share, print, shareMessage, printRoot } = useReceiptActions(receipt ?? { number: '', lines: [], storeName: '' })

  const canMarkPaid = role === 'OWNER' && state.sale?.status === 'COMPLETED' && state.sale.commercial?.paymentMethod === 'DEBT' && !state.sale.commercial.paidAt

  async function confirmPaid() {
    setPaying({ step: 'saving', message: '' })
    const result = await markSalePaid({ supabase, saleId })
    if (result.requiresLogin) { goToLogin(); return }
    if (!result.ok) { setPaying({ step: 'confirm', message: result.message }); return }
    setPaying({ step: 'idle', message: '' })
    setAttempt((value) => value + 1)
    onChanged()
  }

  return <MockSalesSheet title={state.sale ? receiptLabel(state.sale) : receiptLabel({ id: saleId })} subtitle={state.sale ? t('Sold by {name}', { name: state.sale.seller.name }) : t('Receipt')} onClose={onClose}
    footer={receipt && <div className="mock-pos-receipt-actions">
      {canMarkPaid && paying.step === 'idle' && <button type="button" className="mock-pos-primary" onClick={() => setPaying({ step: 'confirm', message: '' })}>{t('Mark debt as paid')}</button>}
      {canMarkPaid && paying.step !== 'idle' && <div className="mock-pos-delete-confirm" role="alert">
        <p>{t('Mark this debt')}{state.sale.commercial.customer ? t(' from {name}', { name: state.sale.commercial.customer.name }) : ''} {t('as paid? {total} was received.', { total: receipt.total })}</p>
        {paying.message && <p>{t(paying.message)}</p>}
        <div><button type="button" className="is-danger" disabled={paying.step === 'saving'} aria-busy={paying.step === 'saving'} onClick={confirmPaid}>
          {paying.step === 'saving' ? t('Saving…') : t('Yes, it was paid')}</button>
          <button type="button" disabled={paying.step === 'saving'} onClick={() => setPaying({ step: 'idle', message: '' })}>{t('Not yet')}</button></div>
      </div>}
      <div className="mock-pos-receipt-secondary">
        <button type="button" onClick={share}>{t('Share on WhatsApp')}</button>
        <button type="button" onClick={print}>{t('Print / PDF')}</button>
      </div>
    </div>}>
    {state.kind === 'loading' && <div className="mock-pos-empty" role="status"><span className="mock-pos-spinner" /><p>{t('Loading receipt…')}</p></div>}
    {state.kind === 'error' && <div className="mock-pos-empty" role="alert"><strong>{t('Receipt could not load')}</strong><p>{t(state.message)}</p>
      <button type="button" onClick={() => { setState({ kind: 'loading', sale: null, message: '' }); setAttempt((value) => value + 1) }}>{t('Try again')}</button></div>}
    {state.sale && <>
      <DebtNote sale={state.sale} />
      <ReturnsNote sale={state.sale} currency={state.sale.currency || currency} />
      <ReceiptView receipt={receipt} />
      {shareMessage && <p className="mock-pos-error" role="alert">{shareMessage}</p>}
      <PrintCopy receipt={receipt} printRoot={printRoot} />
    </>}
  </MockSalesSheet>
}

export function SalesHistory({ supabase, role = 'OWNER', currency = 'USD', storeName = '' }) {
  const { t } = useI18n()
  const [range, setRange] = useState('today')
  const [status, setStatus] = useState('all')
  const [payment, setPayment] = useState('all')
  const [customFrom, setCustomFrom] = useState(() => dateInputValue())
  const [customTo, setCustomTo] = useState(() => dateInputValue())
  const [refresh, setRefresh] = useState(0)
  const [openId, setOpenId] = useState(null)
  const built = historyQuery({ range, status, payment, customFrom, customTo })
  const queryKey = built.ok ? JSON.stringify(built.query) : null

  return <div className="mock-pos-page mock-history-page">
    <div className="mock-pos-shell">
      <header className="mock-pos-header"><h1>{t('Sales history')}</h1>
        <button type="button" className="mock-pos-today" onClick={() => setRefresh((value) => value + 1)}>{t('Refresh')}</button>
      </header>
      <Chips label={t('Period')} items={HISTORY_RANGES} value={range} onChange={setRange} />
      {range === 'custom' && <div className="mock-history-dates">
        <label>{t('From')}<input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label>
        <label>{t('To')}<input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label>
      </div>}
      <Chips label={t('Status')} items={HISTORY_STATUSES} value={status} onChange={setStatus} />
      <Chips label={t('Payment method')} items={HISTORY_PAYMENTS} value={payment} onChange={setPayment} />
      {built.ok
        ? <HistoryResults key={`${queryKey}|${refresh}`} supabase={supabase} queryKey={queryKey} role={role} currency={currency}
          withDay={range === 'week' || range === 'custom'} onOpen={setOpenId} />
        : <p className="mock-pos-error" role="alert">{t(built.message)}</p>}
    </div>
    {openId && <SaleDetailSheet key={openId} supabase={supabase} saleId={openId} role={role} currency={currency} storeName={storeName}
      onChanged={() => setRefresh((value) => value + 1)} onClose={() => setOpenId(null)} />}
  </div>
}
