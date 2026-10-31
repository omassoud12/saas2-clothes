import { normalizeText, tokenizeText } from './normalization.js'
import type { ParseSpan } from './parser.types.js'

export const requestIntentIds = ['REQ_WANT', 'REQ_GIVE', 'REQ_GET', 'REQ_ADD_INTENT'] as const
export type RequestIntentId = typeof requestIntentIds[number]
export type RequestIntentLanguage = 'arabic_lebanese' | 'arabic_msa' | 'english' | 'french' | 'arabizi'
export type RequestIntentPolarity = 'affirmative' | 'negated'

export interface RequestIntentMatch {
  readonly canonicalIntent: RequestIntentId
  readonly matchedExpression: string
  readonly sourceSpan: ParseSpan
  readonly languageEvidence: RequestIntentLanguage
  readonly polarity: RequestIntentPolarity
  readonly certainty: 'exact' | 'context_required'
  readonly contextualUncertainty: 'REQUIRES_PRODUCT_CONTEXT' | null
  readonly recognitionOnly: true
  readonly authorizesAction: false
  readonly itemIndex?: number
}

interface RequestAlias {
  readonly intent: RequestIntentId
  readonly alias: string
  readonly language: RequestIntentLanguage
  readonly contextRequired?: boolean
}

const aliases: readonly RequestAlias[] = Object.freeze([
  ...['بدي', 'بدّي'].map(alias => ({ intent: 'REQ_WANT', alias, language: 'arabic_lebanese' } as const)),
  ...['أريد', 'اريد'].map(alias => ({ intent: 'REQ_WANT', alias, language: 'arabic_msa' } as const)),
  { intent: 'REQ_WANT', alias: 'بديلي', language: 'arabic_lebanese', contextRequired: true },
  ...['bdi', 'baddi', 'bade', 'badi', 'beddi'].map(alias => ({ intent: 'REQ_WANT', alias, language: 'arabizi' } as const)),
  ...['I want', 'I need'].map(alias => ({ intent: 'REQ_WANT', alias, language: 'english' } as const)),
  { intent: 'REQ_WANT', alias: 'je veux', language: 'french' },

  ...['عطيني', 'اعطيني'].map(alias => ({ intent: 'REQ_GIVE', alias, language: 'arabic_lebanese' } as const)),
  { intent: 'REQ_GIVE', alias: 'أعطني', language: 'arabic_msa' },
  ...['3tini', 'atini'].map(alias => ({ intent: 'REQ_GIVE', alias, language: 'arabizi' } as const)),
  { intent: 'REQ_GIVE', alias: 'give me', language: 'english' },

  ...['جيبلي', 'جيب لي', 'هاتلي'].map(alias => ({ intent: 'REQ_GET', alias, language: 'arabic_lebanese' } as const)),
  ...['jiblie', 'jib li', 'hatli'].map(alias => ({ intent: 'REQ_GET', alias, language: 'arabizi' } as const)),
  { intent: 'REQ_GET', alias: 'get me', language: 'english' },

  ...['زيدلي', 'زيد لي'].map(alias => ({ intent: 'REQ_ADD_INTENT', alias, language: 'arabic_lebanese' } as const)),
  { intent: 'REQ_ADD_INTENT', alias: 'zidli', language: 'arabizi' },
  ...['add', 'add me'].map(alias => ({ intent: 'REQ_ADD_INTENT', alias, language: 'english', contextRequired: true } as const)),
])

export interface RequestIntentAliasMatch extends RequestAlias { readonly normalized: string; readonly tokens: readonly string[] }
const compiled: readonly RequestIntentAliasMatch[] = Object.freeze(aliases.map(row => Object.freeze({ ...row,
  normalized: normalizeText(row.alias), tokens: tokenizeText(row.alias),
})).sort((a, b) => b.tokens.length - a.tokens.length || b.normalized.length - a.normalized.length))

const owners = new Map<string, RequestIntentId>()
for (const row of compiled) {
  const owner = owners.get(row.normalized)
  if (owner && owner !== row.intent) throw new Error(`Conflicting request-intent alias: ${row.normalized}`)
  owners.set(row.normalized, row.intent)
}

const clauseConnectors = new Set(['and', 'w', 'و'])
const simpleNegations = new Set(['ما', 'مش', 'مو', 'لا', 'ma', 'mish', 'mesh', 'not', 'no'])

export const requestIntentAliasCount = owners.size
export const requestIntentDeclaredAliasCount = aliases.length

export function requestIntentAliasAt(tokens: readonly string[], index: number): RequestIntentAliasMatch | null {
  return compiled.find(row => row.tokens.every((token, offset) => tokens[index + offset] === token)) ?? null
}

function clauseStart(tokens: readonly string[], index: number): boolean {
  return index === 0 || index > 0 && clauseConnectors.has(tokens[index - 1]!)
}

function polarityAt(tokens: readonly string[], index: number): RequestIntentPolarity | null {
  if (clauseStart(tokens, index)) return 'affirmative'
  if (index > 0 && simpleNegations.has(tokens[index - 1]!) && clauseStart(tokens, index - 1)) return 'negated'
  if (index >= 3 && tokens[index - 3] === 'i' && tokens[index - 2] === 'don' && tokens[index - 1] === 't'
    && clauseStart(tokens, index - 3)) return 'negated'
  if (index >= 3 && tokens[index - 3] === 'i' && tokens[index - 2] === 'do' && tokens[index - 1] === 'not'
    && clauseStart(tokens, index - 3)) return 'negated'
  return null
}

/** Exact request-intent recognition. This layer is advisory and never authorizes a workflow action. */
export function scanRequestIntents(text: string, options: { readonly hasProductContext?: boolean; readonly itemIndex?: number } = {}): readonly RequestIntentMatch[] {
  const tokens = tokenizeText(text)
  const matches: RequestIntentMatch[] = []
  for (let index = 0; index < tokens.length; index++) {
    const frenchNegative = clauseStart(tokens, index) && tokens[index] === 'je' && tokens[index + 1] === 'ne'
      && tokens[index + 2] === 'veux' && (tokens[index + 3] === undefined || tokens[index + 3] === 'pas')
    if (frenchNegative) {
      const endToken = tokens[index + 3] === 'pas' ? index + 4 : index + 3
      const sourceSpan = Object.freeze({ startToken: index, endToken, text: tokens.slice(index, endToken).join(' ') })
      matches.push(Object.freeze({ canonicalIntent: 'REQ_WANT', matchedExpression: sourceSpan.text, sourceSpan,
        languageEvidence: 'french', polarity: 'negated', certainty: 'exact', contextualUncertainty: null,
        recognitionOnly: true, authorizesAction: false,
        ...(options.itemIndex === undefined ? {} : { itemIndex: options.itemIndex }),
      }))
      index = endToken - 1
      continue
    }
    const englishNegative = clauseStart(tokens, index) && tokens[index] === 'i'
      && ((tokens[index + 1] === 'don' && tokens[index + 2] === 't') || (tokens[index + 1] === 'do' && tokens[index + 2] === 'not'))
      && ['want', 'need'].includes(tokens[index + 3] ?? '')
    if (englishNegative) {
      const sourceSpan = Object.freeze({ startToken: index, endToken: index + 4, text: tokens.slice(index, index + 4).join(' ') })
      matches.push(Object.freeze({ canonicalIntent: 'REQ_WANT', matchedExpression: sourceSpan.text, sourceSpan,
        languageEvidence: 'english', polarity: 'negated', certainty: 'exact', contextualUncertainty: null,
        recognitionOnly: true, authorizesAction: false,
        ...(options.itemIndex === undefined ? {} : { itemIndex: options.itemIndex }),
      }))
      index += 3
      continue
    }
    const alias = requestIntentAliasAt(tokens, index)
    const polarity = alias ? polarityAt(tokens, index) : null
    if (!alias || !polarity) continue
    const contextual = Boolean(alias.contextRequired && !options.hasProductContext)
    const sourceSpan = Object.freeze({ startToken: index, endToken: index + alias.tokens.length,
      text: tokens.slice(index, index + alias.tokens.length).join(' ') })
    matches.push(Object.freeze({ canonicalIntent: alias.intent, matchedExpression: sourceSpan.text, sourceSpan,
      languageEvidence: alias.language, polarity, certainty: contextual ? 'context_required' : 'exact',
      contextualUncertainty: contextual ? 'REQUIRES_PRODUCT_CONTEXT' : null,
      recognitionOnly: true, authorizesAction: false,
      ...(options.itemIndex === undefined ? {} : { itemIndex: options.itemIndex }),
    }))
    index += alias.tokens.length - 1
  }
  return Object.freeze(matches)
}
