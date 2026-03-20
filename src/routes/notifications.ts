import { Hono } from 'hono'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/notifications — list recent notifications
app.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const limit = Number(c.req.query('limit') ?? 20)
  const unreadOnly = c.req.query('unread') === '1'

  const res = await pool.query(
    `SELECT id, type, title, body, data, read, created_at
     FROM user_notifications
     WHERE user_id=$1 ${unreadOnly ? 'AND read=FALSE' : ''}
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return c.json(res.rows)
})

// GET /api/notifications/unread-count — count unread
app.get('/unread-count', requireAuth, async (c) => {
  const userId = c.get('userId')
  const res = await pool.query(
    `SELECT COUNT(*) as count FROM user_notifications WHERE user_id=$1 AND read=FALSE`,
    [userId]
  )
  return c.json({ count: Number(res.rows[0].count) })
})

// PATCH /api/notifications/:id/read — mark as read
app.patch('/:id/read', requireAuth, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await pool.query(
    `UPDATE user_notifications SET read=TRUE WHERE id=$1 AND user_id=$2`,
    [id, userId]
  )
  return c.json({ ok: true })
})

// POST /api/notifications/read-all — mark all as read
app.post('/read-all', requireAuth, async (c) => {
  const userId = c.get('userId')
  await pool.query(
    `UPDATE user_notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE`,
    [userId]
  )
  return c.json({ ok: true })
})

// DELETE /api/notifications/:id — delete notification
app.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await pool.query(`DELETE FROM user_notifications WHERE id=$1 AND user_id=$2`, [id, userId])
  return c.json({ ok: true })
})

// ── Slack Detection ─────────────────────────────────────────
// Check if user has been inactive for N days and send warning

export async function checkAndNotifySlack(userId: string): Promise<void> {
  const today = new Date()
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }

  const res = await pool.query(
    `SELECT DISTINCT date FROM check_records
     WHERE user_id=$1 AND date <= $2 AND date >= $3`,
    [userId, dates[0], dates[dates.length - 1]]
  )
  const activeDates = new Set(res.rows.map((r: { date: string }) => r.date))
  const inactiveDays = dates.filter(d => !activeDates.has(d)).length

  // Check if we already sent a slack warning today
  const alreadyNotified = await pool.query(
    `SELECT id FROM user_notifications
     WHERE user_id=$1 AND type='slack_warning' AND created_at > NOW() - INTERVAL '1 day'`,
    [userId]
  )

  if (inactiveDays >= 3 && alreadyNotified.rows.length === 0) {
    await pool.query(
      `INSERT INTO user_notifications (user_id, type, title, body, data)
       VALUES ($1, 'slack_warning', '⚠️ 侦探，你消失了', '已经 ${inactiveDays} 天没有行动了……怪盗团在等你回来。', $2)`,
      [userId, JSON.stringify({ inactive_days: inactiveDays, last_active_date: [...activeDates].pop() })]
    )
  }
}

// ── Send a notification (generic) ────────────────────────────
export async function sendNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO user_notifications (user_id, type, title, body, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body, JSON.stringify(data)]
  )
}
export default app
