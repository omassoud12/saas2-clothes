import { activeNecklines, activeProductTypes, activeColors, activeMaterials, matchVocabularyTokens, tokenizeText } from './index.js'
import { freezeNeckline } from './neckline-source.js'
import type { ParsedNecklineMatch } from './neckline-source.types.js'

export const necklineCues = new Set(['neck', 'neckline', 'collar', 'col', 'encolure', 'قبة', 'ياقة', 'رقبة', '2abbe', '2abbet', '2obbe', 'obbe'])
const modelCues = new Set(['brand', 'model', 'sku', 'barcode', 'ماركة', 'موديل', 'كود'])
export function scanSourceNecklines(text: string, catalogLabel = false, existing?: {
  readonly products: ReturnType<typeof activeProductTypes.matchTokens>
  readonly legacy: ReturnType<typeof matchVocabularyTokens>
}): readonly ParsedNecklineMatch[] {
  const raw = [...activeNecklines.matchTokens(text)]
  // Most catalog labels have no neck evidence. Avoid scanning unrelated domains again.
  if (!raw.length) return Object.freeze([])
  const tokens = tokenizeText(text), products = existing?.products ?? activeProductTypes.matchTokens(text), colors = activeColors.matchTokens(text)
  const materials = activeMaterials.matchTokens(text)
  const legacy = existing?.legacy ?? matchVocabularyTokens(text)
  // One known conjunction clitic, only next to already recognized neck evidence.
  tokens.forEach((token, index) => {
    if (!token.startsWith('و') || raw.some(m => m.startToken <= index && m.endToken > index)
      || !raw.some(m => m.endToken >= index - 1 && m.endToken <= index)) return
    const hit = activeNecklines.lookup(token.slice(1))
    if (hit.status !== 'unknown') raw.push({ startToken: index, endToken: index + 1, phrase: token, result: hit })
  })
  raw.sort((a, b) => a.startToken - b.startToken)
  const qualified = new Set(raw.filter(m => necklineCues.has(tokens[m.startToken - 1])
    || tokens.slice(m.startToken, m.endToken).some(t => necklineCues.has(t))))
  // Connected descriptor phrases inherit a neck role, never a distant sentence word.
  for (let changed = true; changed;) {
    changed = false
    for (const m of raw) if (!qualified.has(m) && [...qualified].some(q => q.endToken === m.startToken || q.startToken === m.endToken)) {
      qualified.add(m); changed = true
    }
  }
  return freezeNeckline(raw.map(match => {
    const domainExplicit = necklineCues.has(tokens[match.startToken - 1])
      || tokens.slice(match.startToken, match.endToken).some(t => necklineCues.has(t))
    const hasStyle = match.result.shapes.length + match.result.collars.length > 0
    const compound = products.some(p => p.startToken <= match.startToken && p.endToken >= match.endToken
      && p.endToken - p.startToken >= match.endToken - match.startToken)
    const differentRole = match.result.crossDomains.some(d => !['necklines'].includes(d)) || match.result.externalRoles.length > 0
    const owned = colors.some(c => c.startToken <= match.startToken && c.endToken >= match.endToken
      && c.endToken - c.startToken > match.endToken - match.startToken)
      || materials.some(m => m.startToken <= match.startToken && m.endToken >= match.endToken
        && m.endToken - m.startToken > match.endToken - match.startToken)
      || legacy.some(m => m.startToken <= match.startToken && m.endToken >= match.endToken
        && m.endToken - m.startToken > match.endToken - match.startToken
        && m.result.hits.some(h => h.domain !== 'necklines' && h.domain !== 'productTypes'))
    const adjoiningNeck = raw.some(other => other !== match && other.result.shapes.length + other.result.collars.length > 0
      && (other.endToken === match.startToken || other.startToken === match.endToken))
    const qualifiedModifier = !hasStyle && (domainExplicit || (adjoiningNeck || qualified.has(match)) && !differentRole)
    const qualifiedStyle = hasStyle && (domainExplicit || !differentRole && match.endToken - match.startToken > 1
      || !differentRole && products.some(p => p.endToken === match.startToken || p.startToken === match.endToken)
      || qualified.has(match) && match.result.shapes.length + match.result.collars.length + match.result.modifiers.length > 1
      || !differentRole && raw.length === 1 && match.startToken === 0 && match.endToken === tokens.length)
    return { startToken: match.startToken, endToken: match.endToken, text: match.phrase, result: match.result,
      domainExplicit, constrainsCatalog: !modelCues.has(tokens[match.startToken - 1]) && !owned
        && (!compound || catalogLabel || necklineCues.has(tokens[match.startToken - 1])) && (qualifiedStyle || qualifiedModifier) }
  }))
}
