import { useEffect, useRef, useState } from 'react'
import {
  ADMIN_INITIAL_STATE,
  approvePendingAccount,
  createAccountActionGuard,
  createRejectionDraft,
  formatRequestedAt,
  initializeAdminDashboard,
  loadPendingAccounts,
  rejectPendingAccount,
  removePendingAccount,
  REJECTION_REASON_MAX_LENGTH,
  validateRejectionReason,
} from '../auth/admin-flow.js'
import { supabase } from '../lib/supabase.js'
import { LogoutAction } from '../components/auth/LogoutAction.jsx'
import { useDirtyState } from '../app/dirty-state.js'

function isSessionFailure(result) {
  return result.code === 'SESSION_REQUIRED' || result.status === 401
}

function isAuthorizationFailure(result) {
  return result.code === 'ADMIN_FORBIDDEN' || result.status === 403
}

export function AdminPage() {
  const initialLoadPromise = useRef(null)
  const [actionGuard] = useState(() => createAccountActionGuard())
  const [pageState, setPageState] = useState(ADMIN_INITIAL_STATE)
  const [busyAccountIds, setBusyAccountIds] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState(null)
  const [rejectionDraft, setRejectionDraft] = useState(null)
  useDirtyState(Boolean(rejectionDraft?.reason))

  useEffect(() => {
    if (!initialLoadPromise.current) {
      initialLoadPromise.current = initializeAdminDashboard({ supabase })
    }

    let active = true
    void initialLoadPromise.current.then((result) => {
      if (!active) return

      if (result.ok) {
        setPageState({ kind: 'ready', accounts: result.accounts })
      } else if (isSessionFailure(result)) {
        window.location.replace('/login')
      } else if (isAuthorizationFailure(result)) {
        setPageState({ kind: 'unauthorized' })
      } else {
        setPageState({
          kind: 'error',
          message: result.message,
        })
      }
    })

    return () => {
      active = false
    }
  }, [])

  function handleProtectedFailure(result) {
    if (isSessionFailure(result)) {
      window.location.replace('/login')
      return true
    }

    if (isAuthorizationFailure(result)) {
      setPageState({ kind: 'unauthorized' })
      return true
    }

    return false
  }

  async function refreshPending({ clearMessage = true } = {}) {
    if (refreshing) return

    setRefreshing(true)
    if (clearMessage) setMessage(null)
    const result = await loadPendingAccounts({ supabase })
    setRefreshing(false)

    if (result.ok) {
      setPageState({ kind: 'ready', accounts: result.accounts })
      return
    }

    if (!handleProtectedFailure(result)) {
      setMessage({ kind: 'error', text: result.message })
    }
  }

  function markAccountBusy(accountId, busy) {
    setBusyAccountIds((current) =>
      busy
        ? current.includes(accountId)
          ? current
          : [...current, accountId]
        : current.filter((id) => id !== accountId),
    )
  }

  async function runReviewAction(accountId, operation, successMessage) {
    const guarded = await actionGuard.run(accountId, async () => {
      markAccountBusy(accountId, true)
      setMessage(null)
      try {
        return await operation()
      } finally {
        markAccountBusy(accountId, false)
      }
    })

    if (guarded.skipped) return

    const result = guarded.value
    if (result.ok) {
      setPageState((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              accounts: removePendingAccount(current.accounts, accountId),
            }
          : current,
      )
      setRejectionDraft(null)
      setMessage({ kind: 'success', text: successMessage })
      return
    }

    if (handleProtectedFailure(result)) return

    setMessage({ kind: 'error', text: result.message })
    if (result.shouldRefresh) {
      await refreshPending({ clearMessage: false })
    }
  }

  async function handleApprove(accountId) {
    await runReviewAction(
      accountId,
      () => approvePendingAccount({ supabase, accountId }),
      'Account approved successfully.',
    )
  }

  function openRejectionForm(accountId) {
    const draft = createRejectionDraft(accountId)
    if (draft) {
      setMessage(null)
      setRejectionDraft(draft)
    }
  }

  async function handleReject(event, accountId) {
    event.preventDefault()
    const validation = validateRejectionReason(rejectionDraft?.reason)
    if (!validation.ok) {
      setRejectionDraft((current) =>
        current?.accountId === accountId
          ? { ...current, error: validation.message }
          : current,
      )
      return
    }

    await runReviewAction(
      accountId,
      () =>
        rejectPendingAccount({
          supabase,
          accountId,
          reason: validation.reason,
        }),
      'Account rejected successfully.',
    )
  }

  if (pageState.kind === 'loading') {
    return (
      <main>
        <section className="card auth-card" aria-live="polite">
          <span className="eyebrow">Platform administration</span>
          <h1>Loading approvals...</h1>
          <div className="spinner" aria-label="Loading" />
          <LogoutAction />
        </section>
      </main>
    )
  }

  if (pageState.kind === 'unauthorized') {
    return (
      <main>
        <section className="card auth-card">
          <span className="eyebrow">Platform administration</span>
          <h1>Access denied</h1>
          <p className="error-message" role="alert">
            You are not authorized to access platform administration.
          </p>
          <a className="button-link secondary" href="/login">
            Return to sign in
          </a>
          <LogoutAction />
        </section>
      </main>
    )
  }

  if (pageState.kind === 'error') {
    return (
      <main>
        <section className="card auth-card">
          <span className="eyebrow">Platform administration</span>
          <h1>Approvals unavailable</h1>
          <p className="error-message" role="alert">{pageState.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
          <LogoutAction />
        </section>
      </main>
    )
  }

  return (
    <main className="admin-main">
      <section className="admin-panel" aria-busy={refreshing}>
        <header className="admin-header">
          <div>
            <span className="eyebrow">Platform administration</span>
            <h1>Account approvals</h1>
            <p>Review new stores before they receive tenant access.</p>
          </div>
          <div className="admin-header-actions"><button
            className="secondary-action"
            type="button"
            onClick={() => refreshPending()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <LogoutAction disabled={refreshing || busyAccountIds.length > 0} /></div>
        </header>

        {message && (
          <p
            className={
              message.kind === 'success'
                ? 'admin-message success-message'
                : 'admin-message error-message'
            }
            role={message.kind === 'success' ? 'status' : 'alert'}
          >
            {message.text}
          </p>
        )}

        {pageState.accounts.length === 0 ? (
          <div className="admin-empty-state">
            <h2>All caught up</h2>
            <p>No accounts are waiting for approval.</p>
          </div>
        ) : (
          <div className="admin-account-list">
            {pageState.accounts.map(({ account, owner }) => {
              const isBusy = busyAccountIds.includes(account.id)
              const isRejecting = rejectionDraft?.accountId === account.id

              return (
                <article className="admin-account-card" key={account.id}>
                  <div className="admin-account-heading">
                    <div>
                      <span className="status-chip">{account.status}</span>
                      <h2>{account.name}</h2>
                    </div>
                    <span className="request-date">
                      Requested {formatRequestedAt(account.createdAt)}
                    </span>
                  </div>

                  <dl className="admin-account-details">
                    <div>
                      <dt>Owner</dt>
                      <dd>{owner.firstName} {owner.lastName}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{owner.email}</dd>
                    </div>
                    <div>
                      <dt>Currency</dt>
                      <dd>{account.baseCurrency}</dd>
                    </div>
                  </dl>

                  <div className="admin-actions">
                    <button
                      type="button"
                      onClick={() => handleApprove(account.id)}
                      disabled={isBusy}
                    >
                      {isBusy ? 'Reviewing...' : 'Approve'}
                    </button>
                    <button
                      className="danger-action"
                      type="button"
                      onClick={() => openRejectionForm(account.id)}
                      disabled={isBusy}
                    >
                      Reject
                    </button>
                  </div>

                  {isRejecting && (
                    <form
                      className="rejection-form"
                      onSubmit={(event) => handleReject(event, account.id)}
                      noValidate
                    >
                      <label htmlFor={`rejection-reason-${account.id}`}>
                        Rejection reason
                      </label>
                      <textarea
                        id={`rejection-reason-${account.id}`}
                        rows="4"
                        maxLength={REJECTION_REASON_MAX_LENGTH}
                        value={rejectionDraft.reason}
                        onChange={(event) =>
                          setRejectionDraft({
                            ...rejectionDraft,
                            reason: event.target.value,
                            error: '',
                          })
                        }
                        disabled={isBusy}
                        required
                      />
                      <div className="rejection-form-meta">
                        <span>
                          {[...rejectionDraft.reason].length}/
                          {REJECTION_REASON_MAX_LENGTH}
                        </span>
                      </div>
                      {rejectionDraft.error && (
                        <p className="error-message" role="alert">
                          {rejectionDraft.error}
                        </p>
                      )}
                      <div className="admin-actions">
                        <button
                          className="danger-action"
                          type="submit"
                          disabled={isBusy}
                        >
                          {isBusy ? 'Rejecting...' : 'Confirm rejection'}
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => setRejectionDraft(null)}
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
