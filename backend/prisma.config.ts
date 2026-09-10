import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const directUrl = process.env.DIRECT_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
})
