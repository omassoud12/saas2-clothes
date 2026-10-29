// Synthetic contract fixtures, never imported by production code.
export function matchFixture(status = 'MATCHED') {
  const attributes = Object.fromEntries(['productType', 'color', 'size', 'quantity', 'material', 'neckline', 'fit', 'pattern'].map(field => [field,
    { status: 'missing', value: null, candidates: [], source: null, evidence: [] }]))
  for (const [field, value] of Object.entries({ productType: 'T_SHIRT', color: 'BLACK', size: 'XL', quantity: 2 })) {
    attributes[field] = { status: 'resolved', value, candidates: [value], source: 'explicit',
      evidence: [{ span: { text: String(value), startToken: 0, endToken: 1 }, source: 'explicit', rule: 'dictionary_alias' }] }
  }
  const candidate = { productId: '11111111-1111-4111-8111-111111111111', variantId: '22222222-2222-4222-8222-222222222222',
    productName: 'Tshirt Cedar', categoryName: 'Clothing', color: 'Black', size: 'XL', quantity: 2,
    sellingPrice: '12.50', availableStock: 10, currency: 'USD', missingFields: [], unresolvedConstraints: [], requiresConfirmation: true,
    evidence: [{ field: 'color', source: 'variant_column', requested: 'BLACK', actual: 'Black' }] }
  const parser = { status: 'parsed', originalText: 'Tshirt Cedar black XL two pieces', normalizedText: 'tshirt cedar black xl two pieces',
    attributes, productNameResidualTokens: [{ token: 'cedar', index: 1 }], unrecognizedTokens: [{ token: 'cedar', index: 1 }],
    conversationalTokens: [], ambiguities: [], missingInformation: ['material', 'neckline', 'fit', 'pattern'], unresolvedInformation: [] }
  const result = { status, reason: 'UNIQUE_SUPPORTED_CATALOG_MATCH', parser, match: null, candidates: [], suggestions: [],
    missingFields: [], requiresConfirmation: true, catalog: { scannedVariants: 1, truncated: false, candidateCount: 1, candidatesTruncated: false } }
  if (status === 'MATCHED') { result.match = candidate; result.candidates = [candidate] }
  if (status === 'INSUFFICIENT_STOCK') { candidate.availableStock = 0; result.match = candidate; result.candidates = [candidate]; result.reason = 'REQUESTED_QUANTITY_EXCEEDS_STOCK' }
  if (status === 'AMBIGUOUS') { result.candidates = [candidate, { ...candidate, variantId: '33333333-3333-4333-8333-333333333333', productName: 'Tshirt Cedar Premium' }]; result.catalog.candidateCount = 2; result.reason = 'MULTIPLE_PLAUSIBLE_VARIANTS'; result.missingFields = ['variant'] }
  if (status === 'INCOMPLETE') { candidate.quantity = null; candidate.missingFields = ['quantity']; result.candidates = [candidate]; result.missingFields = ['quantity']; result.reason = 'MISSING_OR_UNVERIFIED_CONSTRAINTS'; attributes.quantity = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }; parser.status = 'incomplete'; parser.missingInformation.push('quantity') }
  if (status === 'NOT_FOUND') { result.catalog.candidateCount = 0; result.reason = 'NO_ELIGIBLE_EXACT_MATCH'; result.suggestions = [{ ...candidate, missingFields: ['product_name'], evidence: [{ field: 'product_name', source: 'partial_name_suggestion', requested: 'ced', actual: candidate.productName }] }] }
  if (status === 'INVALID_INPUT') { result.reason = 'UNSUPPORTED_MULTIPLE_ITEMS'; result.catalog.scannedVariants = 0; result.catalog.candidateCount = 0; parser.status = 'unsupported_multiple_items'; parser.ambiguities = [{ kind: 'multiple_items', message: 'Multiple product descriptions are unsupported.', span: { text: 'tshirt and pants', startToken: 0, endToken: 3 }, fields: ['productType'], alternatives: [] }] }
  return result
}

export const activeProfile = role => ({ user: { id: 'user-a', role, isActive: true }, account: { id: 'account-a', status: 'ACTIVE' } })
export const sessionClient = () => ({ auth: { async getSession() { return { data: { session: { access_token: 'synthetic-test-token', user: { id: 'synthetic-user' } } }, error: null } } } })
export const jsonResponse = (status, data, retryAfter = null) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => retryAfter }, async json() { return data } })
