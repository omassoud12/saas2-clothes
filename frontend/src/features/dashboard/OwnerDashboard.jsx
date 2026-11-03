import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ROUTES } from '../../app/routes.js'
import { useI18n } from '../../i18n/I18nContext.js'
import { formatLbp, formatUsd } from '../business/lib/money.js'
import {
  BEST_SELLER_PERIODS, asState, monthLabel, monthMoney, normalizeMoneyInput, rankProducts, targetBar,
} from './owner-dashboard.js'
import { loadBestSellers, loadStores, loadSummary, saveMonthTarget } from './owner-api.js'
import '../business/styles/business.css'
import './owner-dashboard.css'
import useAsync from '../business/hooks/useAsync.js'

// The Owner Dashboard (the account owner only; the API refuses everyone else). Mobile first: one column
// at 320px, two columns from 900px. Every number comes from /api/dashboard/* (the business day function).

const money = (value) => formatUsd(value === null || value === undefined ? null : Math.round(Number(value)))

function Link({ to, navigate, className, children, label }) {
  return (
    <a className={className} href={to} aria-label={label} onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate(to)
    }}>{children}</a>
  )
}

function Block({ height = 16, width = '100%' }) {
  return <span className="odash-skeleton" style={{ height, width }} aria-hidden="true" />
}

function Failure({ message, onRetry }) {
  const { t } = useI18n()
  return (
    <div className="odash-card odash-error" role="alert">
      <p>{t(message || 'Something went wrong. Try again.')}</p>
      <button type="button" className="odash-button odash-button--ghost" onClick={onRetry}>{t('Try again')}</button>
    </div>
  )
}

function TodayCard({ summary, navigate }) {
  const { t } = useI18n()
  const today = summary.today
  const change = today.vsYesterdaySameTime.changePercent
  const up = change !== null && Number(change) >= 0
  return (
    <Link to={ROUTES.business} navigate={navigate} className="odash-card odash-hero" label={t('Open today in Business reports')}>
      <span className="odash-hero__label">{t('Sales today')} · {summary.asOf}</span>
      <strong className="odash-hero__value">{money(today.salesTotal)}</strong>
      {summary.exchangeRate && <span className="odash-hero__sub">{formatLbp(Number(today.salesTotal), Number(summary.exchangeRate))}</span>}
      <span className={`odash-trend ${change === null ? '' : up ? 'is-up' : 'is-down'}`}>
        {change === null
          ? t('Yesterday by this time: {amount}', { amount: money(today.vsYesterdaySameTime.salesTotal) })
          : t('{arrow} {percent}% vs yesterday by this time', { arrow: up ? '↑' : '↓', percent: Math.abs(Number(change)).toFixed(0) })}
      </span>
      <span className="odash-hero__stats">
        <span><small>{t('Invoices')}</small><b>{today.invoiceCount}</b></span>
        <span><small>{t('Pieces')}</small><b>{today.piecesSold}</b></span>
        {today.profitTotal !== null && <span><small>{t('Gross profit')}</small><b>{money(today.profitTotal)}</b></span>}
      </span>
      {!today.costComplete && <span className="odash-hero__note">{t('Some items sold today have no cost: profit is not exact.')}</span>}
    </Link>
  )
}

function TargetCard({ summary, onEdit }) {
  const { t, locale } = useI18n()
  const month = summary.month
  const bar = targetBar(month.target, month.salesTotal)
  return (
    <section className="odash-card" aria-labelledby="odash-target-title">
      <div className="odash-row">
        <h2 id="odash-target-title" className="odash-title">{t('Monthly target')}</h2>
        <span className="odash-meta">{monthLabel(summary.currentMonth, locale)}</span>
      </div>
      {bar ? (
        <>
          <p className="odash-big"><b>{money(month.salesTotal)}</b> <span>/ {money(month.target.amount)}</span></p>
          <div className="odash-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, bar.percent)} aria-label={t('{percent}% of the target', { percent: bar.percent })}>
            <span className="odash-bar__fill" style={{ inlineSize: `${bar.fill}%` }} />
            {bar.pace < 100 && <span className="odash-bar__pace" style={{ insetInlineStart: `${bar.pace}%` }} title={t('Where you should be by tonight')} />}
          </div>
          <p className="odash-text">
            <b>{bar.percent}%</b>{' · '}
            {bar.percent >= 100 ? t('Target reached') : bar.gap >= 0
              ? t('{amount} ahead of pace', { amount: money(bar.gap) })
              : t('{amount} behind pace', { amount: money(-bar.gap) })}
          </p>
          <p className="odash-muted">{t('On pace for ~{amount} this month', { amount: money(month.projection) })}</p>
        </>
      ) : (
        <>
          <p className="odash-text">{t('No target for this month yet. A target shows if you are on pace every day.')}</p>
          <p className="odash-muted">{t('On pace for ~{amount} this month', { amount: money(month.projection) })}</p>
        </>
      )}
      <button type="button" className="odash-button odash-button--ghost" onClick={onEdit}>{bar ? t('Edit target') : t('Set a target')}</button>
    </section>
  )
}

function Alerts({ summary, navigate }) {
  const { t } = useI18n()
  const missing = summary.missingCost
  const invited = summary.employees?.invited ?? 0
  if (!missing.productCount && !invited) return null
  return (
    <section className="odash-alerts" aria-label={t('Needs your attention')}>
      {missing.productCount > 0 && (
        <Link to={ROUTES.dashboardCosts} navigate={navigate} className="odash-alert">
          <span className="odash-alert__icon" aria-hidden="true">!</span>
          <span className="odash-alert__body">
            <b>{t('{count} products have no cost', { count: missing.productCount })}</b>
            <small>{Number(missing.salesAffectedTotal) > 0
              ? t('{amount} sold without a cost in 30 days: profit is not exact', { amount: money(missing.salesAffectedTotal) })
              : t('Set their cost so your profit is right')}</small>
          </span>
          <span className="odash-alert__go">{t('Set cost')}</span>
        </Link>
      )}
      {invited > 0 && (
        <div className="odash-alert">
          <span className="odash-alert__icon" aria-hidden="true">✉</span>
          <span className="odash-alert__body"><b>{t('{count} invites pending', { count: invited })}</b></span>
        </div>
      )}
    </section>
  )
}

const PERIOD_LABELS = { today: 'Today', week: 'This week', month: 'This month' }
const MODES = [{ key: 'sales', label: 'Revenue' }, { key: 'quantity', label: 'Pieces' }, { key: 'profit', label: 'Profit' }]

function BestSellers({ storeId }) {
  const { t } = useI18n()
  const [period, setPeriod] = useState('today')
  const [mode, setMode] = useState('sales')
  const [open, setOpen] = useState(null)
  const [all, setAll] = useState(false)
  const result = useAsync((options) => loadBestSellers({ period, storeId }, options), [period, storeId])
  // A new period shows the skeleton instead of the previous period's list.
  const state = result.loading ? { kind: 'loading' } : asState(result)
  const setReload = result.reload

  const items = state.kind === 'ready' ? state.body.items : []
  const canProfit = items.some((item) => item.profitTotal !== null)
  const modes = MODES.filter((item) => item.key !== 'profit' || canProfit)
  const ranked = rankProducts(items, mode === 'profit' && !canProfit ? 'sales' : mode)
  const rows = all ? ranked : ranked.slice(0, 10)
  const value = (item) => mode === 'quantity' ? item.quantity : Number(mode === 'profit' ? item.profitTotal : item.salesTotal) || 0
  const max = Math.max(1, ...ranked.map(value))
  const show = (item) => mode === 'quantity' ? t('{count} pcs', { count: item.quantity }) : money(mode === 'profit' ? item.profitTotal : item.salesTotal)

  return (
    <section className="odash-card" aria-labelledby="odash-best-title">
      <h2 id="odash-best-title" className="odash-title">{t('Best sellers')}</h2>
      <div className="odash-segment" role="tablist" aria-label={t('Period')}>
        {BEST_SELLER_PERIODS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={period === key} className={period === key ? 'is-on' : ''} onClick={() => { setPeriod(key); setOpen(null); setAll(false) }}>{t(PERIOD_LABELS[key])}</button>
        ))}
      </div>
      <div className="odash-segment odash-segment--small" role="tablist" aria-label={t('Rank by')}>
        {modes.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={mode === item.key} className={mode === item.key ? 'is-on' : ''} onClick={() => setMode(item.key)}>{t(item.label)}</button>
        ))}
      </div>
      {state.kind === 'loading' && <div className="odash-stack" aria-busy="true">{[0, 1, 2].map((index) => <Block key={index} height={44} />)}</div>}
      {state.kind === 'error' && <Failure message={state.message} onRetry={setReload} />}
      {state.kind === 'ready' && rows.length === 0 && <p className="odash-muted">{t('Nothing sold in this period yet.')}</p>}
      {state.kind === 'ready' && rows.length > 0 && (
        <ol className="odash-top">
          {rows.map((item, index) => (
            <li key={item.id}>
              <button type="button" className="odash-top__row" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>
                <span className="odash-top__rank">{index + 1}</span>
                <span className="odash-top__main">
                  <span className="odash-top__line"><b>{item.name}</b><b className="odash-num">{show(item)}</b></span>
                  <span className="odash-top__bar"><span style={{ inlineSize: `${(value(item) / max) * 100}%` }} /></span>
                  <small>{t('{count} pcs', { count: item.quantity })} · {money(item.salesTotal)}{item.profitTotal !== null ? ` · ${t('profit {amount}', { amount: money(item.profitTotal) })}` : ''}</small>
                </span>
              </button>
              {open === item.id && (
                <ul className="odash-variants">
                  {item.variants.map((variant) => (
                    <li key={variant.id}><span>{variant.label}</span><span className="odash-num">{t('{count} pcs', { count: variant.quantity })} · {money(variant.salesTotal)}</span></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {state.kind === 'ready' && ranked.length > 10 && (
        <button type="button" className="odash-button odash-button--ghost" onClick={() => setAll(!all)}>{all ? t('Show less') : t('See all {count}', { count: ranked.length })}</button>
      )}
    </section>
  )
}

function MonthMoney({ summary, navigate }) {
  const { t } = useI18n()
  const numbers = monthMoney(summary.month)
  if (!numbers) return null
  const categories = (summary.expensesThisMonth?.byCategory || []).filter((row) => Number(row.amountTotal) > 0)
  return (
    <section className="odash-card" aria-labelledby="odash-money-title">
      <h2 id="odash-money-title" className="odash-title">{t('This month’s money')}</h2>
      <dl className="odash-money">
        <div><dt>{t('Sales')}</dt><dd className="odash-num">{money(numbers.sales)}</dd></div>
        <div><dt>{t('− Cost of goods')}</dt><dd className="odash-num">{money(numbers.cost)}</dd></div>
        <div className="is-sum"><dt>{t('= Gross profit')}</dt><dd className="odash-num">{money(numbers.profit)}</dd></div>
        <div><dt>{t('− Expenses so far')}</dt><dd className="odash-num">{money(numbers.expenses)}</dd></div>
        <div className={`is-total ${numbers.net < 0 ? 'is-negative' : ''}`}><dt>{t('= Net profit')}</dt><dd className="odash-num">{money(numbers.net)}</dd></div>
      </dl>
      <p className="odash-muted">{t('Monthly expenses count day by day, like in Business reports.')}</p>
      {categories.length > 0 && (
        <ul className="odash-categories" aria-label={t('Expenses entered this month')}>
          {categories.map((row) => <li key={row.category}><span>{t(row.label)}</span><span className="odash-num">{money(row.amountTotal)}</span></li>)}
        </ul>
      )}
      {!summary.month.costComplete && <p className="odash-muted">{t('Some sales have no cost: profit is not exact.')}</p>}
      <Link to={ROUTES.expenses} navigate={navigate} className="odash-button odash-button--ghost">{t('Add expense')}</Link>
    </section>
  )
}

function QuickActions({ navigate, onTarget }) {
  const { t } = useI18n()
  return (
    <section className="odash-actions" aria-label={t('Quick actions')}>
      <Link to={ROUTES.dashboardCosts} navigate={navigate} className="odash-action"><span aria-hidden="true">$</span>{t('Set product cost')}</Link>
      <Link to={ROUTES.expenses} navigate={navigate} className="odash-action"><span aria-hidden="true">−</span>{t('Add expense')}</Link>
      <button type="button" className="odash-action" onClick={onTarget}><span aria-hidden="true">◎</span>{t('Set target')}</button>
      <Link to={ROUTES.business} navigate={navigate} className="odash-action"><span aria-hidden="true">↗</span>{t('Business reports')}</Link>
    </section>
  )
}

function TargetSheet({ summary, storeId, onClose, onSaved }) {
  const { t, locale } = useI18n()
  const inputId = useId()
  const dialog = useRef(null)
  const current = summary.month.target?.amount
  const [amount, setAmount] = useState(current ? String(Math.round(Number(current))) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const suggested = summary.month.suggestedTarget

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal?.()
    const close = (event) => { event.preventDefault(); onClose() }
    node?.addEventListener('cancel', close)
    return () => node?.removeEventListener('cancel', close)
  }, [onClose])

  async function save(value) {
    setSaving(true)
    setError('')
    try {
      await saveMonthTarget({ month: summary.currentMonth, amount: value, storeId: storeId === 'all' ? null : storeId })
      onSaved(value === null ? t('Target removed') : t('Target saved'))
    } catch (failure) {
      setError(failure.message)
      setSaving(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    const value = normalizeMoneyInput(amount)
    if (!value) { setError(t('Enter an amount above 0.')); return }
    void save(value)
  }

  return (
    <dialog ref={dialog} className="odash-sheet" aria-labelledby={`${inputId}-title`}>
      <form className="odash-sheet__body" onSubmit={submit}>
        <div className="odash-sheet__handle" aria-hidden="true" />
        <h2 id={`${inputId}-title`} className="odash-title">{t('Target for {month}', { month: monthLabel(summary.currentMonth, locale) })}</h2>
        <label className="odash-field" htmlFor={inputId}>
          <span>{t('Sales target (USD)')}</span>
          <input id={inputId} inputMode="decimal" autoComplete="off" enterKeyHint="done" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="5000" />
        </label>
        {suggested && (
          <button type="button" className="odash-chip" onClick={() => setAmount(String(Math.round(Number(suggested))))}>
            {t('Use suggestion: {amount}', { amount: money(suggested) })}
          </button>
        )}
        {suggested && <p className="odash-muted">{t('Average of the last 3 months + 5%.')}</p>}
        {error && <p className="odash-form-error" role="alert">{t(error)}</p>}
        <div className="odash-sheet__actions">
          <button type="submit" className="odash-button" disabled={saving}>{saving ? t('Saving…') : t('Save target')}</button>
          {current && <button type="button" className="odash-button odash-button--ghost" disabled={saving} onClick={() => void save(null)}>{t('Remove target')}</button>}
          <button type="button" className="odash-button odash-button--ghost" disabled={saving} onClick={onClose}>{t('Cancel')}</button>
        </div>
      </form>
    </dialog>
  )
}

export function OwnerDashboard({ profile, navigate }) {
  const { t, dir } = useI18n()
  const [storeId, setStoreId] = useState('all')
  const [stores, setStores] = useState([])
  const [sheet, setSheet] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    loadStores({ signal: controller.signal }).then((body) => setStores(body.items || [])).catch(() => {})
    return () => controller.abort()
  }, [])

  const summaryResult = useAsync((options) => loadSummary(storeId, options), [storeId])
  const summary = asState(summaryResult)
  const reloadSummary = summaryResult.reload

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  const closeSheet = useCallback(() => setSheet(false), [])
  const saved = useCallback((message) => { setSheet(false); setToast(message); reloadSummary() }, [reloadSummary])
  const body = summary.kind === 'ready' ? summary.body : null

  return (
    <div className="biz odash" dir={dir}>
      <header className="odash-head">
        <div>
          <p className="odash-meta">{profile.account.name}{body ? ` · ${body.date}` : ''}</p>
          <h1 className="odash-hello">{t('Hi {name}', { name: profile.user.firstName })}</h1>
        </div>
        {stores.length > 1 && (
          <label className="odash-store">
            <span className="visually-hidden">{t('Store')}</span>
            <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              <option value="all">{t('All stores')}</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
        )}
      </header>

      {summary.kind === 'loading' && (
        <div className="odash-stack" aria-busy="true" aria-label={t('Loading the dashboard')}>
          <div className="odash-card odash-hero"><Block height={14} width="40%" /><Block height={40} width="60%" /><Block height={14} width="70%" /></div>
          <div className="odash-card"><Block height={18} width="45%" /><Block height={12} /><Block height={14} width="60%" /></div>
        </div>
      )}
      {summary.kind === 'error' && <Failure message={summary.message} onRetry={reloadSummary} />}

      {body && (
        <div className="odash-grid">
          <div className="odash-col">
            <TodayCard summary={body} navigate={navigate} />
            <Alerts summary={body} navigate={navigate} />
            <TargetCard summary={body} onEdit={() => setSheet(true)} />
            <QuickActions navigate={navigate} onTarget={() => setSheet(true)} />
          </div>
          <div className="odash-col">
            <BestSellers storeId={storeId} />
            <MonthMoney summary={body} navigate={navigate} />
          </div>
        </div>
      )}

      {sheet && body && <TargetSheet summary={body} storeId={storeId} onClose={closeSheet} onSaved={saved} />}
      {toast && <p className="odash-toast" role="status">{toast}</p>}
    </div>
  )
}
