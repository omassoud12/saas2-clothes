import test from 'node:test'
import assert from 'node:assert/strict'
import {buildReceipt,buildReceivingSetup,checkReceiptOperation,classifyReceiptFailure,submitReceipt} from './stock-receipt-flow.js'
import {annotateOperation,persistOperation,readOperations,resolveOperation} from '../../app/operation-recovery.js'
import {RECEIPT_OUTCOME} from './stock-receipt-outcome.js'
const options=[{id:'a',sku:'A',color:'Black',size:'S'},{id:'b',sku:'B',color:'Black',size:'M'}]
test('receipt counts only new pieces and calculates fractional cost exactly',()=>{
  const result=buildReceipt(options,{a:'17',b:'23'},'0.1234')
  assert.equal(result.totalQuantity,40);assert.equal(result.totalCost,'4.9360')
  assert.deepEqual(result.payload.items,[{variantId:'a',quantity:17},{variantId:'b',quantity:23}])
})
test('blank cells do not add stock; invalid, inactive and empty receipt reject',()=>{
  assert.equal(buildReceipt(options,{a:'',b:'0'},'2').ok,false)
  for(const value of ['-1','1.5','1000001'])assert.equal(buildReceipt(options,{a:value},'2').ok,false)
  assert.equal(buildReceipt([{...options[0],isActive:false}],{a:'1'},'2').ok,false)
  assert.equal(buildReceipt(options,{a:'1'},'0').ok,false)
})
test('new product payload has no implicit opening stock and warehouse has no costs',()=>{
  const result=buildReceivingSetup({name:'Shirt',categoryId:'category',options:[{sku:'A',color:'Black',size:'S',sellingPrice:'12'}]},'WAREHOUSE')
  assert.equal(result.ok,true);assert.equal(result.payload.receipt,null)
  assert.equal('openingStock' in result.payload.variants[0],false)
  assert.equal('sellingPrice' in result.payload.variants[0],false)
})
test('network failure preserves ambiguous operation and exact idempotency key',async()=>{
  let headers
  const result=await submitReceipt({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'fixture'},access_token:'fixture'}}})}},path:'/api/inventory/receipts',payload:{},operationId:'original-key',fetchImpl:async(_url,options)=>{headers=options.headers;throw new Error('lost')}})
  assert.equal(result.ok,false);assert.equal(result.uncertain,true)
  assert.equal(headers['Idempotency-Key'],'original-key')
})
test('persistent operation recovery keeps immutable payloads across reads and clears only the resolved key',()=>{
  const data=new Map(), storage={get length(){return data.size},key:index=>[...data.keys()][index],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}
  const first={operationId:'first',payload:{quantity:40}},second={operationId:'second',payload:{quantity:1}}
  persistOperation('tenant:user',first,storage);persistOperation('tenant:user',second,storage)
  assert.deepEqual(readOperations('tenant:user',storage),[first,second])
  assert.throws(()=>persistOperation('tenant:user',{...first,payload:{quantity:41}},storage))
  resolveOperation('tenant:user','first',storage)
  assert.deepEqual(readOperations('tenant:user',storage),[second])
  assert.deepEqual(readOperations('other:user',storage),[])
})
test('recovery annotations preserve the exact frozen request and operation identity',()=>{
  const data=new Map(), storage={get length(){return data.size},key:index=>[...data.keys()][index],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}
  const record={operationId:'11111111-1111-4111-8111-111111111111',path:'/api/inventory/receipts',payload:{productId:'product',unitCost:'2.5000',items:[{variantId:'a',quantity:2}]},createdAt:1}
  persistOperation('tenant:user',record,storage)
  annotateOperation('tenant:user',record.operationId,{outcome:RECEIPT_OUTCOME.UNCERTAIN,code:'API_UNAVAILABLE',message:'Pending',updatedAt:2},storage)
  const recovered=readOperations('tenant:user',storage)[0]
  assert.equal(recovered.operationId,record.operationId)
  assert.equal(recovered.path,record.path)
  assert.deepEqual(recovered.payload,record.payload)
})
test('duplicate historical combinations block receiving instead of silently hiding one stock unit',()=>{
  assert.equal(buildReceipt([options[0],{...options[0],id:'duplicate'}],{a:'1'},'2').ok,false)
})
const session={auth:{getSession:async()=>({data:{session:{user:{id:'fixture'},access_token:'fixture'}}})}}
const receiptPayload={productId:'product',unitCost:'2.5000',items:[{variantId:'a',quantity:2}]}
function failure(status,code){return new Response(JSON.stringify({error:{code}}),{status,headers:{'Content-Type':'application/json'}})}
function success(idempotentReplay=false,receipt=true){return new Response(JSON.stringify({productId:'product',idempotentReplay,receipt:receipt?{id:'receipt'}:null}),{status:idempotentReplay?200:201,headers:{'Content-Type':'application/json'}})}

test('receipt success and same-key replay share the committed outcome',async()=>{
  for(const replay of [false,true]){
    const result=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'original-key',fetchImpl:async()=>success(replay)})
    assert.equal(result.ok,true);assert.equal(result.outcome,RECEIPT_OUTCOME.COMMITTED);assert.equal(result.idempotentReplay,replay);assert.equal(result.preservePending,false)
  }
})

test('confirmed validation and inactive targets are correctable and release recovery',async()=>{
  for(const [status,code] of [[422,'INVALID_RECEIPT_INPUT'],[409,'PRODUCT_INACTIVE'],[409,'VARIANT_INACTIVE'],[409,'STOCK_LIMIT_EXCEEDED']]){
    const result=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl:async()=>failure(status,code)})
    assert.equal(result.outcome,RECEIPT_OUTCOME.CORRECTABLE_REJECTION);assert.equal(result.preservePending,false);assert.equal(result.rejected,true)
  }
})

test('missing Product or option is terminal and releases the global block',async()=>{
  for(const code of ['PRODUCT_NOT_FOUND','VARIANT_NOT_FOUND']){
    const result=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl:async()=>failure(404,code)})
    assert.equal(result.outcome,RECEIPT_OUTCOME.TERMINAL_REJECTION);assert.equal(result.preservePending,false);assert.match(result.message,/no longer available/i)
  }
})

test('authentication and account-state pauses preserve the original operation',async()=>{
  const expired=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl:async()=>failure(401,'SESSION_REQUIRED')})
  assert.equal(expired.outcome,RECEIPT_OUTCOME.AUTH_PAUSE);assert.equal(expired.requiresLogin,true);assert.equal(expired.preservePending,true);assert.equal(expired.retrySameOperation,true)
  for(const code of ['ACCOUNT_PENDING','ACCOUNT_REJECTED','ACCOUNT_SUSPENDED','ACCOUNT_NOT_ACTIVE']){
    const result=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl:async()=>failure(403,code)})
    assert.equal(result.outcome,RECEIPT_OUTCOME.ACCOUNT_PAUSE);assert.equal(result.requiresAccountReview,true);assert.equal(result.preservePending,true)
  }
  const role=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl:async()=>failure(403,'ROLE_FORBIDDEN')})
  assert.equal(role.outcome,RECEIPT_OUTCOME.ACCOUNT_PAUSE);assert.equal(role.retrySameOperation,false);assert.equal(role.requiresAccountReview,undefined)
})

test('idempotency conflict is a preserved review state without a generic retry',async()=>{
  const result=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl:async()=>failure(409,'RECEIPT_IDEMPOTENCY_CONFLICT')})
  assert.equal(result.outcome,RECEIPT_OUTCOME.CONFLICT);assert.equal(result.preservePending,true);assert.equal(result.retrySameOperation,false);assert.doesNotMatch(result.message,/key belongs/i)
})

test('network, timeout, 5xx and malformed success remain uncertain and blocking',async()=>{
  const cases=[async()=>{throw new Error('lost')},async()=>{throw new DOMException('timeout','TimeoutError')},async()=>failure(503,'API_UNAVAILABLE'),async()=>new Response(JSON.stringify({unexpected:true}),{status:201,headers:{'Content-Type':'application/json'}})]
  for(const fetchImpl of cases){
    const result=await submitReceipt({supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'key',fetchImpl})
    assert.equal(result.outcome,RECEIPT_OUTCOME.UNCERTAIN);assert.equal(result.preservePending,true);assert.equal(result.retrySameOperation,true);assert.equal(result.uncertain,true)
  }
})

test('retry of an uncertain receipt preserves UUID and frozen payload until success',async()=>{
  const calls=[]
  const fetchImpl=async(_url,options)=>{calls.push({key:options.headers['Idempotency-Key'],body:JSON.parse(options.body)});return calls.length===1?Promise.reject(new Error('lost')):success(true)}
  const input={supabase:session,path:'/api/inventory/receipts',payload:receiptPayload,operationId:'original-key',fetchImpl}
  assert.equal((await submitReceipt(input)).outcome,RECEIPT_OUTCOME.UNCERTAIN)
  assert.equal((await submitReceipt(input)).outcome,RECEIPT_OUTCOME.COMMITTED)
  assert.deepEqual(calls,[{key:'original-key',body:receiptPayload},{key:'original-key',body:receiptPayload}])
})

test('save-only outcomes use product-save language for uncertainty, rejection and auth pause',async()=>{
  const input={supabase:session,path:'/api/inventory/product-setups',payload:{product:{name:'Shirt'},variants:[{sku:'A'}],receipt:null},operationId:'save-key'}
  const uncertain=await submitReceipt({...input,fetchImpl:async()=>{throw new Error('lost')}})
  assert.equal(uncertain.operationKind,'product-save');assert.match(uncertain.message,/product save/i);assert.doesNotMatch(uncertain.message,/receipt/i)
  const rejected=await submitReceipt({...input,fetchImpl:async()=>failure(422,'INVALID_RECEIVING_SETUP')})
  assert.equal(rejected.outcome,RECEIPT_OUTCOME.CORRECTABLE_REJECTION);assert.match(rejected.message,/product details/i);assert.doesNotMatch(rejected.message,/receipt/i)
  const auth=await submitReceipt({...input,fetchImpl:async()=>failure(401,'SESSION_REQUIRED')})
  assert.equal(auth.outcome,RECEIPT_OUTCOME.AUTH_PAUSE);assert.match(auth.message,/product save/i);assert.equal(auth.preservePending,true)
})

test('conflict lookup can recover the authoritative original result',async()=>{
  let requestPath
  const result=await checkReceiptOperation({supabase:session,record:{operationId:'11111111-1111-4111-8111-111111111111',path:'/api/inventory/receipts',payload:receiptPayload},fetchImpl:async(url)=>{requestPath=url;return success(true)}})
  assert.equal(result.ok,true);assert.equal(result.outcome,RECEIPT_OUTCOME.COMMITTED);assert.equal(result.recoveredFromConflict,true);assert.match(requestPath,/by-operation\/11111111/)
})

test('failed conflict lookup remains reviewable and never becomes generic retry',async()=>{
  const record={operationId:'11111111-1111-4111-8111-111111111111',path:'/api/inventory/receipts',payload:receiptPayload}
  const missing=await checkReceiptOperation({supabase:session,record,fetchImpl:async()=>failure(404,'RECEIPT_NOT_FOUND')})
  assert.equal(missing.outcome,RECEIPT_OUTCOME.CONFLICT);assert.equal(missing.retrySameOperation,false);assert.equal(missing.preservePending,true)
  const expired=await checkReceiptOperation({supabase:session,record,fetchImpl:async()=>failure(401,'SESSION_REQUIRED')})
  assert.equal(expired.outcome,RECEIPT_OUTCOME.AUTH_PAUSE);assert.equal(expired.requiresLogin,true)
})

test('direct failure classifier keeps locally rejected configuration out of recovery',()=>{
  const result=classifyReceiptFailure({ok:false,code:'API_CONFIGURATION_INVALID',message:'bad'},'receiving')
  assert.equal(result.outcome,RECEIPT_OUTCOME.CORRECTABLE_REJECTION);assert.equal(result.preservePending,false)
})
