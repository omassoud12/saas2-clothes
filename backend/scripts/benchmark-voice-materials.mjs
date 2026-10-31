import { performance } from 'node:perf_hooks'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'
import { matchParsedCatalog } from '../.test-dist/voice-sales/catalog-matcher.js'

// In-memory synthetic catalog only. Baseline is the exact parser saved before this integration.
const snapshot = new URL('../../.tools/materials-baseline/backend__src__voice-sales__parser.ts', import.meta.url)
let baseline
let baselineMatcher
if (existsSync(snapshot)) {
  const compiled = ts.transpileModule(readFileSync(snapshot, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  const path = new URL('../.test-dist/voice-sales/materials-baseline-parser.js', import.meta.url)
  writeFileSync(path, compiled)
  baseline = (await import(path.href)).parseVoiceSaleText
  const matcherSnapshot = new URL('../../.tools/materials-baseline/backend__src__voice-sales__catalog-matcher.ts', import.meta.url)
  const matcherPath = new URL('../.test-dist/voice-sales/materials-baseline-catalog-matcher.js', import.meta.url)
  writeFileSync(matcherPath, ts.transpileModule(readFileSync(matcherSnapshot, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText)
  baselineMatcher = (await import(matcherPath.href)).matchParsedCatalog
}
const mean = rows => rows.reduce((a, b) => a + b, 0) / rows.length
const stats = rows => ({ runs: rows.length, meanMs: mean(rows), p95Ms: [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * 0.95) - 1] })
function measure(fn, count) {
  for (let i = 0; i < 25; i++) fn()
  const times = []
  for (let i = 0; i < count; i++) { const start = performance.now(); fn(); times.push(performance.now() - start) }
  return stats(times)
}
const commonInput = 'Tshirt black XL 38 pcs'
const materialInput = 'Tshirt fabric coton black XL two pieces'
const commonBefore = baseline ? measure(() => baseline(commonInput), 300) : null
const commonAfter = measure(() => parseVoiceSaleText(commonInput), 300)
const materialAfter = measure(() => parseVoiceSaleText(materialInput), 300)
const parsed = parseVoiceSaleText(materialInput)
const variants = Array.from({ length: 1000 }, (_, index) => ({ productId: `fixture-${index}`, variantId: `variant-${index}`,
  productName: 'Cotton T-Shirt', categoryName: 'T-Shirt', size: 'XL', color: 'Black', sellingPrice: '12.50', availableStock: 40, currency: 'USD' }))
const catalog = { variants, scannedVariants: variants.length, truncated: false }
const matching = measure(() => matchParsedCatalog(parsed, catalog), 30)
const uniqueCatalog = { ...catalog, variants: variants.map((row, index) => ({ ...row, productName: `Cotton T-Shirt Model${index}` })) }
const matchingUnique = measure(() => matchParsedCatalog(parsed, uniqueCatalog), 10)
const beforeAfterExample = baseline && baselineMatcher ? {
  input: materialInput, catalog: [{ ...variants[0] }],
  beforeParser: { attributes: baseline(materialInput).attributes, residual: baseline(materialInput).productNameResidualTokens },
  beforePureCatalogMatch: baselineMatcher(baseline(materialInput), { variants: [variants[0]], scannedVariants: 1, truncated: false }).status,
  afterParser: { sourceMaterial: parsed.sourceMaterial, attributes: parsed.attributes, residual: parsed.productNameResidualTokens },
  afterPureCatalogMatch: matchParsedCatalog(parsed, { variants: [variants[0]], scannedVariants: 1, truncated: false }).status,
  liveSupabase: false,
} : null
const cold = []
for (let i = 0; i < 5; i++) {
  const entry = new URL('../.test-dist/voice-sales/parser.js', import.meta.url).href
  const process = spawnSync(globalThis.process.execPath, ['--input-type=module', '-e',
    `const start=performance.now();await import(${JSON.stringify(entry)});console.log(performance.now()-start)`], { encoding: 'utf8' })
  if (process.status !== 0) throw new Error('Synthetic cold-import benchmark failed')
  cold.push(Number(process.stdout.trim()))
}
const resourceBytes = ['materials.seed.json', 'materials.source-collisions.json'].map(name => ({ name,
  bytes: readFileSync(new URL(`../resources/voice-sales/${name}`, import.meta.url)).length }))
const report = { node: process.version, coldAllVoicePipelineImport: stats(cold), warmCommonParserBefore: commonBefore,
  warmCommonParserAfter: commonAfter, warmMaterialsParser: materialAfter, readOnly1000VariantMatcher: matching,
  readOnly1000DistinctLabelMatcher: matchingUnique, beforeAfterExample,
  observedWarmParserMeanDifferenceMs: commonBefore ? commonAfter.meanMs - commonBefore.meanMs : null,
  resourceBytes, totalMaterialResourceBytes: resourceBytes.reduce((n, row) => n + row.bytes, 0),
  baselineNote: 'Warm baseline parser was saved before this change, transpiled without edits, and shares current unchanged legacy dictionaries. Cold timings cover all voice dictionaries; no controlled cold baseline.',
  limitations: ['Local development measurement, not production/Supabase or load testing.',
    'Identical raw product/category labels share a pure name profile inside one request; stock, prices and variant identities remain fresh and separate.',
    'Distinct-label measurement exercises 1000 independent profiles; missing model words prevent confirmation.'],
  databaseCalls: 0, writes: 0 }
writeFileSync(new URL('../src/voice-sales/MATERIALS_PERFORMANCE.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
