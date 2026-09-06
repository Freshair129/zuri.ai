import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runRuntimeIsolationProbe } from '@/modules/knowledge/runtime-isolation-probe'

// @req FR-054 — execute the isolation probe against PostgreSQL's real type and RLS semantics.
// @spec SDD-027, SEC-011 — UUID-shaped scope identifiers use the deployed text contract.
// @tested tests/integration/runtime-isolation-probe.postgres.test.js

const { Client } = pg
const adminUrl = process.env.ZURI_TEST_POSTGRES_URL
if (adminUrl) {
  const target = new URL(adminUrl)
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
  if (!isLoopback || target.pathname !== '/zuri_fr054_test') {
    throw new Error('RUNTIME_ISOLATION_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  }
}
const runPostgres = adminUrl ? describe : describe.skip
const loginRole = 'zuri_line_smartgift_login'
const policyRole = 'zuri_line_smartgift_ro'
const localPassword = 'zuri-local-integration-only'
const scope = {
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  crossTenantId: 'ef2552ce-ff10-4b1f-8212-d0a729f5a159',
}

function runtimeUrl() {
  const url = new URL(adminUrl)
  url.username = loginRole
  url.password = localPassword
  return url.toString()
}

runPostgres('runtime isolation probe PostgreSQL contract (FR-054)', () => {
  const admin = new Client({ connectionString: adminUrl })

  beforeAll(async () => {
    await admin.connect()
    await admin.query(`
      drop schema if exists zuri_core cascade;
      drop role if exists ${loginRole};
      drop role if exists ${policyRole};
      create role ${policyRole} noinherit nobypassrls nologin;
      create role ${loginRole} login noinherit nobypassrls password '${localPassword}';
      grant ${policyRole} to ${loginRole};
      create schema zuri_core;
      create table zuri_core.business_knowledge (
        knowledge_id text primary key,
        tenant_id text not null,
        business_id text not null,
        name text not null
      );
      alter table zuri_core.business_knowledge enable row level security;
      alter table zuri_core.business_knowledge force row level security;
      create policy line_smartgift_knowledge_read
        on zuri_core.business_knowledge for select
        to ${policyRole}
        using (
          tenant_id = '${scope.tenantId}'
          and business_id = '${scope.businessId}'
        );
      revoke all on schema zuri_core from public, ${loginRole};
      revoke all on zuri_core.business_knowledge from public, ${loginRole};
      grant usage on schema zuri_core to ${policyRole};
      grant select on zuri_core.business_knowledge to ${policyRole};
      insert into zuri_core.business_knowledge values
        ('visible', '${scope.tenantId}', '${scope.businessId}', 'Visible row'),
        ('hidden', '${scope.crossTenantId}', '6944ef44-7f05-4649-bda5-a76473ad4fe9', 'Hidden row');
    `)
  })

  afterAll(async () => {
    await admin.query(`
      drop schema if exists zuri_core cascade;
      drop role if exists ${loginRole};
      drop role if exists ${policyRole};
    `)
    await admin.end()
  })

  it('passes with text scope columns and denies cross-Tenant reads and mutation', async () => {
    const runtime = new Client({ connectionString: runtimeUrl() })
    await runtime.connect()
    try {
      const report = await runRuntimeIsolationProbe({
        client: runtime,
        databaseUrl: runtimeUrl(),
        scope,
        now: () => new Date('2026-08-14T02:00:00.000Z'),
      })

      expect(report).toMatchObject({
        status: 'PASS',
        assertions: {
          exactPositiveScope: { passed: true, visibleCount: 1, outOfScopeCount: 0 },
          crossTenantDenied: { passed: true, visibleCount: 0 },
          directGrantDenied: { passed: true },
          mutationDeniedAndRolledBack: { passed: true, rolledBack: true },
        },
      })
    } finally {
      await runtime.end()
    }
  })
})
