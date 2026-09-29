import { useEffect, useRef, useState } from 'react'
import {
  CATEGORIES_INITIAL_STATE,
  createCategory,
  createCategoryDeleteConfirmation,
  createCategoryEditDraft,
  createCategoryMutationGuard,
  deleteCategory,
  loadCategories,
  removeCategoryFromList,
  renameCategory,
  upsertCategoryInList,
} from '../../features/categories/category-flow.js'
import { supabase } from '../../lib/supabase.js'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatCreatedAt(value) {
  return dateFormatter.format(new Date(value))
}

function resultRedirected(result) {
  if (result.requiresLogin) {
    window.location.replace('/login')
    return true
  }

  if (result.requiresAccountReview) {
    window.location.replace('/pending-approval')
    return true
  }

  return false
}

export function CategoriesPage() {
  const [state, setState] = useState(CATEGORIES_INITIAL_STATE)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [name, setName] = useState('')
  const [editDraft, setEditDraft] = useState(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [busyAction, setBusyAction] = useState('')
  const loadRequest = useRef(null)
  const mutationGuard = useRef(createCategoryMutationGuard())

  useEffect(() => {
    if (!loadRequest.current || loadRequest.current.attempt !== loadAttempt) {
      loadRequest.current = {
        attempt: loadAttempt,
        promise: loadCategories({ supabase }),
      }
    }

    let active = true
    void loadRequest.current.promise.then((result) => {
      if (!active || resultRedirected(result)) return

      setState(
        result.ok
          ? { kind: 'ready', categories: result.categories }
          : { kind: 'error', categories: [], message: result.message },
      )
    })

    return () => {
      active = false
    }
  }, [loadAttempt])

  async function performMutation(action, operation) {
    if (mutationGuard.current.isPending()) return null

    setBusyAction(action)
    setFeedback(null)
    try {
      const guarded = await mutationGuard.current.run(operation)
      if (guarded.skipped || resultRedirected(guarded.value)) return null
      return guarded.value
    } finally {
      setBusyAction('')
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    const result = await performMutation('create', () =>
      createCategory({ supabase, name }),
    )
    if (!result) return

    if (!result.ok) {
      setFeedback({ kind: 'error', message: result.message })
      return
    }

    setState((current) => ({
      kind: 'ready',
      categories: upsertCategoryInList(current.categories, result.category),
    }))
    setName('')
    setFeedback({ kind: 'success', message: 'Category added.' })
  }

  function handleOpenEdit(category) {
    setFeedback(null)
    setDeleteConfirmation(null)
    setEditDraft(createCategoryEditDraft(category))
  }

  async function handleRename(event, category) {
    event.preventDefault()
    const result = await performMutation(`edit:${category.id}`, () =>
      renameCategory({
        supabase,
        categoryId: category.id,
        currentName: category.name,
        name: editDraft?.name,
      }),
    )
    if (!result) return

    if (!result.ok) {
      setFeedback({ kind: 'error', message: result.message })
      return
    }

    if (!result.unchanged) {
      setState((current) => ({
        kind: 'ready',
        categories: upsertCategoryInList(current.categories, result.category),
      }))
      setFeedback({ kind: 'success', message: 'Category renamed.' })
    }
    setEditDraft(null)
  }

  function handleRequestDelete(category) {
    setFeedback(null)
    setEditDraft(null)
    setDeleteConfirmation(createCategoryDeleteConfirmation(category))
  }

  function handleRetry() {
    setState(CATEGORIES_INITIAL_STATE)
    setLoadAttempt((attempt) => attempt + 1)
  }

  async function handleConfirmDelete() {
    const confirmation = deleteConfirmation
    if (!confirmation) return

    const result = await performMutation(`delete:${confirmation.categoryId}`, () =>
      deleteCategory({
        supabase,
        categoryId: confirmation.categoryId,
      }),
    )
    if (!result) return

    if (!result.ok) {
      setFeedback({ kind: 'error', message: result.message })
      return
    }

    setState((current) => ({
      kind: 'ready',
      categories: removeCategoryFromList(
        current.categories,
        result.categoryId,
      ),
    }))
    setDeleteConfirmation(null)
    setFeedback({ kind: 'success', message: 'Category deleted.' })
  }

  const mutationPending = Boolean(busyAction)

  return (
    <section className="business-page categories-page">
      <header className="business-page-heading">
        <span className="eyebrow">Catalog structure</span>
        <h1>Categories</h1>
        <p>Organize products into reusable groups.</p>
      </header>

      <form className="category-create-form" onSubmit={handleCreate}>
        <div>
          <label htmlFor="category-name">Category name</label>
          <input
            id="category-name"
            name="name"
            value={name}
            maxLength={100}
            placeholder="e.g. T-Shirts"
            onChange={(event) => setName(event.target.value)}
            disabled={mutationPending}
          />
        </div>
        <button type="submit" disabled={mutationPending}>
          {busyAction === 'create' ? 'Adding...' : 'Add category'}
        </button>
      </form>

      {feedback && (
        <p
          className={`category-feedback ${feedback.kind}-message`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}

      {state.kind === 'loading' && (
        <div className="category-state" aria-live="polite">
          <div className="spinner" aria-label="Loading categories" />
          <p>Loading categories...</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="category-state category-error-state">
          <h2>Categories unavailable</h2>
          <p className="error-message" role="alert">{state.message}</p>
          <button
            type="button"
            onClick={handleRetry}
          >
            Try again
          </button>
        </div>
      )}

      {state.kind === 'ready' && state.categories.length === 0 && (
        <div className="category-state category-empty-state">
          <h2>No categories yet.</h2>
          <p>Add your first category using the form above.</p>
        </div>
      )}

      {state.kind === 'ready' && state.categories.length > 0 && (
        <div className="category-list" aria-label="Categories">
          <div className="category-list-heading" aria-hidden="true">
            <span>Category name</span>
            <span>Created</span>
            <span>Actions</span>
          </div>
          {state.categories.map((category) => {
            const editing = editDraft?.id === category.id
            const confirmingDelete =
              deleteConfirmation?.categoryId === category.id
            const editingBusy = busyAction === `edit:${category.id}`
            const deletingBusy = busyAction === `delete:${category.id}`

            return (
              <article className="category-row" key={category.id}>
                {editing ? (
                  <form
                    className="category-edit-form"
                    onSubmit={(event) => handleRename(event, category)}
                  >
                    <label className="sr-only" htmlFor={`edit-${category.id}`}>
                      Rename {category.name}
                    </label>
                    <input
                      id={`edit-${category.id}`}
                      value={editDraft.name}
                      maxLength={100}
                      autoFocus
                      onChange={(event) =>
                        setEditDraft({ ...editDraft, name: event.target.value })
                      }
                      disabled={mutationPending}
                    />
                    <div className="category-inline-actions">
                      <button type="submit" disabled={mutationPending}>
                        {editingBusy ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => setEditDraft(null)}
                        disabled={mutationPending}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong className="category-name">{category.name}</strong>
                    <time dateTime={category.createdAt}>
                      {formatCreatedAt(category.createdAt)}
                    </time>
                    <div className="category-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => handleOpenEdit(category)}
                        disabled={mutationPending}
                      >
                        Edit
                      </button>
                      <button
                        className="category-delete-button"
                        type="button"
                        onClick={() => handleRequestDelete(category)}
                        disabled={mutationPending}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}

                {confirmingDelete && !editing && (
                  <div className="category-delete-confirmation" role="group">
                    <p>Delete “{deleteConfirmation.categoryName}”?</p>
                    <span>This action cannot be undone.</span>
                    <div className="category-inline-actions">
                      <button
                        className="danger-action"
                        type="button"
                        onClick={handleConfirmDelete}
                        disabled={mutationPending}
                      >
                        {deletingBusy ? 'Deleting...' : 'Confirm delete'}
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => setDeleteConfirmation(null)}
                        disabled={mutationPending}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
