import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { receiptFingerprint, receiptMovementIdentity, type parseReceipt, type parseReceivingSetup } from './receipt.schemas.js'

type ReceiptInput = ReturnType<typeof parseReceipt>
type Setup = ReturnType<typeof parseReceivingSetup>
type Tx = Prisma.TransactionClient
const include = { items: { include: { variant: { select: { sku: true, color: true, size: true } } } }, product: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } } as const
type Receipt = Prisma.StockReceiptGetPayload<{ include: typeof include }>
function view(row: Receipt, owner: boolean) {
  const totalQuantity = row.items.reduce((sum, item) => sum + item.quantity, 0)
  const totalCost = row.items.reduce((sum, item) => sum.add(item.unitCost.mul(item.quantity)), new Prisma.Decimal(0)).toFixed(4)
  return { id: row.id, productId: row.productId, productName: row.product.name, createdAt: row.createdAt, actor: [row.createdBy.firstName,row.createdBy.lastName].join(' '), totalQuantity,
    ...(owner ? { totalCost } : {}), items: row.items.map(item => ({ variantId: item.variantId, sku: item.variant.sku, color: item.variant.color, size: item.variant.size, quantity: item.quantity, ...(owner ? { unitCost: item.unitCost.toFixed(4) } : {}) })) }
}
function conflict() { return new HttpError(409, 'RECEIPT_IDEMPOTENCY_CONFLICT', 'Operation key belongs to different receiving details') }
export function createReceiptDependencies(prisma: PrismaClient) {
  async function lockOperation(tx: Tx, accountId: string, key: string) {
    // Prisma's interactive-transaction timeout does not cancel a PostgreSQL
    // statement already waiting on a row/advisory lock. Keep lock waits below
    // the 15-second transaction budget so contention fails and rolls back.
    await tx.$queryRaw<{ lockTimeout: string }[]>(Prisma.sql`SELECT set_config('lock_timeout', '14000ms', true) AS "lockTimeout"`)
    // PostgreSQL returns `void` from pg_advisory_xact_lock, which Prisma cannot
    // deserialize. Calling it as a table function keeps the transaction lock
    // semantics while exposing only a supported text result to the adapter.
    await tx.$queryRaw<{ locked: string }[]>(Prisma.sql`SELECT 'locked'::text AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`receiving:${accountId}:${key}`}, 0))`)
  }
  async function replay(tx: Tx, accountId: string, key: string, fingerprint: string) {
    const existing = await tx.stockReceipt.findUnique({ where: { accountId_operationId: { accountId, operationId: key } }, include })
    if (!existing) return null
    if (existing.requestFingerprint !== fingerprint) throw conflict()
    return { productId: existing.productId, receipt: view(existing, true), idempotentReplay: true }
  }
  async function receive(tx: Tx, accountId: string, userId: string, productId: string, key: string, fingerprint: string, input: ReceiptInput) {
    const products = await tx.$queryRaw<{isActive: boolean}[]>(Prisma.sql`SELECT "isActive" FROM "Product" WHERE "id"=${productId}::uuid AND "accountId"=${accountId}::uuid FOR UPDATE`)
    if (!products.length) throw new HttpError(404,'PRODUCT_NOT_FOUND','Product is unavailable')
    if (!products[0].isActive) throw new HttpError(409,'PRODUCT_INACTIVE','Reactivate product first')
    const ids = input.items.map(item => item.id).sort()
    const variants = await tx.$queryRaw<{id:string;isActive:boolean;currentStock:number}[]>(Prisma.sql`SELECT "id","isActive","currentStock" FROM "ProductVariant" WHERE "accountId"=${accountId}::uuid AND "productId"=${productId}::uuid AND "id" IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`)
    for (const item of input.items) {
      const variant = variants.find(v=>v.id===item.id)
      if (!variant) throw new HttpError(404,'VARIANT_NOT_FOUND','Option is unavailable')
      if (!variant.isActive) throw new HttpError(409,'VARIANT_INACTIVE','Reactivate option first')
      if (variant.currentStock > 2147483647-item.quantity) throw new HttpError(409,'STOCK_LIMIT_EXCEEDED','Stock limit exceeded')
    }
    const receipt = await tx.stockReceipt.create({ data: { accountId,productId,createdById:userId,operationId:key,requestFingerprint:fingerprint } })
    for (const item of input.items) {
      await tx.productVariant.update({ where:{id_productId_accountId:{id:item.id,productId,accountId}}, data:{currentStock:{increment:item.quantity},lastPurchaseCost:input.unitCost} })
      // Receipt replay is guarded by the receipt operation/fingerprint. Each
      // linked RESTOCK also receives its own deterministic ledger identity so
      // it satisfies the existing movement-level RESTOCK database contract.
      const movementIdentity = receiptMovementIdentity(accountId,userId,key,productId,item,input.unitCost)
      const movement = await tx.inventoryMovement.create({data:{accountId,variantId:item.id,type:'RESTOCK',quantityChange:item.quantity,unitCost:input.unitCost,performedById:userId,note:`Receipt ${receipt.id}`,...movementIdentity}})
      await tx.stockReceiptItem.create({data:{accountId,productId,receiptId:receipt.id,variantId:item.id,movementId:movement.id,quantity:item.quantity,unitCost:input.unitCost}})
    }
    return tx.stockReceipt.findUniqueOrThrow({where:{id:receipt.id},include})
  }
  async function receiveExisting(accountId:string,userId:string,productId:string,key:string,input:ReceiptInput) {
    const fingerprint=receiptFingerprint(accountId,userId,'existing',{productId,...input})
    return prisma.$transaction(async tx=>{
      await lockOperation(tx,accountId,key)
      const previous=await replay(tx,accountId,key,fingerprint)
      if(previous) return previous
      if(await tx.product.findUnique({where:{accountId_creationOperationId:{accountId,creationOperationId:key}}})) throw conflict()
      const row=await receive(tx,accountId,userId,productId,key,fingerprint,input)
      return {productId,receipt:view(row,true),idempotentReplay:false}
    },{timeout:15000})
  }
  async function createSetup(accountId:string,userId:string,role:UserRole,key:string,input:Setup) {
    const fingerprint=receiptFingerprint(accountId,userId,'new',input)
    return prisma.$transaction(async tx=>{
      await lockOperation(tx,accountId,key)
      const previous=await tx.product.findUnique({where:{accountId_creationOperationId:{accountId,creationOperationId:key}}})
      if(previous){
        if(previous.creationFingerprint!==fingerprint) throw conflict()
        const receipt=await replay(tx,accountId,key,fingerprint)
        return receipt ?? {productId:previous.id,receipt:null,idempotentReplay:true}
      }
      if(await tx.stockReceipt.findUnique({where:{accountId_operationId:{accountId,operationId:key}}})) throw conflict()
      const category=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT "id" FROM "Category" WHERE "id"=${input.product.categoryId}::uuid AND "accountId"=${accountId}::uuid AND "isActive"=true FOR SHARE`)
      if(!category.length) throw new HttpError(404,'CATEGORY_NOT_FOUND','Active category is unavailable')
      const product=await tx.product.create({data:{...input.product,accountId,createdById:userId,creationOperationId:key,creationFingerprint:fingerprint}})
      const variants=input.variants.map(({openingStock: _openingStock,...v})=>({ ...v,id:randomUUID(),accountId,productId:product.id,currentStock:0,lastPurchaseCost:null }))
      await tx.productVariant.createMany({data:variants})
      if(!input.receipt) return {productId:product.id,receipt:null,idempotentReplay:false}
      if(role!==UserRole.OWNER) throw new HttpError(403,'ROLE_FORBIDDEN','Owner required')
      const receipt=await receive(tx,accountId,userId,product.id,key,fingerprint,{unitCost:input.receipt.unitCost,items:input.receipt.items.map(item=>({id:variants.find(v=>v.sku===item.id)!.id,quantity:item.quantity}))})
      return {productId:product.id,receipt:view(receipt,true),idempotentReplay:false}
    },{timeout:15000}).catch(error=>{
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') {
        const target=Array.isArray(error.meta?.target)?error.meta.target:[]
        if(target.includes('sku'))throw new HttpError(409,'VARIANT_SKU_ALREADY_EXISTS','SKU already exists in this account')
        if(target.includes('barcode'))throw new HttpError(409,'VARIANT_BARCODE_ALREADY_EXISTS','Barcode already exists in this account')
      }
      throw error
    })
  }
  async function history(accountId:string,owner:boolean,page:number) {
    const rows=await prisma.stockReceipt.findMany({where:{accountId},include,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:21})
    return {receipts:rows.slice(0,20).map(row=>view(row,owner)),hasMore:rows.length>20,page}
  }
  async function recover(accountId:string,userId:string,key:string) {
    const row=await prisma.stockReceipt.findUnique({where:{accountId_operationId:{accountId,operationId:key}},include})
    if(row && row.createdById===userId) return {productId:row.productId,receipt:view(row,true),idempotentReplay:true}
    const product=await prisma.product.findUnique({where:{accountId_creationOperationId:{accountId,creationOperationId:key}}})
    if(product && product.createdById===userId) return {productId:product.id,receipt:null,idempotentReplay:true}
    throw new HttpError(404,'RECEIPT_NOT_FOUND','Operation is not confirmed')
  }
  return {receiveExisting,createSetup,history,recover}
}
export type ReceiptDependencies = ReturnType<typeof createReceiptDependencies>
