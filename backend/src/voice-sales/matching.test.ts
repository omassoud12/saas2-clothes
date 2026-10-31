import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import { createApp, type AppDependencies, type AppRuntimeConfiguration } from '../app.js'
import type { AuthContext, AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { catalogVariantSelect, CATALOG_PAGE_SIZE, createCatalogReader, MAX_CATALOG_VARIANTS } from './catalog-reader.js'
import { createVoiceMatchingService } from './matching.service.js'
import type { CatalogReader, VoiceSaleMatchResult } from './match.types.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const context = (role: UserRole = UserRole.OWNER, accountId = accountA): AuthContext => ({
  userId, role, accountId, accountStatus: AccountStatus.ACTIVE,
})
type Row = Prisma.ProductVariantGetPayload<{ select: typeof catalogVariantSelect }>

class CatalogDouble {
  rows: Row[] = []
  calls: Prisma.ProductVariantFindManyArgs[] = []
  writes = 0
  add(options: { name?: string; category?: string; productId?: string; tenant?: string; color?: string | null;
    size?: string | null; price?: string | null; stock?: number; active?: boolean; productActive?: boolean;
    imageKey?: string | null; categoryId?: string; barcode?: string | null } = {}): Row {
    const n = this.rows.length + 1
    const tenant = options.tenant ?? accountA
    const categoryName = options.category ?? 'Clothing'
    const existingCategoryId = this.rows.find(row => row.accountId === tenant
      && row.product.category.name === categoryName)?.product.category.id
    const categoryId = options.categoryId ?? existingCategoryId ?? uuid(20_000 + n)
    const row: Row = {
      id: uuid(n), accountId: tenant, createdAt: new Date(1_700_000_000_000 + n * 1000),
      sku: `SKU-${n}`,
      barcode: options.barcode ?? null,
      color: options.color === undefined ? 'Black' : options.color,
      size: options.size === undefined ? 'XL' : options.size,
      sellingPrice: options.price === null ? null : new Prisma.Decimal(options.price ?? '12.50'),
      currentStock: options.stock ?? 40, isActive: options.active ?? true,
      product: { id: options.productId ?? uuid(n + 10_000), accountId: tenant,
        name: options.name ?? 'T-Shirt', imageKey: options.imageKey ?? null, isActive: options.productActive ?? true,
        category: { id: categoryId, accountId: tenant, name: categoryName },
        account: { id: tenant, baseCurrency: 'USD' } },
    }
    // Intentionally include private extra fields: selection/output must remain an allowlist.
    Object.assign(row, { lastPurchaseCost: new Prisma.Decimal('7.1234') })
    Object.assign(row.product, { profitMarginOverride: new Prisma.Decimal('0.4') })
    this.rows.push(row)
    return row
  }
  asClient(): PrismaClient {
    const findMany = async (args: Prisma.ProductVariantFindManyArgs): Promise<Row[]> => {
      this.calls.push(args)
      const where = args.where!
      assert.ok(typeof where.accountId === 'string', 'tenant scope is mandatory')
      assert.deepEqual((where.product as Prisma.ProductWhereInput).accountId, where.accountId)
      assert.equal(where.isActive, true)
      assert.equal((where.product as Prisma.ProductWhereInput).isActive, true)
      assert.ok(args.take! > 0 && args.take! <= CATALOG_PAGE_SIZE)
      assert.equal(args.skip, undefined)
      const cursor = where.OR as { createdAt: Date | { lt: Date }; id?: { lt: string } }[] | undefined
      const pivot = cursor?.[1]
      const found = this.rows.filter(row => row.accountId === where.accountId && row.product.accountId === where.accountId
        && row.isActive && row.product.isActive && (!where.sellingPrice || row.sellingPrice !== null && row.sellingPrice.gt(0))
        && (!pivot || row.createdAt < pivot.createdAt || row.createdAt.getTime() === (pivot.createdAt as Date).getTime() && row.id < pivot.id!.lt))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      return found.slice(0, args.take)
    }
    const write = () => { this.writes++; throw new Error('Writes are forbidden in matching tests') }
    return { productVariant: { findMany, create: write, update: write, delete: write },
      product: { create: write, update: write }, sale: { create: write }, saleItem: { create: write },
      inventoryMovement: { create: write }, $transaction: write, $executeRaw: write,
    } as unknown as PrismaClient
  }
  service() { return createVoiceMatchingService(createCatalogReader(this.asClient())) }
}

describe('ranked catalog discovery', () => {
  test('resolves only actual tenant categories through language bridges and preserves category IDs', async () => {
    const store = new CatalogDouble()
    const localCategoryId = uuid(70_001)
    store.add({ name: 'Polo Classic', category: 't-chirt', categoryId: localCategoryId })
    store.add({ name: 'Foreign Polo', category: 'T-Shirts', categoryId: uuid(70_002), tenant: accountB })
    const result = await store.service().matchVoiceSaleText('بدي تيشيرت polo', context())
    assert.equal(result.discovery?.categoryResolution.status, 'RESOLVED')
    assert.deepEqual(result.discovery?.categoryResolution.candidates.map(row => ({ id: row.categoryId, name: row.categoryName })),
      [{ id: localCategoryId, name: 't-chirt' }])
    assert.ok(result.discovery?.categoryResolution.candidates[0].evidence.includes('PRODUCT_TYPE_BRIDGE'))
    assert.ok(result.discovery?.strongCandidates.every(candidate => candidate.categoryId === localCategoryId))
    assert.equal(store.writes, 0)
  })

  test('keeps multiple real category matches ambiguous while still returning ranked products', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Polo One', category: 't-chirt', categoryId: uuid(70_010) })
    store.add({ name: 'Polo Two', category: 'تي شيرت', categoryId: uuid(70_011) })
    const result = await store.service().matchVoiceSaleText('بدي تيشيرت polo', context())
    assert.equal(result.discovery?.categoryResolution.status, 'AMBIGUOUS')
    assert.deepEqual(new Set(result.discovery?.categoryResolution.candidates.map(row => row.categoryName)),
      new Set(['t-chirt', 'تي شيرت']))
    assert.equal(result.discovery?.strongCandidates.length, 2)
    assert.equal(result.match, null)
    assert.equal(store.writes, 0)
  })

  test('uses exact SKU and barcode as variant identity without hardcoded catalog names', async () => {
    const store = new CatalogDouble()
    const sku = store.add({ name: 'Cedar Unknown Model', category: 'Seasonal' })
    const barcode = store.add({ name: 'Another Unknown Model', category: 'Seasonal', barcode: '5285001234567' })
    const bySku = await store.service().matchVoiceSaleText(sku.sku, context())
    assert.equal(bySku.discovery?.strongCandidates[0]?.variantId, sku.id)
    assert.ok(bySku.discovery?.strongCandidates[0]?.matchedAttributes.includes('product_name'))
    const byBarcode = await store.service().matchVoiceSaleText('5285001234567', context())
    assert.equal(byBarcode.discovery?.strongCandidates[0]?.variantId, barcode.id)
    assert.equal(store.writes, 0)
  })

  test('keeps free word order equivalent while preserving every explicit constraint', async () => {
    const store = new CatalogDouble()
    const exact = store.add({ name: 'Polo T-Shirt', category: 't-chirt', color: 'Black', size: 'L', stock: 5 })
    for (const text of ['بدي تيشيرت polo أسود L قطعتين', 'بدي أسود L تيشيرت polo قطعتين',
      'badi 2 pieces black polo t shirt size L']) {
      const result = await store.service().matchVoiceSaleText(text, context())
      assert.equal(result.status, 'MATCHED', text)
      assert.equal(result.match?.variantId, exact.id, text)
      assert.equal(result.match?.quantity, 2, text)
    }
    assert.equal(store.writes, 0)
  })

  test('keeps discovery available when the actual category has no linguistic bridge', async () => {
    const store = new CatalogDouble()
    const exact = store.add({ name: 'Polo T-Shirt', category: 'Seasonal Drop' })
    const result = await store.service().matchVoiceSaleText('بدي تيشيرت polo', context())
    assert.equal(result.discovery?.categoryResolution.status, 'UNRESOLVED')
    assert.equal(result.discovery?.strongCandidates[0]?.variantId, exact.id)
    assert.equal(store.writes, 0)
  })

  test('keeps explicit T_SHIRT, treats Polo as catalog evidence, and separates alternatives', async () => {
    const store = new CatalogDouble()
    const exact = store.add({ name: 'T-Shirt Polo', category: 'T-Shirt', color: 'Black', size: 'L', stock: 8 })
    store.add({ name: 'T-Shirt Polo', category: 'T-Shirt', color: 'White', size: 'L', stock: 8 })
    store.add({ name: 'T-Shirt Classic', category: 'T-Shirt', color: 'Black', size: 'L', stock: 8 })

    const typeOnly = await store.service().matchVoiceSaleText('بدي تيشيرت', context())
    assert.equal(typeOnly.parser.attributes.productType.value, 'T_SHIRT')
    assert.ok(typeOnly.discovery!.strongCandidates.length >= 3)
    assert.equal(typeOnly.match, null)

    const named = await store.service().matchVoiceSaleText('بدي تيشيرت بولو', context())
    assert.equal(named.parser.attributes.productType.value, 'T_SHIRT')
    assert.deepEqual(named.parser.productNameResidualTokens.map(token => token.token), ['بولو'])
    assert.equal(named.discovery!.strongCandidates[0].productName, 'T-Shirt Polo')
    assert.ok(named.discovery!.alternatives.some(candidate => candidate.productName === 'T-Shirt Classic'
      && candidate.differences.some(difference => difference.field === 'product_name')))

    const posWording = await store.service().matchVoiceSaleText('بدي تي شيرت polo', context())
    assert.equal(posWording.parser.originalText, 'بدي تي شيرت polo')
    assert.equal(posWording.parser.attributes.productType.value, 'T_SHIRT')
    assert.deepEqual(posWording.parser.productNameResidualTokens.map(token => token.token), ['polo'])
    assert.equal(posWording.discovery!.strongCandidates[0].productName, 'T-Shirt Polo')

    const colored = await store.service().matchVoiceSaleText('بدي تيشيرت بولو سودا', context())
    assert.equal(colored.discovery!.strongCandidates[0].variantId, exact.id)
    assert.ok(colored.discovery!.alternatives.some(candidate => candidate.color === 'White'
      && candidate.differences.some(difference => difference.field === 'color')))
    assert.notEqual(colored.status, 'MATCHED')

    const complete = await store.service().matchVoiceSaleText('بدي تيشيرت بولو سودا L قطعتين', context())
    assert.equal(complete.status, 'MATCHED')
    assert.equal(complete.match?.variantId, exact.id)
    assert.equal(complete.discovery!.exactVerified[0].variantId, exact.id)
    assert.equal(store.writes, 0)
  })

  test('signs only returned tenant product images and never exposes image keys', async () => {
    const productId = uuid(900)
    const imageKey = `tenants/${accountA}/products/${productId}/main.webp`
    const reader: CatalogReader = { async read() { return { scannedVariants: 1, truncated: false,
      productImageKeys: new Map([[productId, imageKey]]), variants: [{ productId, variantId: uuid(901), sku: 'IMG-1',
        productName: 'T-Shirt Polo', categoryName: 'T-Shirt', color: 'Black', size: 'L', sellingPrice: '12.50',
        availableStock: 4, currency: 'USD' }] } } }
    let receivedKey = ''
    const service = createVoiceMatchingService(reader, async (auth, resolvedProductId, key) => {
      assert.equal(auth.accountId, accountA); assert.equal(resolvedProductId, productId); receivedKey = key
      return 'https://images.example/signed.webp'
    })
    const result = await service.matchVoiceSaleText('Tshirt Polo black L two pieces', context())
    assert.equal(result.parser.attributes.productType.value, 'T_SHIRT')
    assert.deepEqual(result.parser.productNameResidualTokens.map(token => token.token), ['polo'])
    const imageCandidate = [...(result.discovery?.exactVerified ?? []), ...(result.discovery?.strongCandidates ?? []),
      ...(result.discovery?.alternatives ?? [])].find(candidate => candidate.productId === productId)
    assert.equal(imageCandidate?.imageUrl, 'https://images.example/signed.webp')
    assert.equal(receivedKey, imageKey)
    assert.doesNotMatch(JSON.stringify(result), /tenants\//u)
  })

  test('discovers linen pants with explicit blue and numeric size evidence', async () => {
    const store = new CatalogDouble()
    const exact = store.add({ name: 'بنطلون كتان', category: 'Pants', color: 'Blue', size: '32', stock: 5 })
    store.add({ name: 'بنطلون كتان', category: 'Pants', color: 'Black', size: '32', stock: 5 })
    const incomplete = await store.service().matchVoiceSaleText('بدي بنطلون كتان لون أزرق قياس 32', context())
    assert.equal(incomplete.parser.attributes.productType.value, 'PANTS')
    assert.equal(incomplete.parser.attributes.material.value, 'LINEN')
    assert.equal(incomplete.parser.attributes.color.value, 'BLUE')
    assert.equal(incomplete.parser.attributes.size.value, '32')
    assert.deepEqual(incomplete.parser.productNameResidualTokens, [])
    assert.equal(incomplete.discovery?.strongCandidates[0]?.variantId, exact.id)
    const complete = await store.service().matchVoiceSaleText('بدي بنطلون كتان لون أزرق قياس 32 قطعتين', context())
    assert.equal(complete.status, 'MATCHED', JSON.stringify({ reason: complete.reason,
      missingFields: complete.missingFields, candidates: complete.candidates }))
    assert.equal(complete.match?.variantId, exact.id)
    assert.equal(store.writes, 0)
  })

  test('recognizes spoken Arabic chemise as Shirt without leaking attribute linkers into catalog evidence', async () => {
    const store = new CatalogDouble()
    const exact = store.add({ name: 'شيميز', category: 'Shirts', color: 'Black', size: 'XL', stock: 5 })
    const result = await store.service().matchVoiceSaleText('بدي شيميز لونه أسود وقياسه إكس لارج', context())
    assert.equal(result.parser.attributes.productType.value, 'SHIRT')
    assert.equal(result.parser.attributes.color.value, 'BLACK')
    assert.equal(result.parser.attributes.size.value, 'XL')
    assert.equal(result.parser.attributes.quantity.value, null)
    assert.deepEqual(result.parser.productNameResidualTokens, [])
    assert.equal(result.discovery?.strongCandidates[0]?.variantId, exact.id)
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(store.writes, 0)
  })

  test('resolves the real chemise category despite a later advisory confirmation cue', async () => {
    const store = new CatalogDouble()
    const categoryId = uuid(70_020)
    const exact = store.add({ name: 'Classic Chemise', category: 'chemise', categoryId,
      color: 'White', size: 'XL', stock: 5 })
    const result = await store.service().matchVoiceSaleText('Bade chemise ab behndi yes x large', context())
    assert.equal(result.parser.attributes.productType.value, 'SHIRT')
    assert.equal(result.parser.attributes.size.value, 'XL')
    assert.equal(result.parser.commonExpressionSafety?.reason, 'INTENT_REQUIRES_CONTEXT')
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.match, null)
    assert.equal(result.catalog.scannedVariants, 1)
    assert.deepEqual(result.discovery?.categoryResolution.candidates.map(row => ({ id: row.categoryId, name: row.categoryName })),
      [{ id: categoryId, name: 'chemise' }])
    assert.equal(result.discovery?.categoryResolution.status, 'RESOLVED')
    assert.equal(result.discovery?.alternatives[0]?.variantId, exact.id)
    assert.equal(store.writes, 0)
  })
})

describe('multi-item read-only matching', () => {
  test('matches conjunction items independently, preserves Polo ambiguity, and performs zero writes', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Polo Shirt', category: 'Polo Shirts', color: 'Blue', size: null, stock: 4 })
    store.add({ name: 'Classic Pants', category: 'Pants', color: 'Black', size: null, stock: 3 })
    store.add({ name: 'Classic Pants', category: 'Pants', color: 'Black', size: null, stock: 99, tenant: accountB })
    const result = await store.service().matchVoiceSaleText('bdi polo زرقاء و بنطلون اسود', context())
    assert.equal(result.reason, 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION')
    assert.equal(result.segmentation?.reason, 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE')
    assert.deepEqual(result.items?.map(item => item.segment.text), ['polo زرقاء', 'بنطلون اسود'])
    assert.equal(result.items?.[0].result.parser.attributes.color.value, 'BLUE')
    assert.ok(result.items?.[0].result.parser.ambiguities.some(row => row.kind === 'lexical_ambiguity'))
    assert.equal(result.items?.[1].result.parser.attributes.productType.value, 'PANTS')
    assert.equal(result.items?.[1].result.parser.attributes.color.value, 'BLACK')
    assert.ok(result.items?.every(item => item.result.parser.attributes.quantity.status === 'missing'))
    assert.equal(store.calls.length, 1); assert.equal(store.calls[0].where?.accountId, accountA); assert.equal(store.writes, 0)
  })
  test('keeps MATCHED and INSUFFICIENT_STOCK outcomes independent across a conjunction', async () => {
    const reader: CatalogReader = { async read() { return { scannedVariants: 2, truncated: false, variants: [
      { productId: uuid(520), variantId: uuid(521), sku: 'SKU-521', productName: 'T-Shirt', categoryName: 'T-Shirt',
        color: 'Black', size: null, sellingPrice: '12.50', availableStock: 2, currency: 'USD' },
      { productId: uuid(522), variantId: uuid(523), sku: 'SKU-523', productName: 'Pants', categoryName: 'Pants',
        color: null, size: null, sellingPrice: '20.00', availableStock: 2, currency: 'USD' },
    ] } } }
    const result = await createVoiceMatchingService(reader).matchVoiceSaleText('بدي قطعتين تيشيرت اسود و3 بناطيل', context())
    assert.deepEqual(result.items?.map(item => item.result.status), ['MATCHED', 'INSUFFICIENT_STOCK'])
    assert.deepEqual(result.items?.map(item => item.result.match?.quantity), [2, 3])
    assert.equal(result.items?.[0].result.parser.attributes.productType.value, 'T_SHIRT')
    assert.equal(result.items?.[1].result.parser.attributes.productType.value, 'PANTS')
  })
  test('matches every explicit request independently with isolated attributes and one tenant-scoped snapshot', async () => {
    let reads = 0
    const reader: CatalogReader = { async read(auth) {
      reads++
      assert.equal(auth.accountId, accountA)
      return { scannedVariants: 2, truncated: false, variants: [
        { productId: uuid(500), variantId: uuid(501), sku: 'SKU-501', productName: 'Zara T-Shirt', categoryName: 'T-Shirt',
          color: 'Black', size: 'XL', sellingPrice: '12.50', availableStock: 4, currency: 'USD' },
        { productId: uuid(502), variantId: uuid(503), sku: 'SKU-503', productName: 'Polo Pants', categoryName: 'Pants',
          color: 'Blue', size: 'XL', sellingPrice: '20.00', availableStock: 2, currency: 'USD' },
      ] }
    } }
    const result = await createVoiceMatchingService(reader).matchVoiceSaleText(
      'بدي zara t shirt لونه اسود قياس xl قطعتين بدي بنطلون polo لونه ازرق قياس xl 3 pieces يا معلم', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.reason, 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION')
    assert.equal(result.items?.length, 2); assert.equal(reads, 1)
    assert.equal(result.items?.[0].result.status, 'MATCHED')
    assert.equal(result.items?.[0].result.match?.quantity, 2)
    assert.equal(result.items?.[0].result.parser.attributes.color.value, 'BLACK')
    assert.equal(result.items?.[1].result.status, 'INSUFFICIENT_STOCK')
    assert.equal(result.items?.[1].result.match?.quantity, 3)
    assert.equal(result.items?.[1].result.parser.attributes.color.value, 'BLUE')
    assert.equal(result.items?.[1].result.parser.attributes.productType.value, 'PANTS')
    assert.deepEqual(result.items?.[1].result.parser.productNameResidualTokens.map(token => token.token), ['polo'])
    assert.ok(result.segmentation?.removedConversationalExpressions.includes('يا معلم'))
  })
  test('missing quantities stay missing per item and ambiguous conjunctions preserve legacy fail-closed behavior', async () => {
    let reads = 0
    const reader: CatalogReader = { async read() { reads++; return { variants: [], scannedVariants: 0, truncated: false } } }
    const service = createVoiceMatchingService(reader)
    const multi = await service.matchVoiceSaleText('بدي t shirt zara لونه اسود بدي بنطلون polo يا كبير', context())
    assert.equal(multi.items?.length, 2)
    assert.ok(multi.items?.every(item => item.result.parser.attributes.quantity.status === 'missing'))
    assert.equal(reads, 1)
    const unclear = await service.matchVoiceSaleText('T-shirt and pants black', context())
    assert.equal(unclear.status, 'INVALID_INPUT')
    assert.equal(unclear.reason, 'UNSUPPORTED_MULTIPLE_ITEMS')
    assert.equal(unclear.items, undefined)
    assert.equal(reads, 1)
  })
})

describe('Patterns & Prints authenticated read-only API', () => {
  for(const role of [UserRole.OWNER,UserRole.WAREHOUSE])test(`${role}: actual name proof, tenant isolation and no writes`,async()=>{
    const store=new CatalogDouble(),own=store.add({name:'Cedar dress leopard print',category:'Dress',stock:3})
    store.add({name:'Cedar dress leopard print',category:'Dress',tenant:accountB,price:'0.01',stock:999})
    const text='Cedar dress leopard print black XL two pieces'
    await withApi(store,role,async url=>{
      const response=await post(url,{text});assert.equal(response.status,200)
      const result=await response.json() as VoiceSaleMatchResult
      assert.equal(result.status,'MATCHED');assert.equal(result.match?.variantId,own.id);assert.equal(result.parser.sourcePatternId?.value,'ANIMAL_LEOPARD');assert.equal(result.requiresConfirmation,true)
      assert.doesNotMatch(JSON.stringify(result),/lastPurchaseCost|profitMargin|0\.01/u)
      assert.doesNotMatch(JSON.stringify(result.parser.patternCandidates),/sourceIndex|sourceNormalized|records/u)
      own.currentStock=1;own.sellingPrice=new Prisma.Decimal('27.00')
      const fresh=await (await post(url,{text})).json() as VoiceSaleMatchResult
      assert.equal(fresh.status,'INSUFFICIENT_STOCK');assert.equal(fresh.match?.sellingPrice,'27.00')
      const calls=store.calls.length
      const negative=await (await post(url,{text:'ما بدي منقط بدي مورّد'})).json() as VoiceSaleMatchResult
      assert.equal(negative.match,null);assert.equal(store.calls.length,calls)
      assert.equal((await post(url,{text,accountId:accountB})).status,422);assert.equal((await post(url,{text},'')).status,401)
    })
    assert.equal(store.writes,0);assert.equal(own.currentStock,1);assert.ok(store.calls.every(c=>c.where?.accountId===accountA))
  })
})

describe('Fits & Cuts authenticated read-only API', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`${role}: independent axes preserve tenant, stock, price and projection`, async () => {
    const store=new CatalogDouble()
    const own=store.add({name:'Cedar jeans wide leg high waist',category:'Jeans',size:'W32/L30',stock:3})
    store.add({name:'Cedar jeans wide leg high waist',category:'Jeans',size:'W32/L30',tenant:accountB,price:'0.01',stock:999})
    const text='Cedar jeans wede leg 5ser 3ale black W32/L30 two pieces'
    await withApi(store,role,async url=>{
      const response=await post(url,{text});assert.equal(response.status,200)
      const result=await response.json() as VoiceSaleMatchResult
      assert.equal(result.status,'MATCHED');assert.equal(result.match?.variantId,own.id)
      assert.equal(result.parser.sourceFitCuts?.leg_cut.value,'LEG_WIDE')
      assert.equal(result.parser.sourceFitCuts?.waist_rise.value,'RISE_HIGH')
      assert.equal(result.requiresConfirmation,true)
      assert.doesNotMatch(JSON.stringify(result),/lastPurchaseCost|profitMargin|0\.01/u)
      assert.doesNotMatch(JSON.stringify(result.parser.fitCutCandidates),/sourceIndex|sourceNormalized|records/u)
      own.currentStock=1;own.sellingPrice=new Prisma.Decimal('27.00')
      const fresh=await (await post(url,{text})).json() as VoiceSaleMatchResult
      assert.equal(fresh.status,'INSUFFICIENT_STOCK');assert.equal(fresh.match?.sellingPrice,'27.00')
      const calls=store.calls.length
      const negative=await (await post(url,{text:'ما بدي سكيني بدي بوت كت'})).json() as VoiceSaleMatchResult
      assert.equal(negative.match,null);assert.equal(store.calls.length,calls)
      assert.equal((await post(url,{text,accountId:accountB})).status,422)
      assert.equal((await post(url,{text},'')).status,401)
    })
    assert.equal(store.writes,0);assert.equal(own.currentStock,1)
    assert.ok(store.calls.every(call=>call.where?.accountId===accountA))
  })
})

describe('Common expression cues use the authenticated read-only API', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`${role}: cues preserve tenant scope, current stock/price and financial allowlist`, async () => {
    const store = new CatalogDouble()
    const own = store.add({ name: 'Cedar T-Shirt', stock: 3 })
    store.add({ name: 'Cedar T-Shirt', tenant: accountB, stock: 999, price: '0.01' })
    store.add({ name: 'Cedar T-Shirt', active: false })
    await withApi(store, role, async url => {
      const text = 'je veux Cedar T-shirt black XL two pieces'
      const response = await post(url, { text })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED'); assert.equal(result.match?.variantId, own.id)
      assert.equal(result.parser.commonExpressionMatches?.[0].candidates[0], 'REQ_WANT')
      assert.equal(result.parser.commonExpressionMatches?.[0].authorizesAction, false)
      assert.equal(result.parser.commonExpressionSafety?.recognitionOnly, true)
      assert.doesNotMatch(JSON.stringify(result), /lastPurchaseCost|profitMargin|unitCost|0\.01|sourceIndex|alias_index/u)
      own.currentStock = 1; own.sellingPrice = new Prisma.Decimal('15.00')
      const fresh = await (await post(url, { text })).json() as VoiceSaleMatchResult
      assert.equal(fresh.status, 'INSUFFICIENT_STOCK'); assert.equal(fresh.match?.sellingPrice, '15.00')
      const reads = store.calls.length
      for (const cue of ['أكيد', 'yes', 'في منها', 'ما بدي ألغي الطلب', 'زيدلي قطعة', 'غيرلي اللون']) {
        const advisory = await (await post(url, { text: `${cue} Cedar T-shirt black XL two pieces` })).json() as VoiceSaleMatchResult
        assert.notEqual(advisory.status, 'MATCHED'); assert.equal(advisory.match, null)
        assert.equal(advisory.catalog.scannedVariants, 0); assert.equal(store.calls.length, reads)
        assert.ok(advisory.parser.commonExpressionMatches?.length)
        assert.equal(advisory.parser.commonExpressionSafety?.authorizesAction, false)
      }
    })
    assert.ok(store.calls.every(call => call.where?.accountId === accountA))
    assert.equal(store.writes, 0)
  })
  test('intent recognition cannot bypass authorization or allow client cues/tenant IDs', async () => {
    const store = new CatalogDouble()
    for (const role of [UserRole.SUPER_ADMIN, UserRole.OWNER]) await withApi(store, role, async url => {
      assert.equal((await post(url, { text: 'yes' })).status, 403)
    }, { active: false })
    await withApi(store, UserRole.OWNER, async url => {
      assert.equal((await post(url, { text: 'yes' }, '')).status, 401)
      for (const body of [{ text: 'yes', accountId: accountB }, { text: 'yes', intentCues: [] },
        { text: 'yes', commonExpressionSafety: { salePreviewAllowed: true } }]) assert.equal((await post(url, body)).status, 422)
    })
    assert.equal(store.calls.length, 0); assert.equal(store.writes, 0)
  })
})

describe('Necklines and collars use the existing guarded read-only API', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`${role}: tenant scope, evidence, freshness and financial allowlist`, async () => {
    const store = new CatalogDouble()
    const own = store.add({ name: 'Shirt mandarin collar', stock: 3 })
    store.add({ name: 'Shirt mandarin collar', tenant: accountB, stock: 999, price: '0.01' })
    store.add({ name: 'Shirt mandarin collar', active: false })
    store.add({ name: 'Shirt mandarin collar', productActive: false })
    const text = 'Shirt mandarin collar black XL two pieces'
    await withApi(store, role, async url => {
      const response = await post(url, { text })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED'); assert.equal(result.match?.variantId, own.id)
      assert.equal(result.parser.sourceCollarType?.value, 'COLLAR_MANDARIN')
      assert.ok(result.match?.evidence.some(e => e.field === 'neckline' && e.requested === 'COLLAR_MANDARIN'))
      assert.doesNotMatch(JSON.stringify(result), /lastPurchaseCost|profitMargin|unitCost|0\.01/u)
      own.currentStock = 1; own.sellingPrice = new Prisma.Decimal('15.00')
      const fresh = await (await post(url, { text })).json() as VoiceSaleMatchResult
      assert.equal(fresh.status, 'INSUFFICIENT_STOCK'); assert.equal(fresh.match?.sellingPrice, '15.00')
      assert.equal(store.writes, 0)
    })
  })
  test('neckline alone, conflicts and negative input never initiate a catalog read', async () => {
    const store = new CatalogDouble(); store.add({ name: 'Mandarin collar' })
    for (const text of ['mandarin collar XL two pieces', 'shirt neckline XL two pieces', 'Shirt v neck crew neck XL two pieces', 'not Shirt v neck']) {
      const result = await store.service().matchVoiceSaleText(text, context())
      assert.notEqual(result.status, 'MATCHED'); assert.equal(store.calls.length, 0)
    }
    assert.equal(store.writes, 0)
  })
  test('same ambiguous name and a category cannot choose an interpretation', async () => {
    const store = new CatalogDouble(); store.add({ name: 'Shirt قبة عالية', category: 'Turtleneck' })
    const result = await store.service().matchVoiceSaleText('Shirt قبة عالية black XL two pieces', context())
    assert.equal(result.status, 'INCOMPLETE'); assert.ok(result.missingFields.includes('neckline')); assert.equal(store.writes, 0)
  })
  test('inactive permissions and SUPER_ADMIN cannot use tenant collar matching', async () => {
    const store = new CatalogDouble()
    for (const auth of [context(UserRole.SUPER_ADMIN), { ...context(), accountStatus: AccountStatus.SUSPENDED },
      { ...context(), accountId: null }]) await assert.rejects(store.service().matchVoiceSaleText('Shirt v neck', auth), HttpError)
    assert.equal(store.calls.length, 0); assert.equal(store.writes, 0)
  })
  test('long mixed input retains model identity and safely segments independently described garments', async () => {
    const store = new CatalogDouble(); store.add({ name: 'Shirt Cedar v neck' })
    const prefix = 'بدي '.repeat(60)
    const r = await store.service().matchVoiceSaleText(`${prefix}Shirt Cedar قبة V black XL two pieces`, context())
    assert.equal(r.status, 'MATCHED')
    const multiple = await store.service().matchVoiceSaleText('Shirt v neck and Dress sweetheart neck XL two pieces', context())
    assert.equal(multiple.status, 'INCOMPLETE')
    assert.equal(multiple.reason, 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION')
    assert.equal(multiple.segmentation?.reason, 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE')
    assert.equal(multiple.items?.length, 2); assert.equal(store.writes, 0)
  })
})

describe('Materials and modifiers read-only catalog/API integration', () => {
  for (const word of ['fleece', 'jersey', 'mesh']) test(`a material alias alone cannot select a real item named ${word}`, async () => {
    const store = new CatalogDouble(); store.add({ name: word, color: null })
    const result = await store.service().matchVoiceSaleText(`${word} size XL two pieces`, context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.reason, 'PRODUCT_IDENTITY_REQUIRED')
    assert.equal(store.calls.length, 0)
    assert.equal(store.writes, 0)
  })
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`${role}: language evidence, fresh stock/price, tenant isolation and no cost leak`, async () => {
    const store = new CatalogDouble()
    const row = store.add({ name: 'Cotton T-Shirt', category: 'T-Shirt', stock: 3 })
    store.add({ tenant: accountB, name: 'Cotton T-Shirt', price: '0.01', stock: 999 })
    await withApi(store, role, async url => {
      const response = await post(url, { text: 'Tshirt fabric coton black XL two pieces' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match?.variantId, row.id)
      assert.equal(result.match?.sku, row.sku)
      assert.equal(result.match?.quantity, 2)
      assert.ok(result.match?.evidence.some(e => e.field === 'material' && e.requested === 'COTTON'))
      assert.doesNotMatch(JSON.stringify(result), /lastPurchaseCost|profitMargin|unitCost|0\.01/u)
      row.currentStock = 1; row.sellingPrice = new Prisma.Decimal('13.75')
      const changed = await (await post(url, { text: 'Tshirt fabric coton black XL two pieces' })).json() as VoiceSaleMatchResult
      assert.equal(changed.status, 'INSUFFICIENT_STOCK')
      assert.equal(changed.match?.sellingPrice, '13.75')
    })
    assert.ok(store.calls.every(call => call.where?.accountId === accountA))
    assert.equal(store.writes, 0)
  })
  test('descriptor missing from catalog remains unresolved even for a unique actual variant', async () => {
    const store = new CatalogDouble(); store.add()
    const result = await store.service().matchVoiceSaleText('Tshirt fabric coton black XL two pieces', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.ok(result.missingFields.includes('material'))
    assert.equal(result.match, null)
    assert.equal(store.writes, 0)
  })
  test('independent exact subtype resolves velvet/velour language; ambiguous stored label does not', async () => {
    const store = new CatalogDouble(); store.add({ name: 'Velvet T-Shirt', category: 'T-Shirt' })
    const result = await store.service().matchVoiceSaleText('Tshirt fabric مخمل black XL two pieces', context())
    assert.equal(result.status, 'MATCHED')
    assert.ok(result.match?.evidence.some(e => e.requested === 'VELVET'))
    store.rows[0].product.name = 'مخمل T-Shirt'
    const ambiguous = await store.service().matchVoiceSaleText('Tshirt fabric مخمل black XL two pieces', context())
    assert.notEqual(ambiguous.status, 'MATCHED')
    assert.ok(ambiguous.missingFields.includes('material'))
    assert.equal(store.writes, 0)
  })
  test('plausible material subtypes across actual products remain ambiguous', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Velvet T-Shirt', category: 'T-Shirt' })
    store.add({ name: 'Velour T-Shirt', category: 'T-Shirt' })
    const result = await store.service().matchVoiceSaleText('Tshirt fabric مخمل black XL two pieces', context())
    assert.equal(result.status, 'AMBIGUOUS')
    assert.equal(result.candidates.length, 2)
    assert.equal(store.writes, 0)
  })
  for (const [name, phrase] of [['Genuine Leather Jacket', 'Jacket fabric genuine leather'],
    ['Organic Cotton T-Shirt', 'Tshirt fabric organic cotton'], ['Silk Dress', 'Dress fabric silk']]) {
    test(`label cannot certify ${phrase}`, async () => {
      const store = new CatalogDouble(); store.add({ name })
      const result = await store.service().matchVoiceSaleText(`${phrase} black XL two pieces`, context())
      assert.notEqual(result.status, 'MATCHED')
      assert.equal(result.match, null)
      assert.equal(store.writes, 0)
    })
  }
  test('satin cannot imply silk, stretch cannot imply elastane', async () => {
    const store = new CatalogDouble(); store.add({ name: 'Satin Dress', category: 'Dress' })
    const satin = await store.service().matchVoiceSaleText('Dress fabric satin black XL two pieces', context())
    assert.equal(satin.status, 'MATCHED')
    assert.equal(satin.parser.sourceMaterial?.value, 'SATIN')
    assert.ok(!satin.match?.evidence.some(e => e.requested === 'SILK'))
    store.rows[0].product.name = 'Stretch Dress'
    const stretch = await store.service().matchVoiceSaleText('Dress fabric stretch black XL two pieces', context())
    assert.equal(stretch.status, 'MATCHED')
    assert.deepEqual(stretch.parser.materialCandidates?.[0].result.fabrics, [])
    assert.ok(stretch.match?.evidence.some(e => e.requested === 'STRETCH'))
    assert.equal(store.writes, 0)
  })
  for (const text of ['Tshirt cotton 95% elastane 5% black XL two pieces', 'Tshirt not cotton black XL two pieces',
    'Tshirt من دون ليكرا black XL two pieces', 'fabric cotton black XL two pieces']) {
    test(`unsafe/nonidentity material request has no catalog query: ${text}`, async () => {
      const store = new CatalogDouble(); store.add()
      const result = await store.service().matchVoiceSaleText(text, context())
      assert.notEqual(result.status, 'MATCHED')
      assert.equal(store.calls.length, 0)
      assert.equal(store.writes, 0)
    })
  }
  test('model words and missing sizes remain required; material cannot override explicit constraints', async () => {
    const store = new CatalogDouble(); store.add({ name: 'T-Shirt Model Modal', category: 'T-Shirt' })
    const exact = await store.service().matchVoiceSaleText('Tshirt Model Modal black XL two pieces', context())
    assert.equal(exact.status, 'MATCHED')
    store.rows[0].product.name = 'Cotton T-Shirt'
    const missing = await store.service().matchVoiceSaleText('Tshirt fabric coton black two pieces', context())
    assert.equal(missing.status, 'INCOMPLETE')
    assert.ok(missing.missingFields.includes('size'))
    const wrong = await store.service().matchVoiceSaleText('Tshirt fabric coton black XXL two pieces', context())
    assert.equal(wrong.status, 'NOT_FOUND')
    assert.equal(store.writes, 0)
  })
  test('material requests still respect unpriced/sold-out/multiple variant/truncation safeguards', async () => {
    const store = new CatalogDouble(); const row = store.add({ name: 'Cotton T-Shirt', stock: 0 })
    const sentence = 'Tshirt fabric coton black XL two pieces'
    assert.equal((await store.service().matchVoiceSaleText(sentence, context())).status, 'INSUFFICIENT_STOCK')
    row.sellingPrice = null
    assert.equal((await store.service().matchVoiceSaleText(sentence, context())).status, 'INCOMPLETE')
    row.sellingPrice = new Prisma.Decimal('12.50'); row.currentStock = 10
    store.add({ name: 'Cotton T-Shirt' })
    assert.equal((await store.service().matchVoiceSaleText(sentence, context())).status, 'AMBIGUOUS')
    const reader = createCatalogReader(store.asClient())
    const truncated = createVoiceMatchingService({ async read(ctx) { return { ...await reader.read(ctx), truncated: true } } })
    assert.equal((await truncated.matchVoiceSaleText(sentence, context())).status, 'INCOMPLETE')
    assert.equal(store.writes, 0)
  })
})

describe('Quantities v2 read-only catalog/API integration', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`${role}: extended quantity, real snapshot stock/price and account isolation`, async () => {
    const store = new CatalogDouble()
    const row = store.add({ stock: 40 })
    store.add({ tenant: accountB, stock: 9999, price: '0.01' })
    await withApi(store, role, async url => {
      const first = await post(url, { text: 'Tshirt black XL 38 pcs' })
      assert.equal(first.status, 200)
      const result = await first.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match?.variantId, row.id)
      assert.equal(result.match?.quantity, 38)
      assert.equal(result.match?.sellingPrice, '12.50')
      assert.equal(result.parser.quantityIntent?.unitId, 'PIECE')
      assert.equal(result.requiresConfirmation, true)
      assert.doesNotMatch(JSON.stringify(result), /lastPurchaseCost|profitMargin|unitCost|0\.01/u)
      row.currentStock = 37
      row.sellingPrice = new Prisma.Decimal('13.75')
      const next = await (await post(url, { text: 'Tshirt black XL 38 pcs' })).json() as VoiceSaleMatchResult
      assert.equal(next.status, 'INSUFFICIENT_STOCK')
      assert.equal(next.match?.availableStock, 37)
      assert.equal(next.match?.sellingPrice, '13.75')
    })
    assert.equal(store.writes, 0)
    assert.ok(store.calls.every(call => call.where?.accountId === accountA))
  })
  for (const phrase of ['2 pairs', '2 dozen', '2 packs', '2 cartons', '2 lots', '2 شوال', 'about 2 pieces',
    'at least 2 pieces', 'add 2 pieces', 'remove 2 pieces', '1 piece 2 pieces', 'one two pieces', '1.5 pieces',
    '0 pieces', '1000001 pieces', 'stock 2 pieces', 'price 2$', 'barcode 2', 'offer 1+1']) {
    test(`does not query or write an unsafe request: ${phrase}`, async () => {
      const store = new CatalogDouble(); store.add()
      const result = await store.service().matchVoiceSaleText(`Tshirt black XL ${phrase}`, context())
      assert.notEqual(result.status, 'MATCHED')
      assert.equal(result.match, null)
      assert.equal(store.calls.length, 0)
      assert.equal(store.writes, 0)
    })
  }
  test('multipack product descriptors retain literal name and do not convert contents', async () => {
    const store = new CatalogDouble()
    store.add({ name: '3-pack Socks', category: 'Socks', color: null, size: null })
    const missing = await store.service().matchVoiceSaleText('3-pack Socks', context())
    assert.notEqual(missing.status, 'MATCHED')
    assert.equal(missing.parser.attributes.quantity.value, null)
    const exact = await store.service().matchVoiceSaleText('3-pack Socks two pieces', context())
    assert.equal(exact.status, 'MATCHED')
    assert.equal(exact.match?.quantity, 2)
    assert.equal(store.writes, 0)
  })
})

describe('Lebanese orange T-shirt vocabulary regression', () => {
  test('the exact failing sentence scans 36 mocked variants and asks for size', async () => {
    const store = new CatalogDouble()
    const compatible = store.add({ color: 'Orange' })
    for (let i = 1; i < 36; i++) store.add({ name: 'Pants', color: 'Green' })
    const result = await store.service().matchVoiceSaleText('t chirt orange kt3ten', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.match, null)
    assert.equal(result.catalog.scannedVariants, 36)
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0].variantId, compatible.id)
    assert.equal(result.candidates[0].quantity, 2)
    assert.deepEqual(result.missingFields, ['size'])
    assert.equal(result.parser.attributes.size.value, null)
    assert.equal(store.writes, 0)
  })
  for (const color of ['Orange', 'ORANGE', 'برتقالي', 'برتقالية', 'بُرْتُقَالِيّ']) {
    test(`new canonical color matches the actual stored color ${color} without selecting a size`, async () => {
      const store = new CatalogDouble()
      const row = store.add({ color })
      const result = await store.service().matchVoiceSaleText('t chirt orange kt3ten', context(UserRole.WAREHOUSE))
      assert.equal(result.status, 'INCOMPLETE')
      assert.equal(result.candidates[0].color, color)
      assert.equal(result.candidates[0].variantId, row.id)
      assert.ok(result.candidates[0].evidence.some(item => item.field === 'color' && item.source === 'variant_column' && item.requested === 'ORANGE'))
      assert.equal(result.match, null)
      assert.equal(store.writes, 0)
    })
  }
  for (const text of ['t chirt orange XL kt3ten', 'tchirt Orange XL two pieces', 'تي شيرت برتقالية XL قطعتين']) {
    test(`only a complete, compatible real fixture may match: ${text}`, async () => {
      const store = new CatalogDouble()
      store.add({ color: 'برتقالي' })
      const result = await store.service().matchVoiceSaleText(text, context())
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match?.quantity, 2)
      assert.equal(result.match?.size, 'XL')
      assert.equal(store.writes, 0)
    })
  }
  test('missing-size speech stays ambiguous when real variants differ by size', async () => {
    const store = new CatalogDouble()
    store.add({ color: 'Orange', size: 'XL', productId: uuid(42) })
    store.add({ color: 'Orange', size: 'XXL', productId: uuid(42) })
    const result = await store.service().matchVoiceSaleText('t chirt orange kt3ten', context())
    assert.equal(result.status, 'AMBIGUOUS')
    assert.equal(result.match, null)
    assert.ok(result.missingFields.includes('size'))
    assert.equal(result.parser.attributes.size.value, null)
  })
  test('empty, wrong-color and wrong-product catalogs never become forced matches', async () => {
    for (const options of [null, { color: 'Black' }, { name: 'Pants', color: 'Orange' }]) {
      const store = new CatalogDouble()
      if (options) store.add(options)
      const result = await store.service().matchVoiceSaleText('t chirt orange kt3ten', context())
      assert.equal(result.status, 'NOT_FOUND')
      assert.equal(result.match, null)
      assert.equal(store.writes, 0)
    }
  })
})

describe('active Product Types catalog matching', () => {
  for (const name of ['Chemise', 'tee-shirt', 'baby onesie', 'بودي بيبي']) {
    test(`an active concept grounds the actual catalog name: ${name}`, async () => {
      const store = new CatalogDouble()
      const row = store.add({ name })
      const result = await store.service().matchVoiceSaleText(`${name} black XL two pieces`, context())
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match!.variantId, row.id)
      assert.ok(result.match!.evidence.some(item => item.field === 'productType'))
      assert.ok(result.parser.productTypeCandidates!.every(item => item.result.candidates.every(candidate => candidate.reviewStatus === 'seed_review')))
      assert.equal(store.writes, 0)
    })
  }
  for (const [spoken, actual] of [['chemise', 'Shirt'], ['robe', 'Dress'], ['بودي', 'Bodysuit']]) {
    test(`authorized semantic equivalence matches ${spoken} to definite catalog concept ${actual}`, async () => {
      const store = new CatalogDouble()
      store.add({ name: actual })
      const result = await store.service().matchVoiceSaleText(`${spoken} black XL two pieces`, context())
      assert.equal(result.status, 'MATCHED')
      assert.ok(result.match)
      assert.deepEqual(result.missingFields, [])
      assert.equal(store.writes, 0)
    })
  }
  test('a unique variant with the same ambiguous spelling cannot choose a concept', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'robe' })
    const result = await store.service().matchVoiceSaleText('robe black XL two pieces', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.parser.attributes.productType.value, null)
    assert.deepEqual(result.parser.productTypeCandidates![0].result.candidates.map(item => item.sourceTypeId), ['DRESS', 'ROBE_HOME'])
    assert.equal(store.writes, 0)
  })
  test('source vocabulary never invents an absent product or ignores residual brand words', async () => {
    const store = new CatalogDouble()
    assert.equal((await store.service().matchVoiceSaleText('baby onesie black XL two pieces', context())).status, 'NOT_FOUND')
    store.add({ name: 'Chemise Cedar' })
    assert.equal((await store.service().matchVoiceSaleText('chemise Cedar black XL two pieces', context())).status, 'MATCHED')
    assert.equal((await store.service().matchVoiceSaleText('chemise UnknownBrand black XL two pieces', context())).status, 'NOT_FOUND')
  })
  for (const [speech, missing] of [['chemise black XL', 'quantity'], ['chemise black two pieces', 'size']]) {
    test(`seed catalog match preserves missing ${missing}`, async () => {
      const store = new CatalogDouble()
      store.add({ name: 'Chemise' })
      const result = await store.service().matchVoiceSaleText(speech, context())
      assert.equal(result.status, 'INCOMPLETE')
      assert.ok(result.missingFields.includes(missing as 'quantity' | 'size'))
      assert.equal(result.match, null)
    })
  }
  test('uniqueness, catalog coverage, price and stock still govern source candidates', async () => {
    const store = new CatalogDouble()
    const row = store.add({ name: 'Chemise', stock: 1 })
    const speech = 'chemise black XL two pieces'
    assert.equal((await store.service().matchVoiceSaleText(speech, context())).status, 'INSUFFICIENT_STOCK')
    row.currentStock = 10
    row.sellingPrice = null
    assert.equal((await store.service().matchVoiceSaleText(speech, context())).status, 'INCOMPLETE')
    assert.equal((await store.service().matchVoiceSaleText(speech, context(UserRole.WAREHOUSE))).status, 'NOT_FOUND')
    row.sellingPrice = new Prisma.Decimal('12.50')
    const reader: CatalogReader = { read: async () => ({ variants: [{ productId: row.product.id, variantId: row.id, sku: row.sku,
      productName: row.product.name, categoryName: 'Clothing', color: row.color, size: row.size,
      sellingPrice: '12.50', availableStock: 10, currency: 'USD' }], scannedVariants: 1, truncated: true }) }
    assert.equal((await createVoiceMatchingService(reader).matchVoiceSaleText(speech, context())).status, 'INCOMPLETE')
    store.add({ name: 'Chemise' })
    assert.equal((await store.service().matchVoiceSaleText(speech, context())).status, 'AMBIGUOUS')
    assert.equal(store.writes, 0)
  })
})

describe('dynamic catalog matching', () => {
  for (const sentence of [
    'T-Shirt Black XL 2 pieces', 'بدي تي شيرت سودا قياس XL قطعتين',
    'Bdi Tchirt Sawda XL Tnen pieces', 'قطعتين أسود XL T-shirt',
  ]) {
    test(`exact mixed-language request: ${sentence}`, async () => {
      const store = new CatalogDouble()
      const row = store.add()
      const result = await store.service().matchVoiceSaleText(sentence, context())
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match?.productId, row.product.id)
      assert.equal(result.match?.variantId, row.id)
      assert.equal(result.match?.quantity, 2)
      assert.equal(result.match?.sellingPrice, '12.50')
      assert.equal(result.match?.availableStock, 40)
      assert.equal(result.requiresConfirmation, true)
      assert.ok(result.match!.evidence.some(item => item.field === 'color' && item.source === 'variant_column'))
      assert.equal(store.writes, 0)
    })
  }
  test('a dynamic product name absent from the dictionary needs no hardcoded type', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Cedar Moonwalk', category: 'New collection' })
    const result = await store.service().matchVoiceSaleText('Cedar Moonwalk sawda XL two pieces', context())
    assert.equal(result.status, 'MATCHED')
    assert.equal(result.match?.productName, 'Cedar Moonwalk')
    assert.equal(result.parser.attributes.productType.status, 'missing')
    assert.deepEqual(result.parser.productNameResidualTokens.map(row => row.token), ['cedar', 'moonwalk'])
  })
  test('new Entry-created catalog records are read on the next request', async () => {
    const store = new CatalogDouble()
    const service = store.service()
    assert.equal((await service.matchVoiceSaleText('New Model black XL two pieces', context())).status, 'NOT_FOUND')
    store.add({ name: 'New Model' })
    assert.equal((await service.matchVoiceSaleText('New Model black XL two pieces', context())).status, 'MATCHED')
    assert.equal(store.calls.length, 2)
  })
  test('current stock and Decimal price are read anew on every request', async () => {
    const store = new CatalogDouble()
    const row = store.add()
    const service = store.service()
    assert.equal((await service.matchVoiceSaleText('Tshirt black XL two pieces', context())).status, 'MATCHED')
    row.currentStock = 1
    row.sellingPrice = new Prisma.Decimal('9999999999999999.99')
    const latest = await service.matchVoiceSaleText('Tshirt black XL two pieces', context())
    assert.equal(latest.status, 'INSUFFICIENT_STOCK')
    assert.equal(latest.match?.sellingPrice, '9999999999999999.99')
    assert.equal(latest.match?.availableStock, 1)
  })
  test('Arabic normalization and dictionary aliases bridge grounded product/color names', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'تي شيرت', color: 'أَسود' })
    assert.equal((await store.service().matchVoiceSaleText('T-shirt Sawda XL two pieces', context())).status, 'MATCHED')
  })
  test('an exact category type supports an actual dynamic name', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Moonwalk', category: 'تي شيرت' })
    const result = await store.service().matchVoiceSaleText('Tshirt Moonwalk black XL two pieces', context())
    assert.equal(result.status, 'MATCHED')
    assert.ok(result.match?.evidence.some(item => item.source === 'category_name'))
  })
  test('same type/color/size cannot equate distinct model names', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'T-Shirt Classic' })
    store.add({ name: 'T-Shirt Polo' })
    store.add({ name: 'T-Shirt Oversized' })
    const service = store.service()
    assert.equal((await service.matchVoiceSaleText('Tshirt black XL two pieces', context())).status, 'AMBIGUOUS')
    const exact = await service.matchVoiceSaleText('Tshirt Classic black XL two pieces', context())
    assert.equal(exact.status, 'MATCHED')
    assert.equal(exact.match?.productName, 'T-Shirt Classic')
    const polo = await service.matchVoiceSaleText('Tshirt Polo black XL two pieces', context())
    assert.equal(polo.status, 'MATCHED')
    assert.equal(polo.match?.productName, 'T-Shirt Polo')
    assert.ok(polo.parser.ambiguities.length > 0, 'catalog resolution must preserve parser ambiguity')
  })
  test('similar names remain distinct; partial names are suggestions only', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Tshirt Classic' })
    store.add({ name: 'Tshirt Classic Premium' })
    const service = store.service()
    const exact = await service.matchVoiceSaleText('Tshirt Classic black XL two pieces', context())
    assert.equal(exact.status, 'MATCHED')
    assert.equal(exact.match?.productName, 'Tshirt Classic')
    const partial = await service.matchVoiceSaleText('Tshirt Class black XL two pieces', context())
    assert.equal(partial.status, 'NOT_FOUND')
    assert.equal(partial.match, null)
    assert.equal(partial.suggestions.length, 2)
    assert.ok(partial.suggestions.every(row => row.evidence.some(item => item.source === 'partial_name_suggestion')))
  })
  test('reordered or repeated unknown model words cannot force an exact name match', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Cedar Moonwalk' })
    for (const name of ['Moonwalk Cedar', 'Cedar Cedar Moonwalk']) {
      const result = await store.service().matchVoiceSaleText(`${name} black XL two pieces`, context())
      assert.equal(result.status, 'NOT_FOUND')
      assert.equal(result.match, null)
      assert.equal(result.suggestions.length, 1)
    }
  })
  for (const size of ['XL', 'XXL', 'XXXL']) {
    test(`variant sizes never overlap: ${size}`, async () => {
      const store = new CatalogDouble()
      for (const stored of ['XL', 'XXL', 'XXXL']) store.add({ size: stored, productId: uuid(42) })
      const result = await store.service().matchVoiceSaleText(`Tshirt black ${size} two pieces`, context())
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match?.size, size)
    })
  }
  test('numeric size 32 and quantity 32 have separate contexts', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Jeans', size: '٣٢', color: 'كحلية', stock: 40 })
    const result = await store.service().matchVoiceSaleText('Jeans Kahle size 32 32 pieces', context())
    assert.equal(result.status, 'MATCHED')
    assert.equal(result.match?.size, '٣٢')
    assert.equal(result.match?.quantity, 32)
  })
  test('duplicate real variants stay ambiguous, even if only one has enough stock', async () => {
    const store = new CatalogDouble()
    store.add({ productId: uuid(42), stock: 0 })
    store.add({ productId: uuid(42), stock: 40 })
    const result = await store.service().matchVoiceSaleText('Tshirt black XL two pieces', context())
    assert.equal(result.status, 'AMBIGUOUS')
    assert.equal(result.match, null)
    assert.equal(result.candidates.length, 2)
  })
  test('missing quantity has no default', async () => {
    const store = new CatalogDouble()
    store.add()
    const result = await store.service().matchVoiceSaleText('Tshirt black XL', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.ok(result.missingFields.includes('quantity'))
    assert.equal(result.candidates[0].quantity, null)
    assert.equal(result.match, null)
  })
  test('multiple plausible candidates retain ambiguity and missing quantity together', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Tshirt Classic' })
    store.add({ name: 'Tshirt Premium' })
    const result = await store.service().matchVoiceSaleText('Tshirt black XL', context())
    assert.equal(result.status, 'AMBIGUOUS')
    assert.ok(result.missingFields.includes('quantity'))
    assert.ok(result.missingFields.includes('variant'))
    assert.ok(result.candidates.every(candidate => candidate.quantity === null))
    assert.equal(result.match, null)
  })
  test('missing size is not chosen from a unique variant', async () => {
    const store = new CatalogDouble()
    store.add()
    const result = await store.service().matchVoiceSaleText('Tshirt black two pieces', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.ok(result.missingFields.includes('size'))
    assert.equal(result.match, null)
  })
  test('missing color is not chosen from a unique variant', async () => {
    const store = new CatalogDouble()
    store.add()
    const result = await store.service().matchVoiceSaleText('Tshirt XL two pieces', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.ok(result.missingFields.includes('color'))
    assert.equal(result.match, null)
  })
  test('null variant attributes are not invented or unnecessarily required', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Cedar Model', color: null, size: null })
    const result = await store.service().matchVoiceSaleText('Cedar Model two pieces', context())
    assert.equal(result.status, 'MATCHED')
    assert.equal(result.match?.color, null)
    assert.equal(result.match?.size, null)
  })
  test('unknown brands/model terms cannot be discarded to force a type match', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Tshirt Classic' })
    const result = await store.service().matchVoiceSaleText('Tshirt UnrelatedBrand black XL two pieces', context())
    assert.equal(result.status, 'NOT_FOUND')
    assert.equal(result.parser.productNameResidualTokens[0].token, 'unrelatedbrand')
  })
  test('unsupported cross-language brand transliteration is not invented', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Tshirt Classic' })
    // Classic now has explicit fit candidates. Without a model cue it remains
    // ambiguous; a named brand is still a literal token, never transliterated.
    assert.equal((await store.service().matchVoiceSaleText('تي شيرت كلاسيك سودا XL قطعتين', context())).status, 'INCOMPLETE')
    assert.equal((await store.service().matchVoiceSaleText('تي شيرت ماركة كلاسيك سودا XL قطعتين', context())).status, 'NOT_FOUND')
  })
  test('available catalog candidates can resolve a Pants/Jeans alternative without choosing by order', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Jeans', size: '32' })
    const service = store.service()
    const result = await service.matchVoiceSaleText('بنطلون jeans سودا قياس 32 قطعتين', context())
    assert.equal(result.status, 'MATCHED')
    assert.equal(result.match?.productName, 'Jeans')
    assert.equal(result.parser.attributes.productType.status, 'ambiguous')
    store.add({ name: 'Pants', size: '32' })
    assert.equal((await service.matchVoiceSaleText('بنطلون jeans سودا قياس 32 قطعتين', context())).status, 'AMBIGUOUS')
  })
  for (const extra of ['velvet', 'slim fit', 'plain', 'crew neck']) {
    test(`unverified ${extra} remains a constraint, never a fake schema column`, async () => {
      const store = new CatalogDouble()
      store.add()
      const result = await store.service().matchVoiceSaleText(`Tshirt black XL two pieces ${extra}`, context())
      assert.equal(result.status, 'INCOMPLETE')
      assert.ok(result.candidates[0].unresolvedConstraints.length > 0)
      assert.equal(result.match, null)
    })
  }
  test('material, fit, pattern and neckline can be verified by explicit real product-name descriptors', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Tshirt Velvet Slim Fit Plain Crew Neck' })
    const result = await store.service().matchVoiceSaleText('تي شيرت مخمل ضيق سادة قبّة مبرومة سودا XL قطعتين', context())
    assert.equal(result.status, 'MATCHED')
    assert.deepEqual(result.match?.unresolvedConstraints, [])
  })
  test('explicit contrary catalog descriptors reject the candidate', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Tshirt Cotton' })
    assert.equal((await store.service().matchVoiceSaleText('Tshirt velvet black XL two pieces', context())).status, 'NOT_FOUND')
  })
  for (const stock of [0, 1]) {
    test(`stock ${stock} produces insufficient stock without mutation`, async () => {
      const store = new CatalogDouble()
      const row = store.add({ stock })
      const result = await store.service().matchVoiceSaleText('Tshirt black XL two pieces', context())
      assert.equal(result.status, 'INSUFFICIENT_STOCK')
      assert.equal(result.match?.availableStock, stock)
      assert.equal(row.currentStock, stock)
      assert.equal(store.writes, 0)
    })
  }
  test('empty, inactive and WAREHOUSE-unpriced catalogs have no eligible match', async () => {
    const store = new CatalogDouble()
    store.add({ active: false })
    store.add({ productActive: false })
    store.add({ price: null })
    store.add({ price: '0.00' })
    const result = await store.service().matchVoiceSaleText('Tshirt black XL two pieces', context(UserRole.WAREHOUSE))
    assert.equal(result.status, 'NOT_FOUND')
    assert.equal(result.candidates.length, 0)
    assert.equal((await new CatalogDouble().service().matchVoiceSaleText('Tshirt black XL two pieces', context())).status, 'NOT_FOUND')
  })
  test('OWNER unpriced variants require manual price, with actual DB price preserved', async () => {
    for (const price of [null, '0.00']) {
      const store = new CatalogDouble()
      store.add({ price })
      const result = await store.service().matchVoiceSaleText('Tshirt black XL two pieces', context())
      assert.equal(result.status, 'INCOMPLETE')
      assert.ok(result.missingFields.includes('selling_price'))
      assert.equal(result.candidates[0].sellingPrice, price)
    }
  })
  for (const input of ['Tshirt black white XL two pieces', 'Tshirt black XL XXL two pieces', 'Tshirt black XL one two pieces']) {
    test(`conflicting input is never silently filtered: ${input}`, async () => {
      const store = new CatalogDouble()
      store.add()
      const result = await store.service().matchVoiceSaleText(input, context())
      assert.equal(result.status, 'AMBIGUOUS')
      assert.equal(store.calls.length, 0)
      assert.equal(result.match, null)
      assert.ok(result.parser.ambiguities.some(issue => issue.kind === 'conflicting_attribute'))
    })
  }
  for (const input of ['Tshirt and pants', '', 'x'.repeat(4097), 'Tshirt\u0000black']) {
    test(`invalid/multiple-item text does not query the catalog: ${input.length}`, async () => {
      const store = new CatalogDouble()
      const result = await store.service().matchVoiceSaleText(input, context())
      assert.equal(result.status, 'INVALID_INPUT')
      assert.equal(store.calls.length, 0)
    })
  }
  for (const input of ['2', 'soda XL two pieces', 'not black Tshirt', 'size 42']) {
    test(`unresolved parser information cannot become a match: ${input}`, async () => {
      const store = new CatalogDouble()
      const result = await store.service().matchVoiceSaleText(input, context())
      assert.equal(result.status, 'INCOMPLETE')
      assert.equal(store.calls.length, 0)
    })
  }
})

describe('catalog scope, projection and bounded reads', () => {
  test('Tenant A cannot match or preview Tenant B products', async () => {
    const store = new CatalogDouble()
    const foreign = store.add({ tenant: accountB, name: 'Foreign Model' })
    const result = await store.service().matchVoiceSaleText('Foreign Model black XL two pieces', context())
    assert.equal(result.status, 'NOT_FOUND')
    assert.doesNotMatch(JSON.stringify(result), new RegExp(foreign.id))
    assert.equal((await store.service().matchVoiceSaleText('Foreign Model black XL two pieces', context(UserRole.OWNER, accountB))).status, 'MATCHED')
  })
  test('a repository scope violation fails closed', async () => {
    const store = new CatalogDouble()
    const foreign = store.add({ tenant: accountB })
    const client = { productVariant: { findMany: async () => [foreign] } } as unknown as PrismaClient
    await assert.rejects(createCatalogReader(client).read(context()), error => error instanceof HttpError && error.code === 'CATALOG_UNAVAILABLE')
  })
  test('service and reader require active OWNER/WAREHOUSE context before any query', async () => {
    const store = new CatalogDouble()
    const forbidden = [context(UserRole.SUPER_ADMIN), { ...context(), accountId: null },
      { ...context(), accountStatus: AccountStatus.SUSPENDED }, { ...context(), userId: '' }]
    for (const bad of forbidden) {
      await assert.rejects(store.service().matchVoiceSaleText('Tshirt', bad), error => error instanceof HttpError && error.status === 403)
      await assert.rejects(createCatalogReader(store.asClient()).read(bad), error => error instanceof HttpError && error.status === 403)
    }
    assert.equal(store.calls.length, 0)
  })
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
    test(`${role}: private costs/profit are neither selected nor serialized`, async () => {
      const store = new CatalogDouble()
      store.add()
      const result = await store.service().matchVoiceSaleText('Tshirt black XL two pieces', context(role))
      assert.equal(result.status, 'MATCHED')
      assert.doesNotMatch(JSON.stringify(store.calls[0].select), /lastPurchaseCost|profitMargin|unitCost|COGS/i)
      assert.doesNotMatch(JSON.stringify(result), /lastPurchaseCost|profitMargin|unitCost|COGS|grossProfit/i)
      assert.equal(store.writes, 0)
    })
  }
  test('large catalogs use bounded keyset pages, and truncated coverage never claims a unique match', async () => {
    const store = new CatalogDouble()
    for (let i = 0; i <= MAX_CATALOG_VARIANTS; i++) store.add()
    const result = await store.service().matchVoiceSaleText('Tshirt black XL two pieces', context())
    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.reason, 'CATALOG_COVERAGE_LIMIT')
    assert.equal(result.catalog.truncated, true)
    assert.equal(result.catalog.scannedVariants, MAX_CATALOG_VARIANTS)
    assert.ok(result.missingFields.includes('catalog_coverage'))
    assert.equal(result.candidates.length, 20)
    assert.equal(result.catalog.candidatesTruncated, true)
    assert.ok(store.calls.length <= 6)
    assert.ok(store.calls.slice(1).every(call => call.where?.OR))
    assert.equal(store.writes, 0)
  })
  test('exactly the catalog limit is complete and equal timestamps use the ID tiebreaker', async () => {
    const store = new CatalogDouble()
    for (let i = 0; i < MAX_CATALOG_VARIANTS; i++) {
      const row = store.add({ name: i === 0 ? 'Cedar Moonwalk' : 'Different Model' })
      row.createdAt = new Date(1_700_000_000_000)
    }
    const result = await store.service().matchVoiceSaleText('Cedar Moonwalk black XL two pieces', context())
    assert.equal(result.status, 'MATCHED')
    assert.equal(result.catalog.truncated, false)
    assert.equal(result.catalog.scannedVariants, MAX_CATALOG_VARIANTS)
    assert.equal(store.calls.length, 6)
    assert.equal(store.calls.at(-1)?.take, 1)
    assert.equal(store.writes, 0)
  })
})

function auth(role: UserRole, tenant = accountA, active = true): AuthDependencies {
  return {
    async verifyAccessToken(token) { return token === 'test' ? { id: userId, email: 'user@example.invalid', emailConfirmedAt: '2026-01-01', isAnonymous: false } : null },
    async findApplicationUser() { return { id: userId, role, accountId: role === UserRole.SUPER_ADMIN ? null : tenant, isActive: active } },
    async findAccountById(id) { return { id, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('Unused') },
  }
}
async function withApi<T>(store: CatalogDouble, role: UserRole, operation: (url: string) => Promise<T>,
  options: { expensiveMax?: number; active?: boolean; reader?: CatalogReader } = {}) {
  const config: AppRuntimeConfiguration = { corsAllowedOrigins: [], trustProxyHops: 0,
    generalRateLimitMax: 1000, writeRateLimitMax: 1000, expensiveRateLimitMax: options.expensiveMax ?? 30, imageRateLimitMax: 10 }
  const dependencies = { auth: auth(role, accountA, options.active ?? true), adminAccounts: {}, categories: {}, products: {},
    inventory: {}, sales: {}, returns: {}, voiceMatching: options.reader ? createVoiceMatchingService(options.reader) : store.service() } as unknown as AppDependencies
  const app = createApp(dependencies, config)
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  try { return await operation(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/voice-sales/match`) }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
const post = (url: string, body: unknown, token = 'test') => fetch(url, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })

/** Synthetic regressions only: these do not establish a live Supabase session. */
describe('Phase 1E requested sentences through the guarded API (synthetic catalog)', () => {
  const scenarios = [
    { text: 'بدي تي شيرت سودا XL قطعتين', name: 'T-Shirt', category: 'Clothing', color: 'Black', size: 'XL',
      status: 'MATCHED', productType: 'TSHIRT', quantity: 2 },
    { text: 'bdi tshirt black size xl 2 pieces', name: 'T-Shirt', category: 'Clothing', color: 'Black', size: 'XL',
      status: 'MATCHED', productType: 'TSHIRT', quantity: 2 },
    { text: 'بدي بنطلون جينز قياس W32 L30', name: 'Jeans', category: 'Jeans', color: null, size: 'W32/L30',
      status: 'INCOMPLETE', productType: 'JEANS', quantity: null },
    { text: 'بدي فستان ساتان خمري', name: 'Satin Dress', category: 'Dress', color: 'Burgundy', size: null,
      status: 'INCOMPLETE', productType: 'SATIN_DRESS', quantity: null },
    { text: 'بدي قميص قطن أبيض', name: 'Shirt cotton', category: 'Shirt', color: 'White', size: null,
      status: 'INCOMPLETE', productType: 'SHIRT', quantity: null },
    { text: 'بدي تي شيرت oversized', name: 'T-Shirt oversized', category: 'T-Shirt', color: null, size: null,
      status: 'INCOMPLETE', productType: 'TSHIRT', quantity: null },
    { text: 'بدي بلوزة موردة', name: 'Blouse floral print', category: 'Blouse', color: null, size: null,
      status: 'INCOMPLETE', productType: null, quantity: null },
    { text: 'ما بدي منقط، بدي مخطط', name: 'T-Shirt striped', category: 'T-Shirt', color: null, size: null,
      status: 'INCOMPLETE', productType: null, quantity: null },
  ] as const
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
    for (const [index, scenario] of scenarios.entries()) {
      test(`${role}: Phase 1E sentence ${index + 1}`, async () => {
        const store = new CatalogDouble()
        const own = store.add({ ...scenario, price: '1234567890123456.78', stock: 7 })
        const foreign = store.add({ ...scenario, tenant: accountB, price: '0.01', stock: 999 })
        await withApi(store, role, async url => {
          const response = await post(url, { text: scenario.text })
          assert.equal(response.status, 200)
          const result = await response.json() as VoiceSaleMatchResult
          assert.equal(result.status, scenario.status)
          assert.equal(result.parser.originalText, scenario.text)
          assert.equal(result.parser.sourceProductType?.value, scenario.productType)
          assert.equal(result.parser.attributes.quantity.value, scenario.quantity)
          assert.equal(result.requiresConfirmation, true)
          if (scenario.quantity === null) {
            assert.equal(result.match, null)
            assert.notEqual(result.parser.quantityIntent?.status, 'resolved')
          }
          const previews = [...result.candidates, ...result.suggestions, ...(result.match ? [result.match] : [])]
          for (const preview of previews) {
            assert.equal(preview.productId, own.product.id)
            assert.equal(preview.variantId, own.id)
            assert.equal(preview.availableStock, 7)
            assert.equal(preview.sellingPrice, '1234567890123456.78')
            assert.equal(preview.color, own.color)
            assert.equal(preview.size, own.size)
            assert.equal(preview.quantity, scenario.quantity)
            assert.equal(preview.requiresConfirmation, true)
          }
          if (index < 2) {
            assert.equal(result.match?.variantId, own.id)
            assert.equal(result.parser.attributes.productType.value, 'T_SHIRT')
            assert.equal(result.parser.sourceColorId?.value, 'BLACK')
            assert.equal(result.parser.attributes.size.value, 'XL')
            assert.equal(result.parser.sourceSizeId?.value, 'ALPHA_XL')
          } else if (index === 2) {
            assert.equal(result.parser.sourceSizeId?.value, 'JEANS_W32_L30')
            assert.equal(result.parser.attributes.size.value, null) // Additive composite contract.
            assert.deepEqual(result.missingFields, ['quantity'])
            assert.equal(result.candidates[0]?.variantId, own.id)
          } else if (index === 3) {
            assert.equal(result.parser.sourceColorId?.status, 'ambiguous')
            assert.deepEqual(result.parser.sourceColorId?.candidates, ['BORDEAUX', 'BURGUNDY', 'MAROON_RED', 'WINE_RED'])
            assert.ok(result.candidates[0]?.evidence.some(e => e.field === 'color' && e.requested === 'BURGUNDY'))
            assert.ok(result.missingFields.includes('quantity'))
          } else if (index === 4) {
            assert.equal(result.parser.sourceMaterial?.value, 'COTTON')
            assert.equal(result.parser.sourceColorId?.value, 'WHITE')
            assert.ok(result.candidates[0]?.evidence.some(e => e.field === 'material' && e.source === 'product_name'))
          } else if (index === 5) {
            assert.equal(result.parser.sourceFitCuts?.fit.value, 'FIT_OVERSIZED')
            assert.ok(result.candidates[0]?.evidence.some(e => e.field === 'fit' && e.source === 'product_name'))
          } else if (index === 6) {
            assert.deepEqual(result.parser.sourceProductType?.candidates, ['BLOUSE', 'TOP'])
            assert.ok(result.parser.patternCandidates?.some(p => p.result.patterns.includes('FLORAL_GENERIC')))
            assert.equal(result.parser.sourcePatternId?.value, null)
            assert.ok(result.missingFields.includes('pattern'))
          } else {
            assert.equal(result.catalog.scannedVariants, 0)
            assert.equal(store.calls.length, 0)
            assert.equal(previews.length, 0)
            assert.equal(result.parser.commonExpressionSafety?.salePreviewAllowed, false)
            assert.ok(result.parser.patternCandidates?.some(p => p.text === 'منقط' && p.polarity === 'negated'))
            assert.ok(result.parser.patternCandidates?.some(p => p.text === 'مخطط' && p.polarity === 'affirmative'))
          }
          for (const forbidden of [foreign.id, accountB, 'lastPurchaseCost', 'profitMarginOverride', 'unitCost', '0.01']) {
            assert.ok(!JSON.stringify(result).includes(forbidden), `Forbidden projection: ${forbidden}`)
          }
        })
        assert.ok(store.calls.every(call => call.where?.accountId === accountA))
        assert.equal(store.writes, 0)
        assert.equal(own.currentStock, 7)
        assert.equal(own.sellingPrice?.toFixed(2), '1234567890123456.78')
      })
    }
  }
})

describe('read-only matching API security', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`imported composite size preserves ${role} tenant isolation, Decimal price and zero writes`, async () => {
    const store = new CatalogDouble()
    const local = store.add({ name: 'Jeans', size: 'W32 L30', price: '9999999999999999.99' })
    const foreign = store.add({ name: 'Jeans', size: 'W32 L30', tenant: accountB })
    await withApi(store, role, async url => {
      const response = await post(url, { text: 'Jeans black W32/L30 two pieces' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.parser.sourceSizeId?.value, 'JEANS_W32_L30')
      assert.equal(result.parser.attributes.size.value, null)
      assert.equal(result.match?.variantId, local.id)
      assert.equal(result.match?.size, 'W32 L30')
      assert.equal(result.match?.sellingPrice, '9999999999999999.99')
      assert.equal(result.requiresConfirmation, true)
      for (const forbidden of [foreign.id, accountB, 'lastPurchaseCost', 'profitMarginOverride']) assert.ok(!JSON.stringify(result).includes(forbidden))
    })
    assert.equal(store.writes, 0)
  })
  test('numeric size standard ambiguity survives API serialization without a fabricated match', async () => {
    const store = new CatalogDouble()
    store.add({ name: 'Shoes', size: 'EU 38' })
    await withApi(store, UserRole.WAREHOUSE, async url => {
      const result = await (await post(url, { text: 'Shoes black 38 two pieces' })).json() as VoiceSaleMatchResult
      // Independent explicit merchant EU evidence may ground the candidate;
      // the parser itself never assumes a standard from the bare number.
      assert.equal(result.parser.sourceSizeId?.value, null)
      assert.ok(result.parser.sourceSizeId?.candidates.includes('SHOES_EU_38'))
      assert.equal(result.match?.size, 'EU 38')
    })
    assert.equal(store.writes, 0)
  })
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`precise imported color retains ${role} tenant isolation, Decimal price and zero writes`, async () => {
    const store = new CatalogDouble()
    const local = store.add({ color: 'Dusty Rose', price: '9999999999999999.99' })
    const foreign = store.add({ color: 'Dusty Rose', tenant: accountB })
    await withApi(store, role, async url => {
      const response = await post(url, { text: 'Tshirt color dusty rose XL two pieces' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.parser.sourceColorId?.value, 'DUSTY_ROSE')
      assert.equal(result.parser.attributes.color.value, null)
      assert.equal(result.match?.variantId, local.id)
      assert.equal(result.match?.color, 'Dusty Rose')
      assert.equal(result.match?.sellingPrice, '9999999999999999.99')
      assert.equal(result.requiresConfirmation, true)
      for (const forbidden of [foreign.id, accountB, 'lastPurchaseCost', 'profitMarginOverride']) assert.ok(!JSON.stringify(result).includes(forbidden))
    })
    assert.equal(store.writes, 0)
  })
  test('ambiguous colors remain alternatives through API serialization', async () => {
    const store = new CatalogDouble()
    store.add({ color: 'Khaki Green' }); store.add({ color: 'Khaki Beige' })
    await withApi(store, UserRole.WAREHOUSE, async url => {
      const result = await (await post(url, { text: 'Tshirt color kaki XL two pieces' })).json() as VoiceSaleMatchResult
      assert.equal(result.status, 'AMBIGUOUS')
      assert.equal(result.match, null)
      assert.deepEqual(result.parser.sourceColorId?.candidates, ['KHAKI_BEIGE', 'KHAKI_GREEN'])
    })
    assert.equal(store.writes, 0)
  })
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`active precise source concept keeps ${role} tenant isolation and zero writes`, async () => {
    const store = new CatalogDouble()
    const local = store.add({ name: 'Cargo pants' })
    const foreign = store.add({ name: 'Cargo pants', tenant: accountB })
    await withApi(store, role, async url => {
      const response = await post(url, { text: 'بنطلون كارغو black XL two pieces' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.parser.sourceProductType?.value, 'CARGO_PANTS')
      assert.equal(result.match?.variantId, local.id)
      assert.equal(result.requiresConfirmation, true)
      for (const privateValue of [foreign.id, accountB, 'lastPurchaseCost', 'profitMarginOverride']) {
        assert.ok(!JSON.stringify(result).includes(privateValue))
      }
    })
    assert.equal(store.writes, 0)
  })
  test('seed candidates reach the existing API without tenant leakage or private financial data', async () => {
    const store = new CatalogDouble()
    const local = store.add({ name: 'Chemise' })
    const foreign = store.add({ name: 'Chemise', tenant: accountB })
    await withApi(store, UserRole.WAREHOUSE, async url => {
      const response = await post(url, { text: 'chemise black XL two pieces' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match!.variantId, local.id)
      assert.equal(result.parser.productTypeCandidates![0].result.candidates[0].sourceTypeId, 'SHIRT')
      const encoded = JSON.stringify(result)
      for (const privateValue of [foreign.id, accountB, 'lastPurchaseCost', 'profitMarginOverride']) assert.ok(!encoded.includes(privateValue))
    })
    assert.equal(store.writes, 0)
  })
  test('the Lab endpoint returns ORANGE and explicit quantity 2, with missing size preserved', async () => {
    const store = new CatalogDouble()
    store.add({ color: 'برتقالية' })
    await withApi(store, UserRole.WAREHOUSE, async url => {
      const response = await post(url, { text: 't chirt orange kt3ten' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'INCOMPLETE')
      assert.equal(result.parser.attributes.productType.value, 'T_SHIRT')
      assert.equal(result.parser.attributes.color.value, 'ORANGE')
      assert.equal(result.parser.attributes.quantity.value, 2)
      assert.equal(result.parser.attributes.size.value, null)
      assert.deepEqual(result.missingFields, ['size'])
      assert.equal(result.match, null)
    })
    assert.equal(store.writes, 0)
  })
  test('WAREHOUSE uses server-authenticated tenant context and receives a safe preview', async () => {
    const store = new CatalogDouble()
    store.add()
    await withApi(store, UserRole.WAREHOUSE, async url => {
      const response = await post(url, { text: 'Tshirt black XL two pieces' })
      assert.equal(response.status, 200)
      const result = await response.json() as VoiceSaleMatchResult
      assert.equal(result.status, 'MATCHED')
      assert.equal(result.match?.sellingPrice, '12.50')
      assert.doesNotMatch(JSON.stringify(result), /lastPurchaseCost|profitMargin|COGS|unitCost/i)
    })
    assert.equal(store.writes, 0)
  })
  for (const role of [UserRole.SUPER_ADMIN, UserRole.OWNER]) {
    test(`unauthorized ${role}/inactive user cannot access matching`, async () => {
      const store = new CatalogDouble()
      await withApi(store, role, async url => {
        assert.equal((await post(url, { text: 'Tshirt' })).status, 403)
      }, { active: role === UserRole.SUPER_ADMIN })
      assert.equal(store.calls.length, 0)
    })
  }
  test('missing/invalid Bearer tokens are rejected', async () => {
    const store = new CatalogDouble()
    await withApi(store, UserRole.OWNER, async url => {
      for (const token of ['', 'invalid']) assert.equal((await post(url, { text: 'Tshirt' }, token)).status, 401)
    })
    assert.equal(store.calls.length, 0)
  })
  test('client accountId, pre-parsed attributes and query scope are rejected', async () => {
    const store = new CatalogDouble()
    await withApi(store, UserRole.OWNER, async url => {
      for (const body of [{ text: 'Tshirt', accountId: accountB }, { text: 'Tshirt', attributes: { size: 'XL' } }, { text: 32 }, {}]) {
        assert.equal((await post(url, body)).status, 422)
      }
      assert.equal((await post(`${url}?accountId=${accountB}`, { text: 'Tshirt' })).status, 422)
      assert.equal((await post(url, { text: 'x'.repeat(4097) })).status, 422)
      assert.equal((await post(url, { text: '' })).status, 422)
    })
    assert.equal(store.calls.length, 0)
  })
  test('matching inherits the existing costly-read rate limit', async () => {
    const store = new CatalogDouble()
    store.add()
    await withApi(store, UserRole.OWNER, async url => {
      assert.equal((await post(url, { text: 'Tshirt black XL two pieces' })).status, 200)
      const limited = await post(url, { text: 'Tshirt black XL two pieces' })
      assert.equal(limited.status, 429)
      assert.ok(limited.headers.get('Retry-After'))
      assert.equal((await limited.json()).error.code, 'RATE_LIMIT_EXCEEDED')
    }, { expensiveMax: 1 })
    assert.equal(store.calls.length, 1)
  })
  test('Express-compatible path case and trailing slash cannot bypass the costly-read limit', async () => {
    const store = new CatalogDouble()
    store.add()
    await withApi(store, UserRole.OWNER, async url => {
      const alternate = url.replace('/api/voice-sales/match', '/API/VOICE-SALES/MATCH/')
      assert.equal((await post(alternate, { text: 'Tshirt black XL two pieces' })).status, 200)
      assert.equal((await post(url, { text: 'Tshirt black XL two pieces' })).status, 429)
    }, { expensiveMax: 1 })
    assert.equal(store.calls.length, 1)
  })
  test('unexpected reader failures use the existing sanitized error envelope', async () => {
    const store = new CatalogDouble()
    await withApi(store, UserRole.OWNER, async url => {
      const response = await post(url, { text: 'Tshirt black XL two pieces' })
      assert.equal(response.status, 500)
      assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } })
    }, { reader: { async read() { throw new Error('PRIVATE_DATABASE_DETAIL') } } })
  })
})
