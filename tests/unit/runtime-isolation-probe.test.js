import { describe, expect, it, vi } from 'vitest'
import {
  runRuntimeIsolationProbe,
  runRuntimeIsolationProbeFromEnv,
} from '@/modules/knowledge/runtime-isolation-probe'

// @req FR-054 — activation readiness proves the dedicated runtime login is scope-isolated.
// @spec SDD-027, SEC-011 — probe output is redacted and every mutation assertion rolls back.
// @tested tests/unit/runtime-isolation-probe.test.js

const scope = {
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  crossTenantId: 'ef2552ce-ff10-4b1f-8212-d0a729f5a159',
}

function connectionUrl({ role, password, host }) {
  const url = new URL('postgresql://placeholder.invalid/postgres')
  url.username = role
  url.password = password
  url.hostname = host
  url.port = '5432'
  url.searchParams.set('sslmode', 'require')
  return url.toString()
}

const fakePassword = ['do', 'not', 'print'].join('-')
const databaseUrl = connectionUrl({
  role: 'zuri_line_smartgift_login',
  password: fakePassword,
  host: 'db.qcnmhyglarzcpudjorzc.supabase.co',
})

const poolerDatabaseUrl = connectionUrl({
  role: 'zuri_line_smartgift_login.qcnmhyglarzcpudjorzc',
  password: fakePassword,
  host: 'aws-0-ap-northeast-2.pooler.supabase.com',
})

function fakeClient({ mutationDenied = true } = {}) {
  return {
    query: vi.fn(async (sql) => {
      const normalized = String(sql).toLowerCase()
      if (normalized.includes('has_schema_privilege')) {
        return { rows: [{
          login_role: 'zuri_line_smartgift_login',
          has_direct_schema_usage: false,
          has_direct_table_select: false,
        }] }
      }
      if (normalized.includes('out_of_scope_count')) {
        return { rows: [{ visible_count: 74, out_of_scope_count: 0 }] }
      }
      if (normalized.includes('cross_tenant_visible_count')) {
        return { rows: [{ cross_tenant_visible_count: 0 }] }
      }
      if (normalized.trimStart().startsWith('update ')) {
        if (!mutationDenied) return { rowCount: 0, rows: [] }
        const error = new Error(`permission denied for ${databaseUrl}`)
        error.code = '42501'
        throw error
      }
      return { rows: [] }
    }),
  }
}

describe('runtime database isolation probe (FR-054)', () => {
  it('proves positive scope, cross-Tenant denial, direct-grant denial and rolled-back mutation', async () => {
    const client = fakeClient()
    const report = await runRuntimeIsolationProbe({
      client,
      databaseUrl,
      scope,
      now: () => new Date('2026-08-14T01:23:45.000Z'),
    })

    expect(report).toMatchObject({
      version: '1.0.0',
      observedAt: '2026-08-14T01:23:45.000Z',
      status: 'PASS',
      assertions: {
        exactPositiveScope: { passed: true, visibleCount: 74, outOfScopeCount: 0 },
        crossTenantDenied: { passed: true, visibleCount: 0 },
        directGrantDenied: { passed: true },
        mutationDeniedAndRolledBack: { passed: true, rolledBack: true },
      },
    })
    expect(client.query.mock.calls.at(-1)).toEqual(['rollback'])
    expect(client.query.mock.calls.some(([sql]) => /commit/i.test(sql))).toBe(false)
  })

  it('binds UUID-shaped scope values using the deployed PostgreSQL text contract', async () => {
    const client = fakeClient()
    await runRuntimeIsolationProbe({ client, databaseUrl, scope })

    const sql = client.query.mock.calls.map(([statement]) => String(statement)).join('\n')
    expect(sql).not.toContain('::uuid')
    expect(sql.match(/\$[12]::text/g)).toHaveLength(5)
  })

  it('fails closed and still rolls back when the mutation unexpectedly succeeds', async () => {
    const client = fakeClient({ mutationDenied: false })
    const report = await runRuntimeIsolationProbe({ client, databaseUrl, scope })

    expect(report.status).toBe('FAIL')
    expect(report.assertions.mutationDeniedAndRolledBack).toEqual({
      passed: false,
      rolledBack: true,
      reason: 'MUTATION_WAS_NOT_DENIED',
    })
    expect(client.query.mock.calls.at(-1)).toEqual(['rollback'])
  })

  it('serializes only fingerprints and never the password, full URL, host, role or database error', async () => {
    const client = fakeClient()
    const report = await runRuntimeIsolationProbe({ client, databaseUrl, scope })
    const serialized = JSON.stringify(report)

    expect(report.target).toMatchObject({ hostFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{12}$/), roleFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{12}$/) })
    expect(serialized).not.toContain(databaseUrl)
    expect(serialized).not.toContain(fakePassword)
    expect(serialized).not.toContain('db.qcnmhyglarzcpudjorzc.supabase.co')
    expect(serialized).not.toContain('zuri_line_smartgift_login')
    expect(serialized).not.toContain('permission denied')
    expect(serialized.toLowerCase()).not.toContain('authorization')
  })

  it('rejects a non-dedicated login without echoing its connection material', async () => {
    const forbiddenPassword = ['super', 'secret'].join('-')
    const forbiddenUrl = connectionUrl({
      role: 'postgres',
      password: forbiddenPassword,
      host: 'db.internal.example',
    })
    await expect(runRuntimeIsolationProbe({ client: fakeClient(), databaseUrl: forbiddenUrl, scope }))
      .rejects.toThrow('RUNTIME_ISOLATION_DATABASE_ROLE_FORBIDDEN')
    try {
      await runRuntimeIsolationProbe({ client: fakeClient(), databaseUrl: forbiddenUrl, scope })
    } catch (error) {
      expect(error.message).not.toContain(forbiddenUrl)
      expect(error.message).not.toContain(forbiddenPassword)
    }
  })

  it('accepts the dedicated URL and scope only through named environment values', async () => {
    const report = await runRuntimeIsolationProbeFromEnv({
      client: fakeClient(),
      env: {
        ZURI_LINE_DB_URL: databaseUrl,
        ZURI_LINE_ISOLATION_TENANT_ID: scope.tenantId,
        ZURI_LINE_ISOLATION_BUSINESS_ID: scope.businessId,
        ZURI_LINE_ISOLATION_CROSS_TENANT_ID: scope.crossTenantId,
      },
    })

    expect(report.status).toBe('PASS')
    expect(JSON.stringify(report)).not.toContain(fakePassword)
    await expect(runRuntimeIsolationProbeFromEnv({ client: fakeClient(), env: {} }))
      .rejects.toThrow('RUNTIME_ISOLATION_CONFIGURATION_MISSING')
  })

  it('accepts the approved Supavisor session-pooler username without weakening the role contract', async () => {
    const report = await runRuntimeIsolationProbe({
      client: fakeClient(),
      databaseUrl: poolerDatabaseUrl,
      scope,
    })

    expect(report.status).toBe('PASS')
    expect(JSON.stringify(report)).not.toContain('qcnmhyglarzcpudjorzc')
    expect(JSON.stringify(report)).not.toContain(fakePassword)
  })

  it('rejects a pooler username for another project', async () => {
    const wrongProjectUrl = connectionUrl({
      role: 'zuri_line_smartgift_login.otherprojectref',
      password: fakePassword,
      host: 'aws-0-ap-northeast-2.pooler.supabase.com',
    })

    await expect(runRuntimeIsolationProbe({ client: fakeClient(), databaseUrl: wrongProjectUrl, scope }))
      .rejects.toThrow('RUNTIME_ISOLATION_DATABASE_ROLE_FORBIDDEN')
  })
})
