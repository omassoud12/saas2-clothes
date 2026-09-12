import { createClient } from '@supabase/supabase-js'
import type { BackendEnvironment } from './config/env.js'

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

export function createSupabaseClients(environment: BackendEnvironment) {
  const verifier = createClient(
    environment.supabaseUrl,
    environment.supabasePublicKey,
    { auth: serverAuthOptions },
  )

  const admin = createClient(
    environment.supabaseUrl,
    environment.supabaseServiceRoleKey,
    { auth: serverAuthOptions },
  )

  return Object.freeze({ verifier, admin })
}
