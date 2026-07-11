import { getPool } from '../src/db/pool.js'
import MemorySeedService from '../src/services/memory_seed_service.js'

try {
  await new MemorySeedService().seed(process.env.MEMORY_WORKSPACE_ID?.trim() || 'hackathon-demo')
  console.log('Seeded organizational memory demo')
} finally {
  await getPool().end()
}
