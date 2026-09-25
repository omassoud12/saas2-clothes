import { materializeDatabaseCa } from './database-ca.mjs'

materializeDatabaseCa()
await import('../backend/dist/index.js')
