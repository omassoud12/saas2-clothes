import assert from 'node:assert/strict'
import {describe,test} from 'node:test'
import {activePatterns,normalizeText} from './index.js'
import {patternSource as seed,patternSourceCollisions,validatePatternResources} from './pattern-source.js'
import {patternIdsByGroup} from './pattern-ids.js'
import {scanPatterns} from './pattern-parser.js'
import {parseVoiceSaleText} from './parser.js'
import {matchParsedCatalog} from './catalog-matcher.js'
import type {CatalogVariant} from './match.types.js'
const variant=(name:string,changes:Partial<CatalogVariant>={}):CatalogVariant=>({productId:'p',variantId:'v',sku:'TEST-SKU',productName:name,categoryName:'Dress',color:'Black',size:'XL',sellingPrice:'25.00',availableStock:5,currency:'USD',...changes})
const match=(text:string,rows:CatalogVariant[],truncated=false)=>matchParsedCatalog(parseVoiceSaleText(text),{variants:rows,scannedVariants:rows.length,truncated})
describe('Patterns & Prints exhaustive integrity and activation',()=>{
  for(const p of seed.patterns)test(`concept ${p.pattern_id}`,()=>{assert.ok(Object.isFrozen(p));assert.ok((patternIdsByGroup[p.group] as readonly string[]).includes(p.pattern_id));assert.ok(seed.pattern_aliases.some(a=>a.pattern_id===p.pattern_id))})
  for(const [i,a] of seed.pattern_aliases.entries())test(`alias ${i}: ${a.alias}`,()=>{
    const audit=activePatterns.audit.find(r=>r.domain==='pattern'&&r.sourceIndex===i)!
    assert.equal(audit.alias,a.alias);assert.equal(audit.sourceNormalized,a.normalized_key);assert.equal(audit.normalized,normalizeText(a.alias));assert.equal(audit.quality,a.quality)
    if(audit.disposition==='blocked'){assert.ok(audit.reasons.length);return}
    assert.ok(activePatterns.lookup(a.alias).patterns.includes(a.pattern_id));assert.ok(activePatterns.lookup(a.alias.toUpperCase()).patterns.includes(a.pattern_id))
    assert.ok(scanPatterns(`Dress pattern ${a.alias} black XL two pieces`).some(r=>r.result.patterns.includes(a.pattern_id)))
  })
  for(const m of seed.modifiers)test(`modifier ${m.modifier_id}`,()=>{assert.ok(Object.isFrozen(m));assert.ok(seed.modifier_aliases.some(a=>a.modifier_id===m.modifier_id))})
  for(const [i,a] of seed.modifier_aliases.entries())test(`modifier alias ${i}`,()=>{assert.ok(activePatterns.lookup(a.alias).modifiers.includes(a.modifier_id));assert.equal(activePatterns.audit.find(r=>r.domain==='modifier'&&r.sourceIndex===i)!.disposition,'conditional')})
  for(const a of seed.ambiguities)test(`ambiguity ${a.phrase}`,()=>{
    const hit=activePatterns.lookup(a.phrase)
    if(a.phrase==='2'){assert.equal(hit.status,'unknown');assert.equal(parseVoiceSaleText('Dress 2 pieces').attributes.quantity.value,2);return}
    assert.equal(hit.status,'context_required');a.candidate_ids.forEach(id=>assert.ok(hit.patterns.includes(id)))
  })
  for(const c of seed.collisions)test(`collision ${c.normalized_key}`,()=>{const aliases=seed.pattern_aliases.filter(a=>a.normalized_key===c.normalized_key);for(const a of aliases){const hit=activePatterns.lookup(a.alias);assert.equal(hit.status,'context_required');c.pattern_ids.forEach(id=>assert.ok(hit.patterns.includes(id)))}})
  for(const row of activePatterns.audit.filter(a=>a.crossDomains.length))test(`cross-domain ${row.domain} ${row.sourceIndex}`,()=>{assert.notEqual(row.disposition,'active');assert.ok(row.reasons.length)})
  test('partition and corrupt resource fail closed',()=>{
    const c=activePatterns.coverage;assert.equal(c.patternActive+c.patternConditional+c.patternBlocked,1219);assert.equal(c.modifierActive+c.modifierConditional+c.modifierBlocked,161);assert.equal(activePatterns.audit.length,1380)
    for(const mutate of [(s:any)=>s.patterns.pop(),(s:any)=>s.patterns[0].pattern_id='INVENTED',(s:any)=>s.patterns[0].group='stripes',(s:any)=>s.pattern_aliases[0].quality='trusted',(s:any)=>s.modifier_aliases[0].modifier_id='UNKNOWN',(s:any)=>s.ambiguities[0].candidate_ids=['UNKNOWN'],(s:any)=>s.collisions[0].pattern_ids=['PLAIN_SOLID','DOT_GENERIC']]){const copy=structuredClone(seed);mutate(copy);assert.throws(()=>validatePatternResources(copy,patternSourceCollisions),/Invalid packaged/)}
  })
  test('Unicode, exact phrase boundaries, unknown terminology and no fuzzy trust',()=>{
    assert.ok(activePatterns.lookup(' ＬＥＯＰＡＲＤ　ＰＲＩＮＴ ').patterns.includes('ANIMAL_LEOPARD'))
    assert.deepEqual(activePatterns.lookup('نَقْشَة جِلْد تِمْسَاح').patterns,['ANIMAL_CROCODILE'])
    assert.equal(activePatterns.lookup('leopardish').status,'unknown');assert.equal(activePatterns.matchTokens('unknownleopardprint').length,0)
    const rows=activePatterns.matchTokens('vertical stripes leopard print');assert.equal(rows.length,2);assert.ok(rows[0].endToken<=rows[1].startToken)
  })
})
describe('All original pattern scenarios, reviewed under SaaS2 safety contracts',()=>{
  for(const [i,s] of seed.test_cases.entries())test(`source case ${i}: ${s.input_text}`,()=>{
    const rows=parseVoiceSaleText(s.input_text).patternCandidates!
    const positive=rows.filter(r=>r.polarity==='affirmative').flatMap(r=>r.result.patterns),negative=rows.filter(r=>r.polarity==='negated').flatMap(r=>r.result.patterns)
    s.expected_pattern_ids.forEach(id=>assert.ok(positive.includes(id),`${s.input_text}: missing ${id}`));s.expected_excluded_ids.forEach(id=>assert.ok(negative.includes(id)))
    if(s.expected_excluded_ids.length)assert.notEqual(match(s.input_text,[variant('Dress')]).status,'MATCHED')
    assert.equal(parseVoiceSaleText(s.input_text).attributes.quantity.value,null)
  })
})
describe('Pattern parser, exact catalog proof and safety',()=>{
  test('plain compatible canonical and explicit constraints',()=>{const p=parseVoiceSaleText('bdi tshirt plain black XL two pieces');assert.equal(p.sourcePatternId!.value,'PLAIN_SOLID');assert.equal(p.attributes.pattern.value,'PLAIN');assert.equal(p.attributes.size.value,'XL');assert.equal(p.attributes.quantity.value,2)})
  test('negation preserves exclusions and resets at new affirmative request',()=>{const p=parseVoiceSaleText('ما بدي منقط بدي مورّد');assert.ok(p.patternCandidates!.some(r=>r.polarity==='negated'&&r.result.patterns.includes('DOT_GENERIC')));assert.ok(p.patternCandidates!.some(r=>r.polarity==='affirmative'&&r.result.patterns.includes('FLORAL_GENERIC')));assert.equal(p.attributes.size.value,null);assert.notEqual(match(p.originalText!,[variant('Dress floral print')]).status,'MATCHED')})
  test('plain lexical negation is positive; external negation remains excluded',()=>{assert.equal(parseVoiceSaleText('Tshirt بدون نقشة black XL two pieces').sourcePatternId!.value,'PLAIN_SOLID');assert.notEqual(match('not Tshirt plain black XL two pieces',[variant('Tshirt plain')]).status,'MATCHED')})
  test('ambiguous aliases never select first and all alternatives retained',()=>{for(const text of ['بدي قميص كاروهات','bdi tshirt karohat']){const p=parseVoiceSaleText(text);assert.equal(p.sourcePatternId!.value,null);assert.ok(p.sourcePatternId!.candidates.includes('CHECK_PLAID'));assert.ok(p.sourcePatternId!.candidates.includes('CHECK_TARTAN'));assert.notEqual(match(text,[variant('Shirt كاروهات')]).status,'MATCHED')}})
  test('scale and color treatment do not turn into size or quantities',()=>{for(const text of ['Tshirt small print','Tshirt large dots','Tshirt two-color print','Tshirt large leopard print','Tshirt oversized print']){const p=parseVoiceSaleText(text);assert.equal(p.attributes.size.value,null,text);assert.equal(p.attributes.quantity.value,null,text)}})
  test('appearance does not prove material or animal leather',()=>{for(const alias of ['lace print','jacquard effect','faux embroidery','leopard print','crocodile print','denim effect print']){const p=parseVoiceSaleText(`Dress ${alias} black XL two pieces`);assert.ok(p.patternCandidates!.length,alias);assert.equal(p.attributes.material.value,null,alias);assert.equal(p.sourceMaterial!.value,null,alias)}})
  test('material and known jeans roles remain owned by their domains',()=>{assert.equal(parseVoiceSaleText('جلد').attributes.material.value,'LEATHER');assert.equal(parseVoiceSaleText('Jeans W32/L30 two pieces').sourceSizeId!.value,'JEANS_W32_L30');assert.ok(parseVoiceSaleText('جينز مقاس 38').patternCandidates!.every(p=>!p.constrainsCatalog));assert.ok(parseVoiceSaleText('Tshirt fabric imprimé black XL two pieces').materialCandidates!.some(m=>m.result.fabrics.includes('PRINTED_FABRIC')))})
  test('size systems and quantities stay separate; XL XXL XXXL differ',()=>{for(const size of ['XL','XXL','XXXL'])assert.equal(parseVoiceSaleText(`Dress leopard print ${size} two pieces`).attributes.size.value,size);assert.equal(parseVoiceSaleText('Dress leopard print size 32').attributes.quantity.value,null);assert.equal(parseVoiceSaleText('Dress leopard print 32 pieces').attributes.quantity.value,32)})
  test('cross-language real-name pattern proof; no pattern field assumed',()=>{const row=variant('Cedar dress leopard print');const result=match('Cedar dress ليوبارد black XL two pieces',[row]);assert.equal(result.status,'MATCHED');assert.equal(result.match?.variantId,'v');assert.equal(result.requiresConfirmation,true);assert.ok(result.match?.evidence.some(e=>e.field==='pattern'&&e.requested==='ANIMAL_LEOPARD'))})
  test('missing evidence, size, quantity, identity or coverage never complete',()=>{for(const [text,rows,truncated] of [['Cedar dress leopard print black XL two pieces',[variant('Cedar dress')],false],['Cedar dress leopard print two pieces',[variant('Cedar dress leopard print')],false],['Cedar dress leopard print black XL',[variant('Cedar dress leopard print')],false],['dress leopard print black XL two pieces',[variant('Cedar dress leopard print')],false],['Cedar dress leopard print black XL two pieces',[variant('Cedar dress leopard print')],true]] as const)assert.notEqual(match(text,[...rows],truncated).status,'MATCHED')})
  test('catalog cannot resolve an ambiguous label by stock or price',()=>{const rows=[variant('Cedar dress dalmatian print'),variant('Cedar dress dalmatian print',{variantId:'other',sellingPrice:'0.01',availableStock:100})];assert.notEqual(match('Cedar dress dalmatian print black XL two pieces',rows).status,'MATCHED')})
  test('modifiers must attach and be present on actual same motif',()=>{const text='Cedar dress small leopard print black XL two pieces';assert.equal(match(text,[variant('Cedar dress small leopard print')]).status,'MATCHED');assert.notEqual(match(text,[variant('Cedar dress leopard print')]).status,'MATCHED');assert.notEqual(match('Cedar dress small print black XL two pieces',[variant('Cedar dress')]).status,'MATCHED')})
  test('independent motifs and repetitions retained; plain/printed conflicts remain safe',()=>{const p=parseVoiceSaleText('Dress leopard print rose print');assert.ok(p.patternCandidates!.length>=2);const repeated=parseVoiceSaleText('Dress leopard print leopard print');assert.equal(repeated.sourcePatternId!.value,'ANIMAL_LEOPARD');assert.notEqual(match('Dress plain leopard print black XL two pieces',[variant('Dress leopard print')]).status,'MATCHED')})
  test('unknown brand/model remains literal rather than being consumed as motif',()=>{const p=parseVoiceSaleText('MysteryBrand model Plain dress black XL two pieces');assert.equal(p.sourcePatternId!.value,null);assert.ok(p.productNameResidualTokens.some(t=>t.token==='plain'));assert.notEqual(match('UnknownBrand dress leopard print black XL two pieces',[variant('Cedar dress leopard print')]).status,'MATCHED')})
  test('independent garment and pattern descriptors reset a preceding brand cue',()=>{const p=parseVoiceSaleText('brand Cedar dress leopard print black XL two pieces');assert.equal(p.sourcePatternId!.value,'ANIMAL_LEOPARD');assert.ok(p.productNameResidualTokens.some(t=>t.token==='cedar'))})
  test('variant constraints, stock and Decimal prices remain authoritative',()=>{const text='Cedar dress leopard print black XL two pieces';assert.notEqual(match(text,[variant('Cedar dress leopard print',{size:'XXL'})]).status,'MATCHED');assert.equal(match(text,[variant('Cedar dress leopard print',{availableStock:1})]).status,'INSUFFICIENT_STOCK');assert.notEqual(match(text,[variant('Cedar dress leopard print',{sellingPrice:null})]).status,'MATCHED')})
})
