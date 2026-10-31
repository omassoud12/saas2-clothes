import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { TOKEN_AUDITED } from './styles-audit-files.js'

// Colors, type, spacing, radius and shadows come from styles/tokens.css. A migrated stylesheet may not carry its own
// hex colors, and every var(--name) it reads must exist.
const srcDir = fileURLToPath(new URL('./', import.meta.url))
const read = (file) => readFileSync(join(srcDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![\w-])/g

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? cssFiles(path) : name.endsWith('.css') ? [path] : []
  })
}

// Variables that JavaScript sets on an element (style={{ '--name': … }}).
const SET_BY_SCRIPT = Object.freeze(['--garment', '--swatch', '--variant-count', '--bottom-nav-offset'])

describe('design tokens', () => {
  test('tokens.css defines the palette the Sell screen uses', () => {
    const tokens = read('styles/tokens.css')
    for (const name of ['--color-background', '--color-surface', '--color-text', '--color-text-muted', '--color-border', '--color-primary',
      '--color-primary-contrast', '--color-success', '--color-warning', '--color-danger', '--color-info', '--pos-bg', '--pos-warn-bg',
      '--font-size-xs', '--space-4', '--radius-md', '--shadow-card', '--touch-target']) {
      assert.ok(new RegExp(`${name}\\s*:`).test(tokens), name)
    }
  })

  for (const file of TOKEN_AUDITED) {
    test(`${file}: no hardcoded hex colors (use tokens)`, () => {
      const found = [...read(file).matchAll(HEX)].map((match) => match[0])
      assert.deepEqual(found, [])
    })
  }

  test('every var(--name) in a migrated stylesheet is defined somewhere', () => {
    const defined = new Set(SET_BY_SCRIPT)
    for (const path of cssFiles(srcDir)) {
      for (const match of readFileSync(path, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1])
    }
    const missing = []
    for (const file of TOKEN_AUDITED) {
      for (const match of read(file).matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
        if (!match[2] && !defined.has(match[1])) missing.push(`${file}: ${match[1]}`)
      }
    }
    assert.deepEqual([...new Set(missing)], [])
  })
})
