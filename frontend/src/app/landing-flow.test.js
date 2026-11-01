import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { authorizeBusinessProfile } from './app-flow.js'
import { getAppNavigation } from './app-navigation.js'
import { findLandingRedirect, LANDING_CTA_ROUTES, LANDING_ROUTE_CONTRACT, isLandingRoute, landingRedirectFor } from './landing-flow.js'
import { isBusinessPath, isSitePath, ROUTES } from './routes.js'
import { splitSiteHref } from '../site/site-router.js'

describe('public site routes', () => {
  test('landing, about and contact are public pages outside the app', () => {
    for (const path of ['/', '/about', '/contact', '/about/', '/contact/']) {
      assert.equal(isSitePath(path), true, path)
      assert.equal(isBusinessPath(path), false, path)
    }
    for (const path of ['/app', '/app/sales', '/login', '/about/team', '/contacts']) assert.equal(isSitePath(path), false, path)
  })

  test('section links split into the page and the section', () => {
    assert.deepEqual(splitSiteHref('/#features'), { pathname: '/', hash: '#features' })
    assert.deepEqual(splitSiteHref('/about'), { pathname: '/about', hash: '' })
    assert.deepEqual(splitSiteHref('/contact/'), { pathname: '/contact', hash: '' })
    assert.deepEqual(splitSiteHref('/#'), { pathname: '/', hash: '' })
  })

  test('a signed-in user who opens the landing page goes to the app; anyone else stays', async () => {
    const session = { user: { id: 'u1' }, access_token: 'token' }
    assert.equal(landingRedirectFor(session), ROUTES.app)
    assert.equal(landingRedirectFor(null), null)
    assert.equal(landingRedirectFor({ user: { id: 'u1' }, access_token: '' }), null)
    const client = (result) => ({ auth: { getSession: async () => result } })
    assert.equal(await findLandingRedirect(client({ data: { session }, error: null })), ROUTES.app)
    assert.equal(await findLandingRedirect(client({ data: { session: null }, error: null })), null)
    assert.equal(await findLandingRedirect(client({ data: { session }, error: new Error('expired') })), null)
    assert.equal(await findLandingRedirect({ auth: { getSession: async () => { throw new Error('offline') } } }), null)
    assert.equal(await findLandingRedirect(null), null, 'without Supabase the landing simply shows')
  })
})

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
