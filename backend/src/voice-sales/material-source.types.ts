import type { SourceMaterialId, SourceFabricModifierId } from './material-source-ids.js'
import type { Material } from './dictionary.types.js'
import type { ParseSpan } from './parser.types.js'

export interface FabricConcept {
  readonly fabric_id: SourceMaterialId
  readonly group_id: string
  readonly group_label: string
  readonly canonical_en: string
  readonly canonical_ar: string
  readonly canonical_fr: string
  readonly notes: string
  readonly review_status: string
}
export interface FabricModifierConcept {
  readonly modifier_id: SourceFabricModifierId
  readonly group_id: string
  readonly canonical_en: string
  readonly canonical_ar: string
  readonly notes: string
}
export interface FabricAlias {
  readonly fabric_id: SourceMaterialId
  readonly alias: string
  readonly normalized: string
  readonly source: string
  readonly locale: string
  readonly match_policy: 'exact_candidate' | 'review_candidate' | 'needs_context'
  readonly review_status: 'seed_review' | 'needs_review'
}
export interface FabricModifierAlias {
  readonly modifier_id: SourceFabricModifierId
  readonly alias: string
  readonly normalized: string
  readonly locale: string
  readonly source: string
}
export interface MaterialAmbiguity {
  readonly alias: string
  readonly normalized: string
  readonly candidate_ids: string
  readonly why_ambiguous: string
  readonly safe_default: string
}
export interface MaterialSeed {
  readonly meta: Readonly<Record<string, unknown>>
  readonly stats: Readonly<Record<string, number>>
  readonly groups: readonly { readonly group_id: string; readonly group_label: string }[]
  readonly fabrics: readonly FabricConcept[]
  readonly fabric_aliases: readonly FabricAlias[]
  readonly modifiers: readonly FabricModifierConcept[]
  readonly modifier_aliases: readonly FabricModifierAlias[]
  readonly ambiguities: readonly MaterialAmbiguity[]
  readonly test_cases: readonly Readonly<Record<string, string>>[]
}
export type MaterialAliasDisposition = 'active' | 'conditional' | 'blocked'
export interface MaterialAliasAudit {
  readonly domain: 'fabric' | 'modifier'
  readonly sourceIndex: number
  readonly alias: string
  readonly id: SourceMaterialId | SourceFabricModifierId
  readonly normalized: string
  readonly sourceNormalized: string
  readonly disposition: MaterialAliasDisposition
  readonly reasons: readonly string[]
  readonly crossDomains: readonly string[]
}
export interface SourceMaterialLookup {
  readonly status: 'matched' | 'context_required' | 'blocked' | 'unknown'
  readonly alias: string
  readonly fabrics: readonly SourceMaterialId[]
  readonly modifiers: readonly SourceFabricModifierId[]
  readonly records: readonly MaterialAliasAudit[]
  readonly ambiguities: readonly MaterialAmbiguity[]
  readonly crossDomains: readonly string[]
  readonly legacyMaterial: Material | null
}
export interface ParsedMaterialMatch extends ParseSpan {
  readonly result: SourceMaterialLookup
  readonly domainExplicit: boolean
  /** Product-role collisions remain visible without automatically adding a second fabric claim. */
  readonly constrainsCatalog: boolean
}
export interface MaterialCompositionRequest {
  readonly span: ParseSpan
  readonly percentage: number | null
  readonly candidates: readonly SourceMaterialId[]
  readonly status: 'requested' | 'invalid' | 'unbound'
  readonly catalogVerified: false
}
