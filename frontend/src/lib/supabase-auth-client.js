import { AuthClient } from '@supabase/auth-js'

// The frontend only uses Supabase Auth (sign-in, sessions, password links): everything else goes through
// our API. So this builds just the Auth client instead of the whole supabase-js client (database,
// realtime, storage, functions), exactly as createClient() does for its `auth` part, so the existing
// sessions keep working: same /auth/v1 URL, same apikey headers, same storage key and same defaults.
export function createAuthOnlyClient(url, key, { detectSessionInUrl }) {
  const base = new URL(url.endsWith('/') ? url : `${url}/`)
  const auth = new AuthClient({
    url: new URL('auth/v1', base).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'X-Client-Info': 'saas2-web auth-js/2.115.0' },
    storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl,
    flowType: 'implicit',
  })
  return { auth }
}
