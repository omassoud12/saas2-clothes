import { authenticatedApiRequest } from '../../auth/owner-flow.js'
import { decimalToMinorUnits, minorUnitsToDecimal } from '../../lib/money.js'
import { buildProductPayload, buildVariantPayload } from '../products/product-flow.js'
import { combinationKey } from '../products/product-options.js'
import { RECEIPT_OUTCOME, preservesReceiptOperation } from './stock-receipt-outcome.js'

const accountPauseCodes = new Set(['ACCOUNT_PENDING','ACCOUNT_REJECTED','ACCOUNT_SUSPENDED','ACCOUNT_NOT_ACTIVE'])
const terminalCodes = new Set(['PRODUCT_NOT_FOUND','VARIANT_NOT_FOUND'])

export function receiptOperationKind(path, payload) {
  return path === '/api/inventory/product-setups' && !payload?.receipt ? 'product-save' : 'receiving'
}

function operationLabel(kind) { return kind === 'product-save' ? 'product save' : 'receiving request' }
function outcome(result, kind, value, message, extra = {}) {
  const preservePending = preservesReceiptOperation(value)
  const retrySameOperation = value === RECEIPT_OUTCOME.UNCERTAIN || value === RECEIPT_OUTCOME.AUTH_PAUSE || (value === RECEIPT_OUTCOME.ACCOUNT_PAUSE && result.code !== 'ROLE_FORBIDDEN')
  return { ...result, ok:false, outcome:value, operationKind:kind, message, preservePending, retrySameOperation, rejected:!preservePending, uncertain:value===RECEIPT_OUTCOME.UNCERTAIN, ...extra }
}
function domainMessage(code, kind) {
  const productSave = kind === 'product-save'
  const messages = {
    PRODUCT_NOT_FOUND: 'This product is no longer available. Return to Inventory and refresh before starting again.',
    VARIANT_NOT_FOUND: 'One or more color / size options are no longer available. Refresh the product before starting again.',
    PRODUCT_INACTIVE: 'This product is inactive. Reactivate it before receiving stock.',
    VARIANT_INACTIVE: 'One or more color / size options are inactive. Update the selection before receiving stock.',
    STOCK_LIMIT_EXCEEDED: 'One or more options have reached the stock limit. Review the quantities before trying again.',
    CATEGORY_NOT_FOUND: 'The selected category is no longer available. Choose an active category.',
    VARIANT_SKU_ALREADY_EXISTS: 'One of these product codes is already in use. Review the product options.',
    VARIANT_BARCODE_ALREADY_EXISTS: 'One of these barcodes is already in use. Review the product options.',
  }
  return messages[code] ?? (productSave ? 'The product details were not accepted. Review them before saving again.' : 'The receiving details were not accepted. Review them before trying again.')
}
export function classifyReceiptFailure(result, kind) {
  const label = operationLabel(kind)
  if(result.code==='SESSION_REQUIRED'||result.status===401) return outcome(result,kind,RECEIPT_OUTCOME.AUTH_PAUSE,`Your session expired. Sign in again, then retry the original ${label}.`,{requiresLogin:true})
  if(result.status===403) {
    const accountPause=accountPauseCodes.has(result.code)
    const message=accountPause ? `Your store is not currently active. The original ${label} remains preserved.` : `Your current role cannot confirm this ${label}. The original operation remains preserved for review.`
    return outcome(result,kind,RECEIPT_OUTCOME.ACCOUNT_PAUSE,message,accountPause?{requiresAccountReview:true}:{})
  }
  if(result.code==='RECEIPT_IDEMPOTENCY_CONFLICT') return outcome(result,kind,RECEIPT_OUTCOME.CONFLICT,`The original ${label} conflicts with different details. Check the original result before continuing.`)
  if(terminalCodes.has(result.code)) return outcome(result,kind,RECEIPT_OUTCOME.TERMINAL_REJECTION,domainMessage(result.code,kind))
  if((typeof result.status==='number'&&result.status>=400&&result.status<500)||result.code==='API_CONFIGURATION_INVALID') return outcome(result,kind,RECEIPT_OUTCOME.CORRECTABLE_REJECTION,domainMessage(result.code,kind))
  return outcome(result,kind,RECEIPT_OUTCOME.UNCERTAIN,`${productResultName(kind)} could not be confirmed. Retry the original ${label}.`)
}
function productResultName(kind) { return kind === 'product-save' ? 'The product save' : 'Receiving' }
function committedResult(result, kind, extra = {}) {
  const data=result.data
  if(![200,201].includes(result.status)||typeof data?.productId!=='string'||typeof data.idempotentReplay!=='boolean'||!(data.receipt===null||typeof data.receipt?.id==='string')) return outcome(result,kind,RECEIPT_OUTCOME.UNCERTAIN,`${productResultName(kind)} result could not be confirmed. Retry the original ${operationLabel(kind)}.`)
  return {ok:true,outcome:RECEIPT_OUTCOME.COMMITTED,operationKind:kind,preservePending:false,retrySameOperation:false,...data,...extra}
}

export function buildReceipt(variants, quantities, unitCost, newProduct = false) {
  if(new Set(variants.map(combinationKey)).size!==variants.length)return {ok:false,message:'This product has duplicate color/size options. Correct them in Products before receiving.'}
  const cost=decimalToMinorUnits(unitCost,4)
  if(cost===null || cost<=0n || cost>999999999999999999n) return {ok:false,message:'Enter a positive purchase cost with up to four decimals.'}
  const items=[]
  for(const variant of variants) {
    const key=variant.id??variant.sku
    const text=String(quantities[key]??'').trim()
    if(text===''||text==='0') continue
    if(!/^[1-9]\d{0,6}$/.test(text)||Number(text)>1000000) return {ok:false,message:'Enter whole quantities from 1 to 1,000,000.'}
    if(variant.isActive===false) return {ok:false,message:'Inactive options cannot receive stock.'}
    items.push({[newProduct?'sku':'variantId']:key,quantity:Number(text)})
  }
  if(!items.length || items.length>200) return {ok:false,message:'Enter quantities for 1 to 200 options.'}
  const totalQuantity=items.reduce((sum,item)=>sum+item.quantity,0)
  return {ok:true,payload:{unitCost:minorUnitsToDecimal(cost,4),items},totalQuantity,totalCost:minorUnitsToDecimal(cost*BigInt(totalQuantity),4)}
}
export function buildReceivingSetup(definition, role, receipt = null) {
  const product=buildProductPayload(definition,role)
  if(!product.ok) return product
  if(!definition.options?.length || definition.options.length>200) return {ok:false,message:'Choose 1 to 200 options.'}
  const variants=[]
  const combinations=new Set()
  for(const option of definition.options) {
    const key=combinationKey(option)
    if(combinations.has(key))return {ok:false,message:'Each color and size must appear only once.'}
    combinations.add(key)
    const result=buildVariantPayload(option,role)
    if(!result.ok) return result
    variants.push(result.payload)
  }
  return {ok:true,payload:{product:product.payload,variants,receipt}}
}
export async function loadReceiptHistory({supabase,page=1,fetchImpl}) {
  const result=await authenticatedApiRequest({supabase,fetchImpl,path:`/api/inventory/receipts?page=${page}`,method:'GET',fallbackMessage:'Receipt history is unavailable.'})
  if(!result.ok)return result
  if(!Array.isArray(result.data?.receipts)||typeof result.data.hasMore!=='boolean')return {ok:false,message:'Receipt history could not load. Refresh and try again.'}
  return {ok:true,...result.data}
}
export async function submitReceipt({supabase,fetchImpl,path,payload,operationId}) {
  const kind=receiptOperationKind(path,payload)
  const result=await authenticatedApiRequest({supabase,fetchImpl,path,method:'POST',payload,headers:{'Idempotency-Key':operationId},fallbackMessage:`${productResultName(kind)} could not be confirmed.`})
  if(!result.ok)return classifyReceiptFailure(result,kind)
  return committedResult(result,kind)
}
export async function checkReceiptOperation({supabase,fetchImpl,record}) {
  const kind=receiptOperationKind(record.path,record.payload)
  const result=await authenticatedApiRequest({supabase,fetchImpl,path:`/api/inventory/receipts/by-operation/${encodeURIComponent(record.operationId)}`,method:'GET',fallbackMessage:'The original operation result could not be checked.'})
  if(result.ok)return committedResult(result,kind,{recoveredFromConflict:true})
  const classified=classifyReceiptFailure(result,kind)
  if([RECEIPT_OUTCOME.AUTH_PAUSE,RECEIPT_OUTCOME.ACCOUNT_PAUSE].includes(classified.outcome))return classified
  return outcome(result,kind,RECEIPT_OUTCOME.CONFLICT,`The original ${operationLabel(kind)} still needs review. Its saved details and operation ID remain available below.`)
}
