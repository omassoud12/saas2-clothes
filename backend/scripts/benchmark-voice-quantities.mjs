import { execFileSync } from 'node:child_process'
import { writeFileSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'
import { createVoiceMatchingService } from '../.test-dist/voice-sales/matching.service.js'
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] }
}
const entry = new URL('../.test-dist/voice-sales/index.js', import.meta.url).href
const cold = []
for (let i = 0; i < 5; i++) cold.push(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  `import{performance}from'node:perf_hooks';const start=performance.now();await import(${JSON.stringify(entry)});console.log(JSON.stringify(performance.now()-start))`], { encoding: 'utf8' })))
const texts = ['Tshirt black XL 38 pcs', 'Tshirt black size 32 38 pieces', 'Tshirt black XL 2 pairs',
  'Tshirt black XL about 10 pieces', 'Tshirt black XL one two pieces', '3-pack Socks two pieces']
for (let i = 0; i < 60; i++) parseVoiceSaleText(texts[i % texts.length])
const warm = []
for (let i = 0; i < 300; i++) { const start = performance.now(); parseVoiceSaleText(texts[i % texts.length]); warm.push(performance.now() - start) }
const rows = Array.from({ length: 1000 }, (_, i) => ({ productId: 'fixture-product', variantId: `fixture-${i}`, productName: 'Tshirt',
  categoryName: 'Clothing', color: 'Black', size: i === 999 ? 'XL' : 'XXL', sellingPrice: '12.50', availableStock: 40, currency: 'USD' }))
const service = createVoiceMatchingService({ read: async () => ({ variants: rows, scannedVariants: 1000, truncated: false }) })
const context = { userId: 'fixture-user', accountId: 'fixture-account', accountStatus: 'ACTIVE', role: 'OWNER' }
const match = []
for (let i = 0; i < 35; i++) { const start = performance.now(); const result = await service.matchVoiceSaleText(texts[0], context)
  if (result.status !== 'MATCHED') throw new Error('Benchmark fixture failed')
  if (i >= 5) match.push(performance.now() - start) }
const result = { node: process.version, coldAllVoiceDictionaryImport: summary(cold), warmParser: summary(warm),
  mocked1000VariantMatching: summary(match), runtimeQuantityResourceBytes: ['seed', 'source-collisions'].reduce((total, name) =>
    total + statSync(new URL(`../resources/voice-sales/quantities.${name}.json`, import.meta.url)).size, 0),
  notes: ['All dictionary import timing includes Product Types, Colors, Sizes and Quantities, not quantity-only overhead.',
    'No pre-change controlled baseline; these are end-to-end local observations, not a measured incremental regression.',
    'Warm parser input set includes exact counts, sizes, packages, modifiers and conflicts.',
    'Catalog is synthetic, never a real Supabase latency measurement.'] }
writeFileSync(new URL('../src/voice-sales/QUANTITIES_PERFORMANCE.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
