import jwt from 'jsonwebtoken'
import { pool } from './db.js'
import type { Context, Next } from 'hono'
import type { AppVariables } from './types.js'
import { createHash } from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'arcana-secret-change-me'
const JWT_EXPIRES = '30d'

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

export function verifyToken(token: string): string {
  const decoded = jwt.verify(token, JWT_SECRET) as { sub: string }
  return decoded.sub
}

// Hono middleware: require auth
export async function requireAuth(c: Context<{ Variables: AppVariables }>, next: Next) {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const userId = verifyToken(token)
    c.set('userId', userId)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}

function hashPwd(pwd: string) {
  return createHash('sha256').update(pwd + JWT_SECRET).digest('hex')
}

export async function signUp(email: string, password: string, username?: string) {
  const hash = hashPwd(password)
  const res = await pool.query(
    `INSERT INTO users (email, password, username)
     VALUES ($1, $2, $3)
     RETURNING id, email, username, avatar_id, onboarding_done`,
    [email.toLowerCase().trim(), hash, username || null]
  )
  return res.rows[0]
}

export async function signIn(email: string, password: string) {
  const hash = hashPwd(password)
  const res = await pool.query(
    `SELECT id, email, username, avatar_id, onboarding_done
     FROM users WHERE email = $1 AND password = $2`,
    [email.toLowerCase().trim(), hash]
  )
  return res.rows[0] || null
}
