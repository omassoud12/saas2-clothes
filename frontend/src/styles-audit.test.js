import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Static checks of the phone rules: text is at least 12px, text fields are at least 16px (iOS zooms the page into
// smaller ones) and buttons/links are at least 44px. Each screen is added to AUDITED when it has been fixed.
// An entry is a file, or { file, only } to check just the rules whose selectors match `only` (shared files).
const AUDITED = Object.freeze([
  'features/sales/mock-sales.css',
  'features/products/products.css',
  'features/products/product-polish.css',
  'features/products/product-catalog.css',
  'features/products/product-workspace.css',
  'features/inventory/entry-polish.css',
  'features/inventory/receiving.css',
  { file: 'index.css', only: /^\.category-/ },
])

const MIN_TEXT_PX = 12
const MIN_FIELD_PX = 16
const MIN_TOUCH_PX = 44

function px(value) {
  const match = /^(\d*\.?\d+)(px|rem)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
}

function parse(file, only) {
  const css = readFileSync(fileURLToPath(new URL(file, new URL('./', import.meta.url))), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, ' ').trim()
    if (selector.startsWith('@')) continue
    const declarations = match[2].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const at = part.indexOf(':')
      return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).replace(/!important/i, '').trim()]
    })
    if (only && !selector.split(',').every((part) => only.test(part.trim()))) continue
    rules.push({ selector, declarations })
  }
  return rules
}

const lastCompound = (part) => part.trim().split(/[\s>+~]+/).at(-1)
const isField = (part) => /^(input|textarea|select)\b/.test(lastCompound(part)) && !/\[type=['"]?(checkbox|radio|file|range|color)/.test(part)
const isTouchTarget = (part) => /button|stock-step|^a\b|^summary\b|\[role=['"]?tab/.test(lastCompound(part)) && !/svg|::/.test(lastCompound(part))

describe('phone sizing rules', () => {
  for (const entry of AUDITED) {
    const { file, only } = typeof entry === 'string' ? { file: entry } : entry
    const rules = parse(`./${file}`, only)

    test(`${file}: the audit reads rules`, () => {
      assert.ok(rules.length > 0, 'no rules parsed, so the checks below would pass for nothing')
    })

    test(`${file}: no text below ${MIN_TEXT_PX}px`, () => {
      const small = []
      for (const { selector, declarations } of rules) {
        for (const [prop, value] of declarations) {
          const size = prop === 'font-size' ? px(value) : prop === 'font' ? px((/(\d+(?:\.\d+)?px)(?:\/|\s)/.exec(value) || [])[1] || '') : null
          if (size !== null && size < MIN_TEXT_PX) small.push(`${selector} { ${prop}: ${value} }`)
        }
      }
      assert.deepEqual(small, [])
    })

    test(`${file}: text fields are at least ${MIN_FIELD_PX}px`, () => {
      const small = []
      for (const { selector, declarations } of rules) {
        for (const [prop, value] of declarations) {
          const size = prop === 'font-size' ? px(value) : null
          if (size !== null && size < MIN_FIELD_PX && selector.split(',').some(isField)) small.push(`${selector} { font-size: ${value} }`)
        }
      }
      assert.deepEqual(small, [])
    })

    test(`${file}: buttons and links are at least ${MIN_TOUCH_PX}px`, () => {
      const small = []
      for (const { selector, declarations } of rules) {
        if (!selector.split(',').some(isTouchTarget)) continue
        for (const [prop, value] of declarations) {
          const size = ['height', 'min-height', 'width', 'min-width'].includes(prop) ? px(value) : null
          if (size !== null && size >= 1 && size < MIN_TOUCH_PX) small.push(`${selector} { ${prop}: ${value} }`)
        }
      }
      assert.deepEqual(small, [])
    })
  }
})

// These fields use `font: inherit` (14px on these pages), which the checks above cannot see, so the 16px must be written out.
describe('phone text fields on pages with a 14px base', () => {
  for (const file of ['features/products/products.css', 'features/inventory/receiving.css']) {
    test(`${file}: input, select and textarea are set to 16px on phones`, () => {
      for (const field of ['input', 'select', 'textarea']) {
        const found = parse(`./${file}`).some(({ selector, declarations }) => new RegExp(`\\b${field}\\b`).test(selector)
          && declarations.some(([prop, value]) => prop === 'font-size' && px(value) >= MIN_FIELD_PX))
        assert.ok(found, `${file}: ${field}`)
      }
    })
  }
})

