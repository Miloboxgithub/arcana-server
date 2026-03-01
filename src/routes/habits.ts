import { Hono } from 'hono'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'

const app = new Hono()

// ── Habits ────────────────────────────────────────────────

// GET /api/habits — list active habits
app.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const res = await pool.query(
    `SELECT id, name, slot, exp, dimension, is_anchor, streak, created_at
     FROM habits WHERE user_id = $1 AND active = TRUE ORDER BY created_at`,
    [userId]
  )
  return c.json(res.rows)
})

// POST /api/habits — upsert habit
app.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { id, name, slot, exp, dimension, is_anchor, streak } = body
  await pool.query(
    `INSERT INTO habits (id, user_id, name, slot, exp, dimension, is_anchor, streak, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
     ON CONFLICT (id) DO UPDATE SET name=$3, slot=$4, exp=$5, dimension=$6, is_anchor=$7, active=TRUE`,
    [id, userId, name, slot, exp || 10, dimension || 'pro', is_anchor || false, streak || 0]
  )
  return c.json({ ok: true })
})

// DELETE /api/habits/:id — soft delete
app.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await pool.query(`UPDATE habits SET active=FALSE WHERE id=$1 AND user_id=$2`, [id, userId])
  return c.json({ ok: true })
})

// ── Check Records ─────────────────────────────────────────

// GET /api/habits/records?since=YYYY-MM-DD
app.get('/records', requireAuth, async (c) => {
  const userId = c.get('userId')
  const since = c.req.query('since') || (() => {
    const d = new Date(); d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })()
  const res = await pool.query(
    `SELECT habit_id, date, completed_at FROM check_records
     WHERE user_id=$1 AND date>=$2 ORDER BY completed_at`,
    [userId, since]
  )
  return c.json(res.rows)
})

// POST /api/habits/records — check in
app.post('/records', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { habit_id, date, completed_at } = await c.req.json()
  const id = `${userId.slice(0,8)}-${habit_id}-${date}`
  await pool.query(
    `INSERT INTO check_records (id, user_id, habit_id, date, completed_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING`,
    [id, userId, habit_id, date, completed_at || new Date().toISOString()]
  )
  return c.json({ ok: true })
})

// DELETE /api/habits/records — uncheck
app.delete('/records', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { habit_id, date } = await c.req.json()
  await pool.query(
    `DELETE FROM check_records WHERE user_id=$1 AND habit_id=$2 AND date=$3`,
    [userId, habit_id, date]
  )
  return c.json({ ok: true })
})

export default app
