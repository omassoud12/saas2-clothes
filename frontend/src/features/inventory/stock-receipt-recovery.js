import { annotateOperation,persistOperation,readOperations,resolveOperation } from '../../app/operation-recovery.js'
import { withStockMetadataLock,withStockRecoveryLock } from '../products/stock-recovery.js'
import { receiptOutcomeValues } from './stock-receipt-outcome.js'
export const receiptRecoveryEvent='saas2:receiving-change'
export function receiptScope(accountId,userId) { return `saas2:receiving:v1:${accountId}:${userId}` }
function validate(record) {
  if(!record || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.operationId)||!['/api/inventory/receipts','/api/inventory/product-setups'].includes(record.path)||!record.payload||typeof record.createdAt!=='number') throw new Error('Invalid receiving recovery')
  if(record.recovery && (!receiptOutcomeValues.has(record.recovery.outcome)||!(record.recovery.code===null||typeof record.recovery.code==='string')||typeof record.recovery.message!=='string'||typeof record.recovery.updatedAt!=='number')) throw new Error('Invalid receiving recovery state')
  return record
}
function notify(scope) {window.dispatchEvent(new CustomEvent(receiptRecoveryEvent,{detail:scope}))}
export function readReceipts(scope) { return readOperations(scope).map(validate) }
export async function prepareReceipt(scope,request) {
  return withStockMetadataLock(scope,()=>{
    if(readReceipts(scope).length) throw new Error('Resolve the outstanding receiving operation first.')
    const record=validate({...request,operationId:crypto.randomUUID(),createdAt:Date.now()})
    persistOperation(scope,record);notify(scope);return record
  })
}
export async function settleReceipt(scope,record) { await withStockMetadataLock(scope,()=>{resolveOperation(scope,record.operationId);notify(scope)}) }
export async function markReceiptOutcome(scope,record,result) {
  return withStockMetadataLock(scope,()=>{
    const current=readReceipts(scope).find(item=>item.operationId===record.operationId)
    if(!current)return null
    const updated=annotateOperation(scope,record.operationId,{outcome:result.outcome,code:typeof result.code==='string'?result.code:null,message:result.message,updatedAt:Date.now()})
    notify(scope)
    return validate(updated)
  })
}
export function lockReceipt(scope,record,action) {return withStockRecoveryLock(scope,record.operationId,action)}
