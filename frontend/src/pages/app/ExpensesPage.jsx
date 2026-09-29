import { useEffect, useState } from 'react'
import { createExpense, createLatestRequestGuard, listExpenses, localBusinessDate, validateBusinessDateRange, canAccessFinance } from '../../features/finance/finance-flow.js'
import { createSubmissionGuard } from '../../auth/owner-flow.js'
import { ErrorState, LoadingState, PageHeader } from '../../components/ui/index.jsx'
import { formatMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function ExpenseList({ expenses }) {
  return <div className="expense-list" aria-label="Expense history">{expenses.map((expense) => <article className="expense-row" key={expense.id}>
    <div className="expense-description"><strong>{expense.description}</strong><span>Recorded {new Date(expense.createdAt).toLocaleString()}</span></div>
    <div><small>Business date</small><strong>{expense.expenseDate}</strong></div>
    <div className="expense-amount"><small>Amount</small><strong>{formatMoney(expense.amount, expense.currency)}</strong></div>
  </article>)}</div>
}

export function ExpensesPage({ profile }) {
  const role = profile?.user?.role
  const currency = profile?.account?.baseCurrency
  const [form, setForm] = useState(() => ({ amount: '', description: '', expenseDate: localBusinessDate() }))
  const [draftFilters, setDraftFilters] = useState({ from: '', to: '' })
  const [filters, setFilters] = useState({ from: '', to: '' })
  const [state, setState] = useState({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [version, setVersion] = useState(0)
  const [submissionGuard] = useState(() => createSubmissionGuard())
  const [historyGuard] = useState(() => createLatestRequestGuard())

  useEffect(() => {
    if (!canAccessFinance(role)) return undefined
    let active = true
    const request = historyGuard.begin()
    void listExpenses({ supabase, filters: { ...filters, limit: 25 } }).then((result) => {
      if (!active || !historyGuard.isCurrent(request) || redirectIfNeeded(result)) return
      setState(result.ok ? { kind: 'ready', expenses: result.expenses, nextCursor: result.nextCursor } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [filters, historyGuard, role, version])

  if (!canAccessFinance(role)) return <section className="business-page"><ErrorState title="Owner access required" description="Expenses contain private financial information and are available only to the store owner." /></section>

  function applyFilters(event) {
    event.preventDefault()
    setFeedback(null)
    if (draftFilters.from && draftFilters.to) {
      const validation = validateBusinessDateRange(draftFilters.from, draftFilters.to, 3_652_425)
      if (!validation.ok) { setFeedback({ kind: 'error', message: validation.message }); return }
    }
    historyGuard.invalidate()
    setState({ kind: 'loading' })
    setFilters(draftFilters)
  }

  async function loadOlder() {
    if (state.kind !== 'ready' || !state.nextCursor) return
    const cursor = state.nextCursor
    const request = historyGuard.begin()
    setState({ ...state, loadingMore: true })
    const result = await listExpenses({ supabase, filters: { ...filters, cursor, limit: 25 } })
    if (!historyGuard.isCurrent(request) || redirectIfNeeded(result)) return
    if (!result.ok) { setState({ ...state, loadingMore: false }); setFeedback({ kind: 'error', message: result.message }); return }
    const known = new Set(state.expenses.map((expense) => expense.id))
    setState({ kind: 'ready', expenses: [...state.expenses, ...result.expenses.filter((expense) => !known.has(expense.id))], nextCursor: result.nextCursor })
  }

  async function submitExpense(event) {
    event.preventDefault()
    setFeedback(null)
    const guarded = await submissionGuard.run(async () => {
      setBusy(true)
      try { return await createExpense({ supabase, input: form }) } finally { setBusy(false) }
    })
    if (guarded.skipped) return
    const result = guarded.value
    if (redirectIfNeeded(result)) return
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    setForm({ amount: '', description: '', expenseDate: localBusinessDate() })
    setFeedback({ kind: 'success', message: `Expense saved for ${result.expense.expenseDate}.` })
    historyGuard.invalidate()
    setState({ kind: 'loading' })
    setVersion((value) => value + 1)
  }

  return <section className="business-page finance-page">
    <PageHeader eyebrow="Owner finance" title="Expenses" description="Record immutable operating expenses and review their business dates." />
    {feedback && <p className={feedback.kind === 'error' ? 'error-message finance-feedback' : 'success-message finance-feedback'} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <div className="expense-layout">
      <form className="finance-card expense-form" onSubmit={submitExpense}>
        <div><span className="eyebrow">New record</span><h2>Add expense</h2><p>Saved expenses become part of authoritative financial reports.</p></div>
        <label htmlFor="expense-amount">Amount ({currency})</label>
        <input id="expense-amount" required inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.amount} disabled={busy} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        <label htmlFor="expense-date">Business date</label>
        <input id="expense-date" required type="date" value={form.expenseDate} disabled={busy} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} />
        <label htmlFor="expense-description">Description</label>
        <textarea id="expense-description" required maxLength="2000" rows="4" placeholder="What was this expense for?" value={form.description} disabled={busy} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button>
        <small>Each successful submission creates a new immutable expense record.</small>
      </form>
      <div className="expense-history">
        <form className="finance-card expense-filters" onSubmit={applyFilters}>
          <div><h2>Expense history</h2><p>Newest business dates appear first.</p></div>
          <label htmlFor="expense-from">From<input id="expense-from" type="date" value={draftFilters.from} onChange={(event) => setDraftFilters({ ...draftFilters, from: event.target.value })} /></label>
          <label htmlFor="expense-to">To<input id="expense-to" type="date" value={draftFilters.to} onChange={(event) => setDraftFilters({ ...draftFilters, to: event.target.value })} /></label>
          <div className="finance-filter-actions"><button type="submit">Apply</button><button type="button" className="secondary-action" onClick={() => { const cleared = { from: '', to: '' }; historyGuard.invalidate(); setDraftFilters(cleared); setState({ kind: 'loading' }); setFilters(cleared); setFeedback(null) }}>Clear</button></div>
        </form>
        {state.kind === 'loading' && <LoadingState label="Loading expenses" />}
        {state.kind === 'error' && <ErrorState title="Expenses unavailable" description={state.message} action={<button type="button" onClick={() => { historyGuard.invalidate(); setState({ kind: 'loading' }); setVersion((value) => value + 1) }}>Try again</button>} />}
        {state.kind === 'ready' && state.expenses.length === 0 && <div className="finance-empty"><h2>No expenses found</h2><p>{filters.from || filters.to ? 'No expense records match these business dates.' : 'Add the first operating expense using the form.'}</p></div>}
        {state.kind === 'ready' && state.expenses.length > 0 && <><ExpenseList expenses={state.expenses} />{state.nextCursor && <button type="button" className="secondary-action finance-load-more" disabled={state.loadingMore} onClick={loadOlder}>{state.loadingMore ? 'Loading…' : 'Load older expenses'}</button>}</>}
      </div>
    </div>
  </section>
}
