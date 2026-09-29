import { useEffect, useState } from 'react'
import { dashboardQuickActions, loadDashboardCatalog, loadDashboardFinance, loadDashboardRecentSales } from '../../features/dashboard/dashboard-flow.js'
import { createLatestRequestGuard, isZeroReport, localBusinessDate } from '../../features/finance/finance-flow.js'
import { ROUTES } from '../../app/routes.js'
import { ErrorState, LoadingSpinner, PageHeader } from '../../components/ui/index.jsx'
import { formatSignedMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function DashboardLink({ children, className, navigate, path }) {
  return <a className={className} href={path} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(path)
  }}>{children}</a>
}

function SectionLoading({ label }) {
  return <div className="dashboard-section-state" aria-live="polite"><LoadingSpinner label={label} /><span>{label}</span></div>
}

function OwnerFinance({ state, onRetry }) {
  if (state.kind === 'loading') return <section className="dashboard-finance" aria-label="Today's financial performance"><SectionLoading label="Loading today’s financial performance" /></section>
  if (state.kind === 'error') return <section className="dashboard-finance"><ErrorState title="Financial overview unavailable" description={state.message} action={<button type="button" onClick={onRetry}>Try again</button>} /></section>
  const report = state.report
  const negative = (value) => typeof value === 'string' && value.startsWith('-') && value !== '-0.00'
  return <section className="dashboard-finance" aria-labelledby="dashboard-finance-title">
    <div className="dashboard-section-heading"><div><span className="eyebrow">Today · {report.reportDate}</span><h2 id="dashboard-finance-title">Business performance</h2></div><span className="dashboard-source-label">Live report</span></div>
    {report.costStatus === 'INCOMPLETE' && <p className="dashboard-zero" role="status">Cost data incomplete. Revenue is available; final COGS and profit are unavailable.</p>}
    {isZeroReport(report) && <p className="dashboard-zero">No financial activity has been recorded today yet.</p>}
    <dl className="dashboard-kpis">
      <div className="is-primary"><dt>Net profit</dt><dd className={negative(report.netProfit) ? 'is-negative' : ''}>{formatSignedMoney(report.netProfit, report.currency)}</dd><small>After operating expenses</small></div>
      <div><dt>Net revenue</dt><dd className={negative(report.netRevenue) ? 'is-negative' : ''}>{formatSignedMoney(report.netRevenue, report.currency)}</dd><small>After returns and voids</small></div>
      <div><dt>Operating expenses</dt><dd>{formatSignedMoney(report.operatingExpenses, report.currency)}</dd><small>Expenses dated today</small></div>
      <div><dt>Sales created</dt><dd>{report.salesCount}</dd><small>{report.totalUnitsSold} gross unit{report.totalUnitsSold === 1 ? '' : 's'}</small></div>
    </dl>
  </section>
}

function QuickActions({ actions, navigate }) {
  return <section className="dashboard-actions" aria-labelledby="dashboard-actions-title"><div className="dashboard-section-heading"><div><span className="eyebrow">Shortcuts</span><h2 id="dashboard-actions-title">Move quickly</h2></div></div><div>{actions.map((action) => <DashboardLink key={action.path} className={`dashboard-action ${action.primary ? 'is-primary' : ''}`} navigate={navigate} path={action.path}><strong>{action.label}</strong><span>{action.description}</span><span aria-hidden="true">→</span></DashboardLink>)}</div></section>
}

function RecentSales({ navigate, role, state, onRetry }) {
  return <section className="dashboard-panel dashboard-sales" aria-labelledby="dashboard-sales-title">
    <div className="dashboard-section-heading"><div><span className="eyebrow">Latest activity</span><h2 id="dashboard-sales-title">Recent Sales</h2></div><DashboardLink className="dashboard-text-link" navigate={navigate} path={ROUTES.sales}>View Sales</DashboardLink></div>
    {state.kind === 'loading' && <SectionLoading label="Loading recent Sales" />}
    {state.kind === 'error' && <ErrorState title="Recent Sales unavailable" description={state.message} action={<button type="button" onClick={onRetry}>Try again</button>} />}
    {state.kind === 'ready' && state.sales.length === 0 && <div className="dashboard-empty"><strong>No Sales yet</strong><p>Completed Sales will appear here. Start when the store is ready.</p><DashboardLink className="dashboard-text-link" navigate={navigate} path={ROUTES.sales}>Create the first Sale</DashboardLink></div>}
    {state.kind === 'ready' && state.sales.length > 0 && <div className="dashboard-sales-list">{state.sales.map((sale) => <article key={sale.id}>
      <div><strong>Sale {sale.id.slice(0, 8)}</strong><time dateTime={sale.createdAt}>{new Date(sale.createdAt).toLocaleString()}</time></div>
      <div><span>{sale.totalUnits} unit{sale.totalUnits === 1 ? '' : 's'} · {sale.itemCount} line{sale.itemCount === 1 ? '' : 's'}</span><small>{sale.seller.name}</small></div>
      {role === 'OWNER' && <strong className="dashboard-sale-total">{formatSignedMoney(sale.totalAmount, sale.currency)}</strong>}
      <span className={`dashboard-sale-status ${sale.status === 'VOIDED' ? 'is-voided' : ''}`}>{sale.status === 'VOIDED' ? 'Voided' : 'Completed'}</span>
    </article>)}</div>}
  </section>
}

function StockOverview({ navigate, state, onRetry }) {
  return <section className="dashboard-panel dashboard-stock" aria-labelledby="dashboard-stock-title">
    <div className="dashboard-section-heading"><div><span className="eyebrow">Operational snapshot</span><h2 id="dashboard-stock-title">Stock overview</h2></div><DashboardLink className="dashboard-text-link" navigate={navigate} path={ROUTES.inventory}>View Inventory</DashboardLink></div>
    {state.kind === 'loading' && <SectionLoading label="Loading stock overview" />}
    {state.kind === 'error' && <ErrorState title="Stock overview unavailable" description={state.message} action={<button type="button" onClick={onRetry}>Try again</button>} />}
    {state.kind === 'ready' && state.summary.activeProducts === 0 && <div className="dashboard-empty"><strong>No active Products</strong><p>Add a Product and its variants to begin tracking stock.</p><DashboardLink className="dashboard-text-link" navigate={navigate} path={ROUTES.products}>Open Products</DashboardLink></div>}
    {state.kind === 'ready' && state.summary.activeProducts > 0 && <>
      <dl className="dashboard-stock-counts"><div><dt>Active Products</dt><dd>{state.summary.activeProducts}</dd><small>Entire active catalog</small></div><div><dt>Active variants</dt><dd>{state.summary.activeVariants}</dd><small>Newest {state.summary.sampledProducts} Products</small></div><div><dt>Units on hand</dt><dd>{state.summary.unitsOnHand}</dd><small>Newest {state.summary.sampledProducts} Products</small></div></dl>
      <div className="dashboard-stock-signals"><div><h3>Out of stock</h3><span>Newest catalog page</span></div>{state.summary.outOfStock.length === 0 ? <p className="dashboard-all-stocked">No active out-of-stock variants in this bounded view.</p> : <ul>{state.summary.outOfStock.map((item) => <li key={item.variantId}><div><strong>{item.productName}</strong><span>{item.sku} · {item.details}</span></div><span>0 units</span></li>)}</ul>}</div>
    </>}
  </section>
}

export function DashboardPage({ profile, navigate }) {
  const role = profile.user.role
  const date = localBusinessDate()
  const [finance, setFinance] = useState(() => ({ kind: role === 'OWNER' ? 'loading' : 'hidden' }))
  const [catalog, setCatalog] = useState({ kind: 'loading' })
  const [sales, setSales] = useState({ kind: 'loading' })
  const [version, setVersion] = useState(0)
  const [guard] = useState(() => createLatestRequestGuard())

  useEffect(() => {
    let active = true
    const request = guard.begin()
    const current = () => active && guard.isCurrent(request)
    void loadDashboardCatalog({ supabase }).then((result) => {
      if (!current() || redirectIfNeeded(result)) return
      setCatalog(result.ok ? { kind: 'ready', summary: result.summary } : { kind: 'error', message: result.message })
    })
    void loadDashboardRecentSales({ supabase, role }).then((result) => {
      if (!current() || redirectIfNeeded(result)) return
      setSales(result.ok ? { kind: 'ready', sales: result.sales } : { kind: 'error', message: result.message })
    })
    if (role === 'OWNER') void loadDashboardFinance({ supabase, role, date, currency: profile.account.baseCurrency }).then((result) => {
      if (!current() || redirectIfNeeded(result)) return
      setFinance(result.ok ? { kind: 'ready', report: result.report } : { kind: 'error', message: result.message })
    })
    return () => { active = false; guard.invalidate() }
  }, [date, guard, profile.account.baseCurrency, role, version])

  function refresh() {
    guard.invalidate()
    setCatalog({ kind: 'loading' })
    setSales({ kind: 'loading' })
    if (role === 'OWNER') setFinance({ kind: 'loading' })
    setVersion((value) => value + 1)
  }

  return <section className={`business-page dashboard-page ${role === 'WAREHOUSE' ? 'is-warehouse' : ''}`}>
    <PageHeader eyebrow="Store overview" title={`Good day, ${profile.user.firstName}`} description={`${profile.account.name} · ${date} business view`} actions={<button type="button" className="secondary-action dashboard-refresh" onClick={refresh}>Refresh overview</button>} />
    {role === 'OWNER' && <OwnerFinance state={finance} onRetry={refresh} />}
    <QuickActions actions={dashboardQuickActions(role)} navigate={navigate} />
    <div className="dashboard-operations"><RecentSales navigate={navigate} role={role} state={sales} onRetry={refresh} /><StockOverview navigate={navigate} state={catalog} onRetry={refresh} /></div>
  </section>
}
