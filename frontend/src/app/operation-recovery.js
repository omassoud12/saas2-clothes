// Immutable per-operation keys. Domain callers validate their own records.
export function persistOperation(scope, record, storage = globalThis.localStorage) {
  const key = `${scope}:operation:${record.operationId}`
  const text = JSON.stringify(record)
  const previous = storage.getItem(key)
  if (previous !== null && previous !== text) throw new Error('Conflicting recovery operation')
  if (previous === null) storage.setItem(key, text)
}
export function readOperations(scope, storage = globalThis.localStorage) {
  const keys = Array.from({length:storage.length},(_,index)=>storage.key(index))
  return keys.filter(key=>key?.startsWith(`${scope}:operation:`)).map(key=>{
    const raw=storage.getItem(key)
    if(raw===null) return null
    const record=JSON.parse(raw)
    if(key!==`${scope}:operation:${record.operationId}`) throw new Error('Invalid recovery operation')
    return record
  }).filter(Boolean)
}
export function annotateOperation(scope, id, annotation, storage = globalThis.localStorage) {
  const key = `${scope}:operation:${id}`
  const raw = storage.getItem(key)
  if (raw === null) return null
  const record = JSON.parse(raw)
  if (key !== `${scope}:operation:${record.operationId}`) throw new Error('Invalid recovery operation')
  const updated = { ...record, recovery: annotation }
  storage.setItem(key, JSON.stringify(updated))
  return updated
}
export function resolveOperation(scope, id, storage = globalThis.localStorage) { storage.removeItem(`${scope}:operation:${id}`) }
