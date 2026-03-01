import { Hono } from 'hono'
import { signUp, signIn, signToken, requireAuth } from '../auth.js'
import { pool } from '../db.js'

const app = new Hono()

// POST /api/auth/signup
app.post('/signup', async (c) => {
  try {
    const { email, password, username } = await c.req.json()
    if (!email || !password) return c.json({ error: 'email and password required' }, 400)
    if (password.length < 6) return c.json({ error: 'password too short' }, 400)

    const user = await signUp(email, password, username)
    const token = signToken(user.id)
    return c.json({ token, user })
  } catch (e: any) {
    if (e.code === '23505') return c.json({ error: 'Email already registered' }, 409)
    console.error('[signup]', e)
    return c.json({ error: 'Signup failed' }, 500)
  }
})

// POST /api/auth/signin
app.post('/signin', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)

  const user = await signIn(email, password)
  if (!user) return c.json({ error: 'Invalid email or password' }, 401)

  const token = signToken(user.id)
  return c.json({ token, user })
})

// GET /api/auth/me — get current user
app.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const res = await pool.query(
    `SELECT id, email, username, avatar_id, onboarding_done FROM users WHERE id=$1`,
    [userId]
  )
  if (!res.rows[0]) return c.json({ error: 'User not found' }, 404)
  return c.json({ user: res.rows[0] })
})

// PATCH /api/auth/me — update profile
app.patch('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const updates: string[] = []
  const values: any[] = []
  let idx = 1

  if (body.username !== undefined) { updates.push(`username=$${idx++}`); values.push(body.username) }
  if (body.avatar_id !== undefined) { updates.push(`avatar_id=$${idx++}`); values.push(body.avatar_id) }
  if (body.onboarding_done !== undefined) { updates.push(`onboarding_done=$${idx++}`); values.push(body.onboarding_done) }

  if (!updates.length) return c.json({ ok: true })

  values.push(userId)
  await pool.query(`UPDATE users SET ${updates.join(',')} WHERE id=$${idx}`, values)
  return c.json({ ok: true })
})

export default app
