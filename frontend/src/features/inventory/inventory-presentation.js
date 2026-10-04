import { decimalToMinorUnits, minorUnitsToDecimal } from '../../lib/money.js'

// Presentation-only context: never replaces the frozen request or server totals.
export function recoverySummary(record, owner) {
  const items = Array.isArray(record.payload?.items) ? record.payload.items : record.payload?.receipt?.items ?? []
  const quantity = items.reduce((sum,item)=>sum+(Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0),0)
  const cost = owner ? decimalToMinorUnits(record.payload?.unitCost ?? record.payload?.receipt?.unitCost,4) : null
  return {name:record.payload?.product?.name || null,productId:record.payload?.productId || null,
    quantity,options:items.length,total:cost === null ? null : minorUnitsToDecimal(cost*BigInt(quantity),4),
    unitCost:owner ? record.payload?.unitCost ?? record.payload?.receipt?.unitCost : null,
    saveOnly:record.path==='/api/inventory/product-setups' && !record.payload?.receipt}
}

export function definitionDraft(definition) {
  const groups = new Map()
  for(const option of definition?.options ?? []) {
    if(!groups.has(option.color))groups.set(option.color,{id:crypto.randomUUID(),color:option.color,customSize:'',options:[]})
    groups.get(option.color).options.push({...option,selected:true})
  }
  return {name:definition?.name ?? '',categoryId:definition?.categoryId ?? '',sellingPrice:definition?.options?.[0]?.sellingPrice ?? '',colors:[...groups.values()]}
}
