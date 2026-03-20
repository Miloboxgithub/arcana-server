import { Hono } from 'hono'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/reports/weekly — get the latest weekly report
app.get('/weekly', requireAuth, async (c) => {
  const userId = c.get('userId')
  const res = await pool.query(
    `SELECT id, week_start, week_end, total_checks, total_exp,
            streak_start, streak_end, streak_days, dim_changes,
            top_habits, highlights, suggestions, created_at
     FROM weekly_reports
     WHERE user_id=$1
     ORDER BY week_start DESC
     LIMIT 12`,
    [userId]
  )
  return c.json(res.rows)
})

// GET /api/reports/weekly/:id — get a specific weekly report
app.get('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const res = await pool.query(
    `SELECT * FROM weekly_reports WHERE id=$1 AND user_id=$2`,
    [id, userId]
  )
  if (!res.rows[0]) return c.json({ error: 'Report not found' }, 404)
  return c.json(res.rows[0])
})

// POST /api/reports/weekly/generate — generate current week report (manual trigger)
app.post('/weekly/generate', requireAuth, async (c) => {
  const userId = c.get('userId')
  const report = await generateWeeklyReport(userId)
  return c.json(report)
})

// ── Generate weekly report logic ─────────────────────────
export async function generateWeeklyReport(userId: string): Promise<object> {
  // Calculate current week boundaries (Monday to Sunday)
  const now = new Date()
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek

  const weekEnd = new Date(now)
  weekEnd.setDate(now.getDate() + (7 + mondayOffset))
  const weekStart = new Date(weekEnd)
  weekStart.setDate(weekEnd.getDate() - 6)

  const ws = weekStart.toISOString().split('T')[0]
  const we = weekEnd.toISOString().split('T')[0]

  // ── Check-in data for the week ──
  const checkRes = await pool.query(
    `SELECT date, COUNT(*) as count, habit_id
     FROM check_records
     WHERE user_id=$1 AND date>=$2 AND date<=$3
     GROUP BY date, habit_id
     ORDER BY date`,
    [userId, ws, we]
  )

  const totalChecks = checkRes.rows.length
  const totalExp = checkRes.rows.reduce((sum: number, r: { count: number }) => sum + Number(r.count), 0)

  // ── Daily breakdown ──
  const daysActive = new Set(checkRes.rows.map((r: { date: string }) => r.date)).size

  // ── Streak ──
  const streakRes = await pool.query(
    `SELECT date FROM check_records
     WHERE user_id=$1 AND date<=$2
     ORDER BY date DESC
     LIMIT 30`,
    [userId, ws]
  )
  const dates = streakRes.rows.map((r: { date: string }) => r.date)
  let streakDays = 0
  let streakBroken = false
  const today = new Date()
  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(today)
    expected.setDate(today.getDate() - i)
    const expStr = expected.toISOString().split('T')[0]
    if (dates.includes(expStr)) {
      streakDays++
    } else if (i > 0) {
      streakBroken = true
      break
    }
  }

  // ── Dimension changes ──
  const dimRes = await pool.query(
    `SELECT dim_id, total_exp FROM dimensions WHERE user_id=$1`,
    [userId]
  )
  const dimChanges = dimRes.rows.reduce((acc: Record<string, number>, r: { dim_id: string; total_exp: number }) => {
    acc[r.dim_id] = r.total_exp
    return acc
  }, {})

  // ── Top habits this week ──
  const habitRes = await pool.query(
    `SELECT h.name, COUNT(cr.habit_id) as count
     FROM check_records cr
     JOIN habits h ON h.id = cr.habit_id
     WHERE cr.user_id=$1 AND cr.date>=$2 AND cr.date<=$3 AND h.active=TRUE
     GROUP BY h.id, h.name
     ORDER BY count DESC
     LIMIT 5`,
    [userId, ws, we]
  )
  const topHabits = habitRes.rows.map((r: { name: string; count: number }) => ({
    name: r.name,
    count: Number(r.count),
  }))

  // ── AI-generated highlights and suggestions ──
  const { highlights, suggestions } = generateInsights({
    totalChecks,
    daysActive,
    streakDays,
    topHabits,
    totalExp,
  })

  // ── Upsert weekly report ──
  const reportRes = await pool.query(
    `INSERT INTO weekly_reports
       (user_id, week_start, week_end, total_checks, total_exp, streak_start, streak_end, streak_days,
        dim_changes, top_habits, highlights, suggestions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id, week_start)
     DO UPDATE SET
       total_checks=EXCLUDED.total_checks,
       total_exp=EXCLUDED.total_exp,
       streak_days=EXCLUDED.streak_days,
       dim_changes=EXCLUDED.dim_changes,
       top_habits=EXCLUDED.top_habits,
       highlights=EXCLUDED.highlights,
       suggestions=EXCLUDED.suggestions,
       created_at=NOW()
     RETURNING *`,
    [
      userId, ws, we, totalChecks, totalExp,
      ws, we, streakDays,
      JSON.stringify(dimChanges),
      JSON.stringify(topHabits),
      JSON.stringify(highlights),
      JSON.stringify(suggestions),
    ]
  )

  return reportRes.rows[0]
}

// ── Simple insight generation (P5-style) ──────────────────
function generateInsights(data: {
  totalChecks: number
  daysActive: number
  streakDays: number
  topHabits: Array<{ name: string; count: number }>
  totalExp: number
}): { highlights: string[]; suggestions: string[] } {
  const highlights: string[] = []
  const suggestions: string[] = []

  if (data.totalChecks === 0) {
    highlights.push('本周没有任何打卡记录，侦探，你要消失了吗？')
    suggestions.push('从今天开始，哪怕只完成一个习惯也好')
  } else {
    if (data.streakDays >= 7) {
      highlights.push(`连续行动 ${data.streakDays} 天！这就是怪盗的毅力！`)
    }
    if (data.daysActive >= 6) {
      highlights.push(`本周活跃 ${data.daysActive} 天，几乎每天都在战斗`)
    }
    if (data.totalExp >= 500) {
      highlights.push(`获得 ${data.totalExp} EXP，成长速度可观`)
    }
    if (data.topHabits.length > 0) {
      highlights.push(`「${data.topHabits[0].name}」是本周完成最多的习惯，共 ${data.topHabits[0].count} 次`)
    }

    if (data.daysActive < 4) {
      suggestions.push('本周出勤率偏低，下周试着每天至少完成一个习惯')
    }
    if (data.streakDays < 3 && data.totalChecks > 0) {
      suggestions.push('连击断了也不要紧，重要的是重新开始')
    }
    if (data.totalExp < 200 && data.totalChecks > 0) {
      suggestions.push('经验值增长缓慢，考虑增加每个习惯的 EXP 或添加更多习惯')
    }
  }

  if (highlights.length === 0) highlights.push('本周有行动就值得肯定，继续保持')
  if (suggestions.length === 0) suggestions.push('保持当前节奏，怪盗的道路在于坚持')

  return { highlights, suggestions }
}
export default app
