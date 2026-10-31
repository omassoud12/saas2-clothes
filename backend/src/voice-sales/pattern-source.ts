import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeText, tokenizeText } from './normalization.js'
import { matchLongestAliases } from './dictionary.js'
import { patternIdsByGroup, patternModifierIds } from './pattern-ids.js'
import type { SourcePatternId, PatternModifierId } from './pattern-ids.js'
import type { PatternSeed, PatternAliasAudit, PatternLookup } from './pattern.types.js'
export const PATTERN_SHA256='4b74513419dcb04de3203444a6efa6cdc7bb69699015176d5ba06c0a31490050'
export const PATTERN_COLLISIONS_SHA256='095f2a8b4d252fcc98d0c4b723778c701e6a4f8817f43116dec736fcfb984da5'
export function freezePattern<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freezePattern);Object.freeze(value)}return value}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const str=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()
const ids:readonly string[]=Object.values(patternIdsByGroup).flat()
export function validatePatternResources(seed:unknown,collisions:unknown):asserts seed is PatternSeed {
  const fail=()=>{throw Error('Invalid packaged Patterns & Prints resource')}
  if(!object(seed)||!object(seed.meta)||!object(collisions))return fail()
  for(const [key,count] of [['patterns',169],['groups',13],['pattern_aliases',1219],['modifiers',25],['modifier_aliases',161],['ambiguities',23],['collisions',6],['test_cases',40]] as const)if(!Array.isArray(seed[key])||seed[key].length!==count)return fail()
  for(const [key,count] of [['patterns_count',169],['aliases_count',1219],['groups_count',13],['modifiers_count',25],['ambiguous_phrases_count',23]] as const)if(seed.meta[key]!==count)return fail()
  if(new Set(seed.groups.map((r:any)=>r.group)).size!==13||seed.groups.some((r:any)=>!object(r)||!Object.hasOwn(patternIdsByGroup,r.group)||!str(r.english)||!str(r.arabic)))return fail()
  if(new Set(seed.patterns.map((r:any)=>r.pattern_id)).size!==169||seed.patterns.some((r:any)=>!object(r)||!ids.includes(r.pattern_id)
    ||!(patternIdsByGroup[r.group as keyof typeof patternIdsByGroup] as readonly string[]|undefined)?.includes(r.pattern_id)
    ||!['english','arabic_fusha','lebanese','syrian','french','review_priority'].every(k=>str(r[k]))||!Array.isArray(r.aliases)||!r.aliases.every(str)))return fail()
  if(new Set(seed.modifiers.map((r:any)=>r.modifier_id)).size!==25||seed.modifiers.some((r:any)=>!object(r)||!(patternModifierIds as readonly string[]).includes(r.modifier_id)
    ||!['slot','english','arabic_fusha','lebanese','syrian','french'].every(k=>str(r[k]))||!Array.isArray(r.aliases)||!r.aliases.every(str)))return fail()
  for(const [key,idKey,valid,concepts] of [['pattern_aliases','pattern_id',ids,seed.patterns],['modifier_aliases','modifier_id',patternModifierIds,seed.modifiers]] as const){
    if(seed[key].some((r:any)=>!object(r)||!valid.includes(r[idKey])||!str(r.alias)||!normalizeText(r.alias)||!str(r.normalized_key)
      ||key==='pattern_aliases'&&(!['seed','seed_review'].includes(r.quality)||!str(r.script)||r.group!==concepts.find((c:any)=>c[idKey]===r[idKey])?.group)
      ||key==='modifier_aliases'&&r.slot!==concepts.find((c:any)=>c[idKey]===r[idKey])?.slot))return fail()
    if(valid.some(id=>!seed[key].some((r:any)=>r[idKey]===id)))return fail()
  }
  if(seed.ambiguities.some((r:any)=>!object(r)||!['phrase','normalized_key','reason','severity'].every(k=>str(r[k]))||!Array.isArray(r.candidate_ids)||!r.candidate_ids.length||!r.candidate_ids.every((id:string)=>ids.includes(id)))
    ||seed.collisions.some((r:any)=>!object(r)||!str(r.normalized_key)||!str(r.action)||!Array.isArray(r.pattern_ids)||r.pattern_ids.length<2||!r.pattern_ids.every((id:string)=>ids.includes(id)))
    ||JSON.stringify(seed.ambiguities)!==JSON.stringify(collisions.source_declared_ambiguities)||JSON.stringify(seed.collisions)!==JSON.stringify(collisions.source_declared_collisions)
    ||seed.test_cases.some((r:any)=>!object(r)||!str(r.input_text)||typeof r.expect_review!=='boolean'||!['expected_pattern_ids','expected_excluded_ids'].every(k=>Array.isArray(r[k])&&r[k].every((id:string)=>ids.includes(id)))))return fail()
  for(const row of seed.collisions){const actual=new Set(seed.pattern_aliases.filter((a:any)=>a.normalized_key===row.normalized_key).map((a:any)=>a.pattern_id));if(row.pattern_ids.some((id:string)=>!actual.has(id)))return fail()}
}
const packaged=new URL('../resources/voice-sales/',import.meta.url)
const root=existsSync(new URL('patterns.seed.json',packaged))?packaged:new URL('../../resources/voice-sales/',import.meta.url)
function load(name:string,hash:string):unknown {const bytes=readFileSync(new URL(name,root));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Patterns & Prints integrity check failed');return JSON.parse(bytes.toString('utf8'))}
const seed=load('patterns.seed.json',PATTERN_SHA256)
export const patternSourceCollisions=freezePattern(load('patterns.source-collisions.json',PATTERN_COLLISIONS_SHA256))
validatePatternResources(seed,patternSourceCollisions)
export const patternSource=freezePattern(seed)
const concepts=new Map(patternSource.patterns.map(p=>[p.pattern_id,p]))
export const patternConcept=(id:SourcePatternId)=>concepts.get(id)!
/** Numbers in the source ambiguity list are recognized by numeric domains, never invented as motifs. */
const unsafe=(alias:string)=>/^[0-9]+$/u.test(normalizeText(alias))||/[|\u0000-\u001f]/u.test(alias)
export function createPatternRegistry(crossDomains:(alias:string)=>readonly string[]){
  const groups=new Map<string,PatternAliasAudit[]>(),declared=new Map<string,PatternSeed['ambiguities'][number][]>()
  for(const row of patternSource.ambiguities)if(!unsafe(row.phrase)){const key=normalizeText(row.phrase),rows=declared.get(key)??[];rows.push(row);declared.set(key,rows)}
  const audit:PatternAliasAudit[]=[]
  for(const [domain,rows] of [['pattern',patternSource.pattern_aliases],['modifier',patternSource.modifier_aliases]] as const)rows.forEach((row,sourceIndex)=>{
    const normalized=normalizeText(row.alias),domains=[...new Set(crossDomains(row.alias))],reasons:string[]=[]
    if ('pattern_id' in row && row.pattern_id.endsWith('_GENERIC')) {
      const inherited=patternSource.ambiguities.filter(a=>a.candidate_ids[0]===row.pattern_id && !unsafe(a.phrase))
      if(inherited.length&&!declared.has(normalized))declared.set(normalized,inherited)
    }
    const blocked=unsafe(row.alias)
    if(blocked)reasons.push('Bare numeric/editorial/control token cannot establish a pattern.')
    if('quality' in row&&row.quality==='seed_review')reasons.push('Source review provenance requires independent linguistic/catalog context.')
    if(domain==='modifier')reasons.push('Modifier must attach to a motif; never size, quantity or physical material proof.')
    if(declared.has(normalized))reasons.push(...declared.get(normalized)!.map(r=>r.reason))
    if(domains.length)reasons.push('Cross-domain role requires independent evidence.')
    const entry:PatternAliasAudit={domain,sourceIndex,id:'pattern_id' in row?row.pattern_id:row.modifier_id,alias:row.alias,normalized,sourceNormalized:row.normalized_key,
      quality:'quality' in row?row.quality:'modifier',disposition:blocked?'blocked':reasons.length?'conditional':'active',reasons,crossDomains:domains}
    audit.push(entry);if(!blocked){const group=groups.get(normalized)??[];group.push(entry);groups.set(normalized,group)}
  })
  for(const rows of groups.values())if(new Set(rows.map(r=>`${r.domain}:${r.id}`)).size>1)for(const row of rows)Object.assign(row,{disposition:'conditional',reasons:[...row.reasons,'Multiple normalized identities; never choose by order.']})
  for(const key of declared.keys())if(!groups.has(key))groups.set(key,[])
  // Original smoke fixture attests this feminine spelling; contextual only.
  groups.set(normalizeText('مخططة'),[])
  declared.set(normalizeText('مخططة'),patternSource.ambiguities.filter(a=>a.candidate_ids[0]==='STRIPE_GENERIC'))
  const index=new Map<string,PatternLookup>()
  for(const [key,rows] of groups){const ambiguities=declared.get(key)??[],patterns=new Set<SourcePatternId>(rows.filter(r=>r.domain==='pattern').map(r=>r.id as SourcePatternId));for(const row of ambiguities)row.candidate_ids.forEach(id=>patterns.add(id))
    index.set(key,freezePattern({status:ambiguities.length||patterns.size>1||rows.some(r=>r.disposition==='conditional')?'context_required':'matched',patterns:[...patterns],
      modifiers:[...new Set(rows.filter(r=>r.domain==='modifier').map(r=>r.id as PatternModifierId))],ambiguities,crossDomains:[...new Set(rows.length?rows.flatMap(r=>r.crossDomains):crossDomains(key))]}))}
  freezePattern(audit)
  const unknown:PatternLookup=freezePattern({status:'unknown',patterns:[],modifiers:[],ambiguities:[],crossDomains:[]}),maxTokens=Math.max(...[...index.keys()].map(key=>tokenizeText(key).length))
  const count=(domain:PatternAliasAudit['domain'],disposition:PatternAliasAudit['disposition'])=>audit.filter(r=>r.domain===domain&&r.disposition===disposition).length
  return Object.freeze({audit,lookup:(text:string)=>index.get(normalizeText(text))??unknown,matchTokens:(text:string)=>matchLongestAliases(text,maxTokens,phrase=>index.get(phrase)),
    coverage:Object.freeze({concepts:169,groups:13,modifiers:25,patternAliases:1219,modifierAliases:161,patternActive:count('pattern','active'),patternConditional:count('pattern','conditional'),patternBlocked:count('pattern','blocked'),modifierActive:count('modifier','active'),modifierConditional:count('modifier','conditional'),modifierBlocked:count('modifier','blocked'),uniqueKeys:index.size})})
}
