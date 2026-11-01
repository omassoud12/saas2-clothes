import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_STATUS_VIEW, fieldErrorFor, FRIENDLY_RECOVERY_SENT, friendlyAuthMessage, isLikelyEmail, onboardingFieldErrors, validateLogin } from './auth-messages.js'
import { OWNER_SIGNUP_MESSAGE } from './owner-flow.js'
import { RECOVERY_REQUEST_MESSAGE } from './auth-flow.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const siteCss = readFileSync(new URL('../site/site.css', import.meta.url), 'utf8')
let vite
let shell
let LoginPage
let SignupPage

before(async () => {
  const authFixture = { name: 'auth-ui-fixture', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/lib/supabase.js')) return '\0auth-ui-supabase' },
    load(id) {
      if (id === '\0auth-ui-supabase') {
        return 'export const supabase = null; export const authCallbackContext = {}; export const signupCallbackContext = {}; export const exchangeAuthCallbackCode = () => null'
      }
    },
  }
  vite = await createServer({ root, configFile: false, plugins: [authFixture, react()], logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } })
  shell = await vite.ssrLoadModule('/src/components/auth/AuthShell.jsx')
  LoginPage = (await vite.ssrLoadModule('/src/pages/LoginPage.jsx')).LoginPage
  SignupPage = (await vite.ssrLoadModule('/src/pages/SignupPage.jsx')).SignupPage
  for (const name of OTHER_SCREENS) otherScreens[name] = (await vite.ssrLoadModule(`/src/pages/${name}.jsx`))[name]
})

const OTHER_SCREENS = ['AuthCallbackPage', 'SignupCallbackPage', 'SetPasswordPage', 'OwnerOnboardingPage', 'PendingApprovalPage', 'InactiveAccountPage']
const otherScreens = {}
const AUTH_SCREEN_FILES = ['LoginPage', 'SignupPage', 'AccountStatusPage', ...OTHER_SCREENS].map((name) => `../pages/${name}.jsx`)
after(async () => { await vite?.close() })

const html = (component, props, ...children) => renderToStaticMarkup(createElement(component, props, ...children))

describe('words shop owners see', () => {
  test('a wrong password, no connection and missing setup read simply', () => {
    assert.equal(friendlyAuthMessage({ ok: false, code: 'LOGIN_REJECTED', message: 'Email or password was not accepted.' }), 'Wrong email or password. Check them and try again.')
    assert.equal(friendlyAuthMessage({ ok: false, code: 'AUTH_SERVICE_UNAVAILABLE' }), 'We could not connect. Check your internet and try again.')
    assert.equal(friendlyAuthMessage({ ok: false, code: 'SUPABASE_NOT_CONFIGURED', message: 'Authentication is not configured for this application.' }), 'This is not available right now. Please contact us.')
    assert.equal(friendlyAuthMessage({ ok: true, message: RECOVERY_REQUEST_MESSAGE }), FRIENDLY_RECOVERY_SENT)
  })

  test('technical messages without a known code become a plain sentence; plain ones pass through', () => {
    for (const message of ['Your application profile is inconsistent.', 'Your account has an unsupported status.', 'The application service is not configured correctly.', 'Tenant workspace missing', '']) {
      const text = friendlyAuthMessage({ ok: false, code: 'SOMETHING_NEW', message })
      assert.equal(text, 'We could not open your shop right now. Try again in a moment.', message)
    }
    assert.equal(friendlyAuthMessage({ ok: false, code: 'X', message: 'This confirmation link is invalid or has expired.' }), 'This confirmation link is invalid or has expired.')
    assert.equal(friendlyAuthMessage(null), '')
  })

  test('no screen word mentions tenants, workspaces or authentication', () => {
    const code = ['../components/auth/AuthShell.jsx', ...AUTH_SCREEN_FILES].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
    // Only what reaches the screen: quoted text and the text between tags.
    const screens = [...code.matchAll(/="([^"]+)"|>([^<>{}]+)<|'([^'\n]+)'/gu)].map((match) => match[1] ?? match[2] ?? match[3]).join('\n')
    const messages = readFileSync(new URL('./auth-messages.js', import.meta.url), 'utf8').match(/^\s+[A-Z_]+: '[^']+'|^export const FRIENDLY_RECOVERY_SENT = '[^']+'|^const GENERIC = '[^']+'/gmu).join('\n')
    assert.doesNotMatch(screens + messages, /\b(tenant|workspace|authenticat\w*)\b/iu)
  })

  test('the login form checks the email and password before sending', () => {
    assert.deepEqual(validateLogin({ email: '', password: '' }), { email: 'Enter the email you use for your shop.', password: 'Enter your password.' })
    assert.deepEqual(validateLogin({ email: 'rana@shop', password: 'x' }), { email: 'Enter the email you use for your shop.' })
    assert.deepEqual(validateLogin({ email: ' rana@shop.com ', password: 'x' }), {})
    assert.equal(isLikelyEmail('a b@c.d'), false); assert.equal(isLikelyEmail(undefined), false)
  })
})

describe('sign-in screens', () => {
  test('the frame has the silk panel, the brand, the sales card and the stitched card, inside the .site scope', () => {
    const page = html(shell.AuthShell, { title: 'Welcome back', subtitle: 'Log in to your shop.', footer: 'Footer text' }, createElement('p', null, 'Form'))
    assert.ok(page.startsWith('<div class="site" dir="ltr" lang="en"><div class="auth"><aside class="auth__aside"><div class="hero3d__canvas" aria-hidden="true"></div>'))
    assert.ok(page.includes('<a href="/" class="auth__brand" aria-label="SaaS2 home"><span class="brand__mark">S2</span><span class="brand__name">SaaS2</span></a>'))
    assert.ok(page.includes('<p class="auth__quote">Your shop, ready when you are.</p>'))
    assert.ok(page.includes('<span class="glass__label">Sales today</span><span class="glass__value">$184 · 9 receipts</span>'))
    assert.ok(page.includes('<main class="auth__main" id="content"><div class="auth-card"><h1 class="auth-card__title">Welcome back</h1><p class="auth-card__subtitle">Log in to your shop.</p><p>Form</p><p class="auth-card__footer">Footer text</p>'))
  })

  test('a field with an error is marked invalid and points to the message under it', () => {
    const field = html(shell.AuthTextField, { id: 'email', label: 'Email', type: 'email', inputMode: 'email', autoComplete: 'email', value: 'x', onChange: () => {}, error: 'Enter the email you use for your shop.' })
    const input = field.match(/<input[^>]*>/u)[0]
    for (const part of ['id="email"', 'name="email"', 'type="email"', 'inputMode="email"', 'autoComplete="email"', 'aria-invalid="true"', 'aria-describedby="email-error"']) assert.ok(input.includes(part), part)
    assert.ok(field.includes('<p class="field__error" id="email-error">Enter the email you use for your shop.</p>'))
    const fine = html(shell.AuthTextField, { id: 'email', label: 'Email', value: '', onChange: () => {} })
    assert.doesNotMatch(fine, /aria-invalid|aria-describedby|field__error/u)
  })

  test('the password field has a Show button that says whether the password is visible', () => {
    const field = html(shell.AuthPasswordField, { id: 'password', label: 'Password', autoComplete: 'current-password', value: '', onChange: () => {}, error: 'Enter your password.', extra: createElement('button', { type: 'button', className: 'field__link' }, 'Forgot password?') })
    assert.ok(field.includes('type="password"') && field.includes('autoComplete="current-password"'))
    assert.ok(field.includes('<button type="button" class="field__toggle" aria-controls="password" aria-pressed="false" aria-label="Show password">Show</button>'))
    assert.ok(field.includes('aria-invalid="true" aria-describedby="password-error"'))
    assert.ok(field.includes('<div class="field__top"><label for="password">Password</label><button type="button" class="field__link">Forgot password?</button></div>'))
    const hinted = html(shell.AuthPasswordField, { id: 'new', label: 'Password', value: '', onChange: () => {}, hint: 'At least 8 characters.' })
    assert.ok(hinted.includes('aria-describedby="new-hint"') && hinted.includes('<p class="field__hint" id="new-hint">At least 8 characters.</p>'))
  })

  test('while sending, the button shows a spinner, says what is happening and cannot be tapped again', () => {
    const busy = html(shell.AuthSubmit, { busy: true, busyLabel: 'Logging in…' }, 'Log in')
    assert.equal(busy, '<button type="submit" class="btn btn--primary btn--block" disabled="" aria-busy="true"><span class="spinner" aria-hidden="true"></span>Logging in…</button>')
    assert.equal(html(shell.AuthSubmit, { busy: false, busyLabel: 'Logging in…' }, 'Log in'), '<button type="submit" class="btn btn--primary btn--block" aria-busy="false">Log in</button>')
    assert.ok(html(shell.AuthNotice, { kind: 'error' }, 'Wrong email or password.').includes('class="auth-notice auth-notice--error" role="alert"'))
    assert.ok(html(shell.AuthNotice, { kind: 'success' }, 'Sent').includes('role="status"'))
    assert.equal(html(shell.AuthNotice, { kind: 'error' }), '')
  })

  test('the login page opens in the new frame while it checks for an existing login', () => {
    const page = html(LoginPage, {})
    assert.ok(page.includes('<h1 class="auth-card__title">Welcome back</h1>'))
    assert.ok(page.includes('Checking if you are already logged in…'))
    assert.ok(page.includes('New to SaaS2? <a href="/signup">Create an account</a>'))
    const source = readFileSync(new URL('../pages/LoginPage.jsx', import.meta.url), 'utf8')
    for (const kept of ['resolveExistingSessionDestination({ supabase })', 'signInApplicationUser({ supabase, email, password })', 'requestPasswordRecovery({ supabase, email, origin: window.location.origin })', 'window.location.replace(result.redirectTo)', 'actionGuard.run']) {
      assert.ok(source.includes(kept), `the sign-in logic is unchanged: ${kept}`)
    }
    assert.ok(source.includes('autoComplete="current-password"') && source.includes('inputMode="email"') && source.includes('noValidate'))
  })

  test('the sign up page keeps the real fields (email, password, the password again) in the new frame', () => {
    const page = html(SignupPage, {})
    assert.ok(page.includes('<h1 class="auth-card__title">Create your shop account</h1>'))
    assert.ok(page.includes('<p class="auth-card__subtitle">Set up in a few minutes. No card needed.</p>'))
    for (const [id, name, autoComplete] of [['signup-email', 'email', 'email'], ['signup-password', 'password', 'new-password'], ['signup-confirm-password', 'confirmPassword', 'new-password']]) {
      const input = page.match(new RegExp(`<input id="${id}"[^>]*>`, 'u'))?.[0] ?? ''
      assert.ok(input.includes(`name="${name}"`) && input.includes(`autoComplete="${autoComplete}"`), id)
    }
    assert.ok(page.includes('inputMode="email"'))
    assert.ok(page.includes('<p class="field__hint" id="signup-password-hint">At least 8 characters.</p>'))
    assert.equal((page.match(/class="field__toggle"/gu) ?? []).length, 2, 'both passwords can be shown')
    assert.ok(page.includes('<button type="submit" class="btn btn--primary btn--block" aria-busy="false">Create account</button>'))
    assert.ok(page.includes('Already have an account? <a href="/login">Log in</a>'))
    const source = readFileSync(new URL('../pages/SignupPage.jsx', import.meta.url), 'utf8')
    assert.ok(source.includes('requestOwnerSignup({ supabase, ...form, origin: window.location.origin })') && source.includes('submissionGuard.run'), 'the sign up logic is unchanged')
  })

  test('sign up problems show under the field they belong to', () => {
    const at = (code, values) => fieldErrorFor({ ok: false, code, message: 'x' }, values)
    assert.deepEqual(at('INVALID_SIGNUP_EMAIL'), { field: 'email', text: 'Enter a valid email, like name@shop.com.' })
    assert.deepEqual(at('SIGNUP_PASSWORD_REQUIRED', { password: '' }), { field: 'password', text: 'Choose a password.' })
    assert.deepEqual(at('SIGNUP_PASSWORD_REQUIRED', { password: 'abcdefgh' }), { field: 'confirmPassword', text: 'Type your password again.' })
    assert.deepEqual(at('SIGNUP_PASSWORD_MISMATCH'), { field: 'confirmPassword', text: 'The two passwords are not the same.' })
    assert.deepEqual(at('SIGNUP_PASSWORD_TOO_SHORT'), { field: 'password', text: 'Use at least 8 characters.' })
    assert.equal(at('OWNER_SIGNUP_FAILED'), null, 'a failure from the server shows above the button')
    assert.equal(friendlyAuthMessage({ ok: false, code: 'OWNER_SIGNUP_FAILED' }), 'We could not create your account. Try again, or log in if you already have one.')
    assert.equal(friendlyAuthMessage({ ok: true, message: OWNER_SIGNUP_MESSAGE }), 'We sent you an email. Open the link in it to confirm your address, then set up your shop.')
    assert.equal(fieldErrorFor({ ok: true }), null)
  })

  test('a finished step shows a green check, the message and the way back', () => {
    const done = html(shell.AuthDone, { message: 'We sent you an email.' }, createElement(shell.AuthLinkButton, { href: '/login' }, 'Back to log in'))
    assert.ok(done.startsWith('<div class="success auth-done"><span class="success__icon"><svg'))
    assert.ok(done.includes('<p class="auth-notice auth-notice--success" role="status">We sent you an email.</p>'))
    assert.ok(done.includes('<a class="btn btn--outline btn--block" href="/login">Back to log in</a>'))
  })

  test('every other sign-in screen opens in the same frame while it checks the link or the account', () => {
    const waiting = {
      AuthCallbackPage: ['Checking your link', 'Checking your link…'],
      SignupCallbackPage: ['Confirming your email', 'Confirming your email…'],
      SetPasswordPage: ['Choose your password', 'Checking your link…'],
      OwnerOnboardingPage: ['Set up your shop', 'Checking your account…'],
      PendingApprovalPage: ['We are checking your shop', 'Checking your account…'],
      InactiveAccountPage: ['Your shop is not active', 'Checking your account…'],
    }
    for (const [name, [title, label]] of Object.entries(waiting)) {
      const page = html(otherScreens[name], {})
      assert.ok(page.startsWith('<div class="site" dir="ltr" lang="en"><div class="auth"><aside class="auth__aside">'), name)
      assert.ok(page.includes(`<h1 class="auth-card__title">${title}</h1>`), `${name}: ${title}`)
      assert.ok(page.includes(`<span class="spinner spinner--dark" aria-hidden="true"></span>${label}</p>`), `${name}: ${label}`)
    }
    assert.ok(html(otherScreens.OwnerOnboardingPage, {}).includes('Log out</button>'), 'the owner can still log out while setting up')
  })

  test('the other screens keep their logic', () => {
    const kept = {
      AuthCallbackPage: ['completeAuthCallback({', 'exchangeCode: exchangeAuthCallbackCode', "clearUrl: () => window.history.replaceState(null, '', '/auth/callback')"],
      SignupCallbackPage: ['completeSignupCallback({', "clearUrl: () => window.history.replaceState(null, '', '/auth/signup-callback')"],
      SetPasswordPage: ['verifyPasswordSetupSession({ supabase, storage: window.sessionStorage })', 'updateInvitedUserPassword({ supabase, storage: window.sessionStorage, newPassword, confirmPassword })', 'submissionLock.current', 'useDirtyState(', 'window.setTimeout(() => window.location.replace(result.redirectTo), 1200)'],
      OwnerOnboardingPage: ['loadOwnerOnboarding({ supabase })', 'bootstrapOwnerAccount({ supabase, input: form })', "window.location.replace('/pending-approval')", "window.location.replace('/login')", 'useDirtyState('],
      AccountStatusPage: ['fetchCurrentApplicationUser({ supabase })', "window.location.replace('/owner/onboarding')", 'getPendingAccountView(result.profile)', 'logoutBusinessApp({ supabase', "(mode === 'pending' && isInactive) || (mode === 'inactive' && !isInactive)"],
    }
    for (const [name, parts] of Object.entries(kept)) {
      const source = readFileSync(new URL(`../pages/${name}.jsx`, import.meta.url), 'utf8')
      for (const part of parts) assert.ok(source.includes(part), `${name}: ${part}`)
    }
    for (const path of AUTH_SCREEN_FILES) {
      assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), 'utf8'), /components\/auth\/AuthLayout|LogoutAction/u, `${path} uses the new frame`)
    }
  })

  test('shop setup answers that need fixing show under their field', () => {
    const invalid = (message) => ({ ok: false, code: 'OWNER_ONBOARDING_INVALID', message })
    const empty = { firstName: 'Rana', lastName: ' ', accountName: '', baseCurrency: 'USD', employeeCode: '' }
    assert.deepEqual(onboardingFieldErrors(invalid('Complete all required onboarding fields.'), empty), { lastName: 'Enter your last name.', accountName: 'Enter your shop name.' })
    assert.deepEqual(onboardingFieldErrors(invalid('One or more onboarding fields are too long.'), { ...empty, accountName: 'x'.repeat(161) }), { accountName: 'This is too long. Make it shorter.' })
    assert.deepEqual(onboardingFieldErrors(invalid('Choose a supported base currency.'), empty), { baseCurrency: 'Choose USD or LBP.' })
    assert.deepEqual(onboardingFieldErrors(invalid('Employee code may contain only letters, numbers, hyphens, or underscores.'), empty), { employeeCode: 'Use only letters, numbers, - and _.' })
    assert.deepEqual(onboardingFieldErrors({ ok: false, code: 'OWNER_BOOTSTRAP_UNEXPECTED_RESPONSE' }, empty), {})
    assert.equal(friendlyAuthMessage({ ok: false, code: 'OWNER_BOOTSTRAP_UNEXPECTED_RESPONSE', message: 'Store setup could not be completed.' }), 'We could not save your shop. Try again.')
  })

  test('approval states read simply', () => {
    assert.deepEqual(Object.keys(ACCOUNT_STATUS_VIEW), ['PENDING', 'REJECTED', 'SUSPENDED'])
    assert.equal(ACCOUNT_STATUS_VIEW.PENDING.label, 'Waiting for approval'); assert.equal(ACCOUNT_STATUS_VIEW.SUSPENDED.title, 'Your shop is paused')
    for (const view of Object.values(ACCOUNT_STATUS_VIEW)) assert.doesNotMatch(Object.values(view).join(' '), /platform|tenant|workspace/iu)
    assert.equal(friendlyAuthMessage({ ok: false, code: 'INVITATION_INVALID', message: 'This invitation link is invalid or has expired.' }), 'This link is not valid anymore. Ask for a new one.')
    assert.deepEqual(fieldErrorFor({ ok: false, code: 'PASSWORD_REQUIRED' }, { newPassword: '' }), { field: 'password', text: 'Choose a password.' })
    assert.deepEqual(fieldErrorFor({ ok: false, code: 'PASSWORD_MISMATCH' }, {}), { field: 'confirmPassword', text: 'The two passwords are not the same.' })
  })

  test('inputs are 16px and every tap target is at least 44px', () => {
    assert.match(siteCss, /\.site \.field input, \.site \.field select, \.site \.field textarea \{\s+min-height: 50px;[^}]*font: 16px var\(--font-body\)/u)
    assert.match(siteCss, /\.site \.field__toggle \{ min-height: 44px; \}/u)
    assert.match(siteCss, /\.site \.field__link \{ min-height: 44px; \}/u)
    assert.match(siteCss, /\.site \.btn \{[^}]*min-height: 52px/u)
  })
})
