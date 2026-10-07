import { createClient } from '@supabase/supabase-js'
import { exchangePasswordSetupCode, inspectAuthCallbackUrl } from '../auth/auth-flow.js'
import { inspectSignupCallbackUrl } from '../auth/owner-flow.js'
import { normalizePathname, ROUTES } from '../app/routes.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const authCallbackContext = inspectAuthCallbackUrl(window.location.href)
export const signupCallbackContext = inspectSignupCallbackUrl(window.location.href)
const callbackUrl = new URL(window.location.href)
const usesCodeCallback = normalizePathname(callbackUrl.pathname) === ROUTES.authCallback && authCallbackContext.hasCode === true
export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: !usesCodeCallback,
        persistSession: true,
      },
    })
  : null

let codeCallbackPromise
export function exchangeAuthCallbackCode() {
  if (!codeCallbackPromise) {
    codeCallbackPromise = exchangePasswordSetupCode({
      supabase,
      code: callbackUrl.searchParams.get('code'),
      flowId: callbackUrl.searchParams.get('sb_flow_id'),
    })
  }
  return codeCallbackPromise
}
