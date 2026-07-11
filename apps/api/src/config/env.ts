import 'dotenv/config'

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

export function useDatabaseSsl(): boolean {
  return (process.env.PGSSLMODE ?? '').toLowerCase() === 'require'
}

