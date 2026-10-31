import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeText, tokenizeText } from './normalization.js'
import { matchLongestAliases } from './dictionary.js'
import { fitCutIdsByAxis, fitCutModifierIds } from './fit-cut-ids.js'
import type { SourceFitCutId, FitCutModifierId } from './fit-cut-ids.js'
import type { FitCutSeed, FitCutAliasAudit, FitCutLookup } from './fit-cut.types.js'

export const FIT_CUT_SHA256 = '7de04887498919438d2cd664b699a266e6c7dd3df6d38eea07e278107d008bc2'
export const FIT_CUT_COLLISIONS_SHA256 = '5999378595b6476da59520473207de9994754c01c98c31cefb37216e5565b63a'
export function freezeFitCut<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeFitCut); Object.freeze(value) }
  return value
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const ids: readonly string[] = Object.values(fitCutIdsByAxis).flat()
export function validateFitCutResources(seed: unknown, collisions: unknown): asserts seed is FitCutSeed {
  const fail = () => { throw new Error('Invalid packaged Fits & Cuts resource') }
  if (!object(seed) || !object(seed.meta) || !object(seed.meta.counts) || !object(collisions)) return fail()
  for (const [key, count, meta] of [['styles',144,'styles'],['style_aliases',1278,'aliases'],['groups',9,'groups'],
    ['modifiers',10,'modifiers'],['modifier_aliases',67,'modifier_aliases'],['ambiguities',26,'ambiguities'],
    ['collisions',10,'collisions'],['test_cases',36,'test_cases']] as const) {
    if (!Array.isArray(seed[key]) || seed[key].length !== count || seed.meta.counts[meta] !== count) return fail()
  }
  if (new Set(seed.groups.map((r: any) => r.group)).size !== 9 || seed.groups.some((r: any) => !object(r)
    || !Object.hasOwn(fitCutIdsByAxis,r.group) || !str(r.description) || !str(r.example))) return fail()
  if (new Set(seed.styles.map((r: any)=>r.style_id)).size !== 144 || seed.styles.some((r: any)=>!object(r)
    || !ids.includes(r.style_id) || !(fitCutIdsByAxis[r.group as keyof typeof fitCutIdsByAxis] as readonly string[] | undefined)?.includes(r.style_id)
    || !['english','arabic_fusha','lebanese','syrian','french','review_priority'].every(k=>str(r[k]))
    || !Array.isArray(r.aliases) || !r.aliases.every(str) || !Number.isInteger(r.alias_count))) return fail()
  if (new Set(seed.modifiers.map((r:any)=>r.modifier_id)).size !== 10 || seed.modifiers.some((r:any)=>!object(r)
    || !(fitCutModifierIds as readonly string[]).includes(r.modifier_id) || !['slot','english','arabic','note'].every(k=>str(r[k]))
    || !Array.isArray(r.aliases) || !r.aliases.every(str))) return fail()
  for (const [key,idKey,valid,concepts] of [['style_aliases','style_id',ids,seed.styles],
    ['modifier_aliases','modifier_id',fitCutModifierIds,seed.modifiers]] as const) {
    if (seed[key].some((r:any)=>!object(r) || !valid.includes(r[idKey]) || !str(r.alias) || !normalizeText(r.alias)
      || !str(r.normalized_key) || key === 'style_aliases' && (!['standard','review'].includes(r.risk)
        || !str(r.script) || r.group !== concepts.find((c:any)=>c[idKey]===r[idKey])?.group)
      || key === 'modifier_aliases' && r.slot !== concepts.find((c:any)=>c[idKey]===r[idKey])?.slot)) return fail()
    if (valid.some(id=>!seed[key].some((r:any)=>r[idKey]===id))) return fail()
  }
  if (seed.ambiguities.some((r:any)=>!object(r) || !['phrase','candidate_ids','reason','severity'].every(k=>str(r[k]))
    || r.candidate_ids.split(';').some((id:string)=>!ids.includes(id)))
    || seed.collisions.some((r:any)=>!object(r) || !['normalized_key','style_ids','action'].every(k=>str(r[k]))
      || r.style_ids.split(';').some((id:string)=>!ids.includes(id)))
    || JSON.stringify(seed.ambiguities)!==JSON.stringify(collisions.ambiguities)
    || JSON.stringify(seed.collisions)!==JSON.stringify(collisions.collisions)
    || seed.test_cases.some((r:any)=>!object(r) || !str(r.input_text) || typeof r.expect_review!=='boolean'
      || !Array.isArray(r.expected_style_ids) || !r.expected_style_ids.every((id:string)=>ids.includes(id)))) return fail()
  for (const row of seed.collisions) {
    // Source collision keys use a different Arabic normalization (including ة).
    // Validate source references against source metadata; runtime indexes always use raw aliases.
    const actual = new Set(seed.style_aliases.filter((r:any)=>r.normalized_key===row.normalized_key).map((r:any)=>r.style_id))
    if (row.style_ids.split(';').some((id:string)=>!actual.has(id))) return fail()
  }
}
const packaged = new URL('../resources/voice-sales/',import.meta.url)
const root = existsSync(new URL('fits-cuts.seed.json',packaged)) ? packaged : new URL('../../resources/voice-sales/',import.meta.url)
function load(name:string,hash:string):unknown {
  const bytes=readFileSync(new URL(name,root))
  if (createHash('sha256').update(bytes).digest('hex')!==hash) throw new Error('Fits & Cuts integrity check failed')
  return JSON.parse(bytes.toString('utf8'))
}
const seed=load('fits-cuts.seed.json',FIT_CUT_SHA256)
export const fitCutSourceCollisions=freezeFitCut(load('fits-cuts.source-collisions.json',FIT_CUT_COLLISIONS_SHA256))
validateFitCutResources(seed,fitCutSourceCollisions)
export const fitCutSource=freezeFitCut(seed)
const concepts = new Map(fitCutSource.styles.map(c=>[c.style_id,c]))
export const fitCutConcept = (id:SourceFitCutId) => concepts.get(id)!

export function createFitCutRegistry(crossDomains:(alias:string)=>readonly string[]) {
  const groups = new Map<string,FitCutAliasAudit[]>(), declared = new Map<string,FitCutSeed['ambiguities'][number][]>()
  for (const row of fitCutSource.ambiguities) { const key=normalizeText(row.phrase),rows=declared.get(key)??[];rows.push(row);declared.set(key,rows) }
  const audit:FitCutAliasAudit[]=[]
  for (const [domain,rows] of [['style',fitCutSource.style_aliases],['modifier',fitCutSource.modifier_aliases]] as const) rows.forEach((row,sourceIndex)=>{
    const normalized=normalizeText(row.alias),domains=[...new Set(crossDomains(row.alias))],reasons:string[]=[]
    const blocked=/[|\u0000-\u001f]/u.test(row.alias)
    if (blocked) reasons.push('Unsafe editorial/control expression is not a trusted spoken alias.')
    if ('risk' in row && row.risk==='review') reasons.push('Source dialect/review flag retained; requires garment/catalog context, not empirical validation.')
    if (domain==='modifier') reasons.push('Modifier must attach to a named descriptor; never standalone style proof.')
    if (declared.has(normalized)) reasons.push(...declared.get(normalized)!.map(r=>r.reason))
    if (domains.length) reasons.push('Cross-domain role requires independent evidence.')
    const entry:FitCutAliasAudit={domain,sourceIndex,id:'style_id' in row?row.style_id:row.modifier_id,
      alias:row.alias,normalized,sourceNormalized:row.normalized_key,risk:'risk' in row?row.risk:'modifier',
      disposition:blocked?'blocked':reasons.length?'conditional':'active',reasons,crossDomains:domains}
    audit.push(entry)
    if (!blocked) { const group=groups.get(normalized)??[];group.push(entry);groups.set(normalized,group) }
  })
  for (const rows of groups.values()) if (new Set(rows.map(r=>`${r.domain}:${r.id}`)).size>1) {
    for (const row of rows) Object.assign(row,{disposition:'conditional',reasons:[...row.reasons,'Multiple normalized identities; never choose by order.']})
  }
  for (const key of declared.keys()) if (!groups.has(key)) groups.set(key,[])
  const index=new Map<string,FitCutLookup>()
  for (const [key,rows] of groups) {
    const ambiguities=declared.get(key)??[],styles=new Set<SourceFitCutId>(rows.filter(r=>r.domain==='style').map(r=>r.id as SourceFitCutId))
    for (const row of ambiguities) row.candidate_ids.split(';').forEach(id=>styles.add(id as SourceFitCutId))
    index.set(key,freezeFitCut({status:ambiguities.length || styles.size>1 || rows.some(r=>r.disposition==='conditional')?'context_required':'matched',
      styles:[...styles],modifiers:[...new Set(rows.filter(r=>r.domain==='modifier').map(r=>r.id as FitCutModifierId))],
      ambiguities,crossDomains:[...new Set(rows.flatMap(r=>r.crossDomains))]}))
  }
  freezeFitCut(audit)
  const unknown:FitCutLookup=freezeFitCut({status:'unknown',styles:[],modifiers:[],ambiguities:[],crossDomains:[]})
  const maxTokens=Math.max(...[...index.keys()].map(key=>tokenizeText(key).length))
  const count=(domain:FitCutAliasAudit['domain'],disposition:FitCutAliasAudit['disposition'])=>audit.filter(r=>r.domain===domain&&r.disposition===disposition).length
  return Object.freeze({audit,lookup:(text:string)=>index.get(normalizeText(text))??unknown,
    matchTokens:(text:string)=>matchLongestAliases(text,maxTokens,phrase=>index.get(phrase)),
    coverage:Object.freeze({concepts:144,axes:9,modifiers:10,styleAliases:1278,modifierAliases:67,
      styleActive:count('style','active'),styleConditional:count('style','conditional'),styleBlocked:count('style','blocked'),
      modifierActive:count('modifier','active'),modifierConditional:count('modifier','conditional'),modifierBlocked:count('modifier','blocked'),uniqueKeys:index.size})})
}
