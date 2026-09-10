import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

function getRequiredEnvironmentVariable(name: 'DATABASE_URL'): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }

  return value
}

const adapter = new PrismaPg({
  connectionString: getRequiredEnvironmentVariable('DATABASE_URL'),
})

export const prisma = new PrismaClient({ adapter })
