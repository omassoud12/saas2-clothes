import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { receiptScope, readReceipts, receiptRecoveryEvent, lockReceipt, markReceiptOutcome, settleReceipt } from './stock-receipt-recovery.js'
import { checkReceiptOperation, receiptOperationKind, submitReceipt } from './stock-receipt-flow.js'
import { RECEIPT_OUTCOME } from './stock-receipt-outcome.js'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

export function useReceiptRecovery(profile, onSaved) {
  const [pending, setPending] = useState([])
  const [recoveryError, setRecoveryError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const running = useRef(false)
  const scope = receiptScope(profile.account?.id || profile.user.accountId, profile.user.id)
  useEffect(() => {
    function sync() {
      try { setPending(readReceipts(scope)) }
      catch { setRecoveryError('Receiving recovery storage is unavailable. Resolve browser storage before receiving.') }
    }
    const timer = setTimeout(() => { sync(); if (!navigator.locks) setRecoveryError('Safe receiving requires browser Web Locks. Use a supported browser.') }, 0)
    window.addEventListener('storage', sync)
    window.addEventListener(receiptRecoveryEvent, sync)
    return () => { clearTimeout(timer); window.removeEventListener('storage', sync); window.removeEventListener(receiptRecoveryEvent, sync) }
  }, [scope])
  function operationName(record){return receiptOperationKind(record.path,record.payload)==='product-save'?'product save':'receiving request'}
  async function handleRecoveryFailure(record,result){
    if(result.preservePending)await markReceiptOutcome(scope,record,result)
    else await settleReceipt(scope,record)
    if(redirectIfNeeded(result))return
    if(result.outcome===RECEIPT_OUTCOME.TERMINAL_REJECTION){setFeedback({kind:'error',message:result.message});setRecoveryError('');return}
    if(result.outcome===RECEIPT_OUTCOME.CORRECTABLE_REJECTION){setFeedback({kind:'error',message:`The original ${operationName(record)} was rejected without saving. ${result.message}`});setRecoveryError('');return}
    setRecoveryError('')
  }
  async function retry(record){
    if(running.current)return
    running.current = true; setRetrying(true)
    try{const locked=await lockReceipt(scope,record,async()=>{
      const result=await submitReceipt({supabase,...record})
      if(result.ok){await settleReceipt(scope,record);setRecoveryError('');setFeedback(null);onSaved(result, record.payload?.product?.name)}
      else await handleRecoveryFailure(record,result)
    });if(!locked.acquired)setRecoveryError('Another tab is confirming this operation.')}
    catch{setRecoveryError(`Could not confirm the original ${operationName(record)}. Its saved request remains preserved.`)}
    finally{running.current = false;setRetrying(false)}
  }
  async function checkOriginal(record){
    if(running.current)return
    running.current = true; setRetrying(true)
    try{
      const result=await checkReceiptOperation({supabase,record})
      if(result.ok){await settleReceipt(scope,record);setRecoveryError('');setFeedback(null);onSaved(result,record.payload?.product?.name)}
      else await handleRecoveryFailure(record,result)
    }catch{setRecoveryError(`Could not check the original ${operationName(record)}. Its saved details remain available.`)}
    finally{running.current = false;setRetrying(false)}
  }

  return { scope, pending, recoveryError, feedback, retrying, retry, checkOriginal, blocked: pending.length > 0 || Boolean(recoveryError) }
}
