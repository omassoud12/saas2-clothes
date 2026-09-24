import { createClient } from '@supabase/supabase-js'

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

interface SupabaseVerifierConfiguration {
  readonly supabaseUrl: string
  readonly supabasePublicKey: string
}

interface SupabaseAdminConfiguration {
  readonly supabaseUrl: string
  readonly supabaseServiceRoleKey: string
}

export function createSupabaseVerifier(
  environment: SupabaseVerifierConfiguration,
) {
  return createClient(environment.supabaseUrl, environment.supabasePublicKey, {
    auth: serverAuthOptions,
  })
}

export function createSupabaseAdminClient(
  environment: SupabaseAdminConfiguration,
) {
  return createClient(
    environment.supabaseUrl,
    environment.supabaseServiceRoleKey,
    { auth: serverAuthOptions },
  )
}
