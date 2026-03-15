import { Hono } from 'hono'
import { pool } from '../db.js'
import { verifyToken } from '../auth.js'

const achievements = new Hono()

// 获取用户成就列表
achievements.get('/', async (c) => {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  
  let userId: string
  try {
    userId = verifyToken(token)
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }

  try {
    // 获取所有成就定义
    const defs = await pool.query(`
      SELECT * FROM achievement_definitions ORDER BY 
        CASE rarity 
          WHEN 'legendary' THEN 1 
          WHEN 'epic' THEN 2 
          WHEN 'rare' THEN 3 
          WHEN 'uncommon' THEN 4 
          ELSE 5 
        END, id
    `)

    // 获取用户成就进度
    const userAchievements = await pool.query(`
      SELECT achievement_id, progress, unlocked_at, notified 
      FROM user_achievements WHERE user_id = $1
    `, [userId])

    const userMap = new Map()
    for (const ua of userAchievements.rows) {
      userMap.set(ua.achievement_id, ua)
    }

    // 合并数据
    const result = defs.rows.map((def: any) => {
      const ua = userMap.get(def.id)
      const progress = ua?.progress || 0
      const unlocked = !!ua?.unlocked_at
      const progressPct = Math.min(100, Math.round((progress / def.target) * 100))

      return {
        id: def.id,
        category: def.category,
        name: def.name,
        description: def.description,
        icon: def.icon,
        target: def.target,
        progress,
        progressPct,
        done: unlocked,
        unlockedAt: ua?.unlocked_at,
        expReward: def.exp_reward,
        rarity: def.rarity,
        isHidden: def.is_hidden,
      }
    })

    return c.json({ achievements: result })
  } catch (err) {
    console.error('[achievements] get error:', err)
    return c.json({ error: 'Failed to fetch achievements' }, 500)
  }
})

// 检查并更新成就进度
export async function checkAchievements(userId: string, checkRecord?: { habitId: string; date: string; completedAt: Date }) {
  try {
    // 获取所有成就定义
    const defs = await pool.query('SELECT * FROM achievement_definitions')
    const definitions = defs.rows

    // 获取用户当前状态
    const checks = await pool.query(`
      SELECT COUNT(*) as total FROM check_records WHERE user_id = $1
    `, [userId])
    const totalChecks = parseInt(checks.rows[0].total)

    const habits = await pool.query(`
      SELECT id, slot FROM habits WHERE user_id = $1 AND active = true
    `, [userId])
    const totalHabits = habits.rows.length

    // 计算最大连击
    const streakInfo = await getMaxStreak(userId)
    const maxStreak = streakInfo.maxStreak

    // 获取维度等级（使用与前端一致的计算公式）
    const dims = await pool.query(`
      SELECT dim_id, total_exp FROM dimensions WHERE user_id = $1
    `, [userId])
    
    // 计算等级的辅助函数（与前端 useProfileStore computeLevel 一致）
    function computeLevel(totalExp: number): number {
      let level = 1, maxExp = 1000, remaining = totalExp
      while (remaining >= maxExp) {
        remaining -= maxExp
        level++
        maxExp = Math.floor(maxExp * 1.3)
      }
      return level
    }
    
    const dimLevels = new Map()
    for (const d of dims.rows) {
      // 正确计算：0-999=Lv1, 1000-2299=Lv2, 2300-4299=Lv3...
      dimLevels.set(d.dim_id, computeLevel(d.total_exp || 0))
    }

    // 总经验
    const totalExp = dims.rows.reduce((s, d) => s + (d.total_exp || 0), 0)

    // 早起的次数
    const earlyBirdCount = await pool.query(`
      SELECT COUNT(*) as cnt FROM check_records 
      WHERE user_id = $1 
      AND EXTRACT(HOUR FROM completed_at) >= 6 
      AND EXTRACT(HOUR FROM completed_at) < 8
    `, [userId])
    const earlyBirds = parseInt(earlyBirdCount.rows[0].cnt)

    // 深夜打卡次数
    const nightOwlCount = await pool.query(`
      SELECT COUNT(*) as cnt FROM check_records 
      WHERE user_id = $1 
      AND EXTRACT(HOUR FROM completed_at) >= 22
    `, [userId])
    const nightOwls = parseInt(nightOwlCount.rows[0].cnt)

    // 周末打卡周数
    const weekendWeeks = await getWeekendStreakWeeks(userId)

    // 完美一周（过去7天每天都打卡）
    const perfectWeek = await checkPerfectWeek(userId)

    const newUnlocks: string[] = []

    for (const def of definitions) {
      let progress = 0
      let shouldUnlock = false

      switch (def.trigger_type) {
        case 'total_checks':
          progress = totalChecks
          shouldUnlock = totalChecks >= def.target
          break

        case 'total_habits':
          progress = totalHabits
          shouldUnlock = totalHabits >= def.target
          break

        case 'streak':
          progress = maxStreak
          shouldUnlock = maxStreak >= def.target
          break

        case 'dimension_level': {
          const param = def.trigger_param || {}
          if (param.dim_id === 'any') {
            // 任意维度达到指定等级
            const anyLevel = Math.max(...Array.from(dimLevels.values()))
            progress = anyLevel
            shouldUnlock = anyLevel >= def.target
          } else {
            const level = dimLevels.get(param.dim_id) || 1
            progress = level
            shouldUnlock = level >= def.target
          }
          break
        }

        case 'all_dimensions_level': {
          const param = def.trigger_param || {}
          const targetLevel = param.level || 3
          // 假设有 pro, fitness, social, creative, self, career 六个维度
          const requiredDims = ['pro', 'fitness', 'social', 'creative', 'self', 'career']
          const allAbove = requiredDims.every(d => (dimLevels.get(d) || 1) >= targetLevel)
          progress = Array.from(dimLevels.values()).filter(l => l >= targetLevel).length
          shouldUnlock = allAbove
          break
        }

        case 'total_exp':
          progress = totalExp
          shouldUnlock = totalExp >= def.target
          break

        case 'time_slot':
          // 特定时间段打卡（需要检查 checkRecord）
          if (checkRecord) {
            const hour = checkRecord.completedAt.getHours()
            const param = def.trigger_param || {}
            const start = parseInt(param.start?.split(':')[0] || '0')
            const end = parseInt(param.end?.split(':')[0] || '24')
            progress = (hour >= start && hour < end) ? 1 : 0
            shouldUnlock = progress >= 1
          }
          break

        case 'early_bird_count':
          progress = earlyBirds
          shouldUnlock = earlyBirds >= def.target
          break

        case 'weekend_streak':
          progress = weekendWeeks
          shouldUnlock = weekendWeeks >= def.target
          break

        case 'perfect_week':
          progress = perfectWeek ? 7 : 0
          shouldUnlock = perfectWeek
          break

        case 'all_slots': {
          const slots = new Set(habits.rows.map(h => h.slot))
          progress = slots.size
          shouldUnlock = slots.size >= def.target // 3 for 三界之主, 4 for 四界之主
          break
        }

        case 'streak_no_break':
          // 和 streak 相同逻辑，但专用于隐藏成就
          progress = maxStreak
          shouldUnlock = maxStreak >= def.target
          break

        case 'onboarding':
          // 这个需要特殊处理
          break
      }

      // 更新进度
      if (progress > 0 || def.trigger_type !== 'onboarding') {
        await pool.query(`
          INSERT INTO user_achievements (user_id, achievement_id, progress, unlocked_at)
          VALUES ($1, $2, $3, CASE WHEN $4 THEN NOW() ELSE NULL END)
          ON CONFLICT (user_id, achievement_id) DO UPDATE SET
            progress = GREATEST(user_achievements.progress, $3),
            unlocked_at = CASE 
              WHEN user_achievements.unlocked_at IS NOT NULL THEN user_achievements.unlocked_at
              WHEN $4 THEN NOW() 
              ELSE NULL 
            END
        `, [userId, def.id, progress, shouldUnlock])

        // 记录新解锁的成就
        if (shouldUnlock) {
          const existing = await pool.query(`
            SELECT unlocked_at FROM user_achievements 
            WHERE user_id = $1 AND achievement_id = $2
          `, [userId, def.id])
          if (existing.rows[0]?.unlocked_at) {
            const unlockedAt = new Date(existing.rows[0].unlocked_at)
            const now = new Date()
            const diffMs = now.getTime() - unlockedAt.getTime()
            // 如果是最近 5 秒内解锁的，算新解锁
            if (diffMs < 5000) {
              newUnlocks.push(def.id)
            }
          }
        }
      }
    }

    return { newUnlocks }
  } catch (err) {
    console.error('[achievements] check error:', err)
    return { newUnlocks: [] }
  }
}

// 获取用户最大连击
async function getMaxStreak(userId: string) {
  try {
    const result = await pool.query(`
      SELECT date FROM check_records 
      WHERE user_id = $1 
      ORDER BY date DESC
    `, [userId])

    if (result.rows.length === 0) return { maxStreak: 0, currentStreak: 0 }

    const dates = [...new Set(result.rows.map(r => r.date))].sort().reverse()
    let maxStreak = 0
    let currentStreak = 0
    let tempStreak = 1

    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

    for (let i = 0; i < dates.length; i++) {
      if (i === 0) {
        if (dates[i] === today || dates[i] === yesterday) {
          currentStreak = 1
        }
      } else {
        const prev = new Date(dates[i - 1])
        const curr = new Date(dates[i])
        const diff = (prev.getTime() - curr.getTime()) / 86400000

        if (diff === 1) {
          tempStreak++
          if (currentStreak > 0) currentStreak++
        } else {
          maxStreak = Math.max(maxStreak, tempStreak)
          tempStreak = 1
          currentStreak = 0
        }
      }
    }
    maxStreak = Math.max(maxStreak, tempStreak)

    return { maxStreak, currentStreak }
  } catch (err) {
    console.error('[achievements] streak error:', err)
    return { maxStreak: 0, currentStreak: 0 }
  }
}

// 获取周末打卡的周数
async function getWeekendStreakWeeks(userId: string) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT date FROM check_records 
      WHERE user_id = $1 
      AND EXTRACT(DOW FROM date::date) IN (0, 6)
      ORDER BY date DESC
    `, [userId])

    if (result.rows.length === 0) return 0

    // 按周分组
    const weeks = new Set<string>()
    for (const row of result.rows) {
      const d = new Date(row.date)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      weeks.add(weekStart.toISOString().split('T')[0])
    }

    // 检查连续周数
    const sortedWeeks = [...weeks].sort().reverse()
    let streakWeeks = 0
    let expectedWeek: string | null = null

    for (const week of sortedWeeks) {
      if (!expectedWeek) {
        streakWeeks = 1
        const prevWeek: Date = new Date(week)
        prevWeek.setDate(prevWeek.getDate() - 7)
        expectedWeek = prevWeek.toISOString().split('T')[0]
      } else if (week === expectedWeek) {
        streakWeeks++
        const prevWeek: Date = new Date(week)
        prevWeek.setDate(prevWeek.getDate() - 7)
        expectedWeek = prevWeek.toISOString().split('T')[0]
      } else {
        break
      }
    }

    return streakWeeks
  } catch (err) {
    return 0
  }
}

// 检查是否完美一周（过去7天每天都打卡）
async function checkPerfectWeek(userId: string) {
  try {
    const today = new Date()
    const weekAgo = new Date(today)
    weekAgo.setDate(today.getDate() - 7)

    const result = await pool.query(`
      SELECT DISTINCT date FROM check_records 
      WHERE user_id = $1 AND date >= $2 AND date <= $3
    `, [userId, weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]])

    return result.rows.length >= 7
  } catch (err) {
    return false
  }
}

export default achievements
