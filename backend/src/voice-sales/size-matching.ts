import { activeSizes, normalizeSizeText, normalizeText } from './index.js'
import { inferSizeContext, resolveSizeLookup } from './size-context.js'
import type { SizeContext, ParsedSourceSizeMatch } from './size-source.types.js'

/** Exact source semantics + independent merchant column/category evidence; no conversions. */
export function compareSourceSize(request: ParsedSourceSizeMatch, actual: string | null, context: SizeContext): 'yes' | 'no' | 'unknown' {
  if (actual === null || request.result.status === 'suggestion') return 'unknown'
  const hit = activeSizes.lookup(actual)
  if (hit.status === 'unknown' || hit.status === 'suggestion') return 'unknown'
  const actualContext = { ...context, sizeMarker: true, standards: inferSizeContext(actual).standards }
  const resolved = resolveSizeLookup(hit, actualContext)
  if (!resolved.candidates.length) return 'no'
  const supported = resolved.candidates.filter(id => request.candidates.includes(id))
  if (request.incompatibleStandard || resolved.incompatibleStandard) return 'unknown'
  const numeric = normalizeText(request.phrase).split(' ').filter(word => !['size', 'قياس', 'مقاس', 'سايز', 'taille', '2iyas'].includes(word)).join(' ')
  if (supported.length && request.sizeDomainExplicit && /^\d+$/u.test(numeric) && normalizeSizeText(actual) === numeric
    && request.candidates.some(id => ['APPAREL_NUMERIC', 'SHOES_EU', 'SHOES_REGIONAL'].includes(activeSizes.concept(id).family))) return 'yes'
  if (resolved.resolvedId !== null && supported.includes(resolved.resolvedId)
    && !['BRA_CUP', 'BRA_BAND', 'WAIST_INCH', 'INSEAM_INCH'].includes(activeSizes.concept(resolved.resolvedId).family)) return 'yes'
  const partial = request.candidates.some(id => ['BRA_CUP', 'BRA_BAND', 'WAIST_INCH', 'INSEAM_INCH'].includes(activeSizes.concept(id).family))
  if (partial) return 'unknown' // Partial dimensions never prove a complete bra/W-L size.
  if (!supported.length) return 'no'
  // Preserve legacy numeric LABEL equality without selecting EU/US/UK. An explicit
  // regional request cannot use this escape: its raw label contains that standard.
  return 'unknown'
}
