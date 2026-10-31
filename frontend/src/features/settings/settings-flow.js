import { authenticatedApiRequest } from '../../auth/owner-flow.js'
import { parseRate } from '../../lib/currency.js'

// Account settings: for now the USD -> LBP exchange rate the till uses (the owner sets it, every user reads it).

function failure(code, message, extra = {}) { return Object.freeze({ ok: false, code, message, ...extra }) }

function request({ supabase, fetchImpl, path, method = 'GET', payload }) {
  return authenticatedApiRequest({ supabase, fetchImpl, path, method, payload, fallbackMessage: 'Settings are temporarily unavailable. Please try again.' })
}

function readSettings(result) {
  const settings = result.data?.settings
  const rate = settings?.lbpPerUsd
  if (result.status !== 200 || typeof settings?.baseCurrency !== 'string' || !(rate === null || (typeof rate === 'string' && parseRate(rate) !== null))) {
    return failure('INVALID_SETTINGS_RESPONSE', 'Settings could not be loaded.')
  }
  return Object.freeze({ ok: true, baseCurrency: settings.baseCurrency, lbpPerUsd: rate })
}

function mapFailure(result, fallback) {
  if (result.code === 'SESSION_REQUIRED' || result.status === 401) return failure(result.code, 'Your session has expired. Sign in again.', { requiresLogin: true })
  if (result.status === 403) return failure(result.code, 'Only an owner can change the exchange rate.')
  if (result.code === 'EXCHANGE_RATE_UNSUPPORTED_CURRENCY') return failure(result.code, 'The exchange rate is only used by stores that sell in US dollars.')
  if (result.code === 'INVALID_EXCHANGE_RATE') return failure(result.code, 'Enter a rate greater than zero with at most two decimals.')
  return failure(result.code, fallback)
}

export async function loadSettings({ supabase, fetchImpl }) {
  const result = await request({ supabase, fetchImpl, path: '/api/settings' })
  if (!result.ok) return mapFailure(result, 'Settings could not be loaded. Please try again.')
  return readSettings(result)
}

export async function saveExchangeRate({ supabase, fetchImpl, lbpPerUsd }) {
  const result = await request({ supabase, fetchImpl, path: '/api/settings/exchange-rate', method: 'PUT', payload: { lbpPerUsd } })
  if (!result.ok) return mapFailure(result, 'The exchange rate could not be saved. Please try again.')
  return readSettings(result)
}

// What the owner typed ("89,500") -> the rate to send, or null to clear it.
export function parseRateInput(text) {
  const clean = String(text ?? '').replace(/[\s,]/g, '')
  if (clean === '') return Object.freeze({ ok: true, value: null })
  if (parseRate(clean) === null) return Object.freeze({ ok: false, message: 'Enter a rate greater than zero with at most two decimals, for example 89500.' })
  if (Number(clean) > 1_000_000_000) return Object.freeze({ ok: false, message: 'That rate is too large.' })
  return Object.freeze({ ok: true, value: clean })
}
