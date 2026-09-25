import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const SAFE_CA_ERROR = 'database CA configuration is invalid'
const MAX_CA_BYTES = 128 * 1024

function invalidCaConfiguration() {
  return new Error(SAFE_CA_ERROR)
}

function isWithinDirectory(parent, candidate) {
  const relativePath = relative(parent, candidate)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

export function materializeDatabaseCa(environment = process.env) {
  const caPath = environment.SUPABASE_DB_CA_PATH?.trim()
  const encodedCa = environment.SUPABASE_DB_CA_BASE64?.replace(/\s/gu, '')
  const production = environment.NODE_ENV === 'production'

  if (!caPath && !encodedCa) {
    if (production) throw invalidCaConfiguration()
    return null
  }

  if (!caPath || !isAbsolute(caPath)) throw invalidCaConfiguration()

  if (!encodedCa) {
    if (!existsSync(caPath)) throw invalidCaConfiguration()
    return caPath
  }

  const resolvedCaPath = resolve(caPath)
  const temporaryRoot = realpathSync(tmpdir())
  if (
    resolvedCaPath === temporaryRoot ||
    !isWithinDirectory(temporaryRoot, resolvedCaPath)
  ) {
    throw invalidCaConfiguration()
  }

  if (
    encodedCa.length > MAX_CA_BYTES * 2 ||
    encodedCa.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encodedCa)
  ) {
    throw invalidCaConfiguration()
  }

  const certificate = Buffer.from(encodedCa, 'base64')
  const certificateText = certificate.toString('utf8')

  if (
    certificate.length === 0 ||
    certificate.length > MAX_CA_BYTES ||
    !certificateText.includes('-----BEGIN CERTIFICATE-----') ||
    !certificateText.includes('-----END CERTIFICATE-----')
  ) {
    throw invalidCaConfiguration()
  }

  try {
    const parentDirectory = dirname(resolvedCaPath)
    mkdirSync(parentDirectory, { recursive: true, mode: 0o700 })
    if (!isWithinDirectory(temporaryRoot, realpathSync(parentDirectory))) {
      throw invalidCaConfiguration()
    }
    if (existsSync(resolvedCaPath) && !lstatSync(resolvedCaPath).isFile()) {
      throw invalidCaConfiguration()
    }
    writeFileSync(resolvedCaPath, certificate, { mode: 0o600 })
    chmodSync(resolvedCaPath, 0o600)
  } catch {
    throw invalidCaConfiguration()
  }

  return resolvedCaPath
}
