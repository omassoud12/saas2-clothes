import { normalizeText, tokenizeText } from './normalization.js'
import type {
  Dictionary, DictionaryDefinition, DictionaryDomain, KnownResult, TokenMatch,
} from './dictionary.types.js'

export class DictionaryAliasError extends Error {
  constructor(
    readonly domain: DictionaryDomain,
    readonly alias: string,
    readonly kind: 'duplicate' | 'conflict',
  ) {
    super(`${kind} alias in ${domain}: ${alias}`)
    this.name = 'DictionaryAliasError'
  }
}

type WithoutAlias<R> = R extends unknown ? Omit<R, 'alias'> : never

/** Greedy, non-overlapping lexical spans. Does not interpret sentence intent. */
export function matchLongestAliases<R>(
  text: string, maxTokens: number, lookup: (phrase: string) => R | undefined,
): readonly TokenMatch<R>[] {
  const tokens = tokenizeText(text)
  const matches: TokenMatch<R>[] = []
  for (let start = 0; start < tokens.length;) {
    let end = Math.min(tokens.length, start + maxTokens)
    for (; end > start; end--) {
      const phrase = tokens.slice(start, end).join(' ')
      const result = lookup(phrase)
      if (result !== undefined) {
        matches.push(Object.freeze({ startToken: start, endToken: end, phrase, result }))
        break
      }
    }
    start = end > start ? end : start + 1
  }
  return Object.freeze(matches)
}

export function createDictionary<D extends DictionaryDomain>(definition: DictionaryDefinition<D>): Dictionary<D> {
  const { domain } = definition
  const index = new Map<string, KnownResult<D>>()
  const values = new Set(definition.entries.map(entry => entry.value))
  if (values.size !== definition.entries.length) throw new Error(`Duplicate canonical value in ${domain}`)
  let maxAliasTokens = 0
  const counts = { trustedAliases: 0, contextualAliases: 0, suggestionAliases: 0 }

  const register = (aliases: readonly string[], result: WithoutAlias<KnownResult<D>>,
    category: keyof typeof counts): void => {
    if (aliases.length === 0) throw new Error(`Empty aliases in ${domain}`)
    for (const raw of aliases) {
      const alias = normalizeText(raw)
      if (!alias) throw new Error(`Empty normalized alias in ${domain}`)
      const resolved = Object.freeze({ ...result, alias }) as KnownResult<D>
      const existing = index.get(alias)
      if (existing) {
        const sameMeaning = existing.status === 'matched' && resolved.status === 'matched'
          && existing.value === resolved.value
        throw new DictionaryAliasError(domain, alias, sameMeaning ? 'duplicate' : 'conflict')
      }
      index.set(alias, resolved)
      maxAliasTokens = Math.max(maxAliasTokens, alias.split(' ').length)
      counts[category]++
    }
  }

  for (const entry of definition.entries) {
    register(entry.aliases, { status: 'matched', domain, value: entry.value }, 'trustedAliases')
  }
  for (const [groups, status, category] of [
    [definition.contextual ?? [], 'ambiguous', 'contextualAliases'],
    [definition.suggestions ?? [], 'suggestion', 'suggestionAliases'],
  ] as const) {
    for (const group of groups) {
      if (!group.reason.trim() || !group.candidates.length
        || new Set(group.candidates).size !== group.candidates.length
        || group.candidates.some(candidate => !values.has(candidate))) {
        throw new Error(`Invalid ${status} candidates in ${domain}`)
      }
      register(group.aliases, {
        status, domain, candidates: Object.freeze([...group.candidates]), reason: group.reason,
      }, category)
    }
  }
  return Object.freeze({
    domain, maxAliasTokens,
    coverage: Object.freeze({ canonicalValues: values.size, ...counts }),
    lookup: (text: string) => {
      const alias = normalizeText(text)
      return index.get(alias) ?? Object.freeze({ status: 'unknown' as const, domain, alias })
    },
    matchTokens: (text: string) => matchLongestAliases(text, maxAliasTokens, phrase => index.get(phrase)),
  })
}
