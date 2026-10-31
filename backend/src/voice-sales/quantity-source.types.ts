import type { ParseSpan } from './parser.types.js'

export const quantityUnitIds = ['PIECE', 'PAIR', 'DOZEN', 'HALF_DOZEN', 'QUARTER_DOZEN', 'SET', 'PACK',
  'BUNDLE', 'BOX', 'CARTON', 'BAG', 'ROLL', 'HANGER', 'BALE', 'SACK', 'LOT', 'MULTIPACK', 'STRIP',
  'METER', 'CENTIMETER', 'YARD', 'KILOGRAM', 'GRAM'] as const
export type QuantityUnitId = typeof quantityUnitIds[number]
export const quantityModifierIds = ['APPROX', 'EXACT', 'AT_LEAST', 'AT_MOST', 'MORE_THAN', 'LESS_THAN',
  'RANGE', 'EACH', 'PER_COLOR', 'PER_SIZE', 'TOTAL', 'ADD', 'REMOVE', 'REPLACE', 'ONLY', 'REMAINING',
  'ALL_STOCK', 'ASSORTED', 'HALF', 'QUARTER', 'DOUBLE', 'TRIPLE', 'OF', 'COUNT_LABEL'] as const
export type QuantityModifierId = typeof quantityModifierIds[number]
export type SourceQuantityId = `QTY_${string}`
export interface QuantityValueRecord {
  readonly quantity_id: SourceQuantityId
  readonly value: number
  readonly kind: 'integer'
  readonly arabic_display: string
  readonly english_display: string
  readonly recognition_note: string
}
export interface QuantityNumberAlias {
  readonly alias: string
  readonly normalized: string
  readonly quantity_id: SourceQuantityId
  readonly value: number
  readonly language: string
  readonly alias_type: string
  readonly match_policy: 'needs_quantity_context' | 'needs_context_if_ambiguous'
  readonly review_status: string
}
export interface QuantityUnitRecord {
  readonly unit_id: QuantityUnitId
  readonly english_name: string
  readonly arabic_name: string
  readonly conversion_type: 'fixed' | 'inventory_dependent' | 'unknown' | 'length' | 'weight'
  readonly known_pieces_per_unit: number | null
  readonly notes: string
}
export interface QuantityUnitAlias {
  readonly alias: string
  readonly normalized: string
  readonly unit_id: QuantityUnitId
  readonly language: string
  readonly match_policy: 'unit_context' | 'verify_phrase_for_implicit_number' | 'catalog_conversion_required'
  readonly review_status: string
}
export interface QuantityDirectPhrase {
  readonly alias: string
  readonly normalized: string
  readonly order_units: number
  readonly unit_id: QuantityUnitId
  readonly resolved_pieces: number | null
  readonly requires_pack_metadata: 'yes' | 'no'
  readonly note: string
}
export interface QuantityModifierAlias {
  readonly alias: string
  readonly normalized: string
  readonly modifier_id: QuantityModifierId
  readonly language: string
  readonly match_policy: 'context_only'
}
export interface QuantitySeed {
  readonly metadata: { readonly version: string; readonly counts: Readonly<Record<string, number>>; readonly caution: string }
  readonly data: {
    readonly quantities: readonly QuantityValueRecord[]
    readonly number_aliases: readonly QuantityNumberAlias[]
    readonly units: readonly QuantityUnitRecord[]
    readonly unit_aliases: readonly QuantityUnitAlias[]
    readonly direct_phrases: readonly QuantityDirectPhrase[]
    readonly modifiers: readonly { readonly modifier_id: QuantityModifierId; readonly arabic_name: string;
      readonly semantic_action: string; readonly notes: string }[]
    readonly modifier_aliases: readonly QuantityModifierAlias[]
    readonly ambiguities: readonly { readonly expression: string; readonly may_mean: string;
      readonly domain_hint: string; readonly resolution_rule: string; readonly review_status: string }[]
    readonly alias_collisions: readonly { readonly normalized_alias: string; readonly unit_ids: string; readonly handling: string }[]
    readonly parser_test_cases: readonly { readonly input: string; readonly expected_order_units: number | null;
      readonly expected_unit: QuantityUnitId | null; readonly expected_individual_pieces: number | null;
      readonly expected_intent: string; readonly rationale: string }[]
    readonly normalization_rules: readonly { readonly rule: string; readonly implementation: string }[]
  }
}
export type QuantityAliasGroup = 'number_aliases' | 'unit_aliases' | 'direct_phrases' | 'modifier_aliases'
export interface QuantityAliasAudit {
  readonly group: QuantityAliasGroup
  readonly sourceIndex: number
  readonly alias: string
  readonly normalizedKey: string
  readonly sourceNormalizedKey: string
  readonly disposition: 'conditional' | 'blocked'
  readonly reasons: readonly string[]
  readonly conflictingTargets: readonly string[]
  readonly crossDomains: readonly string[]
}
export interface QuantityEvidence {
  readonly span: ParseSpan
  readonly originalSpan: { readonly start: number; readonly end: number; readonly text: string }
  readonly rule: string
  readonly orderUnits: number | null
  readonly unitCandidates: readonly QuantityUnitId[]
}
export type QuantityIntentKind = 'order' | 'approx' | 'min' | 'max' | 'range' | 'add' | 'remove'
  | 'allocation' | 'inventory' | 'needs_review' | 'not_quantity'
/** Advisory preview only. Non-PIECE units never convert to stock without independently verified SKU metadata. */
export interface ParsedQuantityIntent {
  readonly status: 'missing' | 'resolved' | 'context_required' | 'advisory' | 'conflict' | 'invalid'
  readonly intent: QuantityIntentKind
  readonly orderUnits: number | null
  readonly unitId: QuantityUnitId | null
  readonly unitCandidates: readonly QuantityUnitId[]
  readonly resolvedPieces: number | null
  readonly needsCatalogMetadata: boolean
  readonly exactness: 'exact' | 'approximate' | 'bounded' | 'range' | 'unresolved'
  readonly modifiers: readonly { readonly ids: readonly QuantityModifierId[]; readonly span: ParseSpan }[]
  readonly evidence: readonly QuantityEvidence[]
  readonly reasons: readonly string[]
}
