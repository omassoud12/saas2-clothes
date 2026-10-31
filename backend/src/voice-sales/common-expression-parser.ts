import { activeCommonExpressions, tokenizeText } from './index.js'
import { freezeExpressions } from './common-expression-source.js'
import type { CommonExpressionId } from './common-expression-ids.js'
import type { CommonExpressionCue, CommonExpressionSafety } from './common-expression.types.js'
import type { RequestIntentMatch } from './request-intent.js'

export interface AttributeSpan { readonly startToken: number; readonly endToken: number }
const negative = new Set(['not', 'no', 'ما', 'مش', 'مو', 'لا', 'ma', 'mish', 'mesh', 'pas', 'non', 'ne'])
const nameMarkers = new Set(['brand', 'model', 'sku', 'barcode', 'ماركة', 'موديل', 'كود'])
export const affirmativeRequestIds: ReadonlySet<CommonExpressionId> = new Set(['REQ_WANT', 'REQ_NEED', 'REQ_SEARCH'])
const overlap = (a: AttributeSpan, b: AttributeSpan) => a.startToken < b.endToken && a.endToken > b.startToken
const contains = (a: AttributeSpan, b: AttributeSpan) => a.startToken <= b.startToken && a.endToken >= b.endToken

/** Exact lexical signals, annotated independently from attribute extraction and catalog selection. */
export function scanCommonExpressions(text: string, attributes: readonly AttributeSpan[] = []): readonly CommonExpressionCue[] {
  const tokens = tokenizeText(text)
  const matches = activeCommonExpressions.matchTokens(text)
  const requestPrefix = new Set<number>()
  for (const match of matches) if (match.result.candidates.every(id => affirmativeRequestIds.has(id))) {
    for (let index = match.startToken; index < match.endToken; index++) requestPrefix.add(index)
  }
  const prefixBlockers = [0]
  tokens.forEach((token, index) => prefixBlockers.push(prefixBlockers[index] + (requestPrefix.has(index)
    || ['please', 'sell', 'بيع', 'بيعلي', 'لو', 'سمحت'].includes(token) ? 0 : 1)))
  let closedRejection = 0
  return freezeExpressions(matches.map(match => {
    const span = { startToken: match.startToken, endToken: match.endToken, text: match.phrase }
    const candidates = match.result.candidates
    const categories = [...new Set(candidates.map(id => activeCommonExpressions.concept(id).category))]
    const before = tokens.slice(Math.max(closedRejection, match.startToken - 4), match.startToken)
    const explicitName = before.some(token => nameMarkers.has(token))
    const attribute = attributes.some(row => contains(row, match))
    const grammar = candidates.every(id => id === 'AMB_SIZE' || id === 'AMB_WITH')
      && attributes.some(row => row.startToken === match.endToken)
    const role = explicitName ? 'literal_name' : attribute ? 'attribute_overlap' : grammar ? 'grammar' : 'intent'
    const inherentNegative = candidates.every(id => id === 'CHANGE_KEEP_ORDER' || id.startsWith('REJ_')
      || ['PREF_DISLIKE', 'PREF_NO_PRINT', 'CANCEL_DELIVERY', 'CANCEL_RESERVATION', 'CANCEL_STOP'].includes(id))
    const negated = !inherentNegative && (before.some(token => negative.has(token))
      || before.join(' ').endsWith('don t') || before.join(' ').endsWith('do not'))
    const bareRequestInName = match.startToken > closedRejection && candidates.every(id => affirmativeRequestIds.has(id))
      && prefixBlockers[match.startToken] > prefixBlockers[closedRejection]
    const uncertain = match.result.status === 'context_required' || bareRequestInName
      || role === 'literal_name' || role === 'attribute_overlap'
    if (candidates.every(id => ['REJ_NOT_SIZE', 'REJ_NOT_COLOR'].includes(id))) closedRejection = match.endToken
    return { span, candidates, categories,
      status: match.result.status === 'suggestion' ? 'suggestion' : uncertain ? 'context_required' : 'recognized',
      role, polarity: negated ? 'negated' : candidates.length > 1 ? 'uncertain' : 'affirmative',
      recognitionOnly: true, authorizesAction: false, provenance: 'seed_unvalidated' } satisfies CommonExpressionCue
  }))
}

/** Safe lexical filler removal only. Protected slots/numbers/unknown names stay in place. */
export function requestConversationTokens(cues: readonly CommonExpressionCue[], protectedSpans: readonly AttributeSpan[],
  requestIntents: readonly RequestIntentMatch[] = []): readonly number[] {
  const indexes: number[] = []
  for (const cue of cues) if (cue.role === 'intent' && cue.status === 'recognized' && cue.polarity === 'affirmative'
    && cue.candidates.every(id => affirmativeRequestIds.has(id))) {
    for (let index = cue.span.startToken; index < cue.span.endToken; index++) {
      if (!protectedSpans.some(row => overlap(row, { startToken: index, endToken: index + 1 }))) indexes.push(index)
    }
  }
  for (const request of requestIntents) if (request.certainty === 'exact') {
    for (let index = request.sourceSpan.startToken; index < request.sourceSpan.endToken; index++) {
      // The dedicated request-intent layer runs before quantity parsing and owns
      // an exact clause-initial request span. Some words (notably "add"/"زيدلي")
      // are also advisory quantity modifiers; that overlap must not leak a
      // confirmed request verb into product-name or unknown residual evidence.
      indexes.push(index)
    }
  }
  return Object.freeze([...new Set(indexes)])
}

export function expressionSafety(cues: readonly CommonExpressionCue[], requestIntents: readonly RequestIntentMatch[] = []): CommonExpressionSafety {
  const intents = cues.filter(cue => cue.role === 'intent')
  const reason = requestIntents.some(intent => intent.polarity === 'negated') || intents.some(cue => cue.polarity === 'negated') ? 'NEGATED_INTENT'
    : requestIntents.some(intent => intent.certainty === 'context_required') ? 'INTENT_REQUIRES_CONTEXT'
    : intents.some(cue => cue.status !== 'recognized' || cue.polarity === 'uncertain') ? 'INTENT_REQUIRES_CONTEXT'
      : intents.some(cue => !cue.candidates.every(id => affirmativeRequestIds.has(id))) ? 'NON_SALE_INTENT'
        : 'AFFIRMATIVE_OR_ATTRIBUTE_TEXT'
  return Object.freeze({ salePreviewAllowed: reason === 'AFFIRMATIVE_OR_ATTRIBUTE_TEXT', reason,
    recognitionOnly: true, authorizesAction: false })
}
