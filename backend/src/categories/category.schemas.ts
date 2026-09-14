import { HttpError } from '../errors/http-error.js'
import type { CategoryInput } from './category.types.js'

export const CATEGORY_NAME_MAX_LENGTH = 100

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseCategoryId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(
      400,
      'INVALID_CATEGORY_ID',
      'categoryId must be a valid UUID',
    )
  }

  return value.toLowerCase()
}

export function parseCategoryInput(body: unknown): CategoryInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(
      422,
      'INVALID_CATEGORY_NAME',
      'Category name is required',
    )
  }

  const input = body as Record<string, unknown>
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'name')) {
    throw new HttpError(
      422,
      'INVALID_CATEGORY_NAME',
      'Only a Category name may be supplied',
    )
  }

  if (typeof input.name !== 'string') {
    throw new HttpError(
      422,
      'INVALID_CATEGORY_NAME',
      'Category name must be a string',
    )
  }

  const name = input.name.trim()
  if (!name || [...name].length > CATEGORY_NAME_MAX_LENGTH) {
    throw new HttpError(
      422,
      'INVALID_CATEGORY_NAME',
      `Category name must contain between 1 and ${CATEGORY_NAME_MAX_LENGTH} characters`,
    )
  }

  return Object.freeze({ name })
}
