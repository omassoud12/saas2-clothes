// Offline logout checks: synthetic auth and intercepted APIs, no live services.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const { chromium } = await import(pathToFileURL(process.env.QA_PLAYWRIGHT_MODULE || join(tmpdir(), 'saas2-products-qa/node_modules/playwright/index.mjs')).href)
let server, browser, origin
const profile = role => ({ user: { id: 'qa-user', accountId: 'qa-account', firstName: 'Store', lastName: 'Team', role }, account: role === 'SUPER_ADMIN' ? null : { id: 'qa-account', name: 'Sample store', baseCurrency: 'USD', status: 'ACTIVE' } })

before(async () => {
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {AdminPage} from '/src/pages/AdminPage.jsx';import {OwnerOnboardingPage} from '/src/pages/OwnerOnboardingPage.jsx';import {SetPasswordPage} from '/src/pages/SetPasswordPage.jsx';import {AccountStatusPage} from '/src/pages/AccountStatusPage.jsx';import {AppRouteGuard} from '/src/app/AppRouteGuard.jsx';import {AppLayout} from '/src/app/AppLayout.jsx';const params=new URLSearchParams(location.search);const view=params.get('view');const profile=${profile.toString()};const pages={admin:AdminPage,onboarding:OwnerOnboardingPage,password:SetPasswordPage,pending:()=>React.createElement(AccountStatusPage,{mode:'pending'}),inactive:()=>React.createElement(AccountStatusPage,{mode:'inactive'}),guard:()=>React.createElement(AppRouteGuard,{pathname:'/app/products',navigate:()=>{}})};const Page=pages[view]||(()=>React.createElement(AppLayout,{pathname:'/app/inventory',navigate:()=>{},profile:profile(params.get('role')||'OWNER')}));createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Page)));`
  server = await createServer({ configFile: false, root: resolve('frontend'), envDir: false,
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('') },
    plugins: [{ name: 'logout-offline', enforce: 'pre',
      resolveId(id) { if (id === '/logout-qa.jsx') return '\0logout-qa.jsx' },
      load(id) {
        if (id === '\0logout-qa.jsx') return entry
        if (id.replaceAll('\\', '/').endsWith('/src/lib/supabase.js')) return `export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'offline',user:{id:'qa-user'}}}}),signOut:async()=>{await window.recordSignOut();await new Promise(resolve=>setTimeout(resolve,150));if(window.failLogout)throw new Error('private server detail');return {error:null}}}};`
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/qa')) return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/qa', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/logout-qa.jsx"></script></body></html>'))
      }) },
    }, react()], server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking'] })
})
after(async () => { await browser?.close(); await server?.close() })

async function open(view, width = 390, role = 'OWNER') {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  page.setDefaultTimeout(5000)
  const calls = { signOut: 0, writes: 0 }
  await page.exposeFunction('recordSignOut', () => { calls.signOut += 1 })
  await page.addInitScript(() => sessionStorage.setItem('clothes.password-setup-session', JSON.stringify({ userId: 'qa-user', kind: 'invite', expiresAt: Date.now() + 60000 })))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<h1>Signed out</h1>' })
    if (url.pathname.startsWith('/api/')) {
      if (route.request().method() !== 'GET') { calls.writes += 1; return json({ error: { code: 'OFFLINE_WRITES_BLOCKED' } }, 403) }
      if (url.pathname === '/api/auth/me') {
        if (view === 'onboarding') return json({ error: { code: 'APPLICATION_USER_NOT_FOUND' } }, 403)
        if (view === 'guard') return json({ error: { code: 'PROFILE_UNAVAILABLE' } }, 500)
        const data = profile(view === 'admin' ? 'SUPER_ADMIN' : role)
        if (view === 'pending' || view === 'inactive') data.account.status = view === 'pending' ? 'PENDING' : 'SUSPENDED'
        return json(data)
      }
      if (url.pathname === '/api/admin/accounts/pending') return json({ accounts: [] })
      if (url.pathname === '/api/categories') return json({ categories: [] })
      return json({ error: { code: 'OFFLINE_UNKNOWN_API' } }, 404)
    }
    return route.continue()
  })
  await page.goto(`${origin}/qa?view=${view}&role=${role}`)
  return { page, calls }
}

for (const width of [390, 1440]) test(`Admin has usable Logout beside Refresh at ${width}px`, async () => {
  const { page, calls } = await open('admin', width)
  try {
    await page.getByRole('heading', { name: 'Account approvals', exact: true }).waitFor()
    const button = page.getByRole('button', { name: 'Logout', exact: true })
    const bounds = await button.boundingBox()
    assert.ok(bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width)
    await button.click()
    await page.waitForURL(`${origin}/login`)
    assert.deepEqual(calls, { signOut: 1, writes: 0 })
  } finally { await page.close() }
})

for (const role of ['OWNER', 'WAREHOUSE']) test(`${role} can logout from the mobile sidebar`, async () => {
  const { page, calls } = await open('store', 390, role)
  try {
    await page.getByRole('heading', { name: 'Product Entry', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await page.locator('#business-sidebar').getByRole('button', { name: 'Logout', exact: true }).click()
    await page.waitForURL(`${origin}/login`)
    assert.deepEqual(calls, { signOut: 1, writes: 0 })
  } finally { await page.close() }
})

test('Header logout remains available and two triggers share one pending operation', async () => {
  const { page, calls } = await open('store', 1440)
  try {
    await page.getByRole('heading', { name: 'Product Entry', exact: true }).waitFor()
    await page.evaluate(() => {
      document.querySelector('.business-logout-button').click()
      document.querySelector('.sidebar-logout-button').click()
    })
    await page.waitForURL(`${origin}/login`)
    assert.equal(calls.signOut, 1)
  } finally { await page.close() }
})

test('Failed logout stays on the page with a safe message and allows retry', async () => {
  const { page, calls } = await open('admin')
  try {
    await page.getByRole('heading', { name: 'Account approvals', exact: true }).waitFor()
    await page.evaluate(() => { window.failLogout = true })
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await page.getByRole('alert').getByText('Sign out could not be completed. Please try again.', { exact: true }).waitFor()
    assert.ok(page.url().includes('/qa'))
    assert.equal((await page.locator('body').innerText()).includes('private server detail'), false)
    await page.evaluate(() => { window.failLogout = false })
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await page.waitForURL(`${origin}/login`)
    assert.equal(calls.signOut, 2)
  } finally { await page.close() }
})

test('Cancelling logout preserves an onboarding draft; confirming signs out without another prompt', async () => {
  const { page, calls } = await open('onboarding')
  try {
    await page.getByLabel('Store name', { exact: true }).fill('Unsaved store')
    let dialogs = 0
    page.on('dialog', async dialog => { dialogs += 1; if (dialogs === 1) await dialog.dismiss(); else await dialog.accept() })
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    assert.equal(calls.signOut, 0)
    assert.equal(await page.getByLabel('Store name', { exact: true }).inputValue(), 'Unsaved store')
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await page.waitForURL(`${origin}/login`)
    assert.equal(dialogs, 2)
    assert.deepEqual(calls, { signOut: 1, writes: 0 })
  } finally { await page.close() }
})

for (const view of ['password', 'guard', 'pending', 'inactive']) test(`${view} retains a way to sign out`, async () => {
  const { page, calls } = await open(view)
  try {
    await page.getByRole('button', { name: /^(Logout|Sign out)$/ }).click()
    await page.waitForURL(`${origin}/login`)
    assert.deepEqual(calls, { signOut: 1, writes: 0 })
  } finally { await page.close() }
})
