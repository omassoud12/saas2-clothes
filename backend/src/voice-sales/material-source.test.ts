import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import { activeMaterials, materialSourceResource as seed, materialSourceCollisions, normalizeText } from './index.js'
import { validateMaterialResources, MATERIAL_SOURCE_SHA256, MATERIAL_COLLISIONS_SHA256 } from './material-source.js'
import { parseVoiceSaleText } from './parser.js'
import { sourceMaterialIds, sourceFabricModifierIds } from './material-source-ids.js'

describe('Materials source integrity and every imported alias', () => {
  test('source bytes, separate domain counts, and immutable provenance', () => {
    for (const [file, hash] of [['materials.seed.json', MATERIAL_SOURCE_SHA256], ['materials.source-collisions.json', MATERIAL_COLLISIONS_SHA256],
      ['materials.smoke.json', '2a60031afbf0b78ff73a2eb28bf863ae0d93eaa446dd9dc6e4ff57953cdc8566']]) {
      assert.equal(createHash('sha256').update(readFileSync(new URL(`../../resources/voice-sales/${file}`, import.meta.url))).digest('hex'), hash)
    }
    validateMaterialResources(seed, materialSourceCollisions)
    assert.equal(activeMaterials.audit.length, 1421)
    assert.equal(seed.groups.length, 15)
    assert.equal(seed.ambiguities.length, 50)
    assert.equal(sourceMaterialIds.length, 147)
    assert.equal(sourceFabricModifierIds.length, 35)
    assert.ok(Object.isFrozen(seed.fabric_aliases[0]) && Object.isFrozen(activeMaterials.audit[0]))
  })
  for (const [domain, rows] of [['fabric', seed.fabric_aliases], ['modifier', seed.modifier_aliases]] as const) rows.forEach((row, index) => {
    test(`${domain} alias ${index}: original record, normalized exact lookup and parser evaluation`, () => {
      const hit = activeMaterials.lookup(row.alias)
      assert.deepEqual(hit, activeMaterials.lookup(normalizeText(row.alias)))
      const audit = activeMaterials.audit.find(r => r.domain === domain && r.sourceIndex === index)!
      assert.equal(audit.alias, row.alias)
      assert.equal(audit.sourceNormalized, row.normalized)
      assert.equal(audit.normalized, normalizeText(row.alias))
      assert.ok(hit.records.includes(audit))
      if (audit.disposition === 'active') assert.equal(hit.status, 'matched')
      if (audit.disposition === 'blocked') assert.equal(hit.status, 'blocked')
      const parsed = parseVoiceSaleText(`Tshirt fabric ${row.alias} black XL two pieces`)
      if (audit.disposition !== 'blocked') assert.ok(parsed.materialCandidates?.some(m => m.result.records.includes(audit)))
      assert.ok(parsed.attributes.quantity.value === null || parsed.attributes.quantity.value === 2)
      assert.notEqual(parsed.attributes.size.value, 'XXL')
    })
  })
  for (const id of sourceMaterialIds) test(`material concept ${id}: source ID and aliases preserved`, () => {
    assert.ok(seed.fabrics.some(row => row.fabric_id === id))
    assert.ok(activeMaterials.audit.some(row => row.domain === 'fabric' && row.id === id && row.disposition !== 'blocked'))
  })
  for (const id of sourceFabricModifierIds) test(`modifier concept ${id}: separate ID and aliases preserved`, () => {
    assert.ok(seed.modifiers.some(row => row.modifier_id === id))
    assert.ok(activeMaterials.audit.some(row => row.domain === 'modifier' && row.id === id && row.disposition !== 'blocked'))
  })
  for (const [index, ambiguity] of seed.ambiguities.entries()) test(`declared ambiguity ${index}: never discarded or first-selected`, () => {
    assert.ok(Object.isFrozen(ambiguity))
    const hit = activeMaterials.lookup(ambiguity.alias)
    if (hit.status !== 'unknown' && hit.status !== 'blocked') {
      assert.ok(hit.ambiguities.includes(ambiguity))
      if (!['stretch', 'ستريتش'].includes(normalizeText(ambiguity.alias))) {
        for (const id of ambiguity.candidate_ids.split(';')) assert.ok([...hit.fabrics, ...hit.modifiers].includes(id as any))
      }
    }
  })
  for (const change of [(x: any) => x.fabric_aliases.pop(), (x: any) => x.fabrics[0].fabric_id = 'UNKNOWN',
    (x: any) => x.modifier_aliases[0].modifier_id = 'COTTON', (x: any) => x.fabric_aliases[0].match_policy = 'trusted',
    (x: any) => x.ambiguities[0].candidate_ids = 'INVENTED', (x: any) => x.fabrics[0].group_id = 'OTHER']) {
    test(`invalid resource is rejected: ${change.toString()}`, () => {
      const copy = structuredClone(seed); change(copy)
      assert.throws(() => validateMaterialResources(copy, materialSourceCollisions), /Invalid packaged/)
    })
  }
})
const sourceCases = JSON.parse(readFileSync(new URL('../../resources/voice-sales/materials.smoke.json', import.meta.url), 'utf8'))
describe('Original material scenarios and documented source contradiction', () => {
  for (const row of sourceCases.cases.filter((r: any) => r.origin === 'source')) test(row.id, () => {
    const parsed = parseVoiceSaleText(row.text)
    const ids = [...new Set((parsed.materialCandidates ?? []).flatMap(m => [...m.result.fabrics, ...m.result.modifiers]))]
    // SRC_010 contradicts the source's own explicit FLEECE/POLAR_FLEECE ambiguity.
    // Preserve its original expected ID in the fixture, document extra alternatives,
    // and require clarification instead of pretending that polaire uniquely means polar.
    assert.deepEqual([...ids].sort(), (row.id === 'SRC_010' ? ['FLEECE', 'POLAR_FLEECE'] : row.expectedSourceIds).sort())
    assert.deepEqual(parsed.materialComposition?.filter(r => r.status === 'requested').map(r => String(r.percentage)) ?? [], row.expectedCompositionPercent)
    assert.ok((parsed.materialComposition ?? []).every(r => r.catalogVerified === false))
    if (row.expectedSourceSlot === 'REVIEW' && ids.length > 1) assert.equal(parsed.sourceMaterial?.value, null)
  })
})
describe('Material language and safe separation', () => {
  const safetyChecks: Record<string, (p: ReturnType<typeof parseVoiceSaleText>) => void> = {
    EDGE_001: p => { assert.equal(p.attributes.quantity.value, 2); assert.equal(p.attributes.size.value, 'XL'); assert.ok(p.sourceMaterial?.candidates.includes('COTTON')) },
    EDGE_002: p => { assert.equal(p.attributes.quantity.value, 2); assert.equal(p.attributes.size.value, '32') },
    EDGE_003: p => { assert.equal(p.attributes.productType.value, null); assert.ok(p.sourceMaterial?.candidates.includes('DENIM')) },
    EDGE_004: p => assert.deepEqual(p.materialComposition?.map(r => [r.candidates, r.percentage]), [[['COTTON'], 95], [['ELASTANE'], 5]]),
    EDGE_005: p => { assert.equal(p.materialComposition?.[0].status, 'unbound'); assert.equal(p.attributes.quantity.value, null) },
    EDGE_006: p => { assert.deepEqual(p.materialCandidates?.[0].result.fabrics, []); assert.deepEqual(p.materialCandidates?.[0].result.modifiers, ['STRETCH']) },
    EDGE_007: p => { assert.deepEqual(p.materialCandidates, []); assert.equal(p.attributes.material.value, null) },
    EDGE_008: p => assert.deepEqual(p.sourceMaterial?.candidates, ['SUEDE', 'FAUX_SUEDE']),
    EDGE_009: p => assert.deepEqual([...p.sourceMaterial!.candidates].sort(), ['VELOUR', 'VELVET']),
    EDGE_010: p => assert.deepEqual(p.materialCandidates?.[0].result.modifiers, ['FLEECE_LINED']),
    EDGE_011: p => assert.equal(p.attributes.quantity.value, null),
    EDGE_012: p => { assert.deepEqual(p.materialCandidates, []); assert.equal(p.attributes.material.value, null) },
    EDGE_013: p => { assert.deepEqual(p.sourceMaterial?.candidates, ['SATIN']); assert.equal(p.attributes.quantity.value, 1) },
    EDGE_014: p => { assert.deepEqual(p.sourceMaterial?.candidates, ['COTTON', 'CASHMERE']); assert.deepEqual(p.materialComposition, []) },
    EDGE_015: p => { assert.equal(p.attributes.quantity.value, 2); assert.ok(p.sourceSizeId?.candidates.some(id => id.includes('38'))) },
  }
  for (const row of sourceCases.cases.filter((r: any) => r.origin !== 'source')) test(`kit safety case ${row.id}`, () => {
    assert.ok(safetyChecks[row.id]); safetyChecks[row.id](parseVoiceSaleText(row.text))
  })
  for (const [word, id] of [['Cotton', 'COTTON'], ['قطن', 'COTTON'], ['coton', 'COTTON'], ['كشمير', 'CASHMERE'],
    ['fabric linen', 'LINEN_FIBER'], ['كتان', 'LINEN_FIBER'], ['satin', 'SATIN'], ['ساتان', 'SATIN'], ['قماش جينز', 'DENIM']]) {
    test(`${word} identifies ${id} without asserting merchant composition`, () => {
      const parsed = parseVoiceSaleText(`Tshirt fabric ${word} black XL two pieces`)
      assert.ok(parsed.materialCandidates?.some(m => m.result.fabrics.includes(id as any)))
      assert.deepEqual(parsed.materialComposition, [])
    })
  }
  test('construction and modifiers retain their own identities', () => {
    assert.deepEqual(activeMaterials.lookup('stretch').fabrics, [])
    assert.ok(activeMaterials.lookup('stretch').modifiers.includes('STRETCH'))
    assert.deepEqual(activeMaterials.lookup('satin').fabrics, ['SATIN'])
    assert.ok(!activeMaterials.lookup('satin').fabrics.includes('SILK'))
    const parsed = parseVoiceSaleText('Tshirt fabric 4-way stretch black XXL two pieces')
    assert.equal(parsed.attributes.quantity.value, 2)
    assert.equal(parsed.attributes.size.value, 'XXL')
    assert.deepEqual(parsed.materialCandidates?.[0].result.modifiers, ['FOUR_WAY_STRETCH'])
  })
  for (const text of ['مش مخمل', 'من دون ليكرا', 'Tshirt not cotton XL two pieces']) test(`negation: ${text}`, () => {
    const parsed = parseVoiceSaleText(text)
    assert.notEqual(parsed.status, 'parsed')
    assert.deepEqual(parsed.materialCandidates, [])
    assert.equal(parsed.attributes.material.value, null)
    assert.equal(parsed.attributes.quantity.value, null)
  })
  test('longest phrase prevents generic velvet or fleece from overriding subtype/lining', () => {
    assert.deepEqual(parseVoiceSaleText('مخمل قطني').sourceMaterial?.candidates, ['VELVETEEN'])
    const lined = parseVoiceSaleText('fleece lined jacket')
    assert.equal(lined.sourceMaterial?.value, null)
    assert.deepEqual(lined.materialCandidates?.[0].result.modifiers, ['FLEECE_LINED'])
  })
  for (const text of ['cotton 95% elastane 5%', '95% cotton + 5% elastane', 'cotton ٩٥٪ elastane ۵٪']) {
    test(`attached components only: ${text}`, () => {
      const rows = parseVoiceSaleText(text).materialComposition!
      assert.deepEqual(rows.map(r => [r.candidates, r.percentage, r.catalogVerified]), [[['COTTON'], 95, false], [['ELASTANE'], 5, false]])
    })
  }
  for (const text of ['100%', 'cotton 101%', 'cotton -5%', 'cotton 1.5%', 'cotton model X 100%']) test(`unsafe percentage: ${text}`, () => {
    const parsed = parseVoiceSaleText(text)
    assert.ok(parsed.materialComposition?.some(r => r.status !== 'requested'))
    assert.equal(parsed.attributes.quantity.value, null)
    assert.notEqual(parsed.status, 'parsed')
  })
  test('cross-domain roles and model names are not silently erased', () => {
    const denim = parseVoiceSaleText('قماش جينز')
    assert.equal(denim.attributes.productType.value, null)
    assert.equal(denim.sourceMaterial?.value, 'DENIM')
    const model = parseVoiceSaleText('Tshirt model Modal black XL two pieces')
    assert.deepEqual(model.productNameResidualTokens.map(r => r.token), ['model', 'modal'])
    assert.equal(model.materialCandidates?.[0].constrainsCatalog, false)
    assert.ok(parseVoiceSaleText('Tshirt CedarMoon black XL two pieces').productNameResidualTokens.some(r => r.token === 'cedarmoon'))
    assert.equal(activeMaterials.lookup('cottonish').status, 'unknown')
  })
  for (const size of ['XL', 'XXL', 'XXXL']) test(`size ${size} and quantity 32 stay separate`, () => {
    const parsed = parseVoiceSaleText(`Tshirt fabric coton black ${size} 32 pieces`)
    assert.equal(parsed.attributes.quantity.value, 32)
    assert.ok(parsed.sourceSizeId?.value)
    if (size !== 'XXXL') assert.equal(parsed.attributes.size.value, size)
  })
  test('numeric size is not quantity and two-piece set is not two requested units', () => {
    const numeric = parseVoiceSaleText('Jeans size 32 two pieces')
    assert.equal(numeric.attributes.size.value, '32')
    assert.equal(numeric.attributes.quantity.value, 2)
    assert.equal(parseVoiceSaleText('two piece set').attributes.quantity.value, null)
  })
})
