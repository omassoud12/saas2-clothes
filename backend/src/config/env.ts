export interface BackendEnvironment {
  readonly port: number
  readonly supabaseUrl: string
  readonly supabasePublicKey: string
  readonly supabaseServiceRoleKey: string
  readonly databaseUrl: string
  readonly directUrl: string
}

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()

  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }

  return value
}

function parsePort(value: string | undefined): number {
  if (!value) return 3001

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

export function loadEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): BackendEnvironment {
  const publishableKey =
    environment.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    environment.SUPABASE_ANON_KEY?.trim()

  if (!publishableKey) {
    throw new Error(
      'SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY environment variable is required',
    )
  }

  return Object.freeze({
    port: parsePort(environment.PORT),
    supabaseUrl: requireValue(environment, 'SUPABASE_URL'),
    supabasePublicKey: publishableKey,
    supabaseServiceRoleKey: requireValue(
      environment,
      'SUPABASE_SERVICE_ROLE_KEY',
    ),
    databaseUrl: requireValue(environment, 'DATABASE_URL'),
    directUrl: requireValue(environment, 'DIRECT_URL'),
  })
}
