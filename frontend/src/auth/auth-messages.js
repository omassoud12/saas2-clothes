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
  OWNER_ONBOARDING_INVALID: 'Check your answers and try again.',
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

// The shop setup form: which answers need fixing, under each field.
export function onboardingFieldErrors(result, form) {
  if (!result || result.ok || result.code !== 'OWNER_ONBOARDING_INVALID') return {}
  const message = result.message ?? ''
  if (/required/iu.test(message)) {
    const errors = {}
    if (!form.firstName?.trim()) errors.firstName = 'Enter your first name.'
    if (!form.lastName?.trim()) errors.lastName = 'Enter your last name.'
    if (!form.accountName?.trim()) errors.accountName = 'Enter your shop name.'
    return errors
  }
  if (/too long/iu.test(message)) {
    const limits = { firstName: 100, lastName: 100, accountName: 160, employeeCode: 50 }
    return Object.fromEntries(Object.entries(limits).filter(([key, max]) => (form[key]?.trim().length ?? 0) > max).map(([key]) => [key, 'This is too long. Make it shorter.']))
  }
  if (/currency/iu.test(message)) return { baseCurrency: 'Choose USD or LBP.' }
  if (/employee code/iu.test(message)) return { employeeCode: 'Use only letters, numbers, - and _.' }
  return {}
}

// What the account page says for each state of the shop.
export const ACCOUNT_STATUS_VIEW = Object.freeze({
  PENDING: Object.freeze({ label: 'Waiting for approval', title: 'We are checking your shop', text: 'We will turn your account on soon. You can check again here at any time.' }),
  REJECTED: Object.freeze({ label: 'Not approved', title: 'Your shop was not approved', text: 'Contact us if you think this is a mistake.' }),
  SUSPENDED: Object.freeze({ label: 'Paused', title: 'Your shop is paused', text: 'You and your staff cannot use SaaS2 right now. Contact us to turn it back on.' }),
})

export const FRIENDLY_SIGNUP_SENT = 'We sent you an email. Open the link in it to confirm your address, then set up your shop.'

const FRIENDLY_BY_MESSAGE = Object.freeze({
  'Store setup could not be completed. Please try again.': 'We could not save your shop. Try again in a moment.',
})

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
  // Server errors come back with the flow's fallback message.
  if (FRIENDLY_BY_MESSAGE[result.message]) return FRIENDLY_BY_MESSAGE[result.message]
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
