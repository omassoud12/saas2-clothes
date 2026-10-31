import { performance } from 'node:perf_hooks'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'
import { matchParsedCatalog } from '../.test-dist/voice-sales/catalog-matcher.js'

const baseline = new URL('../../.tools/necklines-baseline/backend/src/voice-sales/', import.meta.url)
async function saved(name, exportName) {
  const output = ts.transpileModule(readFileSync(new URL(name + '.ts', baseline), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  const path = new URL(`../.test-dist/voice-sales/necklines-before-${name}.js`, import.meta.url)
  writeFileSync(path, output)
  return (await import(path.href))[exportName]
}
const beforeParser = await saved('parser', 'parseVoiceSaleText'), beforeMatcher = await saved('catalog-matcher', 'matchParsedCatalog')
const stats = samples => ({ runs: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
  p95Ms: [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1] })
function measure(fn, count = 300, warmup = 25) {
  for (let i = 0; i < warmup; i++) fn()
  const samples = []
  for (let i = 0; i < count; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start) }
  return stats(samples)
}
const common = 'Tshirt black XL 38 pcs', neck = 'Shirt col Claudine black XL two pieces'
const warmCommonBefore = measure(() => beforeParser(common)), warmCommonAfter = measure(() => parseVoiceSaleText(common))
const warmNecklineParser = measure(() => parseVoiceSaleText(neck))
const variant = { productId: 'product', variantId: 'variant', productName: 'Shirt Peter Pan collar', categoryName: 'Shirt',
  color: 'Black', size: 'XL', sellingPrice: '12.50', availableStock: 40, currency: 'USD' }
const catalog = { variants: [variant], scannedVariants: 1, truncated: false }
const parsed = parseVoiceSaleText(neck)
const beforeAfterExample = { input: neck, actualSyntheticCatalog: catalog, before: { parser: beforeParser(neck), status: beforeMatcher(beforeParser(neck), catalog).status },
  after: { parser: parsed, status: matchParsedCatalog(parsed, catalog).status }, liveSupabase: false }
const thousand = { variants: Array.from({ length: 1000 }, (_, i) => ({ ...variant, productId: `product-${i}`, variantId: `variant-${i}` })), scannedVariants: 1000, truncated: false }
const matcher1000SharedLabels = measure(() => matchParsedCatalog(parsed, thousand), 30, 5)
const distinct = { ...thousand, variants: thousand.variants.map((row, i) => ({ ...row, productName: `${row.productName} Model${i}` })) }
const matcher1000DistinctLabels = measure(() => matchParsedCatalog(parsed, distinct), 10, 2)
const cold = [], coldMemory = []
for (let i = 0; i < 5; i++) {
  const entry = new URL('../.test-dist/voice-sales/parser.js', import.meta.url).href
  const child = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e',
    `globalThis.gc(); const before=process.memoryUsage(); const start=performance.now(); await import(${JSON.stringify(entry)});
     const importMs=performance.now()-start; globalThis.gc(); const after=process.memoryUsage();
     console.log(JSON.stringify({importMs,retainedHeapDeltaMiB:(after.heapUsed-before.heapUsed)/1048576,rssDeltaMiB:(after.rss-before.rss)/1048576}))`], { encoding: 'utf8' })
  if (child.status !== 0) throw new Error('Cold import benchmark failed')
  const sample = JSON.parse(child.stdout.trim())
  cold.push(sample.importMs); coldMemory.push(sample)
}
const resourceBytes = ['necklines.seed.json', 'necklines.source-collisions.json'].map(name => ({ name, bytes: readFileSync(new URL(`../resources/voice-sales/${name}`, import.meta.url)).length }))
const report = { node: process.version, warmCommonBefore, warmCommonAfter,
  observedCommonParserMeanDifferenceMs: warmCommonAfter.meanMs - warmCommonBefore.meanMs, warmNecklineParser,
  matcher1000SharedLabels, matcher1000DistinctLabels, coldCompleteDictionaryAndParserImport: stats(cold), coldMemorySamples: coldMemory, resourceBytes,
  totalNewRuntimeBytes: resourceBytes.reduce((n, r) => n + r.bytes, 0), beforeAfterExample,
  measurementScope: 'Synthetic local Node timings; warm baseline uses the exact saved previous parser/matcher sharing current existing dictionaries. Cold covers the entire pipeline; no controlled cold baseline or production latency claim.',
  databaseCalls: 0, writes: 0, liveSupabase: false }
writeFileSync(new URL('../src/voice-sales/NECKLINES_PERFORMANCE.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, beforeAfterExample: { input: neck, before: beforeAfterExample.before.status, after: beforeAfterExample.after.status } }, null, 2))
