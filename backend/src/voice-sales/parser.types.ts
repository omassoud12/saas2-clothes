import type { Color, Fit, Material, Neckline, Pattern, ProductType, Size } from './dictionary.types.js'
import type { ParsedQuantityIntent } from './quantity-source.types.js'
import type { ParsedSourceProductMatch } from './product-type-source.types.js'
import type { SourceProductTypeId } from './product-type-source-ids.js'
import type { SourceColorId } from './color-source-ids.js'
import type { ParsedSourceColorMatch } from './color-source.types.js'
import type { ParsedSourceSizeMatch } from './size-source.types.js'
import type { SourceSizeId } from './size-source-ids.js'
import type { SourceMaterialId } from './material-source-ids.js'
import type { ParsedMaterialMatch, MaterialCompositionRequest } from './material-source.types.js'
import type { SourceNecklineShapeId, SourceCollarTypeId } from './neckline-source-ids.js'
import type { ParsedNecklineMatch } from './neckline-source.types.js'
import type { CommonExpressionCue, CommonExpressionSafety } from './common-expression.types.js'
import type { FitCutAttributes, ParsedFitCutMatch } from './fit-cut.types.js'
import type { SourcePatternId } from './pattern-ids.js'
import type { ParsedPatternMatch } from './pattern.types.js'
import type { RequestIntentMatch } from './request-intent.js'

export interface VoiceSaleAttributes {
  productType: ProductType
  color: Color
  size: Size
  /** Validated integer sellable units; legacy dictionary canonical values remain unchanged. */
  quantity: number
  material: Material
  neckline: Neckline
  fit: Fit
  pattern: Pattern
}
export type AttributeName = keyof VoiceSaleAttributes
export interface ParseSpan {
  /** Half-open offsets into normalized text tokens, not original characters. */
  readonly startToken: number
  readonly endToken: number
  readonly text: string
}
export interface ParseEvidence {
  readonly span: ParseSpan
  readonly source: 'explicit' | 'inferred'
  readonly rule: string
}
export interface ParsedAttribute<T> {
  readonly status: 'missing' | 'resolved' | 'ambiguous' | 'conflict'
  /** Only resolved attributes have a value; alternatives are never silently selected. */
  readonly value: T | null
  readonly candidates: readonly T[]
  readonly source: 'explicit' | 'inferred' | 'mixed' | null
  readonly evidence: readonly ParseEvidence[]
}
export type ParsedAttributes = { readonly [F in AttributeName]: ParsedAttribute<VoiceSaleAttributes[F]> }
export interface ResidualToken {
  readonly token: string
  readonly index: number
}
export interface ParseAlternative {
  readonly field: AttributeName
  readonly value: VoiceSaleAttributes[AttributeName]
}
export interface ParseIssue {
  readonly kind: 'lexical_ambiguity' | 'conflicting_attribute' | 'unresolved_number'
    | 'unsupported_value' | 'uncertain_transcription' | 'unsupported_structure'
    | 'multiple_items' | 'invalid_input'
  readonly message: string
  readonly span: ParseSpan
  readonly fields: readonly AttributeName[]
  readonly alternatives: readonly ParseAlternative[]
}
export interface VoiceSaleParseResult {
  readonly sourcePatternId?: ParsedAttribute<SourcePatternId>
  readonly patternCandidates?: readonly ParsedPatternMatch[]
  readonly sourceFitCuts?: FitCutAttributes
  readonly fitCutCandidates?: readonly ParsedFitCutMatch[]
  readonly commonExpressionMatches?: readonly CommonExpressionCue[]
  readonly commonExpressionSafety?: CommonExpressionSafety
  readonly requestIntents?: readonly RequestIntentMatch[]
  readonly sourceNecklineShape?: ParsedAttribute<SourceNecklineShapeId>
  readonly sourceCollarType?: ParsedAttribute<SourceCollarTypeId>
  readonly necklineCandidates?: readonly ParsedNecklineMatch[]
  readonly sourceMaterial?: ParsedAttribute<SourceMaterialId>
  readonly materialCandidates?: readonly ParsedMaterialMatch[]
  readonly materialComposition?: readonly MaterialCompositionRequest[]
  readonly quantityIntent?: ParsedQuantityIntent
  readonly sourceSizeId?: ParsedAttribute<SourceSizeId>
  readonly sourceSizeCandidates?: readonly ParsedSourceSizeMatch[]
  readonly sourceColorId?: ParsedAttribute<SourceColorId>
  readonly colorCandidates?: readonly ParsedSourceColorMatch[]
  /** Additive identity supporting all source concepts; legacy canonical attributes are preserved. */
  readonly sourceProductType?: ParsedAttribute<SourceProductTypeId>
  /** Additive candidate evidence. Source IDs never replace the existing canonical attribute type. */
  readonly productTypeCandidates?: readonly ParsedSourceProductMatch[]
  readonly status: 'parsed' | 'incomplete' | 'needs_clarification'
    | 'unsupported_multiple_items' | 'invalid_input'
  readonly originalText: string | null
  readonly normalizedText: string
  readonly attributes: ParsedAttributes
  readonly productNameResidualTokens: readonly ResidualToken[]
  readonly unrecognizedTokens: readonly ResidualToken[]
  readonly conversationalTokens: readonly ResidualToken[]
  readonly ambiguities: readonly ParseIssue[]
  readonly missingInformation: readonly AttributeName[]
  readonly unresolvedInformation: readonly AttributeName[]
}

/** Internal parsing hints produced only by the deterministic utterance segmenter. */
export interface VoiceSaleParserOptions {
  /** Item position supplied only by the deterministic multi-item segmenter. */
  readonly itemIndex?: number
  /** Exact token spans that remain literal catalog-name evidence, not product-type assertions. */
  readonly literalProductNameSpans?: readonly ParseSpan[]
  /**
   * Exact low-count spans established by the deterministic multi-item segmenter.
   * The parser never infers these from an arbitrary bare number.
   */
  readonly contextualOrderCountSpans?: readonly ParseSpan[]
}
