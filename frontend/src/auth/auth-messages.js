import { RECOVERY_REQUEST_MESSAGE } from './auth-flow.js'

// The auth flows keep their codes and messages; these are the words shop owners see on the screens.
const FRIENDLY_BY_CODE = Object.freeze({
  LOGIN_REQUIRED: 'Enter your email and password.',
  LOGIN_REJECTED: 'Wrong email or password. Check them and try again.',
  AUTH_SERVICE_UNAVAILABLE: 'We could not connect. Check your internet and try again.',
  SUPABASE_NOT_CONFIGURED: 'Logging in is not available right now. Please contact us.',
  INVALID_FRONTEND_ORIGIN: 'This is not available from this page. Please contact us.',
  INVALID_RECOVERY_EMAIL: 'Enter a valid email, like name@shop.com.',
  SESSION_REQUIRED: 'Please log in again.',
})

const GENERIC = 'We could not open your shop right now. Try again in a moment.'
// Words a shop owner should never have to read.
const TECHNICAL = /tenant|workspace|authenticat|application|profile|session|provision|supabase|configured|unsupported|inconsistent/iu

export const FRIENDLY_RECOVERY_SENT = 'If this email has an account, we sent it a link to reset your password. Check your inbox.'

export function friendlyAuthMessage(result) {
  if (!result) return ''
  if (result.ok) return result.message === RECOVERY_REQUEST_MESSAGE ? FRIENDLY_RECOVERY_SENT : (result.message ?? '')
  if (FRIENDLY_BY_CODE[result.code]) return FRIENDLY_BY_CODE[result.code]
  const message = typeof result.message === 'string' ? result.message : ''
  return !message || TECHNICAL.test(message) ? GENERIC : message
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export function isLikelyEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim())
}

// Errors shown under each field before the form is sent.
export function validateLogin({ email, password }) {
  const errors = {}
  if (!isLikelyEmail(email)) errors.email = 'Enter the email you use for your shop.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}
