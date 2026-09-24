import { z } from 'zod'

// Environment → validated config. The only module besides main.js that may read
// process.env (it receives it as an argument, so tests pass their own). Production
// refuses every development convenience instead of warning about it (ADR-108 D6):
// sqlite, schema creation, assumed execution ownership and plain-http core.
// @req NFR-018
// @spec SEC-017, ADR-108
// @tested services/market-intelligence/test/config.test.js

const secret = z.string().min(32, 'must be at least 32 characters')
const flag = z.enum(['0', '1']).default('0').transform((value) => value === '1')

const zEnv = z.object({
  MARKET_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MARKET_PORT: z.coerce.number().int().min(0).max(65535).default(3082),
  MARKET_API_TOKEN: secret,
  MARKET_CORE_URL: z.string().url(),
  MARKET_CORE_TOKEN: secret,
  MARKET_STORE: z.enum(['sqlite', 'postgres']),
  MARKET_SQLITE_PATH: z.string().min(1).optional(),
  MARKET_DATABASE_URL: z.string().min(1).optional(),
  MARKET_STORE_ENSURE_SCHEMA: flag,
  MARKET_TEST_ASSUME_EXECUTION_OWNER: flag,
})

export function loadConfig(env) {
  const parsed = zEnv.parse(env)
  const production = parsed.MARKET_ENV === 'production'
  const problems = []

  if (parsed.MARKET_STORE === 'sqlite' && !parsed.MARKET_SQLITE_PATH) problems.push('MARKET_SQLITE_PATH is required for sqlite')
  if (parsed.MARKET_STORE === 'postgres' && !parsed.MARKET_DATABASE_URL) problems.push('MARKET_DATABASE_URL is required for postgres')
  if (parsed.MARKET_API_TOKEN === parsed.MARKET_CORE_TOKEN) problems.push('MARKET_API_TOKEN and MARKET_CORE_TOKEN must differ')
  if (production) {
    if (parsed.MARKET_STORE !== 'postgres') problems.push('production requires MARKET_STORE=postgres')
    if (parsed.MARKET_STORE_ENSURE_SCHEMA) problems.push('production must not create schema (MARKET_STORE_ENSURE_SCHEMA)')
    if (parsed.MARKET_TEST_ASSUME_EXECUTION_OWNER) problems.push('production must ask core for execution ownership')
    if (new URL(parsed.MARKET_CORE_URL).protocol !== 'https:' && !/^http:\/\/[a-z0-9-]+(:\d+)?$/i.test(parsed.MARKET_CORE_URL.replace(/\/$/, ''))) {
      problems.push('production core URL must be https or a private service name')
    }
  }
  if (problems.length) throw new Error(`Invalid Market service configuration: ${problems.join('; ')}`)

  return Object.freeze({
    env: parsed.MARKET_ENV,
    production,
    port: parsed.MARKET_PORT,
    apiToken: parsed.MARKET_API_TOKEN,
    coreUrl: parsed.MARKET_CORE_URL,
    coreToken: parsed.MARKET_CORE_TOKEN,
    store: parsed.MARKET_STORE,
    sqlitePath: parsed.MARKET_SQLITE_PATH ?? null,
    databaseUrl: parsed.MARKET_DATABASE_URL ?? null,
    ensureSchema: parsed.MARKET_STORE_ENSURE_SCHEMA,
    assumeExecutionOwner: parsed.MARKET_TEST_ASSUME_EXECUTION_OWNER,
  })
}
