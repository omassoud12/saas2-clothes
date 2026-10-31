import type { ProductType, TokenMatch } from './dictionary.types.js'
import type { SourceProductTypeId } from './product-type-source-ids.js'

export interface SourceProductAlias {
  readonly text: string
  readonly sourceNormalized: string
  readonly source: string
  readonly locale: string
  readonly matchPolicy: 'exact_candidate' | 'require_context'
  readonly reviewStatus: 'seed_review'
}
export interface SourceProductConcept {
  readonly id: SourceProductTypeId
  readonly group: string
  readonly labels: { readonly ar: string; readonly en: string }
  readonly audienceHint: string
  readonly note: string
  readonly aliases: readonly SourceProductAlias[]
}
export interface ProductTypeSeed {
  readonly schemaVersion: '1.0'
  readonly domain: 'product_types'
  readonly source: { readonly originalFilename: string; readonly sourceVersion: string;
    readonly originalJsonSHA256: string; readonly sourceSeedReview: true }
  readonly integratePolicy: { readonly databaseWrites: false;
    readonly canonicalIdsMustBeMappedToExistingParserSemantics: true;
    readonly unknownAmbiguitiesMustRemainCandidates: true;
    readonly doNotAssumeEntryDatabaseProductTypes: true; readonly reviewBeforeBroadEnablement: true }
  readonly productTypes: readonly SourceProductConcept[]
}
export interface SourceProductAmbiguity {
  readonly sourceNormalized: string
  readonly candidateTypeIds: readonly SourceProductTypeId[]
  readonly candidateArabicLabels: string
  readonly neededContext: string
}
export interface ProductTypeAmbiguities {
  readonly domain: 'product_types'
  readonly sourceVersion: string
  readonly ambiguousAliases: readonly SourceProductAmbiguity[]
}
export interface SourceProductCandidate {
  readonly sourceTypeId: SourceProductTypeId
  readonly canonicalType: ProductType | null
  readonly labels: SourceProductConcept['labels']
  readonly group: string
  readonly audienceHint: string
  readonly matchPolicy: SourceProductAlias['matchPolicy']
  readonly reviewStatus: 'seed_review'
  /** Only matched records, not the entire concept's alias list, enter API evidence. */
  readonly aliases: readonly SourceProductAlias[]
}
export interface SourceProductLookup {
  readonly alias: string
  readonly status: 'unknown' | 'candidate' | 'ambiguous' | 'blocked'
  readonly candidates: readonly SourceProductCandidate[]
  readonly context: readonly SourceProductAmbiguity[]
  readonly crossDomainOverlaps: readonly string[]
}
export interface ParsedSourceProductMatch extends TokenMatch<SourceProductLookup> {
  /** Deprecated compatibility flag: active language aliases require ordinary catalog proof, not literal spelling. */
  readonly requiresCatalogEvidence: boolean
}
