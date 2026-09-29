import { useEffect, useState } from 'react'
import { canAccessFinance, createLatestRequestGuard, isZeroReport, loadDailyReport, loadSummaryReport, localBusinessDate, validateBusinessDateRange } from '../../app/finance-flow.js'
import { ErrorState, LoadingState, PageHeader } from '../../components/ui/index.jsx'
import { formatSignedMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'

const revenueRows = Object.freeze([['Gross revenue', 'grossRevenue'], ['Returns', 'returnedRevenue'], ['Voids', 'voidedRevenue'], ['Net revenue', 'netRevenue']])
const cogsRows = Object.freeze([['Gross COGS', 'grossCOGS'], ['Returned COGS', 'returnedCOGS'], ['Voided COGS', 'voidedCOGS'], ['Net COGS', 'netCOGS']])

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function MoneyBreakdown({ title, rows, report }) {
  return <section className="finance-breakdown"><h3>{title}</h3><dl>{rows.map(([label, field]) => <div key={field}><dt>{label}</dt><dd>{formatSignedMoney(report[field], report.currency)}</dd></div>)}</dl></section>
}

function FinancialReport({ report, mode }) {
  return <div className="report-results">
    {report.costStatus === 'INCOMPLETE' && <p className="report-zero-state" role="status"><strong>Cost data incomplete.</strong> Revenue is available. Final COGS and profit are unavailable because some historical purchase costs are unknown.</p>}
    <header className="report-period"><div><span className="eyebrow">Authoritative report</span><h2>{mode === 'daily' ? report.reportDate : `${report.from} to ${report.to}`}</h2></div>{mode === 'summary' && <span>{report.daysCount} inclusive day{report.daysCount === 1 ? '' : 's'}</span>}</header>
    {isZeroReport(report) && <p className="report-zero-state">No financial activity was recorded for this period. All authoritative totals are zero.</p>}
    <div className="report-kpis">
      <article className="is-primary"><span>Net profit</span><strong>{formatSignedMoney(report.netProfit, report.currency)}</strong><small>After operating expenses</small></article>
      <article><span>Net revenue</span><strong>{formatSignedMoney(report.netRevenue, report.currency)}</strong><small>Gross less returns and voids</small></article>
      <article><span>Operating expenses</span><strong>{formatSignedMoney(report.operatingExpenses, report.currency)}</strong><small>Expense aggregate</small></article>
      <article><span>Gross profit</span><strong>{formatSignedMoney(report.grossProfit, report.currency)}</strong><small>Net revenue less net COGS</small></article>
    </div>
    <div className="report-breakdowns"><MoneyBreakdown title="Revenue" rows={revenueRows} report={report} /><MoneyBreakdown title="Cost of goods sold" rows={cogsRows} report={report} /></div>
    <div className="report-supporting">
      <section><h3>Gross activity</h3><dl><div><dt>Sales created</dt><dd>{report.salesCount}</dd></div><div><dt>Units sold</dt><dd>{report.totalUnitsSold}</dd></div></dl><p>Returns and voids do not rewrite these historical gross counts.</p></section>
      <section><h3>Stock valuation</h3><strong>{report.stockValue === null ? 'Not available' : formatSignedMoney(report.stockValue, report.currency)}</strong><p>Stock valuation is not part of the current authoritative report contract.</p></section>
    </div>
  </div>
}

export function ReportsPage({ profile }) {
  const role = profile?.user?.role
  const today = localBusinessDate()
  const [mode, setMode] = useState('daily')
  const [dailyDate, setDailyDate] = useState(today)
  const [range, setRange] = useState({ from: today, to: today })
  const [state, setState] = useState(() => ({ kind: canAccessFinance(role) ? 'loading' : 'idle' }))
  const [guard] = useState(() => createLatestRequestGuard())

  async function runDaily(date = dailyDate) {
    const request = guard.begin()
    setState({ kind: 'loading' })
    const result = await loadDailyReport({ supabase, date })
    if (!guard.isCurrent(request) || redirectIfNeeded(result)) return
    setState(result.ok ? { kind: 'ready', report: result.report, mode: 'daily' } : { kind: 'error', message: result.message })
  }

  async function runSummary(event) {
    event?.preventDefault()
    const request = guard.begin()
    const validation = validateBusinessDateRange(range.from, range.to)
    if (!validation.ok) { setState({ kind: 'error', message: validation.message }); return }
    setState({ kind: 'loading' })
    const result = await loadSummaryReport({ supabase, ...range })
    if (!guard.isCurrent(request) || redirectIfNeeded(result)) return
    setState(result.ok ? { kind: 'ready', report: result.report, mode: 'summary' } : { kind: 'error', message: result.message })
  }

  useEffect(() => {
    if (!canAccessFinance(role)) return undefined
    let active = true
    const request = guard.begin()
    void loadDailyReport({ supabase, date: today }).then((result) => {
      if (!active || !guard.isCurrent(request) || redirectIfNeeded(result)) return
      setState(result.ok ? { kind: 'ready', report: result.report, mode: 'daily' } : { kind: 'error', message: result.message })
    })
    return () => { active = false; guard.invalidate() }
  }, [guard, role, today])

  if (!canAccessFinance(role)) return <section className="business-page"><ErrorState title="Owner access required" description="Reports contain private financial information and are available only to the store owner." /></section>

  function switchMode(next) {
    guard.invalidate()
    setMode(next)
    setState({ kind: 'idle' })
  }

  return <section className="business-page finance-page reports-page">
    <PageHeader eyebrow="Owner insights" title="Financial reports" description="Review backend-calculated revenue, costs, expenses, and profit without client-side recomputation." />
    <div className="report-tabs" role="tablist" aria-label="Report type">
      <button type="button" role="tab" aria-selected={mode === 'daily'} className={mode === 'daily' ? 'is-active' : ''} onClick={() => switchMode('daily')}>Daily report</button>
      <button type="button" role="tab" aria-selected={mode === 'summary'} className={mode === 'summary' ? 'is-active' : ''} onClick={() => switchMode('summary')}>Summary report</button>
    </div>
    {mode === 'daily' ? <form className="finance-card report-controls" onSubmit={(event) => { event.preventDefault(); void runDaily() }}>
      <div><h2>Choose a business date</h2><p>Dates remain exact calendar dates with no timezone conversion.</p></div>
      <label htmlFor="report-date">Report date<input id="report-date" required type="date" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)} /></label>
      <button type="submit" disabled={state.kind === 'loading'}>View daily report</button>
    </form> : <form className="finance-card report-controls is-summary" onSubmit={runSummary}>
      <div><h2>Choose an inclusive range</h2><p>Summary ranges may include up to 366 calendar days.</p></div>
      <label htmlFor="report-from">From<input id="report-from" required type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
      <label htmlFor="report-to">To<input id="report-to" required type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
      <button type="submit" disabled={state.kind === 'loading'}>View summary</button>
    </form>}
    <div className="report-content" aria-live="polite">
      {state.kind === 'idle' && <div className="finance-empty"><h2>Choose report dates</h2><p>Submit the date controls to load authoritative totals.</p></div>}
      {state.kind === 'loading' && <LoadingState label="Calculating financial report" />}
      {state.kind === 'error' && <ErrorState title="Report unavailable" description={state.message} />}
      {state.kind === 'ready' && <FinancialReport report={state.report} mode={state.mode} />}
    </div>
  </section>
}
