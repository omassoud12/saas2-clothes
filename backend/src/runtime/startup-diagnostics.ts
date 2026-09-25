export type StartupStage =
  | 'environment'
  | 'database_client'
  | 'supabase_client'
  | 'dependencies'
  | 'app'
  | 'listen'
  | 'runtime_handlers'

export type StartupDiagnosticCode =
  | 'DATABASE_TLS_INVALID'
  | 'DATABASE_CA_INVALID'
  | 'CORS_CONFIG_INVALID'
  | 'TRUST_PROXY_INVALID'
  | 'REPLICA_COUNT_INVALID'
  | 'SUPABASE_CONFIG_INVALID'
  | 'PORT_INVALID'
  | 'NODE_ENV_INVALID'
  | 'RATE_LIMIT_CONFIG_INVALID'
  | 'EADDRINUSE'
  | 'EACCES'
  | 'STARTUP_UNKNOWN'

const SAFE_MESSAGE_CODES = new Map<string, StartupDiagnosticCode>([
  ['DATABASE_URL environment variable is required', 'DATABASE_TLS_INVALID'],
  [
    'SUPABASE_DB_CA_PATH environment variable is required',
    'DATABASE_CA_INVALID',
  ],
  ['database CA configuration is invalid', 'DATABASE_CA_INVALID'],
  ['CORS allowlist configuration is invalid', 'CORS_CONFIG_INVALID'],
  ['TRUST_PROXY_HOPS configuration is invalid', 'TRUST_PROXY_INVALID'],
  ['APP_REPLICA_COUNT configuration is invalid', 'REPLICA_COUNT_INVALID'],
  ['SUPABASE_URL environment variable is required', 'SUPABASE_CONFIG_INVALID'],
  ['SUPABASE_URL configuration is invalid', 'SUPABASE_CONFIG_INVALID'],
  [
    'SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY environment variable is required',
    'SUPABASE_CONFIG_INVALID',
  ],
  [
    'SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY configuration is invalid',
    'SUPABASE_CONFIG_INVALID',
  ],
  ['SUPABASE_AUTH_TIMEOUT_MS configuration is invalid', 'SUPABASE_CONFIG_INVALID'],
  ['PORT must be an integer between 1 and 65535', 'PORT_INVALID'],
  ['NODE_ENV configuration is invalid', 'NODE_ENV_INVALID'],
  ['API rate-limit configuration is invalid', 'RATE_LIMIT_CONFIG_INVALID'],
])

function readErrorMessage(error: unknown): string | undefined {
  try {
    return error instanceof Error ? error.message : undefined
  } catch {
    return undefined
  }
}

function readListenerErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined

  try {
    return typeof Reflect.get(error, 'code') === 'string'
      ? Reflect.get(error, 'code')
      : undefined
  } catch {
    return undefined
  }
}

export function classifyStartupError(
  error: unknown,
  stage: StartupStage,
): StartupDiagnosticCode {
  if (stage === 'listen') {
    const listenerCode = readListenerErrorCode(error)
    if (listenerCode === 'EADDRINUSE' || listenerCode === 'EACCES') {
      return listenerCode
    }
  }

  const message = readErrorMessage(error)
  if (message === 'database TLS configuration is invalid') {
    return stage === 'database_client'
      ? 'DATABASE_CA_INVALID'
      : 'DATABASE_TLS_INVALID'
  }

  return (message && SAFE_MESSAGE_CODES.get(message)) || 'STARTUP_UNKNOWN'
}
