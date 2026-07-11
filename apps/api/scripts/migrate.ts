import { getPool } from '../src/db/pool.js'
import { migrations } from '../src/db/migrations.js'

const pool = getPool()

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  for (const migration of migrations) {
    const exists = await pool.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [migration.id])
    if (exists.rowCount) continue

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(migration.sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
      await client.query('COMMIT')
      console.log(`Applied ${migration.id}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
} finally {
  await pool.end()
}
