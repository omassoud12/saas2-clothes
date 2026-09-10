import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { isSupabaseConfigured } from './supabase.js'

const app = express()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', supabaseConfigured: isSupabaseConfigured })
})

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
