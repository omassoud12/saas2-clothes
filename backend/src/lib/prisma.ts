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
): PrismaClient {
  const pool = new Pool(createVerifiedPgPoolConfig(databaseUrl, tlsContext))
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}
