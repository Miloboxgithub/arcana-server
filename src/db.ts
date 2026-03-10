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
  `)

  // 列迁移：检测并添加缺失的列
  await pool.query(`
    ALTER TABLE habits ADD COLUMN IF NOT EXISTS dimensions JSONB DEFAULT '[{"dimension":"pro","exp":10}]'
  `).catch(() => {}) // 忽略已存在的列

  // 为已有的 dimensions 列填充数据（如果 dimension 有值但 dimensions 为 NULL）
  await pool.query(`
    UPDATE habits 
    SET dimensions = jsonb_build_array(jsonb_build_object('dimension', dimension, 'exp', COALESCE(exp, 10)))
    WHERE dimensions IS NULL AND dimension IS NOT NULL
  `).catch(() => {})

  console.log('[db] schema ready')
}
