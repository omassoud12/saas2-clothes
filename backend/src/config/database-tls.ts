import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { PoolConfig } from 'pg'

const SAFE_DATABASE_TLS_ERROR = 'database TLS configuration is invalid'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const TLS_QUERY_PARAMETERS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
] as const

export interface DatabaseTlsContext {
  readonly nodeEnvironment: string | undefined
  readonly caPath: string
}

interface ParsedDatabaseUrl {
  readonly url: URL
  readonly loopback: boolean
}

function invalidDatabaseTls(): Error {
  return new Error(SAFE_DATABASE_TLS_ERROR)
}

function parseDatabaseUrl(
  databaseUrl: string,
  nodeEnvironment: string | undefined,
): ParsedDatabaseUrl {
  let url: URL

  try {
    url = new URL(databaseUrl)
  } catch {
    throw invalidDatabaseTls()
  }

  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    !url.hostname
  ) {
    throw invalidDatabaseTls()
  }

  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  const production = nodeEnvironment === 'production'

  if (loopback && !production) {
    return { url, loopback }
  }

  if (production) {
    const sslMode = url.searchParams.get('sslmode')
    const hasConflictingTlsParameter = TLS_QUERY_PARAMETERS.some(
      (parameter) =>
        parameter !== 'sslmode' && url.searchParams.has(parameter),
    )

    if (sslMode !== 'verify-full' || hasConflictingTlsParameter) {
      throw invalidDatabaseTls()
    }
  }

  return { url, loopback }
}

function loadCertificateAuthority(caPath: string): string {
  if (!caPath || !isAbsolute(caPath)) {
    throw invalidDatabaseTls()
  }

  try {
    const certificateAuthority = readFileSync(caPath, 'utf8')

    if (!certificateAuthority.trim()) {
      throw invalidDatabaseTls()
    }

    return certificateAuthority
  } catch {
    throw invalidDatabaseTls()
  }
}

function removeConnectionStringTlsOptions(url: URL): void {
  for (const parameter of TLS_QUERY_PARAMETERS) {
    url.searchParams.delete(parameter)
  }
}

export function validateDatabaseTlsConfiguration(
  databaseUrl: string,
  nodeEnvironment: string | undefined,
): void {
  parseDatabaseUrl(databaseUrl, nodeEnvironment)
}

export function createVerifiedPgPoolConfig(
  databaseUrl: string,
  context: DatabaseTlsContext,
): PoolConfig {
  const { url, loopback } = parseDatabaseUrl(
    databaseUrl,
    context.nodeEnvironment,
  )

  if (loopback && context.nodeEnvironment !== 'production') {
    return { connectionString: databaseUrl }
  }

  const certificateAuthority = loadCertificateAuthority(context.caPath)
  removeConnectionStringTlsOptions(url)

  return {
    connectionString: url.toString(),
    ssl: {
      ca: certificateAuthority,
      rejectUnauthorized: true,
    },
  }
}

export function createVerifiedMigrationUrl(
  databaseUrl: string,
  context: DatabaseTlsContext,
): string {
  const { url, loopback } = parseDatabaseUrl(
    databaseUrl,
    context.nodeEnvironment,
  )

  if (loopback && context.nodeEnvironment !== 'production') {
    return databaseUrl
  }

  loadCertificateAuthority(context.caPath)
  removeConnectionStringTlsOptions(url)
  url.searchParams.set('sslmode', 'verify-full')
  url.searchParams.set('sslrootcert', context.caPath)

  return url.toString()
}
