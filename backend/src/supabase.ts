import { createClient } from '@supabase/supabase-js'

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

interface SupabaseVerifierConfiguration {
  readonly supabaseUrl: string
  readonly supabasePublicKey: string
  readonly supabaseAuthTimeoutMs: number
}

interface SupabaseAdminConfiguration {
  readonly supabaseUrl: string
  readonly supabaseServiceRoleKey: string
}

export function createTimeoutFetch(
  timeoutMs: number,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController()
    const inputSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const abortFromInput = () => controller.abort(inputSignal?.reason)

    if (inputSignal?.aborted) abortFromInput()
    else inputSignal?.addEventListener('abort', abortFromInput, { once: true })

    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    timeout.unref?.()

    try {
      return await baseFetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      inputSignal?.removeEventListener('abort', abortFromInput)
    }
  }
}

export function createSupabaseVerifier(
  environment: SupabaseVerifierConfiguration,
) {
  return createClient(environment.supabaseUrl, environment.supabasePublicKey, {
    auth: serverAuthOptions,
    global: {
      fetch: createTimeoutFetch(environment.supabaseAuthTimeoutMs),
    },
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
