import type { FitCutAxis, SourceFitCutId, FitCutIdForAxis, FitCutModifierId } from './fit-cut-ids.js'
import type { ParseSpan, ParsedAttribute } from './parser.types.js'

export interface FitCutConcept {
  readonly style_id: SourceFitCutId
  readonly group: FitCutAxis
  readonly english: string
  readonly arabic_fusha: string
  readonly lebanese: string
  readonly syrian: string
  readonly french: string
  readonly aliases: readonly string[]
  readonly review_priority: string
  readonly alias_count: number
}
export interface FitCutAlias {
  readonly alias: string
  readonly normalized_key: string
  readonly style_id: SourceFitCutId
  readonly group: FitCutAxis
  readonly script: string
  readonly risk: 'standard' | 'review'
}
export interface FitCutModifier {
  readonly modifier_id: FitCutModifierId
  readonly slot: string
  readonly english: string
  readonly arabic: string
  readonly aliases: readonly string[]
  readonly note: string
}
export interface FitCutModifierAlias {
  readonly modifier_id: FitCutModifierId
  readonly slot: string
  readonly alias: string
  readonly normalized_key: string
}
export interface FitCutAmbiguity { readonly phrase: string; readonly candidate_ids: string; readonly reason: string; readonly severity: string }
export interface FitCutCollision { readonly normalized_key: string; readonly style_ids: string; readonly action: string }
export interface FitCutSeed {
  readonly meta: Readonly<Record<string, unknown>>
  readonly groups: readonly { readonly group: FitCutAxis; readonly description: string; readonly example: string }[]
  readonly styles: readonly FitCutConcept[]
  readonly style_aliases: readonly FitCutAlias[]
  readonly modifiers: readonly FitCutModifier[]
  readonly modifier_aliases: readonly FitCutModifierAlias[]
  readonly ambiguities: readonly FitCutAmbiguity[]
  readonly collisions: readonly FitCutCollision[]
  readonly test_cases: readonly { readonly input_text: string; readonly expected_style_ids: readonly SourceFitCutId[]; readonly expect_review: boolean }[]
}
export interface FitCutAliasAudit {
  readonly domain: 'style' | 'modifier'
  readonly sourceIndex: number
  readonly id: SourceFitCutId | FitCutModifierId
  readonly alias: string
  readonly normalized: string
  readonly sourceNormalized: string
  readonly risk: 'standard' | 'review' | 'modifier'
  readonly disposition: 'active' | 'conditional' | 'blocked'
  readonly reasons: readonly string[]
  readonly crossDomains: readonly string[]
}
export interface FitCutLookup {
  readonly status: 'matched' | 'context_required' | 'unknown'
  readonly styles: readonly SourceFitCutId[]
  readonly modifiers: readonly FitCutModifierId[]
  readonly ambiguities: readonly FitCutAmbiguity[]
  readonly crossDomains: readonly string[]
}
/** Public evidence contains no source file paths, raw audit rows, or product identities. */
export interface ParsedFitCutMatch extends ParseSpan {
  readonly result: FitCutLookup
  readonly role: 'descriptor' | 'modifier' | 'literal_name' | 'owned_by_other' | 'requires_context'
  readonly polarity: 'affirmative' | 'negated'
  readonly constrainsCatalog: boolean
  readonly modifierTarget: ParseSpan | null
}
export type FitCutAttributes = { readonly [A in FitCutAxis]: ParsedAttribute<FitCutIdForAxis<A>> }
