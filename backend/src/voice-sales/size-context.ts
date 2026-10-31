import { activeProductTypes, activeSizes, normalizeText } from './index.js'
import type { SizeContext, SourceSizeConcept, SourceSizeLookup } from './size-source.types.js'
import type { SizeFamily } from './size-source-ids.js'

export function inferSizeContext(text: string, sizeMarker = false): SizeContext {
  const families = new Set<SizeFamily>(), standards = new Set<string>()
  const tokens = new Set(normalizeText(text).split(' '))
  let garment = false
  for (const match of activeProductTypes.matchTokens(text)) for (const product of match.result.candidates) {
    garment = true
    families.add('ALPHA'); families.add('ALPHA_COMBINED'); families.add('ONE_SIZE'); families.add('ADJUSTABLE')
    const group = product.group.split(' / ')[0]
    const id = product.sourceTypeId
    if (!['Footwear', 'Accessories', 'Socks & Legwear'].includes(group)) families.add('APPAREL_NUMERIC')
    if (group === 'Footwear') { families.add('SHOES_EU'); families.add('SHOES_REGIONAL') }
    if (id === 'JEANS' || id.endsWith('_JEANS') || id.includes('PANTS') || id.includes('TROUSERS')) {
      families.add('JEANS_WL'); families.add('WAIST_INCH'); families.add('INSEAM_INCH')
    }
    if (id === 'BRA' || id.endsWith('_BRA') || id === 'BRALETTE') {
      families.add('BRA_COMPOSITE'); families.add('BRA_BAND'); families.add('BRA_CUP')
    }
    if (id === 'SOCKS' || id.endsWith('_SOCKS')) families.add('SOCK_RANGE')
    if (id === 'TIGHTS' || id === 'PANTYHOSE') families.add('HOSIERY_NUMERIC')
    if (id === 'BELT' || id.endsWith('_BELT')) families.add('BELT_CM')
    if (id.includes('GLOVE')) families.add('GLOVES_NUMERIC')
    if (['CAP', 'HAT', 'BEANIE', 'BERET', 'BUCKET_HAT', 'SUN_HAT', 'BASEBALL_CAP'].includes(id)) families.add('HEAD_CIRCUMFERENCE')
    if (product.audienceHint === 'baby' || group === 'Baby') { families.add('BABY_AGE'); families.add('KIDS_HEIGHT') }
    if (product.audienceHint === 'kids' || group === 'Kids & school') {
      families.add('KIDS_AGE'); families.add('KIDS_AGE_RANGE'); families.add('KIDS_HEIGHT')
    }
  }
  if (['baby', 'infant', 'بيبي', 'رضيع'].some(word => tokens.has(word))) { families.add('BABY_AGE'); families.add('KIDS_HEIGHT'); garment = true }
  if (['kids', 'children', 'child', 'ولادي', 'اطفال'].some(word => tokens.has(word))) {
    families.add('KIDS_AGE'); families.add('KIDS_AGE_RANGE'); families.add('KIDS_HEIGHT'); garment = true
  }
  if (['hat', 'قبعة', 'طاقية', 'طربوش'].some(word => tokens.has(word))) { families.add('HEAD_CIRCUMFERENCE'); garment = true }
  if (tokens.has('كلسات')) { families.add('SOCK_RANGE'); garment = true }
  if (['eu', 'european', 'اوروبي', 'اوروبية'].some(word => tokens.has(word))) ['EU', 'EU_SHOES', 'EU_SHOE_RANGE'].forEach(s => standards.add(s))
  if (['us', 'american', 'امريكي', 'اميركي'].some(word => tokens.has(word))) ['US', 'US_UK', 'US_MEN', 'US_WOMEN'].forEach(s => standards.add(s))
  if (['uk', 'british', 'بريطاني', 'انجليزي'].some(word => tokens.has(word))) ['UK', 'US_UK'].forEach(s => standards.add(s))
  const hasSize = sizeMarker || ['size', 'taille', 'قياس', 'مقاس', 'سايز', '2iyas'].some(word => tokens.has(word))
  return { families, standards, garment, sizeMarker: hasSize }
}
export function familySupported(concept: SourceSizeConcept, context: SizeContext): boolean {
  if (!context.families.size) return true // retain alternatives; absence of context never proves a family.
  return context.families.has(concept.family)
}
export function needsStandard(concept: SourceSizeConcept): boolean {
  return ['APPAREL_NUMERIC', 'SHOES_EU', 'SHOES_REGIONAL', 'BRA_BAND', 'BRA_COMPOSITE'].includes(concept.family)
}
export function resolveSizeLookup(hit: SourceSizeLookup, context: SizeContext) {
  const candidates = hit.candidates.filter(concept => familySupported(concept, context))
  const narrowed = candidates.filter(concept => !context.standards.size || !needsStandard(concept) || context.standards.has(concept.size_standard))
  const usable = narrowed.length ? narrowed : candidates
  const incompatibleStandard = !!context.standards.size && !!candidates.length && !narrowed.length && candidates.every(needsStandard)
  const concept = usable.length === 1 ? usable[0] : null
  const needsCm = !!concept && ['KIDS_HEIGHT', 'HEAD_CIRCUMFERENCE', 'BELT_CM'].includes(concept.family)
  const hasCm = /(?:\bcm\b|\dcm\b|سم|سنتيمتر|centimeter)/u.test(normalizeText(hit.alias))
  const normalized = normalizeText(hit.alias)
  const hasMonths = /(?:\d+m\b|\bmonths?\b|\bmois\b|شهور|اشهر|شهر)/u.test(normalized)
  const hasYears = /(?:\d+y\b|\byears?\b|\byrs?\b|\bans?\b|سنة|سنين|سنوات)/u.test(normalized)
  const ageSupported = concept?.family === 'BABY_AGE' ? hasMonths
    : concept && ['KIDS_AGE', 'KIDS_AGE_RANGE'].includes(concept.family) ? hasYears : true
  const ready = !!concept && hit.status !== 'suggestion' && (!hit.crossDomainOverlaps.length || context.sizeMarker)
    && (context.garment || context.sizeMarker)
    && (['ALPHA', 'ALPHA_COMBINED', 'ONE_SIZE', 'ADJUSTABLE'].includes(concept.family) || context.families.has(concept.family))
    && (!needsCm || hasCm)
    && ageSupported
    && !incompatibleStandard
    && (!needsStandard(concept) || context.standards.has(concept.size_standard))
  return Object.freeze({ candidates: Object.freeze(usable.map(row => row.size_id)),
    resolvedId: ready ? concept!.size_id : null, contextRequired: !ready, incompatibleStandard })
}
export function isSizeCue(text: string): boolean {
  return activeSizes.modifiers(text).some(row => row.modifier_id === 'SIZE_PREFIX')
}
