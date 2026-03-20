import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.DATABASE_URL?.includes('neon')
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
})

pool.on('error', (err) => {
  console.error('[db] pool error:', err.message)
})

export { pool }

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      username    TEXT,
      avatar_id   TEXT DEFAULT 'joker',
      onboarding_done BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS habits (
      id          TEXT PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      slot        TEXT NOT NULL DEFAULT 'morning',
      exp         INT NOT NULL DEFAULT 10,
      dimension   TEXT NOT NULL DEFAULT 'pro',
      dimensions  JSONB DEFAULT '[{"dimension":"pro","exp":10}]',
      is_anchor   BOOLEAN DEFAULT FALSE,
      streak      INT DEFAULT 0,
      active      BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS check_records (
      id          TEXT PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      habit_id    TEXT NOT NULL,
      date        TEXT NOT NULL,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS cr_user_date ON check_records(user_id, date);

    CREATE TABLE IF NOT EXISTS dimensions (
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dim_id      TEXT NOT NULL,
      total_exp   INT NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, dim_id)
    );

    -- 成就定义表（系统预设）
    CREATE TABLE IF NOT EXISTS achievement_definitions (
      id          TEXT PRIMARY KEY,
      category    TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      icon        TEXT NOT NULL,
      target      INT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_param JSONB DEFAULT '{}',
      exp_reward  INT NOT NULL DEFAULT 50,
      rarity      TEXT NOT NULL DEFAULT 'common',
      is_hidden   BOOLEAN DEFAULT FALSE
    );

    -- 用户成就进度表
    CREATE TABLE IF NOT EXISTS user_achievements (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      progress    INT NOT NULL DEFAULT 0,
      unlocked_at TIMESTAMPTZ,
      notified    BOOLEAN DEFAULT FALSE,
      UNIQUE(user_id, achievement_id)
    );

    CREATE INDEX IF NOT EXISTS ua_user ON user_achievements(user_id);

    CREATE TABLE IF NOT EXISTS weekly_reports (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start  TEXT NOT NULL,
      week_end    TEXT NOT NULL,
      total_checks INT NOT NULL DEFAULT 0,
      total_exp   INT NOT NULL DEFAULT 0,
      streak_start TEXT,
      streak_end  TEXT,
      streak_days INT DEFAULT 0,
      dim_changes JSONB DEFAULT '{}',
      top_habits  JSONB DEFAULT '[]',
      highlights  JSONB DEFAULT '[]',
      suggestions JSONB DEFAULT '[]',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, week_start)
    );

    CREATE INDEX IF NOT EXISTS wr_user_week ON weekly_reports(user_id, week_start DESC);

    -- 用户通知表
    CREATE TABLE IF NOT EXISTS user_notifications (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,  -- 'slack_warning' | 'streak_milestone' | 'weekly_report' | 'achievement_unlock' | 'ai_insight'
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      data        JSONB DEFAULT '{}',
      read        BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS un_user ON user_notifications(user_id, created_at DESC);
  `)

  // 列迁移：检测并添加缺失的列
  await pool.query(`
    ALTER TABLE habits ADD COLUMN IF NOT EXISTS dimensions JSONB DEFAULT '[{"dimension":"pro","exp":10}]'
  `).catch(() => {})

  // 为已有的 dimensions 列填充数据（如果 dimension 有值但 dimensions 为 NULL）
  await pool.query(`
    UPDATE habits 
    SET dimensions = jsonb_build_array(jsonb_build_object('dimension', dimension, 'exp', COALESCE(exp, 10)))
    WHERE dimensions IS NULL AND dimension IS NOT NULL
  `).catch(() => {})

  // 插入成就定义（如果不存在）
  await seedAchievements()

  console.log('[db] schema ready')
}

// 成就种子数据
async function seedAchievements() {
  const achievements = [
    // === 怪盗初临（入门）===
    { id: 'first_checkin', category: 'beginner', name: '怪盗初临', description: '完成第一次打卡', icon: '⚡', target: 1, trigger_type: 'total_checks', exp_reward: 30, rarity: 'common' },
    { id: 'first_habit', category: 'beginner', name: '签订契约', description: '创建第一个习惯', icon: '📜', target: 1, trigger_type: 'total_habits', exp_reward: 20, rarity: 'common' },
    { id: 'first_dim', category: 'beginner', name: '人格觉醒', description: '任意维度达到 Lv.2', icon: '🎭', target: 2, trigger_type: 'dimension_level', trigger_param: { dim_id: 'any', level: 2 }, exp_reward: 50, rarity: 'common' },
    { id: 'streak_3', category: 'beginner', name: '初试连击', description: '连续打卡 3 天', icon: '🔥', target: 3, trigger_type: 'streak', exp_reward: 30, rarity: 'common' },
    { id: 'onboarding', category: 'beginner', name: '怪盗档案', description: '完成新手引导', icon: '📋', target: 1, trigger_type: 'onboarding', exp_reward: 20, rarity: 'common' },

    // === 连锁反应（连续打卡）===
    { id: 'streak_7', category: 'streak', name: '连锁之力', description: '连续打卡 7 天', icon: '🔗', target: 7, trigger_type: 'streak', exp_reward: 80, rarity: 'uncommon' },
    { id: 'streak_14', category: 'streak', name: '十四日之影', description: '连续打卡 14 天', icon: '🌐', target: 14, trigger_type: 'streak', exp_reward: 150, rarity: 'uncommon' },
    { id: 'streak_21', category: 'streak', name: '三周之证', description: '连续打卡 21 天', icon: '⏳', target: 21, trigger_type: 'streak', exp_reward: 250, rarity: 'rare' },
    { id: 'streak_30', category: 'streak', name: '月之怪盗', description: '连续打卡 30 天', icon: '🌙', target: 30, trigger_type: 'streak', exp_reward: 400, rarity: 'rare' },
    { id: 'streak_66', category: 'streak', name: '陆下六芒星', description: '连续打卡 66 天', icon: '⭐', target: 66, trigger_type: 'streak', exp_reward: 666, rarity: 'epic' },
    { id: 'streak_100', category: 'streak', name: '百日大师', description: '连续打卡 100 天', icon: '👑', target: 100, trigger_type: 'streak', exp_reward: 1000, rarity: 'legendary' },

    // === 秘宝收集（维度成长）===
    { id: 'dim_pro_5', category: 'dimension', name: '学者之路', description: '专业力达到 Lv.5', icon: '📚', target: 5, trigger_type: 'dimension_level', trigger_param: { dim_id: 'pro' }, exp_reward: 200, rarity: 'uncommon' },
    { id: 'dim_pro_10', category: 'dimension', name: '学识之王', description: '专业力达到 Lv.10', icon: '🎓', target: 10, trigger_type: 'dimension_level', trigger_param: { dim_id: 'pro' }, exp_reward: 500, rarity: 'rare' },
    { id: 'dim_fitness_5', category: 'dimension', name: '体能觉醒', description: '体能达到 Lv.5', icon: '💪', target: 5, trigger_type: 'dimension_level', trigger_param: { dim_id: 'fitness' }, exp_reward: 200, rarity: 'uncommon' },
    { id: 'dim_social_5', category: 'dimension', name: '社交达人', description: '社交达到 Lv.5', icon: '🤝', target: 5, trigger_type: 'dimension_level', trigger_param: { dim_id: 'social' }, exp_reward: 200, rarity: 'uncommon' },
    { id: 'all_dim_3', category: 'dimension', name: '全能怪盗', description: '六项维度全部达到 Lv.3', icon: '🌟', target: 6, trigger_type: 'all_dimensions_level', trigger_param: { level: 3 }, exp_reward: 300, rarity: 'rare' },

    // === 星辰大海（累计里程碑）===
    { id: 'total_10', category: 'milestone', name: '十次之战', description: '累计打卡 10 次', icon: '🎯', target: 10, trigger_type: 'total_checks', exp_reward: 50, rarity: 'common' },
    { id: 'total_50', category: 'milestone', name: '五十次之证', description: '累计打卡 50 次', icon: '🛡️', target: 50, trigger_type: 'total_checks', exp_reward: 150, rarity: 'uncommon' },
    { id: 'total_100', category: 'milestone', name: '百次之王', description: '累计打卡 100 次', icon: '🏆', target: 100, trigger_type: 'total_checks', exp_reward: 300, rarity: 'rare' },
    { id: 'total_500', category: 'milestone', name: '五百次贤者', description: '累计打卡 500 次', icon: '🔮', target: 500, trigger_type: 'total_checks', exp_reward: 800, rarity: 'epic' },
    { id: 'total_1000', category: 'milestone', name: '千次传奇', description: '累计打卡 1000 次', icon: '💎', target: 1000, trigger_type: 'total_checks', exp_reward: 1500, rarity: 'legendary' },

    // === 异世界（特殊时刻）===
    { id: 'morning_warrior', category: 'special', name: '晨间战士', description: '在 6:00-8:00 完成打卡', icon: '🌅', target: 1, trigger_type: 'time_slot', trigger_param: { start: '06:00', end: '08:00' }, exp_reward: 50, rarity: 'uncommon' },
    { id: 'night_owl', category: 'special', name: '深夜怪盗', description: '在 22:00-24:00 完成打卡', icon: '🦉', target: 1, trigger_type: 'time_slot', trigger_param: { start: '22:00', end: '24:00' }, exp_reward: 50, rarity: 'uncommon' },
    { id: 'weekend_warrior', category: 'special', name: '周末猎手', description: '连续 4 周在周末打卡', icon: '🎪', target: 4, trigger_type: 'weekend_streak', exp_reward: 200, rarity: 'rare' },
    { id: 'exp_1000', category: 'special', name: '千人之力', description: '累计获得 1000 经验', icon: '⚡', target: 1000, trigger_type: 'total_exp', exp_reward: 100, rarity: 'uncommon' },

    // === 阴影行者（隐藏成就）===
    { id: 'hidden_perfect_week', category: 'hidden', name: '完美一周', description: '一周 7 天全部打卡', icon: '💯', target: 7, trigger_type: 'perfect_week', exp_reward: 300, rarity: 'rare', is_hidden: true },
    { id: 'hidden_no_break', category: 'hidden', name: '永动机', description: '连续打卡期间不中断', icon: '🔄', target: 50, trigger_type: 'streak_no_break', exp_reward: 500, rarity: 'epic', is_hidden: true },
    { id: 'hidden_early_bird', category: 'hidden', name: '早起的鸟儿', description: '累计早起打卡 10 次', icon: '🐦', target: 10, trigger_type: 'early_bird_count', exp_reward: 150, rarity: 'uncommon', is_hidden: true },
    { id: 'hidden_all_slots', category: 'hidden', name: '四界之主', description: '同时拥有早/午/晚/夜四种习惯', icon: '🌞', target: 4, trigger_type: 'all_slots', trigger_param: { slots: ['morning', 'afternoon', 'evening', 'night'] }, exp_reward: 200, rarity: 'rare', is_hidden: true },
  ]

  for (const a of achievements) {
    await pool.query(`
      INSERT INTO achievement_definitions (id, category, name, description, icon, target, trigger_type, trigger_param, exp_reward, rarity, is_hidden)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING
    `, [a.id, a.category, a.name, a.description, a.icon, a.target, a.trigger_type, JSON.stringify(a.trigger_param || {}), a.exp_reward, a.rarity, a.is_hidden || false])
  }
}
