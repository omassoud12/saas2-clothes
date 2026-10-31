export type ProductType = 'T_SHIRT' | 'JEANS' | 'PANTS' | 'BODYSUIT' | 'SWEATER'
  | 'DRESS' | 'LEGGINGS' | 'TIGHTS' | 'UNDERWEAR' | 'BRA' | 'HOODIE' | 'JACKET'
  | 'SHIRT' | 'TOP' | 'POLO_SHIRT'
export type Color = 'BLACK' | 'WHITE' | 'NAVY_BLUE' | 'OLIVE_GREEN' | 'GREEN'
  | 'RED' | 'BLUE' | 'GREY' | 'BEIGE' | 'BROWN' | 'PINK' | 'YELLOW' | 'ORANGE'
export type Size = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL'
  | '28' | '30' | '32' | '34' | '36' | '38' | '40'
export type Material = 'VELVET' | 'COTTON' | 'DENIM' | 'WOOL' | 'LINEN' | 'LEATHER'
export type Neckline = 'POLO_COLLAR' | 'CREW_NECK' | 'V_NECK'
export type Fit = 'SLIM_FIT' | 'REGULAR_FIT' | 'OVERSIZED' | 'LOOSE_FIT'
export type Pattern = 'PLAIN' | 'STRIPED' | 'CHECKERED' | 'WAVY'
export type Quantity = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 20 | 24 | 30 | 32 | 50 | 100
export type Expression = 'SALE' | 'WANT' | 'SIZE_MARKER' | 'COLOR_MARKER'
  | 'QUANTITY_MARKER' | 'PLEASE' | 'CONFIRM' | 'CANCEL'

export interface DomainValues {
  productTypes: ProductType
  colors: Color
  sizes: Size
  materials: Material
  necklines: Neckline
  fits: Fit
  patterns: Pattern
  quantities: Quantity
  expressions: Expression
}
export type DictionaryDomain = keyof DomainValues

export interface DictionaryEntry<D extends DictionaryDomain> {
  readonly value: DomainValues[D]
  readonly aliases: readonly string[]
}
export interface ContextualAliases<D extends DictionaryDomain> {
  readonly aliases: readonly string[]
  readonly candidates: readonly DomainValues[D][]
  readonly reason: string
}
export interface DictionaryDefinition<D extends DictionaryDomain> {
  readonly domain: D
  readonly entries: readonly DictionaryEntry<D>[]
  readonly contextual?: readonly ContextualAliases<D>[]
  readonly suggestions?: readonly ContextualAliases<D>[]
}

export type LookupResult<D extends DictionaryDomain> =
  | { readonly status: 'matched'; readonly domain: D; readonly alias: string; readonly value: DomainValues[D] }
  | { readonly status: 'ambiguous' | 'suggestion'; readonly domain: D; readonly alias: string;
      readonly candidates: readonly DomainValues[D][]; readonly reason: string }
  | { readonly status: 'unknown'; readonly domain: D; readonly alias: string }

export type KnownResult<D extends DictionaryDomain> = Exclude<LookupResult<D>, { status: 'unknown' }>
export type AnyKnownResult = { [D in DictionaryDomain]: KnownResult<D> }[DictionaryDomain]

export interface TokenMatch<R> {
  /** Half-open token offsets in normalized text, NOT character offsets in the original input. */
  readonly startToken: number
  readonly endToken: number
  readonly phrase: string
  readonly result: R
}
export interface DictionaryCoverage {
  readonly canonicalValues: number
  readonly trustedAliases: number
  readonly contextualAliases: number
  readonly suggestionAliases: number
}
export interface Dictionary<D extends DictionaryDomain> {
  readonly domain: D
  readonly maxAliasTokens: number
  readonly coverage: DictionaryCoverage
  lookup(text: string): LookupResult<D>
  matchTokens(text: string): readonly TokenMatch<KnownResult<D>>[]
}
