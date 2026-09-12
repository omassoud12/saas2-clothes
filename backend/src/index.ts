import 'dotenv/config'
import { createApp } from './app.js'
import { createAuthDependencies } from './auth/auth.service.js'
import { loadEnvironment } from './config/env.js'
import { createPrismaClient } from './lib/prisma.js'
import { createSupabaseClients } from './supabase.js'

const environment = loadEnvironment()
const prisma = createPrismaClient(environment.databaseUrl)
const supabase = createSupabaseClients(environment)
const auth = createAuthDependencies(prisma, supabase.verifier)
const app = createApp({ auth })

app.listen(environment.port, () => {
  console.log(`API listening on http://localhost:${environment.port}`)
})
