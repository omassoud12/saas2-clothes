import { useEffect, useState } from 'react'
import { shareReceipt } from './pos-receipt.js'

const SHARE_BLOCKED_MESSAGE = 'Your browser blocked the share window. Allow pop-ups for this site and try again.'

// Sharing and printing for a receipt shown in a sheet (after a sale, and from the sales history).
// printRoot is the element the printed copy is rendered into (see PrintCopy).
export function useReceiptActions(receipt) {
  const [shareMessage, setShareMessage] = useState('')
  // The printed copy is rendered next to #root so the print stylesheet can hide the whole app and print only the receipt.
  const [printRoot] = useState(() => typeof document === 'undefined' ? null
    : Object.assign(document.createElement('div'), { className: 'mock-pos-print-root' }))
  useEffect(() => {
    if (!printRoot) return undefined
    document.body.append(printRoot)
    return () => printRoot.remove()
  }, [printRoot])

  async function share() {
    setShareMessage('')
    const result = await shareReceipt(receipt)
    if (!result.ok) setShareMessage(SHARE_BLOCKED_MESSAGE)
  }

  return { share, print: () => window.print(), shareMessage, printRoot }
}
