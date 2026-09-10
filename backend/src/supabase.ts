import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env

function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }

  return {
    url: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  }
}

const supabaseConfig = getSupabaseConfig()

export const isSupabaseConfigured = supabaseConfig !== null
export const supabaseAdmin = supabaseConfig
  ? createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null
