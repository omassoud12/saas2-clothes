import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { authorizeBusinessProfile } from './app-flow.js'
import { getAppNavigation } from './app-navigation.js'
import { LANDING_CTA_ROUTES, LANDING_ROUTE_CONTRACT, isLandingRoute } from './landing-flow.js'
import { isBusinessPath, ROUTES } from './routes.js'

describe('public landing route contract', () => {
  test('the root route is public and makes no tenant business request', () => {
    assert.equal(isLandingRoute('/'), true)
    assert.deepEqual(LANDING_ROUTE_CONTRACT, {
      path: '/',
      requiresAuthentication: false,
      businessApiRequests: [],
    })
  })

  test('authentication calls to action use centralized internal routes', () => {
    assert.deepEqual(LANDING_CTA_ROUTES, {
      createAccount: ROUTES.signup,
      login: ROUTES.login,
    })
  })

  test('protected application boundaries remain unchanged', () => {
    assert.equal(isBusinessPath(ROUTES.app), true)
    assert.equal(isBusinessPath(ROUTES.dashboard), true)
    assert.equal(isBusinessPath(ROUTES.home), false)
  })

  test('tenant role navigation and SUPER_ADMIN separation remain unchanged', () => {
    assert.ok(getAppNavigation('OWNER').some(({ key }) => key === 'reports'))
    assert.equal(getAppNavigation('WAREHOUSE').some(({ key }) => key === 'reports'), false)
    assert.deepEqual(getAppNavigation('SUPER_ADMIN'), [])
    assert.deepEqual(authorizeBusinessProfile({ user: { role: 'SUPER_ADMIN' }, account: null }), {
      ok: false,
      redirectTo: ROUTES.admin,
    })
  })
})
