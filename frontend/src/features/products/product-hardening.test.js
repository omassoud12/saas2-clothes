import test from 'node:test'
import assert from 'node:assert/strict'
import { clothingSizes, combinationKey, compareSizes, operationalState, groupVariantsByColor } from './product-options.js'
import { readStockRecovery, persistStockOperation, resolveStockOperation, migrateStockRecovery, withStockRecoveryLock, stockRecoveryKey } from './stock-recovery.js'

test('sizes use standard order then deterministic numeric custom order', () => {
  const sizes = ['40','M','XXL','XS','38','4XL','L','S','XL','3XL'].map(size => ({size}))
  assert.deepEqual(sizes.sort(compareSizes).map(v => v.size), [...clothingSizes,'38','40'])
  assert.equal(combinationKey({color:' Black ',size:'m'}),combinationKey({color:'black',size:'M'}))
  assert.equal(combinationKey({color:null,size:''}),combinationKey({}))
})
test('sale readiness uses active/stock/price independently from private cost', () => {
  const variant={isActive:true,currentStock:1,sellingPrice:'15',lastPurchaseCost:null}
  assert.equal(operationalState({isActive:true},variant,'WAREHOUSE'),'Sellable')
  assert.equal(operationalState({isActive:true},{...variant,sellingPrice:null},'OWNER'),'Sale price override needed')
  assert.equal(operationalState({isActive:true},{...variant,sellingPrice:null},'WAREHOUSE'),'Price needed')
  assert.equal(operationalState({isActive:true},{...variant,sellingPrice:'0'},'WAREHOUSE'),'Positive sale price needed')
})
function storageFixture() {
  const map = new Map()
  return { map, get length() { return map.size }, key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }
}
const scope = stockRecoveryKey('account', 'owner', 'product')
const first = {variantId:'33333333-3333-4333-8333-333333333333',operationId:'44444444-4444-4444-8444-444444444444',delta:-1,createdAt:1}
const second = {...first, variantId:'55555555-5555-4555-8555-555555555555',operationId:'66666666-6666-4666-8666-666666666666',createdAt:2}
const locks = {request: async (_name, options, action) => {
  if (typeof options === 'function') return options({})
  return action({})
}}
test('independent writers survive reload and late cleanup removes only its own operation', () => {
  const storage = storageFixture()
  persistStockOperation(scope, {...first, secret:'excluded'}, storage)
  persistStockOperation(scope, second, storage)
  assert.equal(storage.length, 2)
  assert.deepEqual(readStockRecovery(scope, storage).map(v=>v.operationId),[first.operationId,second.operationId])
  assert.equal(readStockRecovery(scope, storage)[0].requiresReview,true)
  assert.deepEqual(readStockRecovery(stockRecoveryKey('other','owner','product'), storage),[])
  assert.doesNotMatch([...storage.map.values()].join(''), /secret|cost|token/)
  resolveStockOperation(scope,first.operationId,storage)
  assert.deepEqual(readStockRecovery(scope,storage).map(v=>v.operationId),[second.operationId])
})
test('legacy migration preserves every UUID and direction and cannot resurrect resolved records', async () => {
  const storage=storageFixture()
  storage.setItem(scope,JSON.stringify([first,second]))
  assert.equal(readStockRecovery(scope,storage).length,2)
  await migrateStockRecovery(scope,storage,locks)
  assert.equal(storage.getItem(scope),null)
  resolveStockOperation(scope,first.operationId,storage)
  await migrateStockRecovery(scope,storage,locks)
  assert.deepEqual(readStockRecovery(scope,storage).map(v=>[v.operationId,v.delta]),[[second.operationId,-1]])
})
test('partial legacy migration retains original records until all writes succeed', async () => {
  const storage=storageFixture(), originalSet=storage.setItem
  storage.setItem(scope,JSON.stringify([first,second]))
  storage.setItem=(key,value)=>{if(key.endsWith(second.operationId))throw Error('quota');originalSet(key,value)}
  await assert.rejects(migrateStockRecovery(scope,storage,locks))
  assert.notEqual(storage.getItem(scope),null)
  assert.equal(readStockRecovery(scope,storage).length,2)
  storage.setItem=originalSet
  await migrateStockRecovery(scope,storage,locks)
  assert.equal(storage.length,2)
})
test('unsupported locking fails closed without running a mutation or removing legacy data', async () => {
  const storage=storageFixture();storage.setItem(scope,JSON.stringify([first]))
  assert.equal(await migrateStockRecovery(scope,storage,null),false)
  let calls=0
  assert.deepEqual(await withStockRecoveryLock(scope,first.variantId,()=>calls++,null),{acquired:false,unsupported:true})
  assert.equal(calls,0);assert.notEqual(storage.getItem(scope),null)
})
test('same variant cannot run concurrently while different variants can', async () => {
  const held=new Set()
  const coordinator={request:async (name, _options, action)=>{
    if(held.has(name))return action(null)
    held.add(name);try{return await action({})}finally{held.delete(name)}
  }}
  let release;const gate=new Promise(resolve=>{release=resolve})
  const active=withStockRecoveryLock(scope,first.variantId,()=>gate,coordinator)
  assert.equal((await withStockRecoveryLock(scope,first.variantId,()=>assert.fail('duplicate send'),coordinator)).acquired,false)
  assert.equal((await withStockRecoveryLock(scope,second.variantId,()=>true,coordinator)).acquired,true)
  release();assert.equal((await active).acquired,true)
})
test('conflicting retry metadata and malformed legacy records are retained and rejected', async () => {
  const storage=storageFixture();persistStockOperation(scope,first,storage)
  assert.throws(()=>persistStockOperation(scope,{...first,delta:1},storage))
  storage.setItem(scope,JSON.stringify([{...second,delta:0}]))
  await assert.rejects(migrateStockRecovery(scope,storage,locks))
  assert.notEqual(storage.getItem(scope),null)
  assert.equal(storage.length,2)
})

test('Phase 3 color groups normalize NFC trim and case without merging stock records', () => {
 const variants=[{id:'a',color:' Black ',size:'S',currentStock:2},{id:'b',color:'black',size:'M',currentStock:5},{id:'c',color:'Cafe\u0301',size:'L',currentStock:3},{id:'d',color:'CAF\u00c9',size:'XS',currentStock:4},{id:'e',color:null,size:'M'},{id:'f',color:'   ',size:'S'},{id:'g',color:'No color',size:'L'}]
 const groups=groupVariantsByColor(variants)
 assert.equal(groups.length,4)
 assert.deepEqual(groups[0],[ 'Black', [variants[0],variants[1]] ])
 assert.deepEqual(groups[1],[ 'Caf\u00e9', [variants[3],variants[2]] ])
 assert.deepEqual(groups[2][1],[variants[5],variants[4]])
 assert.equal(groups[3][1][0],variants[6])
 assert.equal(variants[1].currentStock,5);assert.equal(variants[2].color,'Cafe\u0301')
})
