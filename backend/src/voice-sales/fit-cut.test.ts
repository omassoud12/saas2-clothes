import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { activeFitCuts, fitCutSource as seed, fitCutSourceCollisions, normalizeText } from './index.js'
import { validateFitCutResources } from './fit-cut-source.js'
import { fitCutIdsByAxis } from './fit-cut-ids.js'
import { scanFitCuts } from './fit-cut-parser.js'
import { parseVoiceSaleText } from './parser.js'
import { matchParsedCatalog } from './catalog-matcher.js'
import { createVoiceMatchingService } from './matching.service.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import type { CatalogVariant } from './match.types.js'

const variant=(name:string,changes:Partial<CatalogVariant>={}):CatalogVariant=>({productId:'p',variantId:'v',sku:'TEST-SKU',productName:name,
  categoryName:'Jeans',color:'Black',size:'W32/L30',sellingPrice:'25.00',availableStock:5,currency:'USD',...changes})
const match=(text:string,rows:CatalogVariant[],truncated=false)=>matchParsedCatalog(parseVoiceSaleText(text),{variants:rows,scannedVariants:rows.length,truncated})
const context={userId:'33333333-3333-4333-8333-333333333333',accountId:'11111111-1111-4111-8111-111111111111',role:UserRole.OWNER,accountStatus:AccountStatus.ACTIVE}

describe('Fits & Cuts immutable source and exhaustive recognition',()=>{
  for (const concept of seed.styles) test(`concept ${concept.style_id}`,()=>{
    assert.ok(Object.isFrozen(concept))
    assert.ok((fitCutIdsByAxis[concept.group] as readonly string[]).includes(concept.style_id))
    assert.ok(seed.style_aliases.some(r=>r.style_id===concept.style_id))
  })
  for (const [i,row] of seed.style_aliases.entries()) test(`style alias ${i}: ${row.alias}`,()=>{
    const audit=activeFitCuts.audit.find(r=>r.domain==='style'&&r.sourceIndex===i)!
    assert.equal(audit.normalized,normalizeText(row.alias));assert.equal(audit.sourceNormalized,row.normalized_key)
    assert.equal(audit.risk,row.risk)
    const hit=activeFitCuts.lookup(row.alias)
    if (audit.disposition==='blocked') {assert.ok(audit.reasons.length);return}
    assert.ok(hit.styles.includes(row.style_id))
    assert.ok(activeFitCuts.lookup(row.alias.toUpperCase()).styles.includes(row.style_id))
    const parsed=parseVoiceSaleText(`Jeans cut ${row.alias} black XL two pieces`)
    assert.ok(parsed.fitCutCandidates!.some(c=>c.result.styles.includes(row.style_id)),row.alias)
    assert.ok(Object.isFrozen(hit));assert.ok(Object.isFrozen(audit))
  })
  for (const row of seed.modifiers) test(`modifier concept ${row.modifier_id}`,()=>{
    assert.ok(Object.isFrozen(row));assert.ok(seed.modifier_aliases.some(r=>r.modifier_id===row.modifier_id))
  })
  for (const [i,row] of seed.modifier_aliases.entries()) test(`modifier alias ${i}`,()=>{
    assert.ok(activeFitCuts.lookup(row.alias).modifiers.includes(row.modifier_id))
    assert.equal(activeFitCuts.audit.find(r=>r.domain==='modifier'&&r.sourceIndex===i)!.disposition,'conditional')
    assert.ok(scanFitCuts(row.alias).every(r=>!r.constrainsCatalog))
  })
  for (const row of seed.ambiguities) test(`ambiguity ${row.phrase}`,()=>{
    const hit=activeFitCuts.lookup(row.phrase);assert.equal(hit.status,'context_required')
    for (const id of row.candidate_ids.split(';')) assert.ok((hit.styles as readonly string[]).includes(id))
    assert.equal(hit.ambiguities[0].reason,row.reason)
  })
  for (const row of seed.collisions) test(`source collision ${row.normalized_key}`,()=>{
    const aliases=seed.style_aliases.filter(a=>a.normalized_key===row.normalized_key)
    for (const alias of aliases) assert.ok(activeFitCuts.lookup(alias.alias).styles.includes(alias.style_id))
    assert.ok(row.style_ids.split(';').every(id=>aliases.some(a=>a.style_id===id)))
  })
  for (const row of activeFitCuts.audit.filter(r=>r.crossDomains.length)) test(`cross-domain ${row.domain} ${row.sourceIndex}`,()=>{
    assert.notEqual(row.disposition,'active');assert.ok(row.reasons.length)
  })
  test('all records partitioned; IDs, axes, foreign keys, shape and collision metadata fail closed',()=>{
    const c=activeFitCuts.coverage
    assert.equal(c.styleActive+c.styleConditional+c.styleBlocked,1278)
    assert.equal(c.modifierActive+c.modifierConditional+c.modifierBlocked,67)
    assert.equal(activeFitCuts.audit.length,1345)
    for (const mutate of [(s:any)=>s.styles.pop(),(s:any)=>s.styles[0].style_id='INVENTED',
      (s:any)=>s.styles[0].group='leg_cut',(s:any)=>s.style_aliases[0].risk='trusted',
      (s:any)=>s.modifier_aliases[0].modifier_id='FIT_SLIM',(s:any)=>s.ambiguities[0].candidate_ids='INVENTED']) {
      const copy=structuredClone(seed);mutate(copy);assert.throws(()=>validateFitCutResources(copy,fitCutSourceCollisions),/Invalid packaged/)
    }
  })
  test('exact boundaries, Unicode and longest phrase matching retain distinct axes',()=>{
    assert.equal(activeFitCuts.lookup('not-an-alias').status,'unknown')
    assert.equal(activeFitCuts.matchTokens('ultrawide legging').length,0)
    assert.ok(activeFitCuts.lookup('  ＷＩＤＥ　ＬＥＧ  ').styles.includes('LEG_WIDE'))
    const rows=activeFitCuts.matchTokens('wide leg high waist')
    assert.deepEqual(rows.map(r=>r.result.styles),[['LEG_WIDE'],['RISE_HIGH']])
    assert.ok(activeFitCuts.lookup('أوفر سايز').styles.includes('FIT_OVERSIZED'))
  })
})

describe('Fits & Cuts parser and catalog safety',()=>{
  test('independent axes, legacy IDs and missing size/color/quantity preserved',()=>{
    const p=parseVoiceSaleText('bdi jeans wide leg high waist')
    assert.equal(p.sourceFitCuts!.leg_cut.value,'LEG_WIDE');assert.equal(p.sourceFitCuts!.waist_rise.value,'RISE_HIGH')
    assert.equal(p.sourceFitCuts!.fit.value,null);assert.equal(p.attributes.fit.value,null)
    assert.equal(p.attributes.size.value,null);assert.equal(p.attributes.quantity.value,null);assert.equal(p.attributes.color.value,null)
    assert.equal(parseVoiceSaleText('Tshirt oversized XXL two pieces').attributes.fit.value,'OVERSIZED')
    const dress=parseVoiceSaleText('fustan mermaid maksi')
    assert.equal(dress.sourceFitCuts!.silhouette.value,'SIL_MERMAID');assert.equal(dress.sourceFitCuts!.length_cut.value,'LEN_MAXI')
    assert.equal(parseVoiceSaleText('bdi kenze oversaiz').sourceFitCuts!.fit.value,'FIT_OVERSIZED')
  })
  test('Arabic collisions and product-owned spans preserve all candidates, never first-wins',()=>{
    for (const text of ['بدي جينز سكيني','بدي تنورة بليسيه','واسع','ضيق']) {
      const p=parseVoiceSaleText(text)
      assert.ok(p.fitCutCandidates!.length)
      assert.ok(Object.values(p.sourceFitCuts!).some(r=>r.status==='ambiguous'))
      assert.notEqual(match(text,[variant('Jeans skinny')]).status,'MATCHED')
    }
  })
  test('negated skinny excluded; positive bootcut displayed but never a sale',()=>{
    const p=parseVoiceSaleText('ما بدي سكيني بدي بوت كت')
    assert.ok(p.fitCutCandidates!.some(r=>r.polarity==='negated'&&r.result.styles.includes('FIT_SKINNY')))
    assert.equal(p.sourceFitCuts!.fit.value,null)
    assert.ok(p.sourceFitCuts!.leg_cut.candidates.includes('LEG_BOOTCUT'))
    assert.notEqual(matchParsedCatalog(p,{variants:[variant('Jeans bootcut')],scannedVariants:1,truncated:false}).status,'MATCHED')
  })
  test('numeric sizes and quantity stay separate; two-piece construction never becomes order 2',()=>{
    for (const size of ['XL','XXL','XXXL']) assert.equal(parseVoiceSaleText(`Tshirt oversized ${size} two pieces`).attributes.size.value,size)
    const bare=parseVoiceSaleText('Jeans 38 two pieces');assert.equal(bare.sourceSizeId!.value,null);assert.equal(bare.attributes.quantity.value,2)
    const wl=parseVoiceSaleText('Jeans high waist W32/L30 ٣ pieces');assert.equal(wl.sourceSizeId!.value,'JEANS_W32_L30');assert.equal(wl.attributes.quantity.value,3)
    assert.equal(parseVoiceSaleText('Jeans two piece set size L').attributes.quantity.value,null)
  })
  test('repeated same axis is safe; different concepts require clarification',()=>{
    assert.equal(parseVoiceSaleText('Jeans wide leg wide leg').sourceFitCuts!.leg_cut.status,'resolved')
    const p=parseVoiceSaleText('Jeans wide leg bootcut black XL two pieces')
    assert.equal(p.sourceFitCuts!.leg_cut.status,'conflict')
    assert.notEqual(matchParsedCatalog(p,{variants:[variant('Jeans wide leg bootcut',{size:'XL'})],scannedVariants:1,truncated:false}).status,'MATCHED')
  })
  test('real model tokens retained; modifiers do not prove styles',()=>{
    const p=parseVoiceSaleText('Jeans brand Slim black XL two pieces')
    assert.ok(p.productNameResidualTokens.some(r=>r.token==='slim'))
    assert.equal(p.sourceFitCuts!.fit.value,null)
    assert.ok(scanFitCuts('extra').every(r=>!r.constrainsCatalog))
    const literal=match('Cedar Tshirt model Oversized black XL two pieces',
      [variant('Cedar Tshirt model Oversized',{categoryName:'Tshirt',size:'XL'})])
    assert.equal(literal.status,'MATCHED')
    assert.equal(literal.parser.attributes.fit.value,null)
    assert.ok(literal.parser.productNameResidualTokens.some(r=>r.token==='oversized'))
  })
  const sentence='Cedar jeans wede leg 5ser 3ale black W32/L30 two pieces'
  test('verified alias equivalents match only a real product with every requested axis',()=>{
    const result=match(sentence,[variant('Cedar jeans wide leg high waist')])
    assert.equal(result.status,'MATCHED');assert.equal(result.match!.variantId,'v');assert.equal(result.match!.quantity,2)
    assert.equal(result.requiresConfirmation,true)
    assert.ok(result.match!.evidence.some(e=>e.requested==='leg_cut:LEG_WIDE'))
    const absent=match(sentence,[variant('Cedar jeans')]);assert.equal(absent.status,'INCOMPLETE');assert.ok(absent.missingFields.includes('fit'))
    assert.notEqual(match(sentence,[variant('Cedar jeans bootcut high waist')]).status,'MATCHED')
    assert.notEqual(match(sentence,[variant('Cedar jeans wide leg high waist',{size:'W30/L30'})]).status,'MATCHED')
    assert.notEqual(match(sentence,[variant('Cedar jeans wide leg high waist',{color:'White'})]).status,'MATCHED')
  })
  test('quantity, price, stock, coverage and uniqueness remain mandatory',()=>{
    const row=variant('Cedar jeans wide leg high waist')
    assert.equal(match(sentence,[{...row,availableStock:1}]).status,'INSUFFICIENT_STOCK')
    assert.equal(match(sentence,[{...row,sellingPrice:null}]).status,'INCOMPLETE')
    assert.equal(match(sentence,[row],true).status,'INCOMPLETE')
    assert.equal(match(sentence,[row,{...row,variantId:'v2'}]).status,'AMBIGUOUS')
    assert.notEqual(match(sentence.replace('two pieces',''),[row]).status,'MATCHED')
    assert.equal(row.availableStock,5)
  })
  test('intensity modifier needs exact attached catalog evidence',()=>{
    const text='Cedar Tshirt extra oversized black XL two pieces'
    assert.notEqual(match(text,[variant('Cedar Tshirt oversized',{categoryName:'Tshirt',size:'XL'})]).status,'MATCHED')
  })
  test('category modifier evidence names the actual category; modifiers alone never suffice',()=>{
    const result=match('Cedar Jeans extra loose fit black XL two pieces',
      [variant('Cedar Jeans',{categoryName:'extra loose fit',size:'XL'})])
    assert.equal(result.status,'MATCHED')
    assert.ok(result.match!.evidence.some(e=>e.requested==='FIT_LOOSE:MOD_EXTRA'&&e.source==='category_name'&&e.actual==='extra loose fit'))
  })
  test('styles alone, non-sale intent, auth and inactive roles never read the catalog',async()=>{
    let reads=0;const service=createVoiceMatchingService({async read(){reads++;return {variants:[],scannedVariants:0,truncated:false}}})
    for (const text of ['wide leg high waist','ما بدي سكيني بدي بوت كت','yes Jeans wide leg','Jeans wide leg bootcut']) {
      assert.notEqual((await service.matchVoiceSaleText(text,context)).status,'MATCHED')
    }
    assert.equal(reads,0)
    for (const c of [{...context,role:UserRole.SUPER_ADMIN},{...context,accountStatus:AccountStatus.SUSPENDED}]) {
      await assert.rejects(service.matchVoiceSaleText(sentence,c),/active authorized tenant/)
    }
  })
  for (const role of [UserRole.OWNER,UserRole.WAREHOUSE]) test(`read-only ${role} matching retains current stock and price`,async()=>{
    let row=variant('Cedar jeans wide leg high waist');let reads=0
    const service=createVoiceMatchingService({async read(ctx){assert.equal(ctx.accountId,context.accountId);reads++;return {variants:[row],scannedVariants:1,truncated:false}}})
    const first=await service.matchVoiceSaleText(sentence,{...context,role});assert.equal(first.status,'MATCHED')
    assert.doesNotMatch(JSON.stringify(first),/lastPurchaseCost|profitMargin|service_role/)
    row={...row,availableStock:1,sellingPrice:'26.00'}
    const second=await service.matchVoiceSaleText(sentence,{...context,role});assert.equal(second.status,'INSUFFICIENT_STOCK')
    assert.equal(second.match!.sellingPrice,'26.00');assert.equal(row.availableStock,1);assert.equal(reads,2)
  })
  for (const [i,row] of seed.test_cases.entries()) test(`source reference ${i}: ${row.input_text}`,()=>{
    const p=parseVoiceSaleText(row.input_text)
    assert.notEqual(p.status,'invalid_input')
    assert.equal(p.attributes.quantity.value,null,'source descriptions without explicit count must not invent order quantities')
    const matched=matchParsedCatalog(p,{variants:[],scannedVariants:0,truncated:false})
    assert.notEqual(matched.status,'MATCHED')
  })
})
