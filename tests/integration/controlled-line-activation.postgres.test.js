import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @req FR-055 — prove controlled activation against PostgreSQL role, RLS and constraint semantics.
// @spec NFR-013, SDD-028, SEC-012 — one mutation per correlation and append-only receipt history.
// @tested tests/integration/controlled-line-activation.postgres.test.js

const { Client } = pg
const adminUrl = process.env.ZURI_FR055_TEST_POSTGRES_URL
if (adminUrl) {
  const target = new URL(adminUrl)
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
  if (!isLoopback || target.pathname !== '/zuri_fr055_test') {
    throw new Error('CONTROLLED_ACTIVATION_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  }
}

const runPostgres = adminUrl ? describe : describe.skip
const loginRole = 'zuri_line_activation_login'
const operatorRole = 'zuri_line_activation_operator'
const localPassword = crypto.randomBytes(24).toString('base64url')
const scope = Object.freeze({
  projectRef: 'qcnmhyglarzcpudjorzc',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
})
const correlationId = '20000000-0000-4000-8000-000000000001'

function migrationSql(suffix) {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(dir).filter((name) => name.endsWith(suffix))
  if (matches.length !== 1) throw new Error(`EXPECTED_ONE_MIGRATION:${suffix}`)
  return fs.readFileSync(path.join(dir, matches[0]), 'utf8')
}

function operatorUrl() {
  const url = new URL(adminUrl)
  url.username = loginRole
  url.password = localPassword
  return url.toString()
}

function eventValues({ id, eventType, receiptState, before, after, artifact = null, acceptance = null, correlation = correlationId }) {
  return [
    id,
    correlation,
    eventType,
    receiptState,
    scope.projectRef,
    scope.tenantId,
    scope.businessId,
    scope.bindingId,
    before,
    after,
    'a'.repeat(64),
    'b'.repeat(64),
    'c'.repeat(64),
    'model-provider-test',
    'model-test',
    'W1B-LOCAL-PROOF',
    artifact,
    acceptance,
    'd'.repeat(64),
  ]
}

const insertEventSql = `
  insert into zuri_core.line_activation_event (
    id, correlation_id, event_type, receipt_state, project_ref, tenant_id, business_id,
    binding_id, binding_version_before, binding_version_after, canary_plan_sha256,
    golden_report_sha256, isolation_report_sha256, provider_id, model_id, approval_ref,
    transport_artifact_sha256, line_acceptance_class, actor_fingerprint
  ) values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19
  )
`

runPostgres('controlled LINE activation PostgreSQL contract (FR-055)', () => {
  const admin = new Client({ connectionString: adminUrl })

  beforeAll(async () => {
    await admin.connect()
    await admin.query(`
      drop schema if exists zuri_core cascade;
      do $cleanup$
      begin
        if exists (select 1 from pg_roles where rolname = '${operatorRole}')
          and exists (select 1 from pg_roles where rolname = '${loginRole}') then
          revoke ${operatorRole} from ${loginRole};
        end if;
      end
      $cleanup$;
      drop role if exists ${loginRole};
      drop role if exists ${operatorRole};
      drop role if exists zuri_line_smartgift_login;
      drop role if exists zuri_line_smartgift_ro;
      drop role if exists zuri_app_runtime;
      do $api_roles$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end
      $api_roles$;
    `)
    await admin.query(migrationSql('_production_tenant_bootstrap.sql'))
    await admin.query(migrationSql('_controlled_line_activation.sql'))
    await admin.query(`alter role ${loginRole} password '${localPassword}'`)
  }, 30_000)

  afterAll(async () => {
    await admin.query(`
      drop schema if exists zuri_core cascade;
      revoke ${operatorRole} from ${loginRole};
      drop role if exists ${loginRole};
      drop role if exists ${operatorRole};
      drop role if exists zuri_line_smartgift_login;
      drop role if exists zuri_line_smartgift_ro;
      drop role if exists zuri_app_runtime;
    `)
    await admin.end()
  })

  it('enforces role attributes, grants and forced RLS', async () => {
    const { rows: [proof] } = await admin.query(`
      select
        current_setting('server_version_num')::integer >= 170000 as postgres_17_or_newer,
        (select not rolsuper and not rolinherit and not rolcanlogin and not rolbypassrls
          from pg_roles where rolname = '${operatorRole}') as operator_is_bounded,
        (select not rolsuper and not rolinherit and rolcanlogin and not rolbypassrls
          from pg_roles where rolname = '${loginRole}') as login_is_bounded,
        has_column_privilege('${operatorRole}', 'zuri_core.line_channel_binding', 'status', 'UPDATE') as can_update_status,
        has_column_privilege('${operatorRole}', 'zuri_core.line_channel_binding', 'code', 'UPDATE') as can_update_code,
        has_table_privilege('${operatorRole}', 'zuri_core.line_activation_event', 'INSERT') as can_insert_event,
        has_table_privilege('${operatorRole}', 'zuri_core.line_activation_event', 'UPDATE') as can_update_event,
        has_table_privilege('zuri_app_runtime', 'zuri_core.line_activation_event', 'SELECT') as runtime_can_read_event,
        has_table_privilege('service_role', 'zuri_core.line_activation_event', 'SELECT') as service_can_read_event,
        (select relrowsecurity and relforcerowsecurity
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'zuri_core' and c.relname = 'line_activation_event') as event_forces_rls
    `)

    expect(proof).toEqual({
      postgres_17_or_newer: true,
      operator_is_bounded: true,
      login_is_bounded: true,
      can_update_status: true,
      can_update_code: false,
      can_insert_event: true,
      can_update_event: false,
      runtime_can_read_event: false,
      service_can_read_event: false,
      event_forces_rls: true,
    })
  })

  it('allows only the exact SmartGift binding through the operator role', async () => {
    await admin.query(`
      insert into zuri_core.business (id, tenant_id, code, name)
      values ('30000000-0000-4000-8000-000000000001', '${scope.tenantId}', 'BUS-W1B-HIDDEN', 'Hidden')
      on conflict (code) do nothing;
      insert into zuri_core.line_channel_binding (id, code, provider, tenant_id, business_id)
      values ('30000000-0000-4000-8000-000000000002', 'LINE-W1B-HIDDEN', 'LINE', '${scope.tenantId}', '30000000-0000-4000-8000-000000000001')
      on conflict (code) do nothing;
    `)
    const operator = new Client({ connectionString: operatorUrl() })
    await operator.connect()
    try {
      const { rows: [direct] } = await operator.query(`
        select has_schema_privilege(current_user, 'zuri_core', 'USAGE') as direct_schema_usage
      `)
      expect(direct.direct_schema_usage).toBe(false)

      await operator.query('begin')
      await operator.query(`set local role ${operatorRole}`)
      const { rows } = await operator.query('select id, tenant_id, business_id, code from zuri_core.line_channel_binding')
      expect(rows).toEqual([{
        id: scope.bindingId,
        tenant_id: scope.tenantId,
        business_id: scope.businessId,
        code: 'LINE-SMARTGIFT-OA',
      }])
      await operator.query('rollback')
    } finally {
      await operator.end()
    }
  })

  it('permits one mutation and append-only truthful transport history, then rolls everything back', async () => {
    const operator = new Client({ connectionString: operatorUrl() })
    await operator.connect()
    try {
      await operator.query('begin')
      await operator.query(`set local role ${operatorRole}`)
      const mutation = await operator.query(`
        update zuri_core.line_channel_binding
        set external_channel_id_hash = $1, credential_hash = $2, status = 'ACTIVE',
          valid_from = now(), expires_at = now() + interval '15 minutes', updated_at = now(), version = 2
        where id = $3 and version = 1 and status = 'PENDING'
      `, ['e'.repeat(64), 'f'.repeat(64), scope.bindingId])
      expect(mutation.rowCount).toBe(1)

      await operator.query(insertEventSql, eventValues({
        id: '40000000-0000-4000-8000-000000000001',
        eventType: 'ACTIVATION',
        receiptState: 'EVIDENCE_VERIFIED',
        before: 1,
        after: 2,
      }))

      await operator.query('savepoint second_mutation')
      await expect(operator.query(insertEventSql, eventValues({
        id: '40000000-0000-4000-8000-000000000002',
        eventType: 'ROLLBACK',
        receiptState: 'EVIDENCE_VERIFIED',
        before: 2,
        after: 3,
      }))).rejects.toMatchObject({ code: '23505' })
      await operator.query('rollback to savepoint second_mutation')

      await operator.query('savepoint invalid_transport')
      await expect(operator.query(insertEventSql, eventValues({
        id: '40000000-0000-4000-8000-000000000003',
        eventType: 'CANARY_TRANSPORT',
        receiptState: 'ACCEPTED_BY_LINE',
        before: 2,
        after: 2,
      }))).rejects.toMatchObject({ code: '23514' })
      await operator.query('rollback to savepoint invalid_transport')

      await operator.query('savepoint invalid_mutation_state')
      await expect(operator.query(insertEventSql, eventValues({
        id: '40000000-0000-4000-8000-000000000004',
        eventType: 'ACTIVATION',
        receiptState: 'GENERATED',
        before: 2,
        after: 3,
        correlation: '70000000-0000-4000-8000-000000000001',
      }))).rejects.toMatchObject({ code: '23514' })
      await operator.query('rollback to savepoint invalid_mutation_state')

      await operator.query('savepoint invalid_version_delta')
      await expect(operator.query(insertEventSql, eventValues({
        id: '40000000-0000-4000-8000-000000000005',
        eventType: 'CANARY_TRANSPORT',
        receiptState: 'GENERATED',
        before: 2,
        after: 3,
        correlation: '70000000-0000-4000-8000-000000000002',
      }))).rejects.toMatchObject({ code: '23514' })
      await operator.query('rollback to savepoint invalid_version_delta')

      const transportStates = ['GENERATED', 'ACCEPTED_BY_LINE', 'DISPLAYED_UNKNOWN', 'READ_UNKNOWN']
      for (const [index, receiptState] of transportStates.entries()) {
        const accepted = receiptState !== 'GENERATED'
        await operator.query(insertEventSql, eventValues({
          id: `50000000-0000-4000-8000-00000000000${index + 1}`,
          eventType: 'CANARY_TRANSPORT',
          receiptState,
          before: 2,
          after: 2,
          artifact: accepted ? '1'.repeat(64) : '0'.repeat(64),
          acceptance: accepted ? 'HTTP_2XX' : null,
        }))
      }

      await operator.query('savepoint duplicate_state')
      await expect(operator.query(insertEventSql, eventValues({
        id: '60000000-0000-4000-8000-000000000001',
        eventType: 'CANARY_TRANSPORT',
        receiptState: 'GENERATED',
        before: 2,
        after: 2,
      }))).rejects.toMatchObject({ code: '23505' })
      await operator.query('rollback to savepoint duplicate_state')

      const { rows } = await operator.query(`
        select event_type, receipt_state
        from zuri_core.line_activation_event
        order by created_at, id
      `)
      expect(rows).toHaveLength(5)
      expect(rows.filter((row) => ['ACTIVATION', 'ROLLBACK'].includes(row.event_type))).toHaveLength(1)
      expect(rows.filter((row) => row.event_type === 'CANARY_TRANSPORT').map((row) => row.receipt_state).sort())
        .toEqual([...transportStates].sort())

      await operator.query('rollback')
    } finally {
      await operator.end()
    }

    const { rows: [binding] } = await admin.query(`
      select status, version, external_channel_id_hash, credential_hash
      from zuri_core.line_channel_binding where id = $1
    `, [scope.bindingId])
    expect(binding).toEqual({
      status: 'PENDING',
      version: 1,
      external_channel_id_hash: null,
      credential_hash: null,
    })
    const { rows: [{ count }] } = await admin.query('select count(*)::integer as count from zuri_core.line_activation_event')
    expect(count).toBe(0)
  })
})
