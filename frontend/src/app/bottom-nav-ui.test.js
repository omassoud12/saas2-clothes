import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let vite
let BottomNav
let MoreSheet

before(async () => {
  vite = await createServer({ root, configFile: false, plugins: [react()], logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } })
  BottomNav = (await vite.ssrLoadModule('/src/app/BottomNav.jsx')).BottomNav
  MoreSheet = (await vite.ssrLoadModule('/src/app/MoreSheet.jsx')).MoreSheet
})
after(async () => { await vite?.close() })

const identity = { storeName: 'Mini Store', userName: 'Sam Owner', role: 'OWNER' }
const noop = () => {}
const bar = (role, pathname, extra = {}) => renderToStaticMarkup(createElement(BottomNav, { role, pathname, onNavigate: noop, onOpenMore: noop, moreOpen: false, ...extra }))
const sheet = (role, extra = {}) => renderToStaticMarkup(createElement(MoreSheet, { role, identity: { ...identity, role }, pathname: '/app/dashboard', loggingOut: false, onNavigate: noop, onLogout: noop, onClose: noop, ...extra }))

describe('phone bottom navigation', () => {
  test('shows Home, Products, Sell in the center, History and More, in that order', () => {
    const html = bar('OWNER', '/app/dashboard')
    const order = ['>Home<', '>Products<', '>Sell<', '>History<', '>More<'].map((label) => html.indexOf(label))
    assert.ok(order.every((index) => index > 0), 'all five labels are present')
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'the labels appear in the expected order')
    assert.equal((html.match(/<li>/g) || []).length, 5)
    for (const href of ['/app/dashboard', '/app/products', '/app/sales', '/app/history']) assert.ok(html.includes(`href="${href}"`), href)
    assert.match(html, /<nav class="bottom-nav" aria-label="Main navigation">/u)
    assert.doesNotMatch(html, /Entry|Sales \/ POS|Dashboard</u)
  })

  test('Sell is the highlighted main action and the current page is marked', () => {
    const html = bar('OWNER', '/app/sales')
    assert.match(html, /class="is-active is-primary" href="\/app\/sales" aria-current="page"/u)
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1)
    assert.match(bar('OWNER', '/app/dashboard'), /class="is-active" href="\/app\/dashboard" aria-current="page"/u)
    assert.match(bar('OWNER', '/app/products/11111111-1111-4111-8111-111111111111'), /class="is-active" href="\/app\/products"/u)
  })

  test('More is a button that opens a dialog and lights up for pages that live under it', () => {
    const idle = bar('OWNER', '/app/dashboard')
    assert.match(idle, /<button type="button" aria-haspopup="dialog" aria-expanded="false">/u)
    assert.match(bar('OWNER', '/app/expenses'), /<button type="button" class="is-active" aria-haspopup="dialog"/u)
    assert.match(bar('OWNER', '/app/dashboard', { moreOpen: true }), /aria-expanded="true"/u)
    assert.doesNotMatch(bar('WAREHOUSE', '/app/expenses'), /<button type="button" class="is-active"/u)
  })

  test('the More sheet lists the remaining modules, the store and Logout for OWNER', () => {
    const html = sheet('OWNER')
    assert.match(html, /<dialog[^>]*aria-labelledby="more-sheet-title"/u)
    for (const text of ['>More<', 'New product', 'Categories', 'Returns', 'Exchanges', 'Expenses', 'Business', 'Mini Store', 'Sam Owner', 'Logout']) {
      assert.ok(html.includes(text), text)
    }
    assert.doesNotMatch(html, />Sell<|>Products<|Sales history/u, 'the bar items are not repeated')
  })

  test('WAREHOUSE never sees Expenses or Business, and Logout is disabled while signing out', () => {
    const html = sheet('WAREHOUSE')
    assert.ok(html.includes('New product') && html.includes('Categories'))
    assert.doesNotMatch(html, /Expenses|Business/u)
    const busy = sheet('WAREHOUSE', { loggingOut: true })
    assert.match(busy, /disabled=""[^>]*>Signing out\.\.\./u)
  })
})
