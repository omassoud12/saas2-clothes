import type { SourcePatternId, PatternGroup, PatternModifierId } from './pattern-ids.js'
import type { ParseSpan } from './parser.types.js'
export interface PatternConcept { readonly pattern_id: SourcePatternId; readonly group: PatternGroup; readonly english: string; readonly arabic_fusha: string; readonly lebanese: string; readonly syrian: string; readonly french: string; readonly aliases: readonly string[]; readonly review_priority: string }
export interface PatternAlias { readonly alias: string; readonly normalized_key: string; readonly pattern_id: SourcePatternId; readonly group: PatternGroup; readonly script: string; readonly quality: 'seed'|'seed_review' }
export interface PatternModifier { readonly modifier_id: PatternModifierId; readonly slot: string; readonly english: string; readonly arabic_fusha: string; readonly lebanese: string; readonly syrian: string; readonly french: string; readonly aliases: readonly string[] }
export interface PatternModifierAlias { readonly modifier_id: PatternModifierId; readonly slot: string; readonly alias: string; readonly normalized_key: string }
export interface PatternAmbiguity { readonly phrase: string; readonly normalized_key: string; readonly candidate_ids: readonly SourcePatternId[]; readonly reason: string; readonly severity: string }
export interface PatternCollision { readonly normalized_key: string; readonly pattern_ids: readonly SourcePatternId[]; readonly action: string }
export interface PatternSeed {
  readonly meta: Readonly<Record<string,unknown>>
  readonly groups: readonly {readonly group: PatternGroup;readonly english:string;readonly arabic:string}[]
  readonly patterns: readonly PatternConcept[]; readonly pattern_aliases: readonly PatternAlias[]
  readonly modifiers: readonly PatternModifier[]; readonly modifier_aliases: readonly PatternModifierAlias[]
  readonly ambiguities: readonly PatternAmbiguity[]; readonly collisions: readonly PatternCollision[]
  readonly test_cases: readonly {readonly input_text:string;readonly expected_pattern_ids:readonly SourcePatternId[];readonly expected_excluded_ids:readonly SourcePatternId[];readonly expect_review:boolean}[]
}
export interface PatternAliasAudit { readonly domain:'pattern'|'modifier';readonly sourceIndex:number;readonly id:SourcePatternId|PatternModifierId;readonly alias:string;readonly normalized:string;readonly sourceNormalized:string;readonly quality:'seed'|'seed_review'|'modifier';readonly disposition:'active'|'conditional'|'blocked';readonly reasons:readonly string[];readonly crossDomains:readonly string[] }
export interface PatternLookup { readonly status:'matched'|'context_required'|'unknown';readonly patterns:readonly SourcePatternId[];readonly modifiers:readonly PatternModifierId[];readonly ambiguities:readonly PatternAmbiguity[];readonly crossDomains:readonly string[] }
export interface ParsedPatternMatch extends ParseSpan { readonly result:PatternLookup;readonly role:'descriptor'|'modifier'|'literal_name'|'owned_by_other'|'requires_context';readonly polarity:'affirmative'|'negated';readonly constrainsCatalog:boolean;readonly modifierTarget:ParseSpan|null }
