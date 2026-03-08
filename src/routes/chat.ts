import { Hono } from 'hono'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

const MINIMAX_BASE = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1'
const MINIMAX_KEY = process.env.MINIMAX_API_KEY || ''

// POST /api/chat — 莫尔加纳对话
app.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { messages, system } = await c.req.json()

  if (!MINIMAX_KEY) return c.json({ error: 'AI not configured' }, 503)

  try {
    const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...(messages ?? []),
        ],
        temperature: 0.85,
        max_tokens: 400,
        top_p: 0.95,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[chat] MiniMax error:', res.status, errText)
      return c.json({ error: 'AI service error' }, 502)
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const reply = data.choices?.[0]?.message?.content?.trim() || ''
    return c.json({ reply })
  } catch (e) {
    console.error('[chat] error:', e)
    return c.json({ error: 'AI unavailable' }, 503)
  }
})

// POST /api/chat/analyze — 智能分析输入，判断是否添加经验值
app.post('/analyze', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { prompt, system } = await c.req.json()

  if (!MINIMAX_KEY) return c.json({ error: 'AI not configured' }, 503)

  // 组合完整的 prompt
  const fullSystem = system || '你是 ARCANA 系统的经验值分析器。'

  try {
    const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          { role: 'system', content: fullSystem },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3, // 低温度，更确定性的输出
        max_tokens: 500,
        top_p: 0.9,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[chat/analyze] MiniMax error:', res.status, errText)
      return c.json({ error: 'AI service error' }, 502)
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content?.trim() || ''

    // 解析 JSON 响应 - 支持多维度格式
    let result: {
      shouldAddExp: boolean
      dimension: string | null
      exp: number
      dimensions?: Array<{ dimension: string; exp: number }>
      reason: string
    }

    try {
      // 尝试提取 JSON（可能有额外文本）
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found')
      }
    } catch (parseErr) {
      console.error('[chat/analyze] JSON parse error:', parseErr, 'content:', content)
      // 解析失败，返回默认结果
      return c.json({
        shouldAddExp: false,
        dimension: null,
        exp: 0,
        reason: '无法分析输入',
      })
    }

    // 如果判断应该添加经验值，则更新数据库
    const validDimensions = ['pro', 'fitness', 'social', 'create', 'self', 'charm']
    
    // 处理多维度情况
    if (result.dimensions && Array.isArray(result.dimensions) && result.dimensions.length > 0) {
      for (const dimExp of result.dimensions) {
        if (validDimensions.includes(dimExp.dimension)) {
          try {
            await pool.query(
              `INSERT INTO dimensions (user_id, dim_id, total_exp)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id, dim_id)
               DO UPDATE SET total_exp = dimensions.total_exp + $3`,
              [userId, dimExp.dimension, dimExp.exp]
            )
            console.log(`[chat/analyze] Added ${dimExp.exp} EXP to ${dimExp.dimension} for user ${userId}`)
          } catch (dbErr) {
            console.error('[chat/analyze] DB update error:', dbErr)
          }
        }
      }
      // 返回第一个维度作为主维度（兼容前端）
      return c.json({
        shouldAddExp: true,
        dimension: result.dimensions[0].dimension,
        exp: result.dimensions.reduce((s, d) => s + d.exp, 0),
        dimensions: result.dimensions,
        reason: result.reason || '多维度经验值已添加',
      })
    }
    
    // 处理单维度情况（向后兼容）
    if (result.shouldAddExp && result.dimension) {
      if (validDimensions.includes(result.dimension)) {
        try {
          await pool.query(
            `INSERT INTO dimensions (user_id, dim_id, total_exp)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, dim_id)
             DO UPDATE SET total_exp = dimensions.total_exp + $3`,
            [userId, result.dimension, result.exp]
          )
          console.log(`[chat/analyze] Added ${result.exp} EXP to ${result.dimension} for user ${userId}`)
        } catch (dbErr) {
          console.error('[chat/analyze] DB update error:', dbErr)
        }
      }
    }

    return c.json(result)
  } catch (e) {
    console.error('[chat/analyze] error:', e)
    return c.json({ error: 'AI unavailable' }, 503)
  }
})

// GET /api/chat/profile — user context for AI (habits + dimensions)
app.get('/profile', requireAuth, async (c) => {
  const userId = c.get('userId')
  const [habitsRes, dimsRes] = await Promise.all([
    pool.query(`SELECT name, slot, exp, dimension FROM habits WHERE user_id=$1 AND active=TRUE`, [userId]),
    pool.query(`SELECT dim_id, total_exp FROM dimensions WHERE user_id=$1`, [userId]),
  ])
  return c.json({ habits: habitsRes.rows, dimensions: dimsRes.rows })
})

export default app
