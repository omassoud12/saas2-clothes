import type { Size, DictionaryDomain } from './dictionary.types.js'
import type { SourceSizeId, SizeFamily } from './size-source-ids.js'

export interface SourceSizeConcept {
  readonly size_id: SourceSizeId
  readonly family: SizeFamily
  readonly canonical_label: string
  readonly size_standard: string
  readonly size_value: string
  readonly display_ar: string
  readonly display_en: string
  readonly apparel_scope: string
  readonly required_context: string
  readonly notes: string
  readonly aliases_count: number
}
export interface SourceSizeAlias {
  readonly alias_id: string
  readonly size_id: SourceSizeId
  readonly alias: string
  readonly normalized_alias: string
  readonly language: string
  readonly alias_kind: string
  readonly match_policy: 'contextual' | 'fuzzy_with_context'
  readonly confidence: number
  readonly required_context: string
  readonly notes: string
}
export interface SizeModifier {
  readonly modifier_id: string
  readonly modifier_name_en: string
  readonly modifier_name_ar: string
  readonly modifier_type: string
  readonly is_size_id: false
  readonly notes: string
}
export interface SizeModifierAlias {
  readonly modifier_id: string
  readonly alias: string
  readonly normalized_alias: string
  readonly type: string
}
export interface SizeAmbiguity {
  readonly ambiguity_id: string
  readonly token: string
  readonly normalized_token: string
  readonly possible_meanings: string
  readonly resolution_rule: string
  readonly auto_resolve: false
}
export interface SizeFixture {
  readonly request: string
  readonly product: string
  readonly expected_size_id: string
  readonly expected_other: string
  readonly notes: string
}
export interface SizeSeed {
  readonly project: string
  readonly dictionary: string
  readonly version: string
  readonly generated_at: string
  readonly warning: string
  readonly size_records: readonly SourceSizeConcept[]
  readonly aliases: readonly SourceSizeAlias[]
  readonly modifiers: readonly SizeModifier[]
  readonly modifier_aliases: readonly SizeModifierAlias[]
  readonly ambiguities: readonly SizeAmbiguity[]
  readonly parser_tests: readonly SizeFixture[]
  readonly stats: Readonly<Record<string, number>>
}
export interface SizeCollisionResource {
  readonly schemaVersion: string
  readonly sourceFile: string
  readonly normalizationBasis: string
  readonly countKeysMappingMultipleSizeIds: number
  readonly countKeysWithMultipleAliasRecords: number
  readonly entries: readonly { readonly normalizedAlias: string; readonly targetSizeIds: readonly SourceSizeId[];
    readonly originalAliasRecords: readonly { readonly aliasId: string; readonly sizeId: SourceSizeId;
      readonly alias: string; readonly matchPolicy: string; readonly requiredContext: string }[] }[]
  readonly notes: unknown
}
export interface SourceSizeLookup {
  readonly alias: string
  readonly status: 'matched' | 'ambiguous' | 'suggestion' | 'unknown'
  readonly candidates: readonly SourceSizeConcept[]
  readonly records: readonly SourceSizeAlias[]
  readonly crossDomainOverlaps: readonly DictionaryDomain[]
  readonly legacySize: Size | null
  readonly reason: string | null
}
export interface SizeContext {
  readonly families: ReadonlySet<SizeFamily>
  readonly standards: ReadonlySet<string>
  readonly garment: boolean
  readonly sizeMarker: boolean
}
export interface ParsedSourceSizeMatch {
  readonly startToken: number
  readonly endToken: number
  readonly phrase: string
  readonly originalSpan: { readonly start: number; readonly end: number; readonly text: string }
  readonly result: SourceSizeLookup
  readonly candidates: readonly SourceSizeId[]
  readonly resolvedId: SourceSizeId | null
  readonly sizeDomainExplicit: boolean
  readonly contextRequired: boolean
  readonly incompatibleStandard?: boolean
}
