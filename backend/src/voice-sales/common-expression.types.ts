import type { CommonExpressionId, CommonExpressionCategory } from './common-expression-ids.js'
import type { ParseSpan } from './parser.types.js'

export type ExpressionHandling = 'none' | 'context_required' | 'workflow_validation'
export interface ExpressionConcept {
  readonly expression_id: CommonExpressionId
  readonly category: CommonExpressionCategory
  readonly label_en: string
  readonly label_ar: string
  readonly intent: string
  readonly handling: ExpressionHandling
  readonly aliases: readonly string[]
  readonly review_status: 'seed_unvalidated'
}
export interface ExpressionAlias {
  readonly alias: string
  readonly normalized_key: string
  readonly expression_id: CommonExpressionId
  readonly category: CommonExpressionCategory
  readonly token_count: number
  readonly risk: 'none' | 'workflow_validation' | 'context'
}
export interface ExpressionCollision {
  readonly normalized_key: string
  readonly expression_ids: readonly CommonExpressionId[]
  readonly action: string
}
export interface ExpressionAmbiguity {
  readonly phrase: string
  readonly expression_id: CommonExpressionId
  readonly reason: string
  readonly action: string
}
export interface CommonExpressionSeed {
  readonly meta: { readonly statistics: { entries: number; aliases: number; categories: number; normalized_collisions: number; ambiguous_terms: number } }
  readonly categories: readonly { id: CommonExpressionCategory; name: string }[]
  readonly expressions: readonly ExpressionConcept[]
  readonly alias_index: readonly ExpressionAlias[]
  readonly collisions: readonly ExpressionCollision[]
  readonly ambiguities: readonly ExpressionAmbiguity[]
}
export interface ExpressionAliasAudit extends ExpressionAlias {
  readonly sourceIndex: number
  readonly normalized: string
  readonly disposition: 'active' | 'conditional' | 'suggestion'
  readonly reasons: readonly string[]
  readonly crossDomains: readonly string[]
}
export interface ExpressionLookup {
  readonly status: 'matched' | 'context_required' | 'suggestion' | 'unknown'
  readonly candidates: readonly CommonExpressionId[]
  readonly records: readonly ExpressionAliasAudit[]
  readonly ambiguities: readonly ExpressionAmbiguity[]
  readonly crossDomains: readonly string[]
}
/** Public advisory projection. Resource rows and internal audit metadata never enter the API. */
export interface CommonExpressionCue {
  readonly span: ParseSpan
  readonly candidates: readonly CommonExpressionId[]
  readonly categories: readonly CommonExpressionCategory[]
  readonly status: 'recognized' | 'context_required' | 'suggestion'
  readonly role: 'intent' | 'attribute_overlap' | 'grammar' | 'literal_name'
  readonly polarity: 'affirmative' | 'negated' | 'uncertain'
  readonly recognitionOnly: true
  readonly authorizesAction: false
  readonly provenance: 'seed_unvalidated'
}
export interface CommonExpressionSafety {
  readonly salePreviewAllowed: boolean
  readonly reason: 'AFFIRMATIVE_OR_ATTRIBUTE_TEXT' | 'NON_SALE_INTENT' | 'INTENT_REQUIRES_CONTEXT' | 'NEGATED_INTENT'
  readonly recognitionOnly: true
  readonly authorizesAction: false
}
