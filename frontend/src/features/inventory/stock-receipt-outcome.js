export const RECEIPT_OUTCOME = Object.freeze({
  COMMITTED: 'committed',
  CORRECTABLE_REJECTION: 'correctable_rejection',
  TERMINAL_REJECTION: 'terminal_rejection',
  AUTH_PAUSE: 'authentication_pause',
  ACCOUNT_PAUSE: 'account_pause',
  CONFLICT: 'idempotency_conflict',
  UNCERTAIN: 'uncertain',
})

export const receiptOutcomeValues = new Set(Object.values(RECEIPT_OUTCOME))

export function preservesReceiptOperation(outcome) {
  return [
    RECEIPT_OUTCOME.AUTH_PAUSE,
    RECEIPT_OUTCOME.ACCOUNT_PAUSE,
    RECEIPT_OUTCOME.CONFLICT,
    RECEIPT_OUTCOME.UNCERTAIN,
  ].includes(outcome)
}

export function canRetryReceiptOperation(record) {
  const outcome = record.recovery?.outcome
  if (!outcome || outcome === RECEIPT_OUTCOME.UNCERTAIN || outcome === RECEIPT_OUTCOME.AUTH_PAUSE) return true
  if (outcome === RECEIPT_OUTCOME.ACCOUNT_PAUSE) return record.recovery?.code !== 'ROLE_FORBIDDEN'
  return false
}
