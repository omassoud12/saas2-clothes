import test from 'node:test'
import assert from 'node:assert/strict'
import {parseReceipt,parseReceivingSetup,receiptFingerprint,receiptMovementIdentity} from './receipt.schemas.js'
import {createReceiptDependencies} from './receipt.service.js'
import {Prisma, type PrismaClient} from '../generated/prisma/client.js'
import {UserRole} from '../generated/prisma/enums.js'
const id='11111111-1111-4111-8111-111111111111'
test('receipt parses exact Decimal cost and whole positive quantities',()=>{
  assert.deepEqual(parseReceipt({unitCost:'1.2345',items:[{variantId:id,quantity:40}]}),{unitCost:'1.2345',items:[{id,quantity:40}]})
  for(const quantity of [-1,0,1.5,1000001])assert.throws(()=>parseReceipt({unitCost:'1',items:[{variantId:id,quantity}]}))
  assert.throws(()=>parseReceipt({unitCost:'0',items:[{variantId:id,quantity:1}]}))
})
test('receipt rejects duplicate options, tenant injection and unknown fields',()=>{
  assert.throws(()=>parseReceipt({unitCost:'1',items:[{variantId:id,quantity:1},{variantId:id,quantity:2}]}))
  assert.throws(()=>parseReceipt({accountId:id,unitCost:'1',items:[{variantId:id,quantity:1}]}))
})
test('new setup rejects implicit stock, duplicate combinations and warehouse receipt',()=>{
  const product={name:'Shirt',categoryId:id}
  const variants=[{sku:'A',color:'Black',size:'M'}]
  assert.equal(parseReceivingSetup({product,variants},false).receipt,null)
  assert.throws(()=>parseReceivingSetup({product,variants:[{...variants[0],openingStock:true}]},true))
  assert.throws(()=>parseReceivingSetup({product,variants:[...variants,{sku:'B',color:' black ',size:'m'}]},true))
  assert.throws(()=>parseReceivingSetup({product,variants,receipt:{unitCost:'1',items:[{sku:'A',quantity:1}]}},false))
})
test('fingerprint changes with actor, tenant or receiving details',()=>{
  const original=receiptFingerprint('tenant','user','existing',{quantity:1})
  for(const args of [['other','user','existing',{quantity:1}],['tenant','other','existing',{quantity:1}],['tenant','user','existing',{quantity:2}]] as const)assert.notEqual(receiptFingerprint(args[0],args[1],args[2],args[3]),original)
})
test('receipt movement identity is deterministic and separates ledger scope from request details',()=>{
  const original=receiptMovementIdentity('TENANT','USER',id,'PRODUCT',{id,quantity:2},'1.2345')
  const replay=receiptMovementIdentity('tenant','user',id,'product',{id,quantity:2},'1.2345')
  assert.deepEqual(replay,original)
  assert.match(original.idempotencyKey,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(original.requestFingerprint,/^[0-9a-f]{64}$/)
  const correctedQuantity=receiptMovementIdentity('tenant','user',id,'product',{id,quantity:3},'1.2345')
  assert.equal(correctedQuantity.idempotencyKey,original.idempotencyKey)
  assert.notEqual(correctedQuantity.requestFingerprint,original.requestFingerprint)
  const otherVariant=receiptMovementIdentity('tenant','user',id,'product',{id:'22222222-2222-4222-8222-222222222222',quantity:2},'1.2345')
  assert.notEqual(otherVariant.idempotencyKey,original.idempotencyKey)
})
test('receipt transaction bounds lock waits and does not expose PostgreSQL void to Prisma',async()=>{
  const queries:string[]=[]
  const prisma={$transaction:async(action:(tx:unknown)=>Promise<unknown>)=>action({
    $queryRaw:async(query:Prisma.Sql)=>{queries.push(query.sql);return []},
    stockReceipt:{findUnique:async()=>null},
    product:{findUnique:async()=>{throw new Error('stop after lock setup')}},
  })} as unknown as PrismaClient
  const service=createReceiptDependencies(prisma)
  const input=parseReceipt({unitCost:'1',items:[{variantId:id,quantity:1}]})
  await assert.rejects(service.receiveExisting('tenant','user','product',id,input),/stop after lock setup/)
  assert.match(queries[0],/set_config\('lock_timeout', '14000ms', true\)/)
  assert.match(queries[1],/SELECT 'locked'::text AS "locked" FROM pg_advisory_xact_lock/)
})

function fixture(failItem=false, initialStocks:Record<string,number>={[id]:3}) {
  let state={stocks:{...initialStocks},movementRows:[] as Record<string,unknown>[],itemRows:[] as Record<string,unknown>[],receipt:null as null | Record<string,unknown>}
  const prisma={ $transaction:async(action:(tx:unknown)=>Promise<unknown>)=>{
    const working=structuredClone(state)
    const variantIds=Object.keys(working.stocks)
    const row=()=>({...working.receipt,id:'receipt',productId:'product',createdById:'user',createdAt:new Date(),product:{name:'Shirt'},createdBy:{firstName:'Owner',lastName:'Test'},items:working.itemRows.map((item,index)=>({
      variantId:String(item.variantId),quantity:Number(item.quantity),unitCost:new Prisma.Decimal(String(item.unitCost)),
      variant:{sku:`SKU-${index+1}`,color:index?'Navy':'Black',size:index?'L':'M'},
    }))})
    const tx={
      $queryRaw:async(query:Prisma.Sql)=>{
        if(query.sql.includes('pg_advisory'))return []
        if(query.sql.includes('FROM "Product"'))return query.values.includes('tenant')?[{isActive:true}]:[]
        return variantIds.map(variantId=>({id:variantId,isActive:true,currentStock:working.stocks[variantId]}))
      },
      product:{findUnique:async()=>null},
      stockReceipt:{findUnique:async()=>working.receipt?row():null,create:async({data}:{data:Record<string,unknown>})=>{working.receipt=data;return {id:'receipt'}},findUniqueOrThrow:async()=>row()},
      productVariant:{update:async({where,data}:{where:{id_productId_accountId:{id:string}};data:{currentStock:{increment:number}}})=>{working.stocks[where.id_productId_accountId.id]+=data.currentStock.increment}},
      inventoryMovement:{create:async({data}:{data:Record<string,unknown>})=>{working.movementRows.push(data);return {id:`movement-${working.movementRows.length}`}}},
      stockReceiptItem:{create:async({data}:{data:Record<string,unknown>})=>{if(failItem)throw new Error('item failed');working.itemRows.push(data)}},
    }
    const result=await action(tx);state=working;return result
  }} as unknown as PrismaClient
  return {service:createReceiptDependencies(prisma),state:()=>state}
}
test('receipt commits stock, movement and item together; replay does not repeat writes',async()=>{
  const f=fixture(), input=parseReceipt({unitCost:'1.2345',items:[{variantId:id,quantity:2}]})
  const first=await f.service.receiveExisting('tenant','user','product',id,input)
  assert.equal(first.idempotentReplay,false);assert.equal(first.receipt.totalCost,'2.4690')
  assert.equal(f.state().movementRows.length,1);assert.equal(f.state().itemRows.length,1)
  assert.match(String(f.state().movementRows[0].idempotencyKey),/^[0-9a-f-]{36}$/)
  assert.match(String(f.state().movementRows[0].requestFingerprint),/^[0-9a-f]{64}$/)
  assert.equal(f.state().itemRows[0].movementId,'movement-1')
  assert.equal(f.state().itemRows[0].variantId,f.state().movementRows[0].variantId)
  const replay=await f.service.receiveExisting('tenant','user','product',id,input)
  assert.equal(replay.idempotentReplay,true);assert.equal(f.state().stocks[id],5);assert.equal(f.state().movementRows.length,1)
  const changed=parseReceipt({unitCost:'1.2345',items:[{variantId:id,quantity:3}]})
  await assert.rejects(f.service.receiveExisting('tenant','user','product',id,changed),{code:'RECEIPT_IDEMPOTENCY_CONFLICT'})
  await assert.rejects(f.service.receiveExisting('tenant','other','product',id,input),{code:'RECEIPT_IDEMPOTENCY_CONFLICT'})
})
test('multi-option receipt creates one linked RESTOCK per option and increments each stock once',async()=>{
  const second='22222222-2222-4222-8222-222222222222'
  const f=fixture(false,{[id]:3,[second]:7})
  const input=parseReceipt({unitCost:'2.5000',items:[{variantId:id,quantity:2},{variantId:second,quantity:4}]})
  const result=await f.service.receiveExisting('tenant','user','product',id,input)
  assert.equal(result.receipt.totalQuantity,6);assert.equal(result.receipt.totalCost,'15.0000')
  assert.deepEqual(f.state().stocks,{[id]:5,[second]:11})
  assert.equal(f.state().movementRows.length,2);assert.equal(f.state().itemRows.length,2)
  assert.equal(new Set(f.state().movementRows.map(row=>row.idempotencyKey)).size,2)
  for(const item of f.state().itemRows){
    const movement=f.state().movementRows.find((_row,index)=>`movement-${index+1}`===item.movementId)
    assert.ok(movement);assert.equal(item.variantId,movement.variantId);assert.equal(item.quantity,movement.quantityChange);assert.equal(item.unitCost,movement.unitCost)
  }
  await f.service.receiveExisting('tenant','user','product',id,input)
  assert.deepEqual(f.state().stocks,{[id]:5,[second]:11});assert.equal(f.state().movementRows.length,2)
})
test('item failure rolls back every write and foreign tenant cannot change stock',async()=>{
  const input=parseReceipt({unitCost:'1',items:[{variantId:id,quantity:2}]})
  const failed=fixture(true)
  await assert.rejects(failed.service.receiveExisting('tenant','user','product',id,input))
  assert.deepEqual(failed.state(),{stocks:{[id]:3},movementRows:[],itemRows:[],receipt:null})
  const foreign=fixture()
  await assert.rejects(foreign.service.receiveExisting('foreign','user','product',id,input),{code:'PRODUCT_NOT_FOUND'})
  assert.equal(foreign.state().stocks[id],3)
})
test('warehouse receipt history omits all purchase cost values and scopes the query',async()=>{
  let where:unknown
  const prisma={stockReceipt:{findMany:async(query:{where:unknown})=>{
    where=query.where
    return [{id:'receipt',productId:id,createdAt:new Date(),product:{name:'Shirt'},createdBy:{firstName:'Owner',lastName:'Test'},items:[{variantId:id,quantity:2,unitCost:new Prisma.Decimal('1.2345'),variant:{sku:'A',color:'Black',size:'M'}}]}]
  }}} as unknown as PrismaClient
  const service=createReceiptDependencies(prisma)
  const warehouse=await service.history('tenant',false,1)
  assert.deepEqual(where,{accountId:'tenant'})
  assert.equal(warehouse.receipts[0].totalQuantity,2)
  assert.doesNotMatch(JSON.stringify(warehouse),/unitCost|totalCost|1\.2345/)
  assert.equal((await service.history('tenant',true,1)).receipts[0].totalCost,'2.4690')
})
test('save-only creation replays one zero-stock definition; failed initial receipt rolls creation back',async()=>{
  let committed:{product:Record<string,unknown>|null;variants:Record<string,unknown>[]}={product:null,variants:[]}
  const prisma={$transaction:async(action:(tx:unknown)=>Promise<unknown>)=>{
    const working=structuredClone(committed)
    const tx={
      $queryRaw:async(query:Prisma.Sql)=>{
        if(query.sql.includes('set_config')||query.sql.includes('pg_advisory'))return []
        if(query.sql.includes('Category'))return [{id}]
        throw new Error('initial receipt failed')
      },
      product:{findUnique:async()=>working.product,create:async({data}:{data:Record<string,unknown>})=>{working.product={...data,id};return working.product}},
      productVariant:{createMany:async({data}:{data:Record<string,unknown>[]})=>{working.variants=data}},
      stockReceipt:{findUnique:async()=>null},
    }
    const result=await action(tx);committed=working;return result
  }} as unknown as PrismaClient
  const service=createReceiptDependencies(prisma)
  const definition={product:{name:'Shirt',categoryId:id},variants:[{sku:'A',color:'Black',size:'S'}]}
  const input=parseReceivingSetup(definition,false)
  assert.equal((await service.createSetup('tenant','user',UserRole.WAREHOUSE,id,input)).receipt,null)
  assert.equal(committed.variants[0].currentStock,0);assert.equal(committed.variants[0].lastPurchaseCost,null)
  assert.equal((await service.createSetup('tenant','user',UserRole.WAREHOUSE,id,input)).idempotentReplay,true)
  assert.equal(committed.variants.length,1)
  committed={product:null,variants:[]}
  const receive=parseReceivingSetup({...definition,receipt:{unitCost:'2',items:[{sku:'A',quantity:40}]}},true)
  await assert.rejects(service.createSetup('tenant','user',UserRole.OWNER,id,receive))
  assert.deepEqual(committed,{product:null,variants:[]})
})
