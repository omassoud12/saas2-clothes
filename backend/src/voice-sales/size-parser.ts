import { activeColors, activeProductTypes, activeSizes, activeQuantities, normalizeText, tokenizeText, quantities } from './index.js'
import { inferSizeContext, resolveSizeLookup, isSizeCue } from './size-context.js'
import type { ParsedSourceSizeMatch } from './size-source.types.js'

/** Local composite scan over ORIGINAL text; offsets still refer to shared normalized tokens. */
export function scanSourceSizes(text: string): readonly ParsedSourceSizeMatch[] {
  const words = [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)]
  const tokens = tokenizeText(text)
  const context = inferSizeContext(text)
  const productSpans = activeProductTypes.matchTokens(text)
  const colorSpans = activeColors.matchTokens(text)
  const results: ParsedSourceSizeMatch[] = []
  for (let i = 0; i < words.length;) {
    const word = words[i], start = word.index!
    const startToken = tokenizeText(text.slice(0, start)).length
    const explicitBefore = isSizeCue(tokens[startToken - 1] ?? '')
    const dimensionCue = activeSizes.modifiers(word[0]).some(row => ['WAIST_PREFIX', 'LENGTH_PREFIX', 'BAND_PREFIX', 'CUP_PREFIX'].includes(row.modifier_id))
    // A generic size cue must not greedily steal the first half of S/M,
    // 2-3Y or 44 CM. Prefer the complete suffix when it exists; retain a
    // whole prefix phrase only when its suffix has no independent alias.
    if (isSizeCue(word[0]) && words[i + 1]) {
      const suffixStart = words[i + 1].index!
      let suffixKnown = false
      for (let endWord = Math.min(words.length, i + 1 + activeSizes.maxTokens); endWord > i + 1; endWord--) {
        const end = words[endWord - 1].index! + words[endWord - 1][0].length
        if (activeSizes.lookup(text.slice(suffixStart, end)).status !== 'unknown') { suffixKnown = true; break }
      }
      if (suffixKnown) { i++; continue }
    }
    // Preserve ordinary product/color spans. Explicit size qualifiers may own
    // an embedded garment noun only with independent surrounding family evidence.
    const braCupCue = context.families.has('BRA_CUP') && ['cup', 'كاب'].includes(normalizeText(word[0]))
    if (productSpans.some(s => s.startToken === startToken) && !braCupCue && !explicitBefore
      || colorSpans.some(s => s.startToken === startToken) && !explicitBefore
      || !explicitBefore && ['baby', 'kids', 'children', 'بيبي', 'ولادي', 'لبس'].includes(normalizeText(word[0]))) { i++; continue }
    let found: { match: ParsedSourceSizeMatch; endWord: number } | undefined
    for (let endWord = Math.min(words.length, i + activeSizes.maxTokens); endWord > i; endWord--) {
      const end = words[endWord - 1].index! + words[endWord - 1][0].length
      const phrase = text.slice(start, end)
      let hit = activeSizes.lookup(phrase)
      if (/^\d+$/u.test(normalizeText(phrase)) && isSizeCue(tokens[startToken - 1] ?? '') && context.families.has('HOSIERY_NUMERIC')) {
        hit = activeSizes.lookup(`T${normalizeText(phrase)}`)
      }
      if (hit.status === 'unknown') continue
      const endToken = tokenizeText(text.slice(0, end)).length
      const ownsProduct = productSpans.some(s => s.startToken >= startToken && s.startToken < endToken)
      if (ownsProduct && !explicitBefore && !dimensionCue && !braCupCue
        || colorSpans.some(s => s.startToken > startToken && s.startToken < endToken
          && !productSpans.some(p => p.startToken === s.startToken && p.endToken === s.endToken
            && s.result.crossDomainOverlaps.includes('productTypes')))) continue
      const next = tokens[endToken] ?? ''
      // Numbers followed by sale units always belong to quantity grammar.
      if (/^\d+$/u.test(normalizeText(phrase)) && !isSizeCue(tokens[startToken - 1] ?? '') && activeQuantities.lookup('unit_aliases', next)
        .some(row => row.unit_id === 'PIECE')) continue
      if (quantities.lookup(normalizeText(phrase)).status === 'matched') continue
      const explicit = isSizeCue(tokens[startToken - 1] ?? '') || normalizeText(phrase).split(' ').some(isSizeCue)
      if (!explicit && activeSizes.modifiers(phrase).length) continue
      // Embedded garment qualifiers can own their phrase only when an independent
      // surrounding product supports the family. "Dress size bra 75B" cannot
      // erase the contradictory bra noun to manufacture a dress match.
      const supportedContext = ownsProduct ? inferSizeContext(`${text.slice(0, start)} ${text.slice(end)}`) : context
      if (ownsProduct && !supportedContext.garment) continue
      const resolved = resolveSizeLookup(hit, { ...supportedContext, standards: inferSizeContext(phrase).standards,
        sizeMarker: supportedContext.sizeMarker || explicit })
      if (!resolved.candidates.length) continue
      const bareNumber = /^\d+(?:[.٫]\d+)?$/u.test(phrase.normalize('NFKC')) || /^\d+$/u.test(normalizeText(phrase))
      // Preserve the legacy bare-number safeguards for generic apparel. Explicit
      // markers and specialized product families can retain contextual alternatives.
      if (bareNumber && !explicit && !context.families.has('SHOES_EU') && !context.families.has('HOSIERY_NUMERIC')
        && !context.families.has('GLOVES_NUMERIC') && !context.families.has('BRA_BAND')) continue
      if (!context.garment && !explicit && !hit.legacySize && hit.candidates.every(c => /^\d+$/u.test(c.canonical_label))) continue
      found = { endWord, match: Object.freeze({ startToken, endToken, phrase,
        originalSpan: Object.freeze({ start, end, text: phrase }), result: hit, ...resolved, sizeDomainExplicit: explicit }) }
      break
    }
    if (found) { results.push(found.match); i = found.endWord }
    else i++
  }
  return Object.freeze(results)
}
