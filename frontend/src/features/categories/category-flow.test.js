import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  CATEGORIES_INITIAL_STATE,
  CATEGORY_NAME_MAX_LENGTH,
  createCategory,
  createCategoryDeleteConfirmation,
  createCategoryEditDraft,
  createCategoryMutationGuard,
  deleteCategory,
  loadCategories,
  removeCategoryFromList,
  renameCategory,
  upsertCategoryInList,
} from './category-flow.js'

const categoryId = '11111111-1111-4111-8111-111111111111'
const secondCategoryId = '22222222-2222-4222-8222-222222222222'
const createdAt = '2026-09-15T08:00:00.000Z'

function category(id = categoryId, name = 'Shirts') {
  return { id, name, createdAt, updatedAt: createdAt }
}

function createSupabase() {
  const calls = { getSession: 0 }
  return {
    calls,
    client: {
      auth: {
        async getSession() {
          calls.getSession += 1
          return {
            data: {
              session: {
                access_token: 'synthetic-category-test-token',
                user: { id: '33333333-3333-4333-8333-333333333333' },
              },
            },
            error: null,
          }
        },
      },
    },
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (status === 204) throw new Error('No response body')
      return body
    },
  }
}

function apiError(status, code) {
  return jsonResponse(status, { error: { code, message: 'private detail' } })
}

function readRequestBody(options) {
  return options.body ? JSON.parse(options.body) : undefined
}

describe('Category list', () => {
  test('starts in a loading state', () => {
    assert.deepEqual(CATEGORIES_INITIAL_STATE, {
      kind: 'loading',
      categories: [],
    })
  })

  test('loads and sorts categories for rendering', async () => {
    const { client, calls } = createSupabase()
    const result = await loadCategories({
      supabase: client,
      fetchImpl: async (path, options) => {
        assert.equal(path, '/api/categories')
        assert.equal(options.method, 'GET')
        assert.match(options.headers.Authorization, /^Bearer /)
        return jsonResponse(200, {
          categories: [
            category(categoryId, 'T-Shirts'),
            category(secondCategoryId, 'Accessories'),
          ],
        })
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.categories.map(({ name }) => name), [
      'Accessories',
      'T-Shirts',
    ])
    assert.equal(calls.getSession, 1)
  })

  test('supports an empty list', async () => {
    const result = await loadCategories({
      supabase: createSupabase().client,
      fetchImpl: async () => jsonResponse(200, { categories: [] }),
    })

    assert.deepEqual(result, { ok: true, categories: [] })
  })

  test('handles API failures without exposing backend details', async () => {
    const result = await loadCategories({
      supabase: createSupabase().client,
      fetchImpl: async () => apiError(500, 'INTERNAL_SERVER_ERROR'),
    })

    assert.equal(result.ok, false)
    assert.equal(result.message, 'Something went wrong. Please try again.')
    assert.doesNotMatch(JSON.stringify(result), /private detail/i)
  })

  test('marks an expired backend session for login', async () => {
    const result = await loadCategories({
      supabase: createSupabase().client,
      fetchImpl: async () => apiError(401, 'INVALID_ACCESS_TOKEN'),
    })

    assert.equal(result.ok, false)
    assert.equal(result.requiresLogin, true)
  })
})

describe('Category creation', () => {
  test('creates a category and trims whitespace', async () => {
    const requests = []
    const result = await createCategory({
      supabase: createSupabase().client,
      name: '  Shirts  ',
      fetchImpl: async (path, options) => {
        requests.push({ path, options })
        return jsonResponse(201, { category: category() })
      },
    })

    assert.equal(result.ok, true)
    assert.equal(requests[0].path, '/api/categories')
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(readRequestBody(requests[0].options), { name: 'Shirts' })
    assert.equal(Object.hasOwn(readRequestBody(requests[0].options), 'accountId'), false)
    assert.deepEqual(upsertCategoryInList([], result.category), [result.category])
  })

  for (const name of ['   ', 'x'.repeat(CATEGORY_NAME_MAX_LENGTH + 1)]) {
    test('rejects an invalid name before making a request', async () => {
      let requestCount = 0
      const result = await createCategory({
        supabase: createSupabase().client,
        name,
        fetchImpl: async () => {
          requestCount += 1
          return jsonResponse(201, { category: category() })
        },
      })

      assert.equal(result.code, 'INVALID_CATEGORY_NAME')
      assert.equal(requestCount, 0)
    })
  }

  test('shows a safe duplicate conflict', async () => {
    const result = await createCategory({
      supabase: createSupabase().client,
      name: 'Shirts',
      fetchImpl: async () => apiError(409, 'CATEGORY_ALREADY_EXISTS'),
    })

    assert.equal(result.ok, false)
    assert.equal(result.message, 'A category with this name already exists.')
  })

  test('blocks a second submission while the first is pending', async () => {
    const guard = createCategoryMutationGuard()
    let releaseRequest
    let markRequestStarted
    let requestCount = 0
    const pendingRequest = new Promise((resolve) => {
      releaseRequest = resolve
    })
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    const operation = () =>
      createCategory({
        supabase: createSupabase().client,
        name: 'Shirts',
        fetchImpl: async () => {
          requestCount += 1
          markRequestStarted()
          await pendingRequest
          return jsonResponse(201, { category: category() })
        },
      })

    const first = guard.run(operation)
    const second = await guard.run(operation)
    assert.deepEqual(second, { skipped: true })
    await requestStarted
    assert.equal(requestCount, 1)

    releaseRequest()
    assert.equal((await first).value.ok, true)
  })
})

describe('Category rename', () => {
  test('creates an edit draft without tenant identity', () => {
    assert.deepEqual(createCategoryEditDraft(category()), {
      id: categoryId,
      name: 'Shirts',
    })
  })

  test('renames with only the normalized name', async () => {
    let request
    const result = await renameCategory({
      supabase: createSupabase().client,
      categoryId,
      currentName: 'Shirts',
      name: '  Tops  ',
      fetchImpl: async (path, options) => {
        request = { path, options }
        return jsonResponse(200, {
          category: category(categoryId, 'Tops'),
        })
      },
    })

    assert.equal(result.ok, true)
    assert.equal(request.path, `/api/categories/${categoryId}`)
    assert.equal(request.options.method, 'PATCH')
    assert.deepEqual(readRequestBody(request.options), { name: 'Tops' })
    assert.equal(Object.hasOwn(readRequestBody(request.options), 'accountId'), false)
    assert.deepEqual(
      upsertCategoryInList([category()], result.category).map(({ name }) => name),
      ['Tops'],
    )
  })

  for (const [status, code, message] of [
    [409, 'CATEGORY_ALREADY_EXISTS', 'A category with this name already exists.'],
    [404, 'CATEGORY_NOT_FOUND', 'This category could not be found. Refresh the list and try again.'],
  ]) {
    test(`handles ${code} safely`, async () => {
      const result = await renameCategory({
        supabase: createSupabase().client,
        categoryId,
        currentName: 'Shirts',
        name: 'Tops',
        fetchImpl: async () => apiError(status, code),
      })

      assert.equal(result.ok, false)
      assert.equal(result.message, message)
    })
  }

  test('avoids an unnecessary request for an unchanged name', async () => {
    let requestCount = 0
    const result = await renameCategory({
      supabase: createSupabase().client,
      categoryId,
      currentName: 'Shirts',
      name: '  Shirts ',
      fetchImpl: async () => {
        requestCount += 1
      },
    })

    assert.deepEqual(result, { ok: true, unchanged: true })
    assert.equal(requestCount, 0)
  })
})

describe('Category deletion', () => {
  test('requires a named confirmation before any delete request', () => {
    let requestCount = 0
    const confirmation = createCategoryDeleteConfirmation(category())

    assert.deepEqual(confirmation, {
      categoryId,
      categoryName: 'Shirts',
    })
    assert.equal(requestCount, 0)
    assert.doesNotMatch(JSON.stringify(confirmation), /accountId|product/i)
  })

  test('deletes only the confirmed category resource', async () => {
    let request
    const result = await deleteCategory({
      supabase: createSupabase().client,
      categoryId,
      fetchImpl: async (path, options) => {
        request = { path, options }
        return jsonResponse(204)
      },
    })

    assert.deepEqual(result, { ok: true, categoryId })
    assert.equal(request.path, `/api/categories/${categoryId}`)
    assert.equal(request.options.method, 'DELETE')
    assert.equal(request.options.body, undefined)
    assert.doesNotMatch(request.path, /product/i)
    assert.deepEqual(
      removeCategoryFromList([category(), category(secondCategoryId)], categoryId),
      [category(secondCategoryId)],
    )
  })

  for (const [status, code, message] of [
    [
      409,
      'CATEGORY_IN_USE',
      'This category cannot be deleted because it is used by existing products or sales history.',
    ],
    [
      404,
      'CATEGORY_NOT_FOUND',
      'This category could not be found. Refresh the list and try again.',
    ],
  ]) {
    test(`handles ${code} safely`, async () => {
      const result = await deleteCategory({
        supabase: createSupabase().client,
        categoryId,
        fetchImpl: async () => apiError(status, code),
      })

      assert.equal(result.ok, false)
      assert.equal(result.message, message)
    })
  }
})

describe('Category request security', () => {
  test('uses authenticated requests without returning or logging the token', async () => {
    const { client, calls } = createSupabase()
    const originalConsoleError = console.error
    const logged = []
    console.error = (...values) => logged.push(values)

    try {
      const result = await loadCategories({
        supabase: client,
        fetchImpl: async () => jsonResponse(200, { categories: [] }),
      })

      assert.equal(result.ok, true)
      assert.equal(calls.getSession, 1)
      assert.deepEqual(logged, [])
      assert.doesNotMatch(JSON.stringify(result), /synthetic-category-test-token/)
    } finally {
      console.error = originalConsoleError
    }
  })
})
