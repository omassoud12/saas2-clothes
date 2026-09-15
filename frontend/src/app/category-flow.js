import { authenticatedApiRequest } from '../auth/owner-flow.js'

export const CATEGORY_NAME_MAX_LENGTH = 100
export const CATEGORIES_INITIAL_STATE = Object.freeze({
  kind: 'loading',
  categories: Object.freeze([]),
})

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const categoryErrorMessages = Object.freeze({
  CATEGORY_ALREADY_EXISTS: 'A category with this name already exists.',
  CATEGORY_NOT_FOUND: 'This category could not be found. Refresh the list and try again.',
  CATEGORY_IN_USE:
    'This category cannot be deleted because it is used by existing products or sales history.',
  INVALID_CATEGORY_NAME:
    'Category name must be between 1 and 100 characters.',
})

const accountReviewCodes = new Set([
  'ACCOUNT_PENDING',
  'ACCOUNT_REJECTED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_NOT_ACTIVE',
])

function resultError(code, message, status, extra = {}) {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(typeof status === 'number' ? { status } : {}),
    ...extra,
  })
}

function invalidResponse() {
  return resultError(
    'INVALID_CATEGORIES_RESPONSE',
    'Something went wrong. Please try again.',
  )
}

function mapCategoryFailure(result) {
  const knownMessage = categoryErrorMessages[result.code]
  if (knownMessage) {
    return resultError(result.code, knownMessage, result.status)
  }

  if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
    return resultError(
      result.code,
      'Your session has expired. Sign in again.',
      result.status,
      { requiresLogin: true },
    )
  }

  if (result.status === 403 && accountReviewCodes.has(result.code)) {
    return resultError(
      result.code,
      'Your store is not currently active.',
      result.status,
      { requiresAccountReview: true },
    )
  }

  return resultError(
    result.code || 'CATEGORY_REQUEST_FAILED',
    'Something went wrong. Please try again.',
    result.status,
  )
}

export function validateCategoryName(name) {
  if (typeof name !== 'string') {
    return resultError(
      'INVALID_CATEGORY_NAME',
      categoryErrorMessages.INVALID_CATEGORY_NAME,
    )
  }

  const normalizedName = name.trim()
  if (!normalizedName || normalizedName.length > CATEGORY_NAME_MAX_LENGTH) {
    return resultError(
      'INVALID_CATEGORY_NAME',
      categoryErrorMessages.INVALID_CATEGORY_NAME,
    )
  }

  return Object.freeze({ ok: true, name: normalizedName })
}

function normalizeCategory(value) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !uuidPattern.test(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > CATEGORY_NAME_MAX_LENGTH ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return null
  }

  return Object.freeze({
    id: value.id.toLowerCase(),
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  })
}

export function sortCategories(categories) {
  return Object.freeze(
    [...categories].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
    ),
  )
}

export function upsertCategoryInList(categories, category) {
  return sortCategories([
    ...categories.filter((current) => current.id !== category.id),
    category,
  ])
}

export function removeCategoryFromList(categories, categoryId) {
  return Object.freeze(
    categories.filter((category) => category.id !== categoryId),
  )
}

export function createCategoryMutationGuard() {
  let pending = false

  return Object.freeze({
    isPending() {
      return pending
    },
    async run(operation) {
      if (pending) return Object.freeze({ skipped: true })

      pending = true
      try {
        return Object.freeze({ skipped: false, value: await operation() })
      } finally {
        pending = false
      }
    },
  })
}

export function createCategoryEditDraft(category) {
  if (
    !category ||
    typeof category.id !== 'string' ||
    !uuidPattern.test(category.id) ||
    typeof category.name !== 'string'
  ) {
    return null
  }

  return Object.freeze({ id: category.id.toLowerCase(), name: category.name })
}

export function createCategoryDeleteConfirmation(category) {
  const draft = createCategoryEditDraft(category)
  return draft
    ? Object.freeze({ categoryId: draft.id, categoryName: draft.name })
    : null
}

export async function loadCategories({
  supabase,
  fetchImpl = globalThis.fetch,
}) {
  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: '/api/categories',
    method: 'GET',
    fallbackMessage: 'Something went wrong. Please try again.',
  })

  if (!result.ok) return mapCategoryFailure(result)
  if (result.status !== 200 || !Array.isArray(result.data?.categories)) {
    return invalidResponse()
  }

  const categories = result.data.categories.map(normalizeCategory)
  if (categories.some((category) => category === null)) {
    return invalidResponse()
  }

  return Object.freeze({ ok: true, categories: sortCategories(categories) })
}

export async function createCategory({
  supabase,
  fetchImpl = globalThis.fetch,
  name,
}) {
  const validation = validateCategoryName(name)
  if (!validation.ok) return validation

  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: '/api/categories',
    method: 'POST',
    payload: { name: validation.name },
    fallbackMessage: 'Something went wrong. Please try again.',
  })

  if (!result.ok) return mapCategoryFailure(result)
  const category = normalizeCategory(result.data?.category)
  if (result.status !== 201 || !category) return invalidResponse()

  return Object.freeze({ ok: true, category })
}

export async function renameCategory({
  supabase,
  fetchImpl = globalThis.fetch,
  categoryId,
  currentName,
  name,
}) {
  if (typeof categoryId !== 'string' || !uuidPattern.test(categoryId)) {
    return resultError(
      'CATEGORY_NOT_FOUND',
      categoryErrorMessages.CATEGORY_NOT_FOUND,
    )
  }

  const validation = validateCategoryName(name)
  if (!validation.ok) return validation
  if (validation.name === currentName) {
    return Object.freeze({ ok: true, unchanged: true })
  }

  const normalizedId = categoryId.toLowerCase()
  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: `/api/categories/${encodeURIComponent(normalizedId)}`,
    method: 'PATCH',
    payload: { name: validation.name },
    fallbackMessage: 'Something went wrong. Please try again.',
  })

  if (!result.ok) return mapCategoryFailure(result)
  const category = normalizeCategory(result.data?.category)
  if (
    result.status !== 200 ||
    !category ||
    category.id !== normalizedId
  ) {
    return invalidResponse()
  }

  return Object.freeze({ ok: true, category, unchanged: false })
}

export async function deleteCategory({
  supabase,
  fetchImpl = globalThis.fetch,
  categoryId,
}) {
  if (typeof categoryId !== 'string' || !uuidPattern.test(categoryId)) {
    return resultError(
      'CATEGORY_NOT_FOUND',
      categoryErrorMessages.CATEGORY_NOT_FOUND,
    )
  }

  const normalizedId = categoryId.toLowerCase()
  const result = await authenticatedApiRequest({
    supabase,
    fetchImpl,
    path: `/api/categories/${encodeURIComponent(normalizedId)}`,
    method: 'DELETE',
    fallbackMessage: 'Something went wrong. Please try again.',
  })

  if (!result.ok) return mapCategoryFailure(result)
  if (result.status !== 204) return invalidResponse()

  return Object.freeze({ ok: true, categoryId: normalizedId })
}
