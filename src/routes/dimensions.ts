import { Hono } from 'hono'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/dimensions
app.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const res = await pool.query(
    `SELECT dim_id, total_exp FROM dimensions WHERE user_id=$1`,
    [userId]
  )
  return c.json(res.rows)
})

// POST /api/dimensions — upsert single { dim_id, total_exp } or batch array
app.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const items: Array<{ dim_id: string; total_exp: number }> = Array.isArray(body) ? body : [body]
  for (const { dim_id, total_exp } of items) {
    await pool.query(
      `INSERT INTO dimensions (user_id, dim_id, total_exp)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, dim_id) DO UPDATE SET total_exp=$3, updated_at=NOW()`,
      [userId, dim_id, total_exp]
    )
  }
  return c.json({ ok: true })
})

export default app
