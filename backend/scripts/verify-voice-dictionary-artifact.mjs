import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('standalone compiled vocabulary artifact loads all concepts without repository resources', () => {
  const testRoot = resolve(fileURLToPath(new URL('../.test-dist/', import.meta.url)))
  mkdirSync(testRoot, { recursive: true })
  const temporary = mkdtempSync(resolve(testRoot, 'voice-artifact-'))
  try {
    cpSync(new URL('../dist/voice-sales/', import.meta.url), resolve(temporary, 'voice-sales'), { recursive: true })
    cpSync(new URL('../dist/resources/', import.meta.url), resolve(temporary, 'resources'), { recursive: true })
    assert.deepEqual(readdirSync(resolve(temporary, 'resources/voice-sales')).sort(), [
      'product-types.seed.json', 'product-types.ambiguous.json', 'colors.seed.json', 'colors.source-collisions.json',
      'sizes.seed.json', 'sizes.source-collisions.json', 'quantities.seed.json', 'quantities.source-collisions.json',
      'materials.seed.json', 'materials.source-collisions.json', 'necklines.seed.json', 'necklines.source-collisions.json', 'common-expressions.seed.json', 'common-expressions.collisions.json', 'common-expressions.ambiguities.json', 'fits-cuts.seed.json', 'fits-cuts.source-collisions.json', 'patterns.seed.json', 'patterns.source-collisions.json',
    ].sort(), 'Only the 19 runtime resources belong in the deployment artifact; no QA, CSV or test fixtures')
    for (const name of ['seed', 'ambiguous']) {
      assert.deepEqual(readFileSync(resolve(temporary, `resources/voice-sales/product-types.${name}.json`)),
        readFileSync(new URL(`../resources/voice-sales/product-types.${name}.json`, import.meta.url)))
    }
    for (const name of ['colors.seed.json', 'colors.source-collisions.json', 'sizes.seed.json', 'sizes.source-collisions.json', 'quantities.seed.json', 'quantities.source-collisions.json', 'materials.seed.json', 'materials.source-collisions.json', 'necklines.seed.json', 'necklines.source-collisions.json', 'common-expressions.seed.json', 'common-expressions.collisions.json', 'common-expressions.ambiguities.json', 'fits-cuts.seed.json', 'fits-cuts.source-collisions.json', 'patterns.seed.json', 'patterns.source-collisions.json']) {
      assert.deepEqual(readFileSync(resolve(temporary, `resources/voice-sales/${name}`)),
        readFileSync(new URL(`../resources/voice-sales/${name}`, import.meta.url)))
    }
    // This synthetic tree has only JS and whitelisted resources, no src or .env.
    const entry = new URL(`file:///${resolve(temporary, 'voice-sales/index.js').replaceAll('\\', '/')}`).href
    const parserEntry = new URL('parser.js', entry).href
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import {activeProductTypes,activeColors,activeSizes,activeQuantities,activeMaterials,activeNecklines,activeCommonExpressions,activeFitCuts,activePatterns} from ${JSON.stringify(entry)};
       import {parseVoiceSaleText} from ${JSON.stringify(parserEntry)};
       const parsed=parseVoiceSaleText('Tshirt color dusty rose XXL two pieces');
       const jeans=parseVoiceSaleText('Jeans W32/L30 two pieces');
       console.log(JSON.stringify({products:activeProductTypes.coverage.supportedConcepts,sizes:activeSizes.coverage.concepts,
         sizeRows:activeSizes.coverage.aliasRecords,composite:jeans.sourceSizeId.value,
         colors:activeColors.coverage.concepts,rows:activeColors.coverage.aliasRecords,
         shade:parsed.sourceColorId.value,size:parsed.attributes.size.value,quantity:parsed.attributes.quantity.value,
         quantityConcepts:activeQuantities.coverage.concepts,quantityAliases:activeQuantities.coverage.aliasRecords,
         extended:parseVoiceSaleText('Tshirt XL 38 pcs').attributes.quantity.value,
         pair:parseVoiceSaleText('Tshirt XL 2 pairs').attributes.quantity.value,materialConcepts:activeMaterials.coverage.concepts,modifierConcepts:activeMaterials.coverage.modifiers,material:parseVoiceSaleText('Tshirt fabric coton black XL two pieces').sourceMaterial.value,
         necklines:activeNecklines.coverage.styles,neckModifiers:activeNecklines.coverage.modifiers,collar:parseVoiceSaleText('Shirt mandarin collar XL two pieces').sourceCollarType.value, expressions:activeCommonExpressions.coverage.concepts, expressionRows:activeCommonExpressions.coverage.aliasRecords, want:parseVoiceSaleText('je veux Tshirt XL two pieces').commonExpressionMatches[0].candidates[0], keep:parseVoiceSaleText('ما بدي ألغي الطلب').commonExpressionMatches[0].candidates[0], fits:activeFitCuts.coverage.concepts, fitAliases:activeFitCuts.coverage.styleAliases, leg:parseVoiceSaleText('Jeans wide leg high waist').sourceFitCuts.leg_cut.value, patterns:activePatterns.coverage.concepts,patternAliases:activePatterns.coverage.patternAliases,pattern:parseVoiceSaleText('Dress leopard print').sourcePatternId.value,confirmationAllowed:parseVoiceSaleText('yes Tshirt XL two pieces').commonExpressionSafety.salePreviewAllowed}))`], { encoding: 'utf8' })
    assert.deepEqual(JSON.parse(output), { products: 343, sizes: 671, sizeRows: 10448, composite: 'JEANS_W32_L30', colors: 307, rows: 3475, shade: 'DUSTY_ROSE', size: 'XXL', quantity: 2,
      quantityConcepts: 1006, quantityAliases: 2426, extended: 38, pair: null, materialConcepts: 147, modifierConcepts: 35, material: 'COTTON', necklines: 92, neckModifiers: 38, collar: 'COLLAR_MANDARIN', expressions: 141, expressionRows: 1297, want: 'REQ_WANT', keep: 'CHANGE_KEEP_ORDER', confirmationAllowed: false, fits:144, fitAliases:1278, leg:'LEG_WIDE', patterns:169, patternAliases:1219, pattern:'ANIMAL_LEOPARD' })
  } finally {
    // Validate the absolute target before the recursive cleanup, entirely within the test workspace.
    assert.ok(resolve(temporary).startsWith(testRoot + sep))
    rmSync(temporary, { recursive: true, force: true })
  }
})
