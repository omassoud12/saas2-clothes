import type { Color, DictionaryDomain, Pattern, TokenMatch } from './dictionary.types.js'
import type { SourceColorId } from './color-source-ids.js'

export interface SourceColorAlias {
  readonly alias: string
  readonly sourceNormalized: string
  readonly source: string
  readonly locale: 'ar' | 'latin'
  readonly matchPolicy: 'exact_candidate' | 'needs_context'
  readonly reviewStatus: 'seed_review' | 'needs_review'
  readonly sourceCsvLine: number
}
export interface SourceColorConcept {
  readonly colorId: SourceColorId
  readonly canonicalEn: string
  readonly canonicalAr: string
  readonly aliases: readonly SourceColorAlias[]
}
export interface ColorSeed {
  readonly kind: 'SAAS2_COLOR_SHADES_IMPORT_SEED'
  readonly schemaVersion: '1.0.0'
  readonly sourceFile: string
  readonly sourceSha256: string
  readonly important: string
  readonly metadata: { readonly colorConceptCount: number; readonly sourceAliasRecordCount: number;
    readonly scope: string; readonly generatedDefiniteArabicReviewCount: number }
  readonly colors: readonly SourceColorConcept[]
}
export interface ColorCollision {
  readonly sourceNormalizedKey: string
  readonly colorIds: readonly SourceColorId[]
  readonly sourceAliasesByColor: Readonly<Record<string, readonly string[]>>
  readonly policy: 'MUST_REQUIRE_CONTEXT_OR_CLARIFICATION'
}
export interface ColorCollisions {
  readonly note: string
  readonly collisionCount: number
  readonly collisions: readonly ColorCollision[]
}
export interface SourceColorLookup {
  readonly alias: string
  readonly status: 'matched' | 'ambiguous' | 'deferred' | 'unknown'
  readonly value: SourceColorId | null
  readonly candidates: readonly SourceColorId[]
  readonly legacyColor: Color | null
  readonly records: readonly SourceColorAlias[]
  readonly crossDomainOverlaps: readonly DictionaryDomain[]
  readonly embeddedPattern: Pattern | null
  readonly colorMode: boolean
  readonly reason: string | null
}
export interface ParsedSourceColorMatch extends TokenMatch<SourceColorLookup> {
  readonly colorDomainExplicit: boolean
}
