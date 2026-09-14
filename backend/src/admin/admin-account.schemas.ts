import { HttpError } from '../errors/http-error.js'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseAccountId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(
      400,
      'INVALID_ACCOUNT_ID',
      'accountId must be a valid UUID',
    )
  }

  return value.toLowerCase()
}

export function assertEmptyReviewBody(body: unknown): void {
  if (body === undefined || body === null) return

  if (
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length > 0
  ) {
    throw new HttpError(
      400,
      'INVALID_REQUEST_BODY',
      'This operation does not accept request fields',
    )
  }
}

export function parseRejectionReason(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(
      422,
      'INVALID_REJECTION_REASON',
      'A rejection reason is required',
    )
  }

  const input = body as Record<string, unknown>
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'reason')) {
    throw new HttpError(
      422,
      'INVALID_REJECTION_REASON',
      'Only a rejection reason may be supplied',
    )
  }

  if (typeof input.reason !== 'string') {
    throw new HttpError(
      422,
      'INVALID_REJECTION_REASON',
      'Rejection reason must be a string',
    )
  }

  const reason = input.reason.trim()
  if (!reason || [...reason].length > 2000) {
    throw new HttpError(
      422,
      'INVALID_REJECTION_REASON',
      'Rejection reason must contain between 1 and 2000 characters',
    )
  }

  return reason
}
