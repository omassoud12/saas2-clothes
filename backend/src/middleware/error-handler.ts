import type { ErrorRequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error)
    return
  }

  if (isBodyParserError(error, 'entity.parse.failed', 400)) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON_BODY',
        message: 'Request body must contain valid JSON',
      },
    })
    return
  }

  if (isBodyParserError(error, 'entity.too.large', 413)) {
    response.status(413).json({
      error: {
        code: 'JSON_BODY_TOO_LARGE',
        message: 'Request body exceeds the allowed size',
      },
    })
    return
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  console.error('Unhandled request error', {
    category: 'UNEXPECTED_ERROR',
    status: 500,
  })
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  })
}

function isBodyParserError(
  error: unknown,
  type: string,
  status: number,
): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as { type?: unknown; status?: unknown }
  return candidate.type === type && candidate.status === status
}
