import 'dotenv/config'
import { createAdminAccountDependencies } from './admin/admin-account.service.js'
import { createApp } from './app.js'
import { createAuthDependencies } from './auth/auth.service.js'
import { loadEnvironment } from './config/env.js'
import { createCategoryDependencies } from './categories/category.service.js'
import { createPrismaClient } from './lib/prisma.js'
import { createInventoryAuditDependencies } from './inventory/inventory.service.js'
import { createProductDependencies } from './products/product.service.js'
import { createR2ProductImageStore, loadR2Environment } from './product-images/r2-product-image-store.js'
import { createSupabaseClients } from './supabase.js'

const environment = loadEnvironment()
const prisma = createPrismaClient(environment.databaseUrl)
const supabase = createSupabaseClients(environment)
const auth = createAuthDependencies(prisma, supabase.verifier)
const adminAccounts = createAdminAccountDependencies(prisma)
const categories = createCategoryDependencies(prisma)
let imageStore: ReturnType<typeof createR2ProductImageStore> | undefined
const products = createProductDependencies(prisma, () => {
  imageStore ??= createR2ProductImageStore(loadR2Environment())
  return imageStore
})
const inventory = createInventoryAuditDependencies(prisma)
const app = createApp({ auth, adminAccounts, categories, products, inventory })

app.listen(environment.port, () => {
  console.log(`API listening on http://localhost:${environment.port}`)
})
