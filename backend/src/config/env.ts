import { validateDatabaseTlsConfiguration } from './database-tls.js'

export type NodeEnvironment = 'development' | 'test' | 'production'

export interface HttpRuntimeConfiguration {
  readonly corsAllowedOrigins: readonly string[]
  readonly trustProxyHops: number
}

export interface RateLimitConfiguration {
  readonly generalRateLimitMax: number
  readonly writeRateLimitMax: number
  readonly expensiveRateLimitMax: number
  readonly imageRateLimitMax: number
}

export interface BackendEnvironment
  extends HttpRuntimeConfiguration,
    RateLimitConfiguration {
  readonly port: number
  readonly supabaseUrl: string
  readonly supabasePublicKey: string
  readonly databaseUrl: string
  readonly databaseCaPath: string
  readonly nodeEnvironment: NodeEnvironment
  readonly appReplicaCount: 1
  readonly supabaseAuthTimeoutMs: number
}

export interface AdminEnvironment {
  readonly supabaseUrl: string
  readonly supabaseServiceRoleKey: string
  readonly databaseUrl: string
  readonly databaseCaPath: string
  readonly nodeEnvironment: NodeEnvironment
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const MAX_SUPABASE_KEY_LENGTH = 8_192
const MAX_TRUST_PROXY_HOPS = 10

function parseBoundedInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  errorMessage: string,
): number {
  const configured = value?.trim()
  if (!configured) return defaultValue
  if (!/^\d+$/.test(configured)) throw new Error(errorMessage)

  const parsed = Number(configured)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(errorMessage)
  }

  return parsed
}

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()

  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }

  return value
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const normalized = value?.trim() || 'development'

  if (
    normalized !== 'development' &&
    normalized !== 'test' &&
    normalized !== 'production'
  ) {
    throw new Error('NODE_ENV configuration is invalid')
  }

  return normalized
}

function parsePort(value: string | undefined): number {
  if (!value) return 3001

  if (!/^\d+$/.test(value.trim())) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

function parseSupabaseUrl(
  value: string,
  nodeEnvironment: NodeEnvironment,
): string {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error('SUPABASE_URL configuration is invalid')
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  const secureRemote = url.protocol === 'https:'
  const localDevelopment =
    nodeEnvironment !== 'production' && isLoopback && url.protocol === 'http:'

  if (
    !url.hostname ||
    (!secureRemote && !localDevelopment) ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('SUPABASE_URL configuration is invalid')
  }

  return url.origin
}

function parseSupabaseKey(value: string | undefined, label: string): string {
  const key = value?.trim()

  if (!key) {
    throw new Error(`${label} environment variable is required`)
  }

  if (
    key.length > MAX_SUPABASE_KEY_LENGTH ||
    /\s|[\u0000-\u001f\u007f]/u.test(key)
  ) {
    throw new Error(`${label} configuration is invalid`)
  }

  return key
}

export function parseCorsAllowedOrigins(
  value: string | undefined,
  nodeEnvironment: NodeEnvironment,
): readonly string[] {
  const configured = value?.trim()

  if (!configured) {
    if (nodeEnvironment === 'production') {
      throw new Error('CORS allowlist configuration is invalid')
    }

    return Object.freeze([])
  }

  const normalized = new Set<string>()

  for (const candidate of configured.split(',')) {
    const valueToParse = candidate.trim()
    let url: URL

    if (!valueToParse || valueToParse.includes('*')) {
      throw new Error('CORS allowlist configuration is invalid')
    }

    try {
      url = new URL(valueToParse)
    } catch {
      throw new Error('CORS allowlist configuration is invalid')
    }

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      throw new Error('CORS allowlist configuration is invalid')
    }

    normalized.add(url.origin)
  }

  if (nodeEnvironment === 'production' && normalized.size === 0) {
    throw new Error('CORS allowlist configuration is invalid')
  }

  return Object.freeze([...normalized])
}

function parseTrustProxyHops(
  value: string | undefined,
  nodeEnvironment: NodeEnvironment,
): number {
  const configured = value?.trim()

  if (!configured) {
    if (nodeEnvironment === 'production') {
      throw new Error('TRUST_PROXY_HOPS configuration is invalid')
    }

    return 0
  }

  if (!/^\d+$/.test(configured)) {
    throw new Error('TRUST_PROXY_HOPS configuration is invalid')
  }

  const hops = Number(configured)
  const minimum = nodeEnvironment === 'production' ? 1 : 0

  if (!Number.isInteger(hops) || hops < minimum || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error('TRUST_PROXY_HOPS configuration is invalid')
  }

  return hops
}

function parseReplicaCount(
  value: string | undefined,
  nodeEnvironment: NodeEnvironment,
): 1 {
  const configured = value?.trim()

  if (!configured) {
    if (nodeEnvironment === 'production') {
      throw new Error('APP_REPLICA_COUNT configuration is invalid')
    }
    return 1
  }

  if (configured !== '1') {
    throw new Error('APP_REPLICA_COUNT configuration is invalid')
  }

  return 1
}

function loadRateLimitConfiguration(
  environment: NodeJS.ProcessEnv,
): RateLimitConfiguration {
  const generalRateLimitMax = parseBoundedInteger(
    environment.API_RATE_LIMIT_MAX,
    300,
    10,
    10_000,
    'API rate-limit configuration is invalid',
  )
  const writeRateLimitMax = parseBoundedInteger(
    environment.API_WRITE_RATE_LIMIT_MAX,
    120,
    1,
    5_000,
    'API rate-limit configuration is invalid',
  )
  const expensiveRateLimitMax = parseBoundedInteger(
    environment.API_EXPENSIVE_RATE_LIMIT_MAX,
    30,
    1,
    1_000,
    'API rate-limit configuration is invalid',
  )
  const imageRateLimitMax = parseBoundedInteger(
    environment.API_IMAGE_RATE_LIMIT_MAX,
    10,
    1,
    100,
    'API rate-limit configuration is invalid',
  )

  if (
    writeRateLimitMax > generalRateLimitMax ||
    expensiveRateLimitMax > generalRateLimitMax ||
    imageRateLimitMax > writeRateLimitMax
  ) {
    throw new Error('API rate-limit configuration is invalid')
  }

  return {
    generalRateLimitMax,
    writeRateLimitMax,
    expensiveRateLimitMax,
    imageRateLimitMax,
  }
}

function loadDatabaseEnvironment(
  environment: NodeJS.ProcessEnv,
  nodeEnvironment: NodeEnvironment,
) {
  const databaseUrl = requireValue(environment, 'DATABASE_URL')
  const databaseCaPath = requireValue(environment, 'SUPABASE_DB_CA_PATH')

  validateDatabaseTlsConfiguration(databaseUrl, nodeEnvironment)

  return { databaseUrl, databaseCaPath }
}

export function loadEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): BackendEnvironment {
  const nodeEnvironment = parseNodeEnvironment(environment.NODE_ENV)
  const publishableKey =
    environment.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    environment.SUPABASE_ANON_KEY?.trim()
  const database = loadDatabaseEnvironment(environment, nodeEnvironment)
  const rateLimits = loadRateLimitConfiguration(environment)

  return Object.freeze({
    port: parsePort(environment.PORT),
    supabaseUrl: parseSupabaseUrl(
      requireValue(environment, 'SUPABASE_URL'),
      nodeEnvironment,
    ),
    supabasePublicKey: parseSupabaseKey(
      publishableKey,
      'SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY',
    ),
    ...database,
    nodeEnvironment,
    corsAllowedOrigins: parseCorsAllowedOrigins(
      environment.CORS_ALLOWED_ORIGINS,
      nodeEnvironment,
    ),
    trustProxyHops: parseTrustProxyHops(
      environment.TRUST_PROXY_HOPS,
      nodeEnvironment,
    ),
    ...rateLimits,
    appReplicaCount: parseReplicaCount(
      environment.APP_REPLICA_COUNT,
      nodeEnvironment,
    ),
    supabaseAuthTimeoutMs: parseBoundedInteger(
      environment.SUPABASE_AUTH_TIMEOUT_MS,
      5_000,
      1_000,
      30_000,
      'SUPABASE_AUTH_TIMEOUT_MS configuration is invalid',
    ),
  })
}

export function loadAdminEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AdminEnvironment {
  const nodeEnvironment = parseNodeEnvironment(environment.NODE_ENV)
  const database = loadDatabaseEnvironment(environment, nodeEnvironment)

  return Object.freeze({
    supabaseUrl: parseSupabaseUrl(
      requireValue(environment, 'SUPABASE_URL'),
      nodeEnvironment,
    ),
    supabaseServiceRoleKey: parseSupabaseKey(
      environment.SUPABASE_SERVICE_ROLE_KEY,
      'SUPABASE_SERVICE_ROLE_KEY',
    ),
    ...database,
    nodeEnvironment,
  })
}
