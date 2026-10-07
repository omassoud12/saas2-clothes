import { useRef, useState } from 'react'
import { logoutBusinessApp } from './app-flow.js'
import { clearDiscardedChanges, confirmDiscardChanges } from './dirty-state.js'
import { supabase } from '../lib/supabase.js'

export function useLogout() {
  const pending = useRef(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  async function logout() {
    if (pending.current || !confirmDiscardChanges()) return
    pending.current = true
    setLoggingOut(true)
    setLogoutError('')
    const result = await logoutBusinessApp({
      supabase,
      redirect: path => {
        // The user approved discarding drafts and sign-out succeeded. Do not
        // prompt again during the redirect; unresolved operation records remain.
        clearDiscardedChanges()
        window.location.replace(path)
      },
    })
    if (!result.ok) {
      setLogoutError(result.message)
      pending.current = false
      setLoggingOut(false)
    }
    return result
  }

  return { loggingOut, logoutError, logout }
}
