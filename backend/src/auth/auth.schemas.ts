import { HttpError } from '../errors/http-error.js'
import type {
  OwnerBootstrapInput,
  SupportedCurrency,
} from './auth.types.js'

const allowedFields = new Set([
  'firstName',
  'lastName',
  'accountName',
  'baseCurrency',
  'employeeCode',
])
const supportedCurrencies = new Set(['USD', 'LBP'])
const employeeCodePattern = /^[A-Z0-9][A-Z0-9_-]*$/

function validationError(message: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message)
}

function readRequiredString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field]

  if (typeof value !== 'string') {
    throw validationError(`${field} must be a string`)
  }

  const normalized = value.trim()

  if (!normalized) {
    throw validationError(`${field} must not be blank`)
  }

  if (normalized.length > maxLength) {
    throw validationError(`${field} must be at most ${maxLength} characters`)
  }

  return normalized
}

export function parseOwnerBootstrapInput(body: unknown): OwnerBootstrapInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('Request body must be a JSON object')
  }

  const input = body as Record<string, unknown>
  const unknownFields = Object.keys(input).filter(
    (field) => !allowedFields.has(field),
  )

  if (unknownFields.length > 0) {
    throw validationError('Request body contains unsupported fields')
  }

  const firstName = readRequiredString(input, 'firstName', 100)
  const lastName = readRequiredString(input, 'lastName', 100)
  const accountName = readRequiredString(input, 'accountName', 160)
  const baseCurrency = readRequiredString(input, 'baseCurrency', 3).toUpperCase()

  if (!/^[A-Z]{3}$/.test(baseCurrency) || !supportedCurrencies.has(baseCurrency)) {
    throw validationError('baseCurrency must be a supported three-letter currency')
  }

  let employeeCode: string | null = null

  if (Object.hasOwn(input, 'employeeCode')) {
    if (typeof input.employeeCode !== 'string') {
      throw validationError('employeeCode must be a string when supplied')
    }

    employeeCode = input.employeeCode.trim().toUpperCase()

    if (!employeeCode) {
      throw validationError('employeeCode must not be blank when supplied')
    }

    if (employeeCode.length > 50 || !employeeCodePattern.test(employeeCode)) {
      throw validationError(
        'employeeCode must be at most 50 characters and contain only letters, numbers, hyphens, or underscores',
      )
    }
  }

  return Object.freeze({
    firstName,
    lastName,
    accountName,
    baseCurrency: baseCurrency as SupportedCurrency,
    employeeCode,
  })
}
