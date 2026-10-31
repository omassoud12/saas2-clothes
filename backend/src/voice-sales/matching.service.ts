import type { PrismaClient } from '../generated/prisma/client.js'
import { requireVoiceSaleTenant } from './authenticated-tenant.js'
import { createCatalogReader } from './catalog-reader.js'
import { discoverParsedCatalog, matchParsedCatalog } from './catalog-matcher.js'
import { segmentVoiceSaleText } from './multi-item-segmenter.js'
import { parseVoiceSaleText } from './parser.js'
import type { CatalogImageResolver, CatalogReader, CatalogSnapshot, MissingMatchField, VoiceDiscoveryCandidate, VoiceMatchCandidate, VoiceMatchingDependencies, VoiceSaleMatchResult } from './match.types.js'
import type { VoiceSaleParseResult } from './parser.types.js'

function isExplicitCatalogIdentifierLookup(parser: VoiceSaleParseResult): boolean {
  const text = parser.normalizedText
  return /^(?:sku|barcode|باركود|كود) [\p{L}\p{N}](?:[\p{L}\p{N} ]{0,62}[\p{L}\p{N}])?$/u.test(text)
    || /^\d{8,18}$/u.test(text)
}

function parserGate(parser: VoiceSaleParseResult): VoiceSaleMatchResult | null {
  // Exact catalog identifiers are not quantities. Permit only the complete,
  // bounded forms above to reach the tenant catalog; ordinary bare numbers
  // and mixed unsafe phrases retain the parser's existing fail-closed gate.
  if (isExplicitCatalogIdentifierLookup(parser)) return null
  const nonSaleIntent = parser.commonExpressionSafety?.salePreviewAllowed === false
  const safeRequestDiscovery = nonSaleIntent
    && parser.commonExpressionSafety?.reason === 'INTENT_REQUIRES_CONTEXT'
    && parser.requestIntents?.some(intent => intent.polarity === 'affirmative' && intent.certainty === 'exact') === true
  const blockingNonSaleIntent = nonSaleIntent && !safeRequestDiscovery
  const invalid = parser.status === 'invalid_input' || parser.status === 'unsupported_multiple_items'
  const conflict = parser.ambiguities.some(issue => issue.kind === 'conflicting_attribute')
  const unsafe = parser.ambiguities.some(issue => issue.kind !== 'lexical_ambiguity')
  const materialOnlyName = parser.attributes.productType.status === 'missing' && !parser.productTypeCandidates?.length
    && !!parser.materialCandidates?.length && parser.productNameResidualTokens.every(token =>
      parser.materialCandidates!.some(material => material.startToken <= token.index && material.endToken > token.index))
  const necklineOnlyName = parser.attributes.productType.status === 'missing' && !parser.productTypeCandidates?.length
    && !!parser.necklineCandidates?.length && parser.productNameResidualTokens.every(token =>
      parser.necklineCandidates!.some(neck => neck.startToken <= token.index && neck.endToken > token.index))
  const fitOnlyName=parser.attributes.productType.status==='missing'&&!parser.productTypeCandidates?.length
    &&!!parser.fitCutCandidates?.length&&parser.productNameResidualTokens.every(token=>
      parser.fitCutCandidates!.some(cut=>cut.startToken<=token.index&&cut.endToken>token.index))
  const noIdentity = parser.attributes.productType.status === 'missing' && !parser.productNameResidualTokens.length
    && !parser.productTypeCandidates?.length
    && !parser.ambiguities.some(issue => issue.alternatives.some(alternative => alternative.field === 'productType'))
  const patternOnlyName=parser.attributes.productType.status==='missing'&&!parser.productTypeCandidates?.length
    &&!!parser.patternCandidates?.length&&parser.productNameResidualTokens.every(t=>parser.patternCandidates!.some(p=>p.startToken<=t.index&&p.endToken>t.index))
  if (!(invalid || conflict || unsafe || noIdentity || materialOnlyName || necklineOnlyName || fitOnlyName || patternOnlyName
    || blockingNonSaleIntent)) return null
  const missingFields: readonly MissingMatchField[] = noIdentity || materialOnlyName || necklineOnlyName || fitOnlyName || patternOnlyName
    ? ['product_name', ...parser.unresolvedInformation] : [...parser.unresolvedInformation]
  return Object.freeze({
    status: invalid ? 'INVALID_INPUT' : conflict ? 'AMBIGUOUS' : 'INCOMPLETE',
    reason: invalid ? parser.status === 'unsupported_multiple_items' ? 'UNSUPPORTED_MULTIPLE_ITEMS' : 'INVALID_TEXT'
      : blockingNonSaleIntent ? 'COMMON_EXPRESSION_REQUIRES_CLARIFICATION'
        : conflict ? 'PARSER_ATTRIBUTE_CONFLICT' : noIdentity || materialOnlyName || necklineOnlyName || fitOnlyName || patternOnlyName ? 'PRODUCT_IDENTITY_REQUIRED' : 'PARSER_REQUIRES_CLARIFICATION',
    parser, match: null, candidates: Object.freeze([]), suggestions: Object.freeze([]), requiresConfirmation: true,
    missingFields: Object.freeze(missingFields),
    catalog: Object.freeze({ scannedVariants: 0, truncated: false, candidateCount: 0, candidatesTruncated: false }),
  })
}

async function matchCatalog(parser: VoiceSaleParseResult, catalog: CatalogSnapshot, context: Parameters<CatalogReader['read']>[0],
  resolveImage?: CatalogImageResolver): Promise<VoiceSaleMatchResult> {
  const strict = matchParsedCatalog(parser, catalog)
  const discovery = discoverParsedCatalog(parser, catalog, strict)
  const catalogSummary = Object.freeze({ ...strict.catalog,
    scannedVariants: catalog.scannedVariants, truncated: catalog.truncated })
  if (!resolveImage || !catalog.productImageKeys?.size) return Object.freeze({ ...strict, catalog: catalogSummary, discovery })
  const productIds = new Set([...discovery.exactVerified, ...discovery.strongCandidates, ...discovery.alternatives]
    .map(candidate => candidate.productId))
  const images = new Map<string, string | null>()
  await Promise.all([...productIds].map(async productId => {
    const key = catalog.productImageKeys!.get(productId)
    if (!key) return
    try { images.set(productId, await resolveImage(context, productId, key)) }
    catch { images.set(productId, null) }
  }))
  const decorate = <T extends VoiceMatchCandidate | VoiceDiscoveryCandidate>(candidate: T): T => Object.freeze({
    ...candidate, imageUrl: images.get(candidate.productId) ?? null,
  }) as unknown as T
  const exactVerified = Object.freeze(discovery.exactVerified.map(decorate))
  const strongCandidates = Object.freeze(discovery.strongCandidates.map(decorate))
  const alternatives = Object.freeze(discovery.alternatives.map(decorate))
  const candidateMap = new Map([...exactVerified, ...strongCandidates, ...alternatives]
    .map(candidate => [candidate.variantId, candidate] as const))
  const strictCandidate = (candidate: VoiceMatchCandidate) => candidateMap.get(candidate.variantId) ?? decorate(candidate)
  return Object.freeze({ ...strict, catalog: catalogSummary,
    match: strict.match ? strictCandidate(strict.match) : null,
    candidates: Object.freeze(strict.candidates.map(strictCandidate)),
    suggestions: Object.freeze(strict.suggestions.map(strictCandidate)),
    discovery: Object.freeze({ ...discovery, exactVerified, strongCandidates, alternatives }),
  })
}

export function createVoiceMatchingService(reader: CatalogReader, resolveImage?: CatalogImageResolver): VoiceMatchingDependencies {
  return {
    async matchVoiceSaleText(text, context) {
      requireVoiceSaleTenant(context)
      const segmentation = segmentVoiceSaleText(text)
      if (segmentation.status === 'segmented') {
        const parsed = segmentation.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
        const gated = parsed.map(parserGate)
        const needsCatalog = gated.some(result => result === null)
        const catalog = needsCatalog ? await reader.read(context) : null
        const items = await Promise.all(segmentation.segments.map(async (segment, index) => Object.freeze({ index,
          segment: Object.freeze({ text: segment.text,
            removedConversationalExpressions: segment.removedConversationalExpressions }),
          result: gated[index] ?? await matchCatalog(parsed[index], catalog!, context, resolveImage),
        })))
        const missingFields = [...new Set(items.flatMap(item => item.result.missingFields))]
        const parser = parseVoiceSaleText(text)
        return Object.freeze({ status: 'INCOMPLETE' as const, reason: 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION',
          parser, match: null, candidates: Object.freeze([]), suggestions: Object.freeze([]),
          missingFields: Object.freeze(missingFields), requiresConfirmation: true as const,
          catalog: Object.freeze({ scannedVariants: catalog?.scannedVariants ?? 0, truncated: catalog?.truncated ?? false,
            candidateCount: items.reduce((count, item) => count + item.result.catalog.candidateCount, 0),
            candidatesTruncated: items.some(item => item.result.catalog.candidatesTruncated) }),
          segmentation: Object.freeze({ status: 'segmented' as const, normalizedText: segmentation.normalizedText,
            reason: segmentation.reasons.includes('CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE')
              ? 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE' as const : 'REPEATED_EXPLICIT_REQUEST_MARKERS' as const,
            removedConversationalExpressions: segmentation.removedConversationalExpressions }),
          items: Object.freeze(items),
        })
      }
      const parser = parseVoiceSaleText(text)
      const gated = parserGate(parser)
      if (gated) return gated
      const catalog = await reader.read(context)
      return matchCatalog(parser, catalog, context, resolveImage)
    },
  }
}

export function createVoiceMatchingDependencies(prisma: PrismaClient, resolveImage?: CatalogImageResolver): VoiceMatchingDependencies {
  return createVoiceMatchingService(createCatalogReader(prisma), resolveImage)
}
