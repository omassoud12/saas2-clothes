import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const siteCss = readFileSync(new URL('./site.css', import.meta.url), 'utf8')
let vite
let SiteRoot

before(async () => {
  const authFixture = { name: 'site-auth-fixture', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/lib/supabase.js')) return '\0site-auth' },
    load(id) { if (id === '\0site-auth') return 'export const supabase = null' },
  }
  vite = await createServer({ root, configFile: false, plugins: [authFixture, react()], logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } })
  SiteRoot = (await vite.ssrLoadModule('/src/site/SiteRoot.jsx')).SiteRoot
})
after(async () => { await vite?.close() })

const render = (pathname) => renderToStaticMarkup(createElement(SiteRoot, { pathname, navigate: () => {} }))

describe('public site', () => {
  test('every page has the navbar, the footer and a skip link inside the scoped .site root', () => {
    for (const path of ['/', '/about', '/contact']) {
      const html = render(path)
      assert.ok(html.startsWith('<div class="site" dir="ltr" lang="en">'), path)
      assert.ok(html.includes('class="skip-link" href="#content"'), path)
      assert.ok(html.includes('<span class="brand__mark">S2</span><span class="brand__name">SaaS2</span>'), path)
      assert.ok(html.includes('<main id="content">'), path)
      assert.match(html, /© \d{4} UltraScaling · SaaS2/u)
    }
  })

  test('the navbar links scroll to the landing sections and open the about and contact pages', () => {
    const html = render('/')
    for (const [href, label] of [['/#product', 'Product'], ['/#business', 'Business types'], ['/#features', 'Features'], ['/#hardware', 'Hardware'], ['/about', 'About'], ['/contact', 'Contact']]) {
      assert.ok(html.includes(`href="${href}">${label}</a>`), label)
    }
    for (const id of ['product', 'business', 'features', 'hardware']) assert.ok(html.includes(`id="${id}"`), id)
    assert.ok(html.includes('aria-expanded="false"') && html.includes('aria-label="Open menu"'), 'the phone menu starts closed')
    assert.doesNotMatch(html, /aria-current/u, 'no page link is current on the landing')
    assert.ok(render('/about').includes('href="/about" aria-current="page">About</a>'))
    assert.ok(render('/contact').includes('href="/contact" aria-current="page">Contact</a>'))
  })

  test('the landing hero has the title, the subtitle and both actions', () => {
    const html = render('/')
    assert.ok(html.includes('Your clothing shop, on your phone.'))
    assert.ok(html.includes('Sell in dollars or lira, and track every size.'))
    assert.ok(html.includes('<a href="/contact" class="btn btn--primary">Book a free demo</a>'))
    assert.ok(html.includes('<a href="#features" class="text-link">See features</a>'))
    assert.ok(render('/about').includes('SaaS2 is built by UltraScaling'))
    assert.ok(render('/contact').includes('Talk to us'))
  })

  test('every site style is scoped under .site so the app is untouched', () => {
    const rules = siteCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
    const selectors = [...rules.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) => match[1].replace(/@media[^{]+\{/g, '').split(','))
      .map((selector) => selector.trim()).filter(Boolean)
    assert.ok(selectors.length > 100)
    const unscoped = selectors.filter((selector) => !/^\.site(?![\w-])/.test(selector) && !/^(html|body):has\(\.site\)/.test(selector))
    assert.deepEqual(unscoped, [])
  })
})
