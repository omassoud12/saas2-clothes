import test from 'node:test'
import assert from 'node:assert/strict'
import { clothingSizes, combinationKey, compareSizes, operationalState } from './product-options.js'
import { readStockRecovery, writeStockRecovery, stockRecoveryKey } from './stock-recovery.js'

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
test('durable metadata is operational only, scoped and retains exact retry direction and UUID', () => {
  const map=new Map(), storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)}
  const key=stockRecoveryKey('account','owner','product')
  const pending={variantId:'33333333-3333-4333-8333-333333333333',operationId:'44444444-4444-4444-8444-444444444444',delta:-1,createdAt:Date.now()}
  writeStockRecovery(key,[pending],storage)
  assert.deepEqual(readStockRecovery(key,storage),[pending])
  assert.deepEqual(readStockRecovery(stockRecoveryKey('other','owner','product'),storage),[])
  assert.doesNotMatch(map.get(key),/token|cost|secret/i)
  writeStockRecovery(key,[{...pending,createdAt:1}],storage);assert.equal(readStockRecovery(key,storage)[0].requiresReview,true)
  writeStockRecovery(key,[],storage);assert.equal(map.has(key),false)
})
