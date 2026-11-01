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

  test('the hero has the silk canvas, the sewing scene with the receipt, and the stock card', () => {
    const html = render('/')
    const hero = html.slice(html.indexOf('<section class="hero3d">'), html.indexOf('</section>'))
    assert.ok(hero.includes('<div class="hero3d__canvas" aria-hidden="true"></div>'), 'the WebGL canvas is added on the client')
    assert.ok(hero.includes('<div class="hero3d__fade" aria-hidden="true"></div>'))
    assert.ok(hero.includes('<div class="stitch" aria-hidden="true">'))
    for (const text of ['SaaS2', '#1024', 'Linen shirt · M', '$25', 'Midi dress · S', '$42', 'Total', '$67', '≈ 5,996,500 LBP']) assert.ok(hero.includes(`>${text}</text>`), text)
    assert.ok(hero.includes('<span class="glass__label">Stock updated</span><span class="glass__value">Linen shirt · M · 7 left</span>'))
    assert.ok(hero.includes('<span class="is-on">M</span>'))
    assert.ok(hero.indexOf('hero3d__canvas') < hero.indexOf('hero3d__fade') && hero.indexOf('stitch') < hero.indexOf('hero3d__content'), 'silk, fade, sewing scene, then the text on top')
  })

  test('the hero animations keep the reference behavior: capped pixel ratio, paused off screen, reduced motion', () => {
    const silk = readFileSync(new URL('./components/HeroSilk.jsx', import.meta.url), 'utf8')
    const stitch = readFileSync(new URL('./components/HeroStitch.jsx', import.meta.url), 'utf8')
    assert.match(silk, /Math\.min\(window\.devicePixelRatio \|\| 1, 1\.75\)/u)
    assert.match(silk, /IntersectionObserver/u)
    assert.match(silk, /if \(reduceMotion\) \{\s+draw\(8\)/u, 'reduced motion draws a single frame')
    assert.doesNotMatch(silk, /three/u)
    assert.match(stitch, /if \(reduceMotion\) \{\s+render\(3\.9\)/u, 'reduced motion shows the finished scene')
    assert.equal((stitch.match(/^ {2}'M /gmu) ?? []).length, 4, 'four seams')
    assert.equal((stitch.match(/300 128',$/gmu) ?? []).length, 4, 'every seam ends at the receipt')
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
