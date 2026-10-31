import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { TOKEN_AUDITED } from './styles-audit-files.js'

// Arabic mirrors the page (dir="rtl"), so the stylesheets say "start"/"end" instead of "left"/"right".
const PHYSICAL = /^(margin|padding)-(left|right)$|^border-(left|right)(-(color|width|style))?$|^(left|right)$|^border-(top|bottom)-(left|right)-radius$/

function declarations(file) {
  const css = readFileSync(fileURLToPath(new URL(file, new URL('./', import.meta.url))), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const found = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, ' ').trim()
    if (selector.startsWith('@') || /@keyframes/.test(selector)) continue
    for (const part of match[2].split(';').map((item) => item.trim()).filter(Boolean)) {
      const at = part.indexOf(':')
      found.push({ selector, prop: part.slice(0, at).trim().toLowerCase(), value: part.slice(at + 1).trim() })
    }
  }
  return found
}

describe('right-to-left styles', () => {
  for (const file of TOKEN_AUDITED) {
    test(`${file}: no physical left/right properties`, () => {
      const physical = declarations(file).filter(({ prop, value }) => PHYSICAL.test(prop) || (prop === 'text-align' && /^(left|right)$/.test(value)) || (/^(float|clear)$/.test(prop) && /^(left|right)$/.test(value)))
      assert.deepEqual(physical.map(({ selector, prop, value }) => `${selector} { ${prop}: ${value} }`), [])
    })
  }

  test('four-value margins and paddings are written with logical sides', () => {
    const risky = []
    for (const file of TOKEN_AUDITED) {
      for (const { selector, prop, value } of declarations(file)) {
        if (!/^(margin|padding)$/.test(prop)) continue
        const parts = value.replace(/\([^)]*\)/g, 'x').split(/\s+/)
        if (parts.length === 4 && parts[1] !== parts[3]) risky.push(`${file}: ${selector} { ${prop}: ${value} }`)
      }
    }
    assert.deepEqual(risky, [])
  })
})
