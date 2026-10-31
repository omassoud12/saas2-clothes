import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Static checks of the phone rules: text is at least 12px, text fields are at least 16px (iOS zooms the page into
// smaller ones) and buttons/links are at least 44px. Each screen is added to AUDITED when it has been fixed.
const AUDITED = Object.freeze([
  'features/sales/mock-sales.css',
])

const MIN_TEXT_PX = 12
const MIN_FIELD_PX = 16
const MIN_TOUCH_PX = 44

function px(value) {
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
}

function parse(file) {
  const css = readFileSync(fileURLToPath(new URL(file, new URL('./', import.meta.url))), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, ' ').trim()
    if (selector.startsWith('@')) continue
    const declarations = match[2].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const at = part.indexOf(':')
      return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).replace(/!important/i, '').trim()]
    })
    rules.push({ selector, declarations })
  }
  return rules
}

const lastCompound = (part) => part.trim().split(/[\s>+~]+/).at(-1)
const isField = (part) => /^(input|textarea|select)\b/.test(lastCompound(part)) && !/\[type=['"]?(checkbox|radio|file|range|color)/.test(part)
const isTouchTarget = (part) => /button|^a\b|^summary\b|\[role=['"]?tab/.test(lastCompound(part)) && !/svg|::/.test(lastCompound(part))

describe('phone sizing rules', () => {
  for (const file of AUDITED) {
    const rules = parse(`./${file}`)

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
