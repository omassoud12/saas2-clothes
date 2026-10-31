import { performance } from 'node:perf_hooks'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'
import { matchParsedCatalog } from '../.test-dist/voice-sales/catalog-matcher.js'

const baseline = new URL('../../.tools/expressions-baseline/backend/src/voice-sales/', import.meta.url)
async function saved(name, exportName) {
  const original = new URL(`${name}.ts`, baseline)
  if (!existsSync(original)) return null
  const output = ts.transpileModule(readFileSync(original, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  const path = new URL(`../.test-dist/voice-sales/expressions-before-${name}.js`, import.meta.url)
  writeFileSync(path, output)
  return (await import(path.href))[exportName]
}
const beforeParser = await saved('parser', 'parseVoiceSaleText'), beforeMatcher = await saved('catalog-matcher', 'matchParsedCatalog')
const stats = samples => ({ runs: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
  p95Ms: [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1] })
function measure(fn, count = 200, warmup = 20) {
  for (let i = 0; i < warmup; i++) fn()
  const samples = []
  for (let i = 0; i < count; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start) }
  return stats(samples)
}
const common = 'Tshirt black XL 38 pcs', request = 'je veux Cedar T-shirt black XL two pieces'
let commonBefore = null, commonAfter
if (beforeParser) {
  // Interleave paired samples after warming both paths; avoid implying improvement
  // from JIT warmup or unrelated compiler/test work occurring between batches.
  for (let i = 0; i < 50; i++) { beforeParser(common); parseVoiceSaleText(common) }
  const before = [], after = []
  for (let i = 0; i < 200; i++) {
    const runBefore = () => { const start = performance.now(); beforeParser(common); before.push(performance.now() - start) }
    const runAfter = () => { const start = performance.now(); parseVoiceSaleText(common); after.push(performance.now() - start) }
    if (i % 2) { runAfter(); runBefore() } else { runBefore(); runAfter() }
  }
  commonBefore = stats(before); commonAfter = stats(after)
} else commonAfter = measure(() => parseVoiceSaleText(common))
const requestAfter = measure(() => parseVoiceSaleText(request))
const variant = { productId: 'product', variantId: 'variant', productName: 'Cedar T-Shirt', categoryName: 'T-Shirts',
  color: 'Black', size: 'XL', sellingPrice: '20.00', availableStock: 50, currency: 'USD' }
const catalog = { variants: [variant], scannedVariants: 1, truncated: false }
const beforeAfterExamples = [request, 'أكيد Cedar T-shirt black XL two pieces', 'baddi Cedar T-shirt black XL two pieces',
  'ما بدي ألغي الطلب', 'bdi 2 tshirt soda size L'].map(input => {
  const parser = parseVoiceSaleText(input)
  const previous = beforeParser?.(input)
  return { input, before: previous ? { parser: previous, status: beforeMatcher(previous, catalog).status } : null,
    after: { parser, status: matchParsedCatalog(parser, catalog).status }, catalog, synthetic: true }
})
const thousand = { variants: Array.from({ length: 1000 }, (_, i) => ({ ...variant, variantId: `v${i}`, productId: `p${i}` })),
  scannedVariants: 1000, truncated: false }
const parsed = parseVoiceSaleText(request)
const match1000Shared = measure(() => matchParsedCatalog(parsed, thousand), 20, 3)
const distinct = { ...thousand, variants: thousand.variants.map((row, i) => ({ ...row, productName: `${row.productName} Model${i}` })) }
const match1000Distinct = measure(() => matchParsedCatalog(parsed, distinct), 5, 1)
const nonSaleGate = measure(() => matchParsedCatalog(parseVoiceSaleText('yes Cedar T-shirt black XL two pieces'), distinct))
const cold = []
for (let i = 0; i < 3; i++) {
  const entry = new URL('../.test-dist/voice-sales/parser.js', import.meta.url).href
  const child = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e',
    `globalThis.gc(); const before=process.memoryUsage(); const start=performance.now(); await import(${JSON.stringify(entry)});
     const importMs=performance.now()-start; globalThis.gc(); const after=process.memoryUsage();
     console.log(JSON.stringify({importMs,heapDeltaMiB:(after.heapUsed-before.heapUsed)/1048576,rssDeltaMiB:(after.rss-before.rss)/1048576}))`], { encoding: 'utf8' })
  if (child.status !== 0) throw Error('Cold import benchmark failed')
  cold.push(JSON.parse(child.stdout.trim()))
}
const resourceBytes = ['seed', 'collisions', 'ambiguities'].map(kind => ({ kind,
  bytes: readFileSync(new URL(`../resources/voice-sales/common-expressions.${kind}.json`, import.meta.url)).length }))
const report = { node: process.version, commonBefore, commonAfter, requestAfter,
  commonParserMeanDeltaMs: commonBefore ? commonAfter.meanMs - commonBefore.meanMs : null,
  match1000Shared, match1000Distinct, nonSaleGate, coldWholePipeline: cold, resourceBytes,
  totalNewRuntimeBytes: resourceBytes.reduce((n, row) => n + row.bytes, 0), beforeAfterExamples,
  scope: 'Synthetic warm timings. Saved before parser/matcher share existing current registries. Cold time/memory covers the complete dictionary/parser pipeline, not incremental Common Expressions cost. Local Node 24; production Node 22 and live Supabase not verified.',
  liveSupabase: false, databaseCalls: 0, writes: 0 }
writeFileSync(new URL('../src/voice-sales/COMMON_EXPRESSIONS_PERFORMANCE.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, beforeAfterExamples: beforeAfterExamples.map(row => ({ input: row.input, before: row.before?.status, after: row.after.status })) }, null, 2))
