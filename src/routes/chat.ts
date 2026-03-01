import { Hono } from 'hono'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'

const app = new Hono()

const MINIMAX_BASE = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1'
const MINIMAX_KEY = process.env.MINIMAX_API_KEY || ''

// POST /api/chat
app.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { messages, system } = await c.req.json()

  if (!MINIMAX_KEY) {
    return c.json({ error: 'AI not configured' }, 503)
  }

  try {
    const payload = {
      model: 'MiniMax-Text-01',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...(messages || []),
      ],
      temperature: 0.85,
      max_tokens: 400,
      top_p: 0.95,
    }

    const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[chat] MiniMax error:', res.status, errText)
      return c.json({ error: 'AI service error', detail: errText }, 502)
    }

    const data = await res.json() as any
    const reply = data.choices?.[0]?.message?.content?.trim() || ''
    return c.json({ reply })

  } catch (e) {
    console.error('[chat] fetch error:', e)
    return c.json({ error: 'AI unavailable' }, 503)
  }
})

// GET /api/chat/profile — get user profile for AI context
app.get('/profile', requireAuth, async (c) => {
  const userId = c.get('userId')
  const [userRes, habitsRes, dimsRes] = await Promise.all([
    pool.query(`SELECT username, avatar_id, onboarding_done FROM users WHERE id=$1`, [userId]),
    pool.query(`SELECT name, slot, exp, dimension FROM habits WHERE user_id=$1 AND active=TRUE`, [userId]),
    pool.query(`SELECT dim_id, total_exp FROM dimensions WHERE user_id=$1`, [userId]),
  ])
  return c.json({
    user: userRes.rows[0] || {},
    habits: habitsRes.rows,
    dimensions: dimsRes.rows,
  })
})

export default app
