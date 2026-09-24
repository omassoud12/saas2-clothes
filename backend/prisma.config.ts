import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { createVerifiedMigrationUrl } from './src/config/database-tls.js'

const directUrl = process.env.DIRECT_URL
const migrationUrl = directUrl
  ? createVerifiedMigrationUrl(directUrl, {
      caPath: process.env.SUPABASE_DB_CA_PATH?.trim() ?? '',
      nodeEnvironment: process.env.NODE_ENV,
    })
  : undefined

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
})
