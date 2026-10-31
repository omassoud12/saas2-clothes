import type { AuthContext } from '../auth/auth.types.js'
import type { AttributeName, VoiceSaleParseResult } from './parser.types.js'

export type VoiceMatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'INCOMPLETE' | 'NOT_FOUND'
  | 'INSUFFICIENT_STOCK' | 'INVALID_INPUT'
export type CatalogEvidenceField = AttributeName | 'product_name' | 'category'
export type MissingMatchField = AttributeName | 'product_name' | 'variant' | 'selling_price' | 'catalog_coverage'
export interface MatchEvidence {
  readonly field: AttributeName | 'product_name'
  readonly source: 'variant_column' | 'product_name' | 'category_name' | 'literal_product_name' | 'partial_name_suggestion'
    | 'sku' | 'barcode'
  readonly requested: string
  readonly actual: string | null
}
export interface CatalogVariant {
  readonly productId: string
  readonly variantId: string
  readonly categoryId?: string
  /** Operational identifier required by the existing POS cart. */
  readonly sku: string
  readonly barcode?: string | null
  readonly productName: string
  readonly categoryName: string
  readonly color: string | null
  readonly size: string | null
  /** Safe Decimal serialization from the database, never a floating-point amount. */
  readonly sellingPrice: string | null
  readonly availableStock: number
  readonly currency: string
}
export interface CatalogSnapshot {
  readonly variants: readonly CatalogVariant[]
  readonly scannedVariants: number
  readonly truncated: boolean
  /** Internal image keys keyed by product id. Never serialized to a client. */
  readonly productImageKeys?: ReadonlyMap<string, string>
}
export interface CatalogReader {
  read(context: AuthContext): Promise<CatalogSnapshot>
}
export type CatalogImageResolver = (context: AuthContext, productId: string, imageKey: string) => Promise<string | null>
export interface VoiceMatchCandidate extends CatalogVariant {
  readonly imageUrl?: string | null
  readonly quantity: number | null
  readonly evidence: readonly MatchEvidence[]
  readonly missingFields: readonly MissingMatchField[]
  readonly unresolvedConstraints: readonly AttributeName[]
  readonly requiresConfirmation: true
}
export type DiscoveryTier = 'EXACT_VERIFIED' | 'STRONG_CANDIDATE' | 'ALTERNATIVE'
export interface DiscoveryDifference {
  readonly field: CatalogEvidenceField
  readonly requested: string
  readonly actual: string | null
}
export interface VoiceDiscoveryCandidate extends VoiceMatchCandidate {
  readonly tier: DiscoveryTier
  readonly matchedAttributes: readonly CatalogEvidenceField[]
  readonly unverifiedAttributes: readonly CatalogEvidenceField[]
  readonly differences: readonly DiscoveryDifference[]
}
export interface VoiceCatalogDiscovery {
  readonly exactVerified: readonly VoiceDiscoveryCandidate[]
  readonly strongCandidates: readonly VoiceDiscoveryCandidate[]
  readonly alternatives: readonly VoiceDiscoveryCandidate[]
  readonly requiresClarification: boolean
  readonly categoryResolution: CatalogCategoryResolution
}
export type CatalogCategoryResolutionStatus = 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'PARTIAL'
export interface CatalogCategoryCandidate {
  readonly categoryId: string | null
  readonly categoryName: string
  readonly evidence: readonly ('EXACT_NAME' | 'PRODUCT_TYPE_BRIDGE')[]
  readonly productCount: number
}
export interface CatalogCategoryResolution {
  readonly status: CatalogCategoryResolutionStatus
  readonly candidates: readonly CatalogCategoryCandidate[]
  readonly coverageComplete: boolean
}
export interface VoiceSaleMatchResult {
  readonly status: VoiceMatchStatus
  readonly reason: string
  readonly parser: VoiceSaleParseResult
  readonly match: VoiceMatchCandidate | null
  readonly candidates: readonly VoiceMatchCandidate[]
  readonly suggestions: readonly VoiceMatchCandidate[]
  readonly missingFields: readonly MissingMatchField[]
  readonly requiresConfirmation: true
  readonly catalog: {
    readonly scannedVariants: number
    readonly truncated: boolean
    readonly candidateCount: number
    readonly candidatesTruncated: boolean
  }
  /** Read-only ranked discovery. It never changes strict match status. */
  readonly discovery?: VoiceCatalogDiscovery
  /** Additive multi-item result. Absent for every legacy single-item response. */
  readonly items?: readonly VoiceSaleItemMatchResult[]
  readonly segmentation?: VoiceSaleSegmentationSummary
}
export interface VoiceSaleSegmentationSummary {
  readonly status: 'segmented'
  readonly normalizedText: string
  readonly reason: 'REPEATED_EXPLICIT_REQUEST_MARKERS' | 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE'
  readonly removedConversationalExpressions: readonly string[]
}
export interface VoiceSaleItemMatchResult {
  readonly index: number
  readonly segment: {
    readonly text: string
    readonly removedConversationalExpressions: readonly string[]
  }
  readonly result: VoiceSaleMatchResult
}
export interface VoiceMatchingDependencies {
  matchVoiceSaleText(text: string, context: AuthContext): Promise<VoiceSaleMatchResult>
}
