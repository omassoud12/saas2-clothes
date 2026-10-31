import { useEffect, useState } from 'react'
import { canAccessFinance, createLatestRequestGuard, isZeroReport, loadDailyReport, loadSummaryReport, localBusinessDate, validateBusinessDateRange } from '../../features/finance/finance-flow.js'
import { ErrorState, LoadingState, PageHeader } from '../../components/ui/index.jsx'
import { formatSignedMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'
import { useI18n } from '../../i18n/I18nContext.js'

const revenueRows = Object.freeze([['Gross revenue', 'grossRevenue'], ['Returns', 'returnedRevenue'], ['Voids', 'voidedRevenue'], ['Net revenue', 'netRevenue']])
const cogsRows = Object.freeze([['Gross COGS', 'grossCOGS'], ['Returned COGS', 'returnedCOGS'], ['Voided COGS', 'voidedCOGS'], ['Net COGS', 'netCOGS']])

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function MoneyBreakdown({ title, rows, report }) {
  const { t } = useI18n()
  return <section className="finance-breakdown"><h3>{t(title)}</h3><dl>{rows.map(([label, field]) => <div key={field}><dt>{t(label)}</dt><dd>{formatSignedMoney(report[field], report.currency)}</dd></div>)}</dl></section>
}

function FinancialReport({ report, mode }) {
  const { t } = useI18n()
  return <div className="report-results">
    {report.costStatus === 'INCOMPLETE' && <p className="report-zero-state" role="status"><strong>{t('Cost data incomplete.')}</strong> {t('Revenue is available. Final COGS and profit are unavailable because some historical purchase costs are unknown.')}</p>}
    <header className="report-period"><div><span className="eyebrow">{t('Authoritative report')}</span><h2>{mode === 'daily' ? report.reportDate : t('{from} to {to}', { from: report.from, to: report.to })}</h2></div>{mode === 'summary' && <span>{t('{daysCount} inclusive day', { daysCount: report.daysCount })}{report.daysCount === 1 ? '' : 's'}</span>}</header>
    {isZeroReport(report) && <p className="report-zero-state">{t('No financial activity was recorded for this period. All authoritative totals are zero.')}</p>}
    <div className="report-kpis">
      <article className="is-primary"><span>{t('Net profit')}</span><strong>{formatSignedMoney(report.netProfit, report.currency)}</strong><small>{t('After operating expenses')}</small></article>
      <article><span>{t('Net revenue')}</span><strong>{formatSignedMoney(report.netRevenue, report.currency)}</strong><small>{t('Gross less returns and voids')}</small></article>
      <article><span>{t('Operating expenses')}</span><strong>{formatSignedMoney(report.operatingExpenses, report.currency)}</strong><small>{t('Expense aggregate')}</small></article>
      <article><span>{t('Gross profit')}</span><strong>{formatSignedMoney(report.grossProfit, report.currency)}</strong><small>{t('Net revenue less net COGS')}</small></article>
    </div>
    <div className="report-breakdowns"><MoneyBreakdown title={t('Revenue')} rows={revenueRows} report={report} /><MoneyBreakdown title={t('Cost of goods sold')} rows={cogsRows} report={report} /></div>
    <div className="report-supporting">
      <section><h3>{t('Gross activity')}</h3><dl><div><dt>{t('Sales created')}</dt><dd>{report.salesCount}</dd></div><div><dt>{t('Units sold')}</dt><dd>{report.totalUnitsSold}</dd></div></dl><p>{t('Returns and voids do not rewrite these historical gross counts.')}</p></section>
      <section><h3>{t('Stock valuation')}</h3><strong>{report.stockValue === null ? t('Not available') : formatSignedMoney(report.stockValue, report.currency)}</strong><p>{t('Stock valuation is not part of the current authoritative report contract.')}</p></section>
    </div>
  </div>
}

export function ReportsPage({ profile }) {
  const { t } = useI18n()
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

  if (!canAccessFinance(role)) return <section className="business-page"><ErrorState title={t('Owner access required')} description={t('Reports contain private financial information and are available only to the store owner.')} /></section>

  function switchMode(next) {
    guard.invalidate()
    setMode(next)
    setState({ kind: 'idle' })
  }

  return <section className="business-page finance-page reports-page">
    <PageHeader eyebrow={t('Owner insights')} title={t('Financial reports')} description={t('Review backend-calculated revenue, costs, expenses, and profit without client-side recomputation.')} />
    <div className="report-tabs" role="tablist" aria-label={t('Report type')}>
      <button type="button" role="tab" aria-selected={mode === 'daily'} className={mode === 'daily' ? 'is-active' : ''} onClick={() => switchMode('daily')}>{t('Daily report')}</button>
      <button type="button" role="tab" aria-selected={mode === 'summary'} className={mode === 'summary' ? 'is-active' : ''} onClick={() => switchMode('summary')}>{t('Summary report')}</button>
    </div>
    {mode === 'daily' ? <form className="finance-card report-controls" onSubmit={(event) => { event.preventDefault(); void runDaily() }}>
      <div><h2>{t('Choose a business date')}</h2><p>{t('Dates remain exact calendar dates with no timezone conversion.')}</p></div>
      <label htmlFor="report-date">{t('Report date')}<input id="report-date" required type="date" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)} /></label>
      <button type="submit" disabled={state.kind === 'loading'}>{t('View daily report')}</button>
    </form> : <form className="finance-card report-controls is-summary" onSubmit={runSummary}>
      <div><h2>{t('Choose an inclusive range')}</h2><p>{t('Summary ranges may include up to 366 calendar days.')}</p></div>
      <label htmlFor="report-from">{t('From')}<input id="report-from" required type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
      <label htmlFor="report-to">{t('To')}<input id="report-to" required type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
      <button type="submit" disabled={state.kind === 'loading'}>{t('View summary')}</button>
    </form>}
    <div className="report-content" aria-live="polite">
      {state.kind === 'idle' && <div className="finance-empty"><h2>{t('Choose report dates')}</h2><p>{t('Submit the date controls to load authoritative totals.')}</p></div>}
      {state.kind === 'loading' && <LoadingState label={t('Calculating financial report')} />}
      {state.kind === 'error' && <ErrorState title={t('Report unavailable')} description={t(state.message)} />}
      {state.kind === 'ready' && <FinancialReport report={state.report} mode={state.mode} />}
    </div>
  </section>
}
