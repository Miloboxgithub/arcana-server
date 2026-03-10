import { Hono } from 'hono'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/habits
app.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  try {
    // 动态检查 dimensions 列是否存在
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name='habits' AND column_name='dimensions' AND table_schema='public'`
    )
    const hasDimensions = colCheck.rows.length > 0
    
    const selectCols = hasDimensions 
      ? 'id, name, slot, exp, dimension, dimensions, is_anchor, streak, created_at'
      : 'id, name, slot, exp, dimension, is_anchor, streak, created_at'
    
    const res = await pool.query(
      `SELECT ${selectCols} FROM habits WHERE user_id=$1 AND active=TRUE ORDER BY created_at`,
      [userId]
    )
    
    // 兼容：dimensions 为 NULL 时用 dimension 字段填充
    const habits = res.rows.map(h => ({
      ...h,
      dimensions: h.dimensions || [{ dimension: h.dimension, exp: h.exp || 10 }]
    }))
    
    return c.json(habits)
  } catch (err: any) {
    console.error('[habits GET] error:', err.message)
    return c.json({ error: 'Database error', detail: err.message }, 500)
  }
})

// POST /api/habits — upsert
app.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { id, name, slot, exp, dimension, dimensions, is_anchor, streak } = await c.req.json()
  
  // 动态检查 dimensions 列是否存在
  const colCheck = await pool.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name='habits' AND column_name='dimensions' AND table_schema='public'`
  )
  const hasDimensions = colCheck.rows.length > 0
  
  // 处理多维度数据
  let dimsJson = dimensions
  if (!dimsJson && dimension) {
    dimsJson = [{ dimension, exp: exp ?? 10 }]
  } else if (!dimsJson) {
    dimsJson = [{ dimension: 'pro', exp: 10 }]
  }
  
  const totalExp = Array.isArray(dimsJson) ? dimsJson.reduce((s: number, d: { exp: number }) => s + (d.exp || 0), 0) : (exp ?? 10)
  const mainDim = Array.isArray(dimsJson) && dimsJson.length > 0 ? dimsJson[0].dimension : (dimension ?? 'pro')
  
  if (hasDimensions) {
    await pool.query(
      `INSERT INTO habits (id, user_id, name, slot, exp, dimension, dimensions, is_anchor, streak, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       ON CONFLICT (id) DO UPDATE SET name=$3, slot=$4, exp=$5, dimension=$6, dimensions=$7, is_anchor=$8, active=TRUE`,
      [id, userId, name, slot, totalExp, mainDim, JSON.stringify(dimsJson), is_anchor ?? false, streak ?? 0]
    )
  } else {
    // 兼容旧数据库（无 dimensions 列）
    await pool.query(
      `INSERT INTO habits (id, user_id, name, slot, exp, dimension, is_anchor, streak, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
       ON CONFLICT (id) DO UPDATE SET name=$3, slot=$4, exp=$5, dimension=$6, is_anchor=$7, active=TRUE`,
      [id, userId, name, slot, totalExp, mainDim, is_anchor ?? false, streak ?? 0]
    )
  }
  return c.json({ ok: true })
})

// DELETE /api/habits/:id
app.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await pool.query(`UPDATE habits SET active=FALSE WHERE id=$1 AND user_id=$2`, [id, userId])
  return c.json({ ok: true })
})

// ── Check Records ──────────────────────────────────────────

// GET /api/habits/records?since=YYYY-MM-DD
app.get('/records', requireAuth, async (c) => {
  const userId = c.get('userId')
  const since = c.req.query('since') ?? (() => {
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
  const id = `${(userId as string).slice(0, 8)}-${habit_id}-${date}`
  await pool.query(
    `INSERT INTO check_records (id, user_id, habit_id, date, completed_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [id, userId, habit_id, date, completed_at ?? new Date().toISOString()]
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
