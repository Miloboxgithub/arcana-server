import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { initDb } from './db.js'
import authRoutes from './routes/auth.js'
import habitsRoutes from './routes/habits.js'
import dimensionsRoutes from './routes/dimensions.js'
import chatRoutes from './routes/chat.js'
import achievementsRoutes from './routes/achievements.js'
import reportsRoutes from './routes/reports.js'
import notificationsRoutes from './routes/notifications.js'

const app = new Hono()

// ── Middleware ────────────────────────────────────────────
app.use('*', logger())
app.use('*', cors({
  origin: '*',  // 允许所有来源（前端可以随意部署）
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ── Routes ────────────────────────────────────────────────
app.route('/api/auth', authRoutes)
app.route('/api/habits', habitsRoutes)
app.route('/api/dimensions', dimensionsRoutes)
app.route('/api/chat', chatRoutes)
app.route('/api/achievements', achievementsRoutes)
app.route('/api/reports', reportsRoutes)

// Health check
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ── Start ─────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001

async function main() {
  await initDb()
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`🃏 ARCANA server running on http://localhost:${PORT}`)
  })
}

main().catch(console.error)
