import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.DATABASE_URL?.includes('neon')
    ? { rejectUnauthorized: false }
    : false,
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
  console.log('[db] schema ready')
}
