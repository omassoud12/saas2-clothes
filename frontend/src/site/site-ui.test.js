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
    for (const [href, label] of [['/#product', 'Product'], ['/#business', 'Business types'], ['/#features', 'Features'], ['/#hardware', 'Hardware'], ['/about', 'About'], ['/contact', 'Contact'], ['/login', 'Log in']]) {
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
    assert.ok(html.includes('<a href="/login" class="text-link">Log in</a>'), 'customers with an account sign in from the hero')
    assert.doesNotMatch(html, /See features/u)
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

  test('the product section has three step cards with their app pictures under one zipper', () => {
    const html = render('/')
    const product = html.slice(html.indexOf('id="product"'), html.indexOf('id="business"'))
    assert.equal((product.match(/<li class="step-card">/gu) ?? []).length, 3)
    for (const [i, title] of ['Get your account', 'Add your products', 'Start selling'].entries()) {
      assert.ok(product.includes(`<span class="step-card__num">Step ${i + 1}</span><span class="step-card__of">of 3</span></div><h3 class="step-card__title">${title}</h3>`), title)
    }
    for (const text of ['<strong>Owner</strong><span>Full access</span>', '<strong>Staff</strong><span>Sells, never sees costs</span>', '<strong>Linen shirt</strong><span>$25 a piece</span>',
      '<span>S<em>4</em></span><span class="is-on">M<em>12</em></span><span>L<em>6</em></span><span>XL<em>2</em></span>', '<strong>Sale completed · $67</strong>', 'Linen shirt · M · 11 left']) {
      assert.ok(product.includes(text), text)
    }
    const cover = product.slice(product.indexOf('<svg class="zip-panel__cover"'))
    assert.ok(cover.includes('aria-hidden="true"'))
    assert.ok(cover.includes('>Scroll to open</text>'))
    for (const part of ['zp-shadow', 'zp-tape', 'zp-stitch', 'zp-lip', 'zp-teeth', 'zp-shine', 'zp-fold', 'zp-fold-light']) {
      assert.equal((cover.match(new RegExp(`class="${part}"`, 'gu')) ?? []).length >= 2, true, `${part} on both edges`)
    }
    assert.ok(cover.includes('data-half="-1"') && cover.includes('data-weave="1"') && cover.includes('id="s2-weave"') && cover.includes('id="s2-zip-blur"'))
  })

  test('the zipper keeps the reference motion: pull at 85% of the screen, ripple every frame on screen, open with reduced motion', () => {
    const zipper = readFileSync(new URL('./components/StepStack.jsx', import.meta.url), 'utf8')
    assert.match(zipper, /window\.innerHeight \* 0\.85 - box\.top/u)
    assert.match(zipper, /IntersectionObserver/u)
    assert.match(zipper, /if \(!visible\) return/u)
    assert.match(zipper, /if \(reduceMotion\) \{\s+draw\(wrap\.offsetHeight \* 4, 0\)/u, 'fully open, no ripple')
  })

  test('business types hang on the clothing rail: two rails of three, each garment with a label tag', () => {
    const html = render('/')
    const business = html.slice(html.indexOf('id="business"'), html.indexOf('id="features"'))
    assert.equal((business.match(/<div class="rack__row">/gu) ?? []).length, 2)
    assert.equal((business.match(/<div class="rack__rail" aria-hidden="true"><\/div>/gu) ?? []).length, 2)
    const labels = [...business.matchAll(/<span class="hang__label">([^<]+)<\/span>/gu)].map((match) => match[1])
    assert.deepEqual(labels, ['Boutiques', 'Kids&#x27; wear', 'Shoe stores', 'Sportswear', 'Modest fashion', 'Accessories &amp; bags'])
    const delays = [...business.matchAll(/--d:(-?[\d.]+)s/gu)].map((match) => Number(match[1]))
    assert.equal(delays.length, 6); assert.equal(new Set(delays).size, 6, 'staggered sway')
    const css = siteCss
    assert.match(css, /\.site \.hang \{[^}]*animation: hang-sway 4\.6s ease-in-out infinite/u)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.site \.hang, \.site \.hang\.is-swinging \{ animation: none; \} \}/u)
  })

  test('features, hardware, questions and the final call to action are on the landing', () => {
    const html = render('/')
    for (const title of ['Quick selling', 'Dollars and lira', 'Every way to pay', 'Stock by size', 'WhatsApp receipts', 'Arabic and English']) {
      assert.ok(html.includes(`>${title}</h3>`), title)
    }
    assert.equal((html.match(/<div class="tile">/gu) ?? []).length, 6)
    assert.ok(html.includes('<summary>See the full feature list<span class="disclosure__plus" aria-hidden="true">+</span></summary>'))
    assert.equal((html.match(/<ul class="disclosure__list">(.*?)<\/ul>/su)[1].match(/<li>/gu) ?? []).length, 11)
    for (const device of ['Phone', 'Tablet', 'Laptop']) assert.ok(html.includes(`</svg>${device}</div>`), device)
    assert.equal((html.match(/<details class="disclosure">/gu) ?? []).length, 4, 'the feature list and three questions, all closed')
    assert.doesNotMatch(html, /<details[^>]* open/u)
    assert.ok(html.includes('See it with products like yours'))
    assert.equal((html.match(/href="\/contact" class="btn btn--primary">Book a free demo<\/a>/gu) ?? []).length, 2)
    assert.ok(html.includes('From <strong>[YOUR PRICE]</strong> a month'))
  })

  test('the about page has the reasons, the values, the company facts and a link to contact', () => {
    const html = render('/about')
    for (const title of ['Why we built it', 'What we care about', 'The company']) assert.ok(html.includes(`>${title}</h2>`), title)
    assert.equal((html.match(/<article class="card"/gu) ?? []).length, 8)
    for (const fact of ['<dt>Company</dt><dd>UltraScaling</dd>', '<dt>Product</dt><dd>SaaS2</dd>', '<dt>Based in</dt><dd>[YOUR CITY], Lebanon</dd>', '<dt>Founded</dt><dd>[YEAR]</dd>']) {
      assert.ok(html.includes(fact), fact)
    }
    assert.ok(html.includes('<a href="/contact" class="btn btn--primary">Talk to us</a>'))
  })

  test('the contact page has the ways to reach us and the form; sending shows the thanks message', () => {
    const html = render('/contact')
    assert.ok(html.includes('class="way way--primary" href="https://wa.me/" target="_blank" rel="noopener noreferrer"'))
    for (const value of ['[YOUR WHATSAPP NUMBER]', '[YOUR EMAIL]', '[YOUR CITY], Lebanon', '[YOUR WORKING HOURS]']) assert.ok(html.includes(`<span class="way__value">${value}</span>`), value)
    assert.ok(html.includes('href="mailto:[YOUR EMAIL]"'))
    for (const [id, name] of [['c-name', 'name'], ['c-shop', 'shop'], ['c-phone', 'phone']]) {
      const input = html.match(new RegExp(`<input id="${id}"[^>]*>`, 'u'))?.[0] ?? ''
      assert.ok(input.includes(`name="${name}"`) && input.includes('required=""'), name)
    }
    assert.equal((html.match(/<option[^>]*>/gu) ?? []).length, 11, 'six shop types and Other, four reasons')
    assert.ok(html.includes('<button type="submit" class="btn btn--primary">Send message</button>'))
    const contactPage = readFileSync(new URL('./pages/Contact.jsx', import.meta.url), 'utf8')
    assert.match(contactPage, /TODO: send `data` to your backend/u, 'the real API is still to be connected')
    assert.match(contactPage, /e\.preventDefault\(\)[\s\S]*setSent\(true\)/u)
    assert.ok(contactPage.includes('Thanks, we got your message') && contactPage.includes('We will reply on WhatsApp within {contact.replyTime}.'))
  })

  test('every page sets its own title and description, and index.html has Open Graph and the SoftwareApplication data', () => {
    const titles = {
      Home: 'SaaS2 · POS for clothing shops in Lebanon',
      About: 'About SaaS2 · UltraScaling',
      Contact: 'Contact SaaS2 · Book a free demo',
    }
    for (const [page, title] of Object.entries(titles)) {
      const source = readFileSync(new URL(`./pages/${page}.jsx`, import.meta.url), 'utf8')
      assert.match(source, new RegExp(`useSeo\\(\\s+'${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s+'[^']{80,}'`, 'u'), page)
    }
    const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    assert.ok(indexHtml.includes('<title>SaaS2 · POS for clothing shops in Lebanon</title>'))
    for (const tag of ['property="og:type" content="website"', 'property="og:title"', 'property="og:description"', 'name="theme-color" content="#FCF7F5"']) assert.ok(indexHtml.includes(tag), tag)
    const jsonLd = JSON.parse(indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)[1])
    assert.equal(jsonLd['@type'], 'SoftwareApplication'); assert.equal(jsonLd.publisher.name, 'UltraScaling')
    assert.doesNotMatch(indexHtml, /fonts\.googleapis/u, 'the fonts load only on the public pages')
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
