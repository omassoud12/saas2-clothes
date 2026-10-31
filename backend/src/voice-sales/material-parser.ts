import { activeMaterials, activeProductTypes, activeColors, decomposeQualifiedProductAlias } from './index.js'
import { normalizeText, tokenizeText } from './normalization.js'
import type { ParsedMaterialMatch, MaterialCompositionRequest } from './material-source.types.js'
import type { ParseSpan } from './parser.types.js'

export const materialCues = new Set(['material', 'fabric', 'composition', 'قماش', 'خامة', 'تركيبة'])
const modelCues = new Set(['brand', 'model', 'sku', 'barcode', 'ماركة', 'موديل', 'كود'])
export function scanSourceMaterials(text: string, catalogLabel = false): readonly ParsedMaterialMatch[] {
  const tokens = tokenizeText(text)
  const products = activeProductTypes.matchTokens(text)
  const colors = activeColors.matchTokens(text)
  const raw = [...activeMaterials.matchTokens(text)]
  // Arabic conjunction clitic: split only one leading و followed by an exact
  // known alias, immediately after an already recognized fabric descriptor.
  // Unknown names and standalone words are never stripped or fuzzily corrected.
  tokens.forEach((token, index) => {
    if (!token.startsWith('و') || token.length < 2 || raw.some(m => m.startToken <= index && m.endToken > index)
      || !raw.some(m => m.endToken === index)) return
    const hit = activeMaterials.lookup(token.slice(1))
    if (hit.status !== 'unknown' && hit.status !== 'blocked') raw.push(Object.freeze({
      startToken: index, endToken: index + 1, phrase: token, result: hit,
    }))
  })
  raw.sort((a, b) => a.startToken - b.startToken)
  const result: ParsedMaterialMatch[] = []
  for (const match of raw) {
    const domainExplicit = materialCues.has(tokens[match.startToken - 1])
      || match.endToken > match.startToken + 1 && materialCues.has(tokens[match.startToken])
    const productOverlap = products.some(p => p.startToken <= match.startToken && p.endToken >= match.endToken)
    const legacyQualified = products.some(p => p.startToken < match.startToken && p.endToken === match.endToken
      && !!decomposeQualifiedProductAlias(p.phrase))
    const qualified = legacyQualified || catalogLabel && products.some(p => p.startToken <= match.startToken && p.endToken >= match.endToken
        && p.endToken - p.startToken > match.endToken - match.startToken
        && activeProductTypes.lookup(tokens.slice(p.startToken, p.endToken)
          .filter((_, offset) => p.startToken + offset < match.startToken || p.startToken + offset >= match.endToken).join(' ')).status === 'candidate')
    const differentRole = match.result.crossDomains.some(d => !['materials', 'sourceProductTypes'].includes(d))
    const model = modelCues.has(tokens[match.startToken - 1])
    const colorOverlap = colors.some(c => c.startToken <= match.startToken && c.endToken >= match.endToken
      && c.endToken - c.startToken > match.endToken - match.startToken)
    const garment = products.some(p => p.endToken === match.startToken || p.startToken === match.endToken
      || p.startToken < match.startToken && p.endToken > match.startToken)
    // No claim about a brand/model merely because its name is a vocabulary term.
    const compositionCue = /[%٪]/u.test(text) && (/^\d+$/u.test(tokens[match.startToken - 1] ?? '')
      || /^\d+$/u.test(tokens[match.endToken] ?? ''))
    const previousMaterial = raw.some(p => p.endToken <= match.startToken && p.endToken >= match.startToken - 1
      && tokens.slice(p.endToken, match.startToken).every(t => ['and', 'و', 'w'].includes(t)))
    const constrainsCatalog = match.result.status !== 'blocked' && !model
      && (domainExplicit || !colorOverlap && (qualified || !productOverlap && !differentRole && garment
        || !productOverlap && !differentRole && (compositionCue || previousMaterial)
        || !productOverlap && !differentRole && raw.length === 1 && match.startToken === 0 && match.endToken === tokens.length))
    result.push(Object.freeze({ startToken: match.startToken, endToken: match.endToken, text: match.phrase,
      result: match.result, domainExplicit, constrainsCatalog }))
  }
  return Object.freeze(result)
}

/** Only adjacent, explicitly named components; never verifies merchant composition. */
export function scanMaterialComposition(text: string, matches: readonly ParsedMaterialMatch[]): readonly MaterialCompositionRequest[] {
  const rows: MaterialCompositionRequest[] = []
  let prefixStyle: boolean | undefined
  const normalizedSource = text.normalize('NFKC')
  for (const match of normalizedSource.matchAll(/[+\-−]?\p{N}+(?:[.,٫]\p{N}+)?\s*[%٪]/gu)) {
    const startToken = tokenizeText(normalizedSource.slice(0, match.index)).length
    const endToken = startToken + tokenizeText(match[0]).length
    const span: ParseSpan = Object.freeze({ startToken, endToken, text: tokenizeText(text).slice(startToken, endToken).join(' ') })
    const attached = matches.filter(row => row.constrainsCatalog && row.result.fabrics.length
      && (row.endToken === startToken || row.startToken === endToken))
    // Prefer a preceding material (cotton 95% elastane 5%); two interpretations on
    // the same side remain unresolved. Prefix syntax is allowed for the first component.
    const preceding = attached.filter(row => row.endToken === startToken)
    const following = attached.filter(row => row.startToken === endToken)
    prefixStyle ??= !preceding.length && following.length === 1
    const selected = prefixStyle ? following.length === 1 ? following[0] : undefined
      : preceding.length === 1 ? preceding[0] : !preceding.length && following.length === 1 ? following[0] : undefined
    const numberText = normalizeText(match[0].replace(/[%٪\s]/gu, ''))
    const value = Number(numberText)
    const valid = !/[+\-−.,٫]/u.test(match[0]) && Number.isInteger(value) && value >= 0 && value <= 100
    rows.push(Object.freeze({ span, percentage: valid ? value : null,
      candidates: Object.freeze(selected ? [...selected.result.fabrics] : []),
      status: !valid ? 'invalid' : selected ? 'requested' : 'unbound', catalogVerified: false }))
  }
  return Object.freeze(rows)
}
