import { getPool } from '../src/db/pool.js'
import CapabilitiesRepository from '../src/repositories/capabilities_repository.js'
import { DEMO_WORKSPACE_ID } from '../src/data/capability_demo_data.js'

const pool = getPool()

try {
  await new CapabilitiesRepository().seedDemo(DEMO_WORKSPACE_ID)
  console.log(`Seeded clean-room organizational memory data for ${DEMO_WORKSPACE_ID}`)
} finally {
  await pool.end()
}
