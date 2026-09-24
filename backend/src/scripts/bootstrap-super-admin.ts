import 'dotenv/config'
import { loadEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaClient } from '../lib/prisma.js'
import { createSupabaseClients } from '../supabase.js'
import {
  bootstrapSuperAdmin,
  createSuperAdminBootstrapDependencies,
  parseSuperAdminBootstrapInput,
  SuperAdminBootstrapError,
} from './super-admin-bootstrap.js'

async function run(): Promise<number> {
  let prisma: PrismaClient | undefined

  try {
    const input = parseSuperAdminBootstrapInput(process.argv.slice(2))
    const environment = loadEnvironment()
    prisma = createPrismaClient(environment.databaseUrl, {
      caPath: environment.databaseCaPath,
      nodeEnvironment: environment.nodeEnvironment,
    })
    const { admin } = createSupabaseClients(environment)
    const dependencies = createSuperAdminBootstrapDependencies(prisma, admin)
    const result = await bootstrapSuperAdmin(dependencies, input)

    console.log(
      result.created
        ? 'SUPER_ADMIN provisioned successfully.'
        : 'SUPER_ADMIN is already provisioned; no changes were made.',
    )
    return 0
  } catch (error) {
    if (error instanceof SuperAdminBootstrapError) {
      console.error(`SUPER_ADMIN bootstrap failed [${error.code}]: ${error.message}`)
      if (error.compensation !== 'NOT_REQUIRED') {
        console.error(`Auth compensation: ${error.compensation}`)
      }
    } else {
      console.error('SUPER_ADMIN bootstrap failed unexpectedly; no sensitive details were logged.')
    }
    return 1
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect()
      } catch {
        console.error('Database disconnect failed; no sensitive details were logged.')
      }
    }
  }
}

process.exitCode = await run()
