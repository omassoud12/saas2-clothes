import type { SourceNecklineStyleId, SourceNecklineShapeId, SourceCollarTypeId, SourceNecklineModifierId } from './neckline-source-ids.js'
import type { ParseSpan } from './parser.types.js'

export interface NecklineStyleConcept {
  readonly style_id: SourceNecklineStyleId
  readonly group: 'neckline_shape' | 'collar_type'
  readonly english: string
  readonly arabic_fusha: string
  readonly lebanese: string
  readonly syrian: string
  readonly french: string
  readonly aliases: readonly string[]
  readonly description: string
  readonly review_status: string
  readonly source: string
  readonly alias_count: number
}
export interface NecklineModifierConcept {
  readonly modifier_id: SourceNecklineModifierId
  readonly slot: string
  readonly english: string
  readonly arabic: string
  readonly aliases: readonly string[]
  readonly rule: string
}
export interface NecklineStyleAlias {
  readonly alias: string
  readonly normalized_key: string
  readonly style_id: SourceNecklineStyleId
  readonly group: 'neckline_shape' | 'collar_type'
  readonly script: string
  readonly locale_group: string
  readonly review_priority: string
}
export interface NecklineModifierAlias {
  readonly alias: string
  readonly normalized_key: string
  readonly modifier_id: SourceNecklineModifierId
  readonly slot: string
  readonly rule: string
}
export interface NecklineAmbiguity {
  readonly phrase: string
  /** Includes explicitly external language roles, not only style identities. */
  readonly candidates: string
  readonly reason: string
  readonly action: string
  readonly severity: string
}
export interface NecklineSeed {
  readonly meta: Readonly<Record<string, unknown>>
  readonly styles: readonly NecklineStyleConcept[]
  readonly style_aliases: readonly NecklineStyleAlias[]
  readonly modifiers: readonly NecklineModifierConcept[]
  readonly modifier_aliases: readonly NecklineModifierAlias[]
  readonly ambiguities: readonly NecklineAmbiguity[]
  readonly test_cases: readonly { readonly input_text: string; readonly expected_style_id: string; readonly expect_review: boolean; readonly note: string }[]
}
export interface NecklineAliasAudit {
  readonly domain: 'style' | 'modifier'
  readonly sourceIndex: number
  readonly id: SourceNecklineStyleId | SourceNecklineModifierId
  readonly alias: string
  readonly normalized: string
  readonly sourceNormalized: string
  readonly disposition: 'active' | 'conditional' | 'blocked'
  readonly reasons: readonly string[]
  readonly crossDomains: readonly string[]
}
export interface SourceNecklineLookup {
  readonly status: 'matched' | 'context_required' | 'unknown'
  readonly shapes: readonly SourceNecklineShapeId[]
  readonly collars: readonly SourceCollarTypeId[]
  readonly modifiers: readonly SourceNecklineModifierId[]
  readonly externalRoles: readonly string[]
  readonly records: readonly NecklineAliasAudit[]
  readonly ambiguities: readonly NecklineAmbiguity[]
  readonly crossDomains: readonly string[]
}
export interface ParsedNecklineMatch extends ParseSpan {
  readonly result: SourceNecklineLookup
  readonly domainExplicit: boolean
  readonly constrainsCatalog: boolean
}
