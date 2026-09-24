import { z } from 'zod'

// The only reader of process.env (via main.js). Validated once at start; a bad
// value fails the process before it listens, never at the first request.
const zConfig = z.object({
  SCM_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SCM_PORT: z.coerce.number().int().min(0).max(65535).default(3084),
  SCM_HOST: z.string().default('127.0.0.1'),
  SCM_STORE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  SCM_SQLITE_PATH: z.string().min(1).optional(),
  // postgres://… of the SCM-owned database. A secret (it may carry a password):
  // validated by shape only and never logged.
  SCM_PG_URL: z.string().regex(/^postgres(ql)?:\/\//, 'SCM_PG_URL must be a postgres:// URL').optional(),
  SCM_ENSURE_SCHEMA: z.enum(['0', '1']).default('0'),
  SCM_DELEGATION_KEY: z.string().min(32, 'SCM_DELEGATION_KEY must be at least 32 characters'),
  SCM_DELEGATION_ISSUER: z.string().min(1).default('zuri-core'),
  SCM_DELEGATION_MAX_LIFETIME_S: z.coerce.number().int().min(10).max(900).default(120),
  SCM_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(4 * 1024 * 1024).default(256 * 1024),
  SCM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  // Test/rehearsal only: a synthetic ReferenceAuthority fixture file. Refused outside SCM_ENV=test.
  SCM_TEST_REFERENCE_FIXTURE: z.string().min(1).optional(),
})

export function loadConfig(env) {
  const parsed = zConfig.safeParse(env)
  if (!parsed.success) {
    // Names only — never echo a value (the delegation key is a secret).
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw Object.assign(new Error(`invalid SCM configuration: ${fields}`), { code: 'SCM_CONFIG_INVALID' })
  }
  const c = parsed.data
  if (c.SCM_STORE === 'sqlite' && !c.SCM_SQLITE_PATH) throw Object.assign(new Error('invalid SCM configuration: SCM_SQLITE_PATH'), { code: 'SCM_CONFIG_INVALID' })
  if (c.SCM_STORE === 'postgres' && !c.SCM_PG_URL) throw Object.assign(new Error('invalid SCM configuration: SCM_PG_URL'), { code: 'SCM_CONFIG_INVALID' })
  // A production process never creates its own schema: migration ordering belongs
  // to the integrator (one owner), not to every service start.
  if (c.SCM_ENV === 'production' && c.SCM_ENSURE_SCHEMA === '1') throw Object.assign(new Error('SCM_ENSURE_SCHEMA is refused in production'), { code: 'SCM_CONFIG_INVALID' })
  if (c.SCM_TEST_REFERENCE_FIXTURE && c.SCM_ENV !== 'test') throw Object.assign(new Error('SCM_TEST_REFERENCE_FIXTURE is only allowed with SCM_ENV=test'), { code: 'SCM_CONFIG_INVALID' })
  return {
    env: c.SCM_ENV, port: c.SCM_PORT, host: c.SCM_HOST, store: c.SCM_STORE, sqlitePath: c.SCM_SQLITE_PATH ?? null, pgUrl: c.SCM_PG_URL ?? null,
    ensureSchema: c.SCM_ENSURE_SCHEMA === '1', delegationKey: c.SCM_DELEGATION_KEY, delegationIssuer: c.SCM_DELEGATION_ISSUER,
    delegationMaxLifetimeSeconds: c.SCM_DELEGATION_MAX_LIFETIME_S, maxBodyBytes: c.SCM_MAX_BODY_BYTES, requestTimeoutMs: c.SCM_REQUEST_TIMEOUT_MS,
    testReferenceFixture: c.SCM_TEST_REFERENCE_FIXTURE ?? null,
  }
}
