import 'dotenv/config'
import { createAdminAccountDependencies } from './admin/admin-account.service.js'
import { createApp } from './app.js'
import { createAuthDependencies } from './auth/auth.service.js'
import { loadEnvironment } from './config/env.js'
import { createPrismaClient } from './lib/prisma.js'
import { createSupabaseClients } from './supabase.js'

const environment = loadEnvironment()
const prisma = createPrismaClient(environment.databaseUrl)
const supabase = createSupabaseClients(environment)
const auth = createAuthDependencies(prisma, supabase.verifier)
const adminAccounts = createAdminAccountDependencies(prisma)
const app = createApp({ auth, adminAccounts })

app.listen(environment.port, () => {
  console.log(`API listening on http://localhost:${environment.port}`)
})
