import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

// Synthetic, read-only benchmark. No environment loading or real catalog access.
const entry = new URL('../dist/voice-sales/index.js', import.meta.url).href
const coldSamples = []
for (let i = 0; i < 5; i++) {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const start=performance.now();const {activeSizes}=await import(${JSON.stringify(entry)});
     if(activeSizes.coverage.concepts!==671)throw new Error('Incomplete resource');
     console.log(JSON.stringify({ms:performance.now()-start,heapMiB:process.memoryUsage().heapUsed/1048576}))`], { encoding: 'utf8' })
  coldSamples.push(JSON.parse(output))
}
const { parseVoiceSaleText } = await import(new URL('../dist/voice-sales/parser.js', import.meta.url))
const { createVoiceMatchingService } = await import(new URL('../dist/voice-sales/matching.service.js', import.meta.url))
const samples = ['Jeans black W32/L30 two pieces', 'Baby Onesie black 0-3M two pieces', 'Shoes black EU 38 two pieces']
const context = { userId: 'synthetic-user', role: 'OWNER', accountId: 'synthetic-tenant', accountStatus: 'ACTIVE' }
const variants = Array.from({ length: 1000 }, (_, i) => ({ productId: 'synthetic-jeans', variantId: `fixture-${i}`,
  productName: 'Jeans', categoryName: 'Jeans', color: 'Black', size: i === 999 ? 'W32 L30' : 'W34 L32',
  availableStock: 40, sellingPrice: '12.50', currency: 'USD' }))
const service = createVoiceMatchingService({ read: async () => ({ variants, scannedVariants: variants.length, truncated: false }) })
for (let i = 0; i < 50; i++) parseVoiceSaleText(samples[i % samples.length])
for (let i = 0; i < 5; i++) await service.matchVoiceSaleText(samples[0], context)
const warm = []
for (let i = 0; i < 300; i++) {
  const start = performance.now()
  const parsed = parseVoiceSaleText(samples[i % samples.length])
  warm.push(performance.now() - start)
  assert.equal(parsed.attributes.quantity.value, 2)
}
const matches = []
for (let i = 0; i < 30; i++) {
  const start = performance.now()
  const result = await service.matchVoiceSaleText(samples[0], context)
  matches.push(performance.now() - start)
  assert.equal(result.status, 'MATCHED'); assert.equal(result.match.variantId, 'fixture-999')
}
const stats = values => {
  const sorted = values.toSorted((a, b) => a - b)
  return { iterations: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
const results = { measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
  coldAllVoiceDictionaries: stats(coldSamples.map(row => row.ms)),
  coldHeapMiB: coldSamples.map(row => row.heapMiB), warmParse: stats(warm), matching1000Variants: stats(matches),
  addedRuntimeResourceBytes: ['sizes.seed.json', 'sizes.source-collisions.json'].reduce((sum, file) =>
    sum + statSync(new URL(`../resources/voice-sales/${file}`, import.meta.url)).size, 0),
  scope: 'All vocabulary registries cold import; warmed mixed parsing; one product with 1000 variant rows, one exact compatible size. No DB/network latency measured.' }
writeFileSync(new URL('../src/voice-sales/SIZES_PERFORMANCE.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
