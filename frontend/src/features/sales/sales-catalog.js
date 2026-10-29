import { loadCategories } from '../categories/category-flow.js'
import { listProducts, PRODUCT_PAGE_SIZE } from '../products/product-flow.js'

const MAX_CATALOG_PAGES = 50
const fallbackPalette = Object.freeze(['#315941', '#38566f', '#8e896b', '#8b5f65', '#59635d', '#765f43'])
const namedColors = Object.freeze({
  black: '#202522', white: '#f1f0e9', cream: '#e9dfc7', beige: '#c8b892', brown: '#765f43',
  red: '#a8473f', blue: '#4d7896', navy: '#324357', green: '#397052', olive: '#69705a',
  grey: '#9a9f9b', gray: '#9a9f9b', pink: '#bd7d83', yellow: '#d6b849', orange: '#d27a3d',
})

const voiceSearchFillers = new Set(['bdi', 'baddi', 'badi', 'bade', 'beddi', 'want', 'need', 'please',
  'بدي', 'اريد', 'أريد', 'عطيني', 'اعطيني', 'أعطني', 'جيبلي', 'هاتلي'])
const arabicLatinLetters = Object.freeze({
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'th', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: '', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a',
  و: 'w', ي: 'y', ى: 'a', ئ: 'y', ؤ: 'w', ء: '',
})

function transliterateArabicToken(token) {
  return [...token].map(character => arabicLatinLetters[character] ?? character).join('')
}

function voicePhoneticKey(token) {
  return token.replace(/ch/gu, 'sh').replace(/ph/gu, 'f').replace(/th/gu, 't')
    .replace(/kh/gu, 'x').replace(/gh/gu, 'g').replace(/qu/gu, 'k')
    .replace(/[bp]/gu, 'p').replace(/[sz]/gu, 's').replace(/[cqk]/gu, 'k')
    .replace(/[aeiouyw]/gu, '').replace(/h$/u, '').replace(/(.)\1+/gu, '$1')
}

function voiceSearchTokens(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/\p{Mark}/gu, '').replace(/\u0640/gu, '').toLocaleLowerCase()
    .replace(/تي\s*شيرت|تيشيرت|تشيرت/gu, ' tshirt ')
    .replace(/t[\s-]*chirt|t[\s-]*shirt|tshirt/giu, ' tshirt ')
    .replace(/شيميز|شميز/gu, ' shirt ')
    .replace(/قميص/gu, ' shirt ')
    .replace(/\b(?:chemise|chemis|shirt|qamis|kamis|amis)\b/giu, ' shirt ')
    .replace(/بنطلون/gu, ' pants ')
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .filter(token => !voiceSearchFillers.has(token))
    .map(token => /\p{Script=Arabic}/u.test(token) ? transliterateArabicToken(token) : token)
    .filter(Boolean)
}

function stableColorIndex(value) {
  return [...value].reduce((sum, character) => (sum * 31 + character.codePointAt(0)) >>> 0, 0) % fallbackPalette.length
}

export function colorHex(value) {
  const normalized = String(value || '').normalize('NFKC').trim().toLocaleLowerCase()
  const direct = Object.entries(namedColors).find(([name]) => normalized.includes(name))?.[1]
  return direct || fallbackPalette[stableColorIndex(normalized || 'standard')]
}

export function decimalToCents(value) {
  const match = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/.exec(String(value ?? ''))
  if (!match) return null
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0')
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}

function productIcon(product) {
  const value = `${product.name} ${product.category?.name || ''}`.toLocaleLowerCase()
  if (/jeans|pants|trouser|short|بنطلون|جينز/u.test(value)) return value.includes('short') ? 'shorts' : 'pants'
  if (/hoodie|هودي/u.test(value)) return 'hoodie'
  if (/shirt|chemise|قميص/u.test(value)) return 'shirt'
  return 'tee'
}

export function mapCatalogProduct(product) {
  const activeVariants = product.variants.filter(variant => variant?.isActive === true)
  const groups = new Map()
  for (const variant of activeVariants) {
    const colorName = String(variant.color || '').trim() || 'Standard'
    const colorKey = colorName.normalize('NFKC').toLocaleLowerCase()
    const group = groups.get(colorKey) || {
      id: `${product.id}:${groups.size}`,
      name: colorName,
      hex: colorHex(colorName),
      sizes: [],
    }
    group.sizes.push({
      variantId: variant.id,
      name: String(variant.size || '').trim() || 'One size',
      sku: variant.sku,
      stock: Number.isInteger(variant.currentStock) && variant.currentStock > 0 ? variant.currentStock : 0,
      priceCents: decimalToCents(variant.sellingPrice),
    })
    groups.set(colorKey, group)
  }
  const prices = activeVariants.map(variant => decimalToCents(variant.sellingPrice)).filter(value => value !== null)
  const skus = activeVariants.map(variant => variant.sku).filter(Boolean)
  return {
    id: product.id,
    name: product.name,
    categoryId: product.category.id,
    categoryName: product.category.name,
    imageUrl: product.imageUrl,
    sku: skus[0] || 'No SKU',
    skus,
    priceCents: prices.length ? Math.min(...prices) : null,
    priceMaxCents: prices.length ? Math.max(...prices) : null,
    icon: productIcon(product),
    colors: [...groups.values()],
    sourceProduct: product,
  }
}

/** Extract tenant catalog identities from the validated Voice Sale matcher response. */
export function voiceCatalogSelection(result) {
  const productIds = new Set()
  const categoryIds = new Set()
  const addCandidate = candidate => {
    if (typeof candidate?.productId === 'string' && candidate.productId) productIds.add(candidate.productId)
    if (typeof candidate?.categoryId === 'string' && candidate.categoryId) categoryIds.add(candidate.categoryId)
  }
  const collect = matchResult => {
    if (!matchResult || typeof matchResult !== 'object') return
    addCandidate(matchResult.match)
    for (const candidate of matchResult.candidates || []) addCandidate(candidate)
    for (const candidate of matchResult.suggestions || []) addCandidate(candidate)
    for (const group of ['exactVerified', 'strongCandidates', 'alternatives']) {
      for (const candidate of matchResult.discovery?.[group] || []) addCandidate(candidate)
    }
    for (const category of matchResult.discovery?.categoryResolution?.candidates || []) {
      if (typeof category?.categoryId === 'string' && category.categoryId) categoryIds.add(category.categoryId)
    }
    for (const item of matchResult.items || []) collect(item?.result)
  }
  collect(result)
  return Object.freeze({ productIds: Object.freeze([...productIds]), categoryIds: Object.freeze([...categoryIds]) })
}

/**
 * Read-only fallback when the remote matcher is unavailable. It compares exact
 * normalized words against the already tenant-scoped catalog and never selects
 * a variant, changes stock, or invents a product.
 */
export function searchLoadedCatalogByVoice(sentence, products) {
  const requested = voiceSearchTokens(sentence)
  if (!requested.length || !Array.isArray(products)) return Object.freeze([])
  return Object.freeze(products.filter(product => {
    const variantWords = (product.colors || []).flatMap(color => [color.name,
      ...(color.sizes || []).flatMap(size => [size.name, size.sku])])
    const available = new Set(voiceSearchTokens([product.name, product.categoryName, ...variantWords].join(' ')))
    const phonetic = new Set([...available].map(voicePhoneticKey).filter(key => key.length >= 2))
    return requested.every(token => available.has(token)
      || (voicePhoneticKey(token).length >= 2 && phonetic.has(voicePhoneticKey(token))))
  }).map(product => product.id))
}

export async function loadSalesCatalog({ supabase, fetchImpl = globalThis.fetch, signal }) {
  const [categoryResult, firstPage] = await Promise.all([
    loadCategories({ supabase, fetchImpl, signal }),
    listProducts({ supabase, fetchImpl, filters: { page: 1 }, signal }),
  ])
  if (!categoryResult.ok) return categoryResult
  if (!firstPage.ok) return firstPage

  const pageCount = Math.ceil(firstPage.total / PRODUCT_PAGE_SIZE)
  const loadedPageCount = Math.min(pageCount, MAX_CATALOG_PAGES)
  const remaining = []
  for (let page = 2; page <= loadedPageCount; page += 1) {
    const result = await listProducts({ supabase, fetchImpl, filters: { page }, signal })
    if (!result.ok) return result
    remaining.push(result)
  }
  const products = [firstPage, ...remaining].flatMap(result => result.products).filter(product => product.isActive)
  return Object.freeze({
    ok: true,
    categories: categoryResult.categories,
    products: products.map(mapCatalogProduct),
    total: firstPage.total,
    complete: loadedPageCount >= pageCount,
  })
}
