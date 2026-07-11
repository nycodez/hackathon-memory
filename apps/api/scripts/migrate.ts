import { getPool } from '../src/db/pool.js'
import { applyPendingMigrations } from '../src/services/migration_service.js'

try {
  const applied = await applyPendingMigrations()
  for (const id of applied) console.log(`Applied ${id}`)
} finally {
  await getPool().end()
}
