import crypto from 'node:crypto'
import { z } from 'zod'

// @req FR-054 — prove the dedicated LINE database login is isolated before activation.
// @spec SDD-027, SEC-011 — assertions are read-only, redacted and always rolled back.
// @tested tests/unit/runtime-isolation-probe.test.js

const DEDICATED_LOGIN_ROLE = 'zuri_line_smartgift_login'
const POLICY_READ_ROLE = 'zuri_line_smartgift_ro'

const zScope = z.object({
  tenantId: z.string().uuid(),
  businessId: z.string().uuid(),
  crossTenantId: z.string().uuid(),
}).strict().refine((value) => value.tenantId !== value.crossTenantId, {
  message: 'RUNTIME_ISOLATION_CROSS_TENANT_REQUIRED',
  path: ['crossTenantId'],
})

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

function parseTarget(databaseUrl) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('RUNTIME_ISOLATION_DATABASE_URL_INVALID')
  }
  const role = decodeURIComponent(url.username)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || role !== DEDICATED_LOGIN_ROLE) {
    throw new Error('RUNTIME_ISOLATION_DATABASE_ROLE_FORBIDDEN')
  }
  return {
    hostFingerprint: fingerprint(url.hostname.toLowerCase()),
    roleFingerprint: fingerprint(role),
  }
}

function count(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1
}

export async function runRuntimeIsolationProbe({ client, databaseUrl, scope, now = () => new Date() }) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('RUNTIME_ISOLATION_CLIENT_REQUIRED')
  }
  const target = parseTarget(databaseUrl)
  const parsedScope = zScope.parse(scope)
  const assertions = {
    exactPositiveScope: { passed: false, visibleCount: -1, outOfScopeCount: -1 },
    crossTenantDenied: { passed: false, visibleCount: -1 },
    directGrantDenied: { passed: false },
    mutationDeniedAndRolledBack: {
      passed: false,
      rolledBack: false,
      reason: 'MUTATION_ASSERTION_NOT_RUN',
    },
  }
  let transactionStarted = false
  let probeFailure = null

  try {
    await client.query('begin')
    transactionStarted = true

    const directGrantResult = await client.query(`
      select
        current_user as login_role,
        has_schema_privilege(current_user, 'zuri_core', 'USAGE') as has_direct_schema_usage,
        has_table_privilege(current_user, 'zuri_core.business_knowledge', 'SELECT') as has_direct_table_select
    `)
    const direct = directGrantResult.rows?.[0] ?? {}
    assertions.directGrantDenied.passed = direct.login_role === DEDICATED_LOGIN_ROLE
      && direct.has_direct_schema_usage === false
      && direct.has_direct_table_select === false

    await client.query(`set local role ${POLICY_READ_ROLE}`)

    const scopeResult = await client.query(`
      select
        count(*)::integer as visible_count,
        count(*) filter (
          where tenant_id <> $1::uuid or business_id <> $2::uuid
        )::integer as out_of_scope_count
      from zuri_core.business_knowledge
    `, [parsedScope.tenantId, parsedScope.businessId])
    const visibleCount = count(scopeResult.rows?.[0]?.visible_count)
    const outOfScopeCount = count(scopeResult.rows?.[0]?.out_of_scope_count)
    assertions.exactPositiveScope = {
      passed: visibleCount > 0 && outOfScopeCount === 0,
      visibleCount,
      outOfScopeCount,
    }

    const crossTenantResult = await client.query(`
      select count(*)::integer as cross_tenant_visible_count
      from zuri_core.business_knowledge
      where tenant_id = $1::uuid
    `, [parsedScope.crossTenantId])
    const crossTenantVisibleCount = count(crossTenantResult.rows?.[0]?.cross_tenant_visible_count)
    assertions.crossTenantDenied = {
      passed: crossTenantVisibleCount === 0,
      visibleCount: crossTenantVisibleCount,
    }

    try {
      await client.query(`
        update zuri_core.business_knowledge
        set name = name
        where tenant_id = $1::uuid and business_id = $2::uuid and false
      `, [parsedScope.tenantId, parsedScope.businessId])
      assertions.mutationDeniedAndRolledBack.reason = 'MUTATION_WAS_NOT_DENIED'
    } catch (error) {
      if (error?.code === '42501') {
        assertions.mutationDeniedAndRolledBack.reason = 'MUTATION_DENIED'
      } else {
        assertions.mutationDeniedAndRolledBack.reason = 'MUTATION_ASSERTION_FAILED'
      }
    }
  } catch {
    probeFailure = 'RUNTIME_ISOLATION_QUERY_FAILED'
  } finally {
    if (transactionStarted) {
      try {
        await client.query('rollback')
        assertions.mutationDeniedAndRolledBack.rolledBack = true
      } catch {
        probeFailure = 'RUNTIME_ISOLATION_ROLLBACK_FAILED'
      }
    }
  }

  const mutation = assertions.mutationDeniedAndRolledBack
  mutation.passed = mutation.reason === 'MUTATION_DENIED' && mutation.rolledBack
  if (mutation.passed) delete mutation.reason

  const passed = !probeFailure && Object.values(assertions).every((assertion) => assertion.passed)
  return {
    version: '1.0.0',
    observedAt: now().toISOString(),
    status: passed ? 'PASS' : 'FAIL',
    target,
    assertions,
    ...(probeFailure ? { reason: probeFailure } : {}),
  }
}

export function parseRuntimeIsolationEnvironment(env = process.env) {
  const required = {
    databaseUrl: env.ZURI_LINE_DB_URL,
    tenantId: env.ZURI_LINE_ISOLATION_TENANT_ID,
    businessId: env.ZURI_LINE_ISOLATION_BUSINESS_ID,
    crossTenantId: env.ZURI_LINE_ISOLATION_CROSS_TENANT_ID,
  }
  if (Object.values(required).some((value) => !value)) {
    throw new Error('RUNTIME_ISOLATION_CONFIGURATION_MISSING')
  }
  const scope = zScope.parse({
    tenantId: required.tenantId,
    businessId: required.businessId,
    crossTenantId: required.crossTenantId,
  })
  parseTarget(required.databaseUrl)
  return { databaseUrl: required.databaseUrl, scope }
}

export async function runRuntimeIsolationProbeFromEnv({ client, env = process.env, now }) {
  const config = parseRuntimeIsolationEnvironment(env)
  return runRuntimeIsolationProbe({
    client,
    databaseUrl: config.databaseUrl,
    scope: config.scope,
    now,
  })
}
