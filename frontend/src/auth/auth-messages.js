import { PASSWORD_MIN_LENGTH, RECOVERY_REQUEST_MESSAGE } from './auth-flow.js'
import { OWNER_SIGNUP_MESSAGE } from './owner-flow.js'

// The auth flows keep their codes and messages; these are the words shop owners see on the screens.
const FRIENDLY_BY_CODE = Object.freeze({
  LOGIN_REQUIRED: 'Enter your email and password.',
  LOGIN_REJECTED: 'Wrong email or password. Check them and try again.',
  AUTH_SERVICE_UNAVAILABLE: 'We could not connect. Check your internet and try again.',
  SUPABASE_NOT_CONFIGURED: 'This is not available right now. Please contact us.',
  INVALID_FRONTEND_ORIGIN: 'This is not available from this page. Please contact us.',
  INVALID_RECOVERY_EMAIL: 'Enter a valid email, like name@shop.com.',
  SESSION_REQUIRED: 'Please log in again.',
  INVALID_SIGNUP_EMAIL: 'Enter a valid email, like name@shop.com.',
  SIGNUP_PASSWORD_REQUIRED: 'Choose a password and type it again.',
  SIGNUP_PASSWORD_MISMATCH: 'The two passwords are not the same.',
  SIGNUP_PASSWORD_TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  OWNER_SIGNUP_FAILED: 'We could not create your account. Try again, or log in if you already have one.',
  PASSWORD_REQUIRED: 'Choose a password and type it again.',
  PASSWORD_MISMATCH: 'The two passwords are not the same.',
  PASSWORD_TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  PASSWORD_UPDATE_FAILED: 'We could not save your password. Try a longer one, then try again.',
  PASSWORD_SETUP_SESSION_REQUIRED: 'Open the link from your email to choose a password.',
  PASSWORD_SETUP_SESSION_INVALID: 'This link has expired. Ask for a new one.',
  INVITATION_INVALID: 'This link is not valid anymore. Ask for a new one.',
  INVITATION_SESSION_MISSING: 'This link is not valid anymore. Ask for a new one.',
  SIGNUP_CONFIRMATION_INVALID: 'This confirmation link is not valid anymore. Sign up again to get a new one.',
  SIGNUP_CONFIRMATION_SESSION_MISSING: 'This confirmation link is not valid anymore. Sign up again to get a new one.',
  OWNER_BOOTSTRAP_UNEXPECTED_RESPONSE: 'We could not save your shop. Try again.',
  SIGN_OUT_FAILED: 'We could not log you out. Close this page, then open it again.',
})

// Which field a flow error belongs under, so it shows there instead of at the bottom.
const FIELD_BY_CODE = Object.freeze({
  INVALID_SIGNUP_EMAIL: 'email',
  SIGNUP_PASSWORD_MISMATCH: 'confirmPassword',
  SIGNUP_PASSWORD_TOO_SHORT: 'password',
  PASSWORD_MISMATCH: 'confirmPassword',
  PASSWORD_TOO_SHORT: 'password',
})

// { field, text } for an error that belongs under one field, else null.
export function fieldErrorFor(result, values = {}) {
  if (!result || result.ok) return null
  if (result.code === 'SIGNUP_PASSWORD_REQUIRED' || result.code === 'PASSWORD_REQUIRED') {
    const password = values.password ?? values.newPassword
    return password
      ? { field: 'confirmPassword', text: 'Type your password again.' }
      : { field: 'password', text: 'Choose a password.' }
  }
  const field = FIELD_BY_CODE[result.code]
  return field ? { field, text: FRIENDLY_BY_CODE[result.code] } : null
}

export const FRIENDLY_SIGNUP_SENT = 'We sent you an email. Open the link in it to confirm your address, then set up your shop.'

const GENERIC = 'We could not open your shop right now. Try again in a moment.'
// Words a shop owner should never have to read.
const TECHNICAL = /tenant|workspace|authenticat|application|profile|session|provision|supabase|configured|unsupported|inconsistent/iu

export const FRIENDLY_RECOVERY_SENT = 'If this email has an account, we sent it a link to reset your password. Check your inbox.'

export function friendlyAuthMessage(result) {
  if (!result) return ''
  if (result.ok) {
    if (result.message === RECOVERY_REQUEST_MESSAGE) return FRIENDLY_RECOVERY_SENT
    if (result.message === OWNER_SIGNUP_MESSAGE) return FRIENDLY_SIGNUP_SENT
    return result.message ?? ''
  }
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
