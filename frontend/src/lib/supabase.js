import { createClient } from '@supabase/supabase-js'
import { inspectAuthCallbackUrl } from '../auth/auth-flow.js'
import { inspectSignupCallbackUrl } from '../auth/owner-flow.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const authCallbackContext = inspectAuthCallbackUrl(window.location.href)
export const signupCallbackContext = inspectSignupCallbackUrl(window.location.href)
export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null
