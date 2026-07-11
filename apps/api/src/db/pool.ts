import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { requireEnv, useDatabaseSsl } from '../config/env.js'

declare global {
  var hackathonFrameworkPool: Pool | undefined
}

export function getPool(): Pool {
  if (!globalThis.hackathonFrameworkPool) {
    globalThis.hackathonFrameworkPool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      options: '-c statement_timeout=15000',
      ssl: useDatabaseSsl() ? { rejectUnauthorized: false } : undefined,
    })
  }

  return globalThis.hackathonFrameworkPool
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values)
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

