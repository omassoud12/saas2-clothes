import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import {
  createVerifiedPgPoolConfig,
  type DatabaseTlsContext,
} from '../config/database-tls.js'
import { PrismaClient } from '../generated/prisma/client.js'

export function createPrismaClient(
  databaseUrl: string,
  tlsContext: DatabaseTlsContext,
  options: { readonly poolMax?: number } = {},
): PrismaClient {
  // One pool per process. Its size defaults to pg's (10); set DATABASE_POOL_MAX to change it (keep it
  // under the Supabase pooler's limit for this service).
  const pool = new Pool({ ...createVerifiedPgPoolConfig(databaseUrl, tlsContext), ...(options.poolMax ? { max: options.poolMax } : {}) })
  const adapter = new PrismaPg(pool, { disposeExternalPool: true })
  return new PrismaClient({ adapter })
}
