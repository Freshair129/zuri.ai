import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createLineBindingActivationService } from '@/modules/agent/line-binding-activation'
import { hashBindingSecret } from '@/modules/agent/line-binding-resolver'
import {
  cleanupFr055DatabaseTestChanges,
  FR055_API_ROLES,
  FR055_FIXED_TEST_ROLES,
  FR055_TOUCHED_ROLES,
  parseFr055PostgresTarget,
  runPostgresSetupWithCleanup,
  verifyDisposableClusterMarker,
} from '../helpers/fr055-postgres-target-guard.js'

// @req FR-055 — compose the real operator service with PostgreSQL 17 roles, RLS and constraints.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — prove exact CAS, atomic evidence, denial and routing-first rollback.
// @tested tests/integration/line-binding-activation.postgres.test.js

const { Client, Pool } = pg
const target = parseFr055PostgresTarget({
  databaseUrl: process.env.ZURI_FR055_TEST_POSTGRES_URL,
  destructiveOptIn: process.env.ZURI_FR055_TEST_DESTRUCTIVE_OPT_IN,
  clusterMarker: process.env.ZURI_FR055_TEST_CLUSTER_MARKER,
})
const adminUrl = target.enabled ? target.databaseUrl : undefined
const runPostgres = target.enabled ? describe : describe.skip
const loginRole = 'zuri_line_activation_login'
const operatorRole = 'zuri_line_activation_operator'
const localPassword = crypto.randomBytes(24).toString('base64url')
const scope = Object.freeze({
  projectRef: 'qcnmhyglarzcpudjorzc',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
})
const evidenceBytes = Object.freeze({
  canary: 'FR055 immutable canary plan bytes\n',
  golden: 'FR055 immutable golden report bytes\n',
  isolation: 'FR055 immutable isolation report bytes\n',
})
const evidencePaths = Object.freeze({
  canaryPlan: 'canary',
  goldenReport: 'golden',
  isolationReport: 'isolation',
})
const evidence = Object.freeze({
  canaryPlanSha256: crypto.createHash('sha256').update(evidenceBytes.canary).digest('hex'),
  goldenReportSha256: crypto.createHash('sha256').update(evidenceBytes.golden).digest('hex'),
  isolationReportSha256: crypto.createHash('sha256').update(evidenceBytes.isolation).digest('hex'),
})
const fakeSecrets = Object.freeze({
  destination: 'local-test-destination',
  bearer: 'local-test-bearer-value-0000000000000000',
  pepper: 'local-test-pepper-value-0000000000000000',
})

function migrationSql(suffix) {
  const directory = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(directory).filter((name) => name.endsWith(suffix))
  if (matches.length !== 1) throw new Error(`EXPECTED_ONE_MIGRATION:${suffix}`)
  return fs.readFileSync(path.join(directory, matches[0]), 'utf8')
}

function operatorUrl() {
  const url = new URL(adminUrl)
  url.username = loginRole
  url.password = localPassword
  return url.toString()
}

function windowAround(reference = new Date(), { approvalOffsetMs = 60_000, bindingOffsetMs = 30_000 } = {}) {
  return {
    notBefore: new Date(reference.getTime() - 60_000).toISOString(),
    expiresAt: new Date(reference.getTime() + approvalOffsetMs).toISOString(),
    bindingExpiresAt: new Date(reference.getTime() + bindingOffsetMs).toISOString(),
  }
}

function activationInput({
  correlationId = crypto.randomUUID(),
  mode = 'APPLY',
  version = 1,
  status = 'PENDING',
  timeWindow = windowAround(),
  scopeOverrides = {},
} = {}) {
  return {
    contractVersion: '1.0.0',
    mode,
    correlationId,
    scope: { ...scope, ...scopeOverrides },
    expectation: {
      bindingVersion: version,
      bindingStatus: status,
      destinationHashPresent: status === 'ACTIVE',
      credentialHashPresent: status === 'ACTIVE',
      bindingCode: 'LINE-SMARTGIFT-OA',
      channelProvider: 'LINE',
      providerId: 'openai',
      modelId: 'gpt-5-mini',
    },
    evidence,
    approval: { approvalRef: 'FR055-W4-LOCAL', notBefore: timeWindow.notBefore, expiresAt: timeWindow.expiresAt },
    ...(status === 'PENDING' ? { bindingExpiresAt: timeWindow.bindingExpiresAt } : {}),
  }
}

function exactReadFile(pathname) {
  if (!Object.hasOwn(evidenceBytes, pathname)) throw new Error('UNEXPECTED_EVIDENCE_PATH')
  return Promise.resolve(Buffer.from(evidenceBytes[pathname], 'utf8'))
}

function createService(pool, options = {}) {
  return createLineBindingActivationService({
    connect: () => pool.connect(),
    readFile: exactReadFile,
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
  })
}

function activationRequest(input) {
  return { input, evidencePaths, secrets: fakeSecrets }
}

async function readTouchedRoles(client) {
  const { rows } = await client.query(
    'select rolname from pg_roles where rolname = any($1::text[])',
    [FR055_TOUCHED_ROLES],
  )
  return new Set(rows.map(({ rolname }) => rolname))
}

runPostgres('FR-055 setup-failure recovery on PostgreSQL 17', () => {
  it('rolls back an aborted migration before cleanup, removes created roles and preserves baseline roles', async () => {
    const admin = new Client({ connectionString: adminUrl })
    let sentinelCreated = false
    await admin.connect()
    try {
      await verifyDisposableClusterMarker(admin, target.clusterMarker)
      const initialRoles = await readTouchedRoles(admin)
      if (!initialRoles.has('anon')) {
        await admin.query('create role anon nologin')
        sentinelCreated = true
      }
      const preexistingRoles = await readTouchedRoles(admin)
      let ddlStarted = false
      let observedError
      try {
        await runPostgresSetupWithCleanup(
          admin,
          async () => {
            for (const role of FR055_API_ROLES) {
              if (!preexistingRoles.has(role)) await admin.query(`create role ${role} nologin`)
            }
            ddlStarted = true
            await admin.query(`
              begin;
              create schema zuri_core;
              create role zuri_app_runtime noinherit nobypassrls nologin;
              do $forced_failure$
              begin
                raise exception 'FR055_FORCED_MID_MIGRATION_FAILURE';
              end
              $forced_failure$;
              commit;
            `)
          },
          () => cleanupFr055DatabaseTestChanges(admin, preexistingRoles, ddlStarted),
        )
      } catch (error) {
        observedError = error
      }

      expect(observedError).toMatchObject({ code: 'P0001' })
      expect(observedError.message).toContain('FR055_FORCED_MID_MIGRATION_FAILURE')
      expect(await readTouchedRoles(admin)).toEqual(preexistingRoles)
      const { rows: [proof] } = await admin.query(`
        select to_regnamespace('zuri_core') is null as schema_removed
      `)
      expect(proof.schema_removed).toBe(true)
    } finally {
      if (sentinelCreated) await admin.query('drop role if exists anon')
      await admin.end()
    }
  })
})

runPostgres('FR-055 composed LINE binding activation on PostgreSQL 17', () => {
  const admin = new Client({ connectionString: adminUrl })
  let adminConnected = false
  let baselineCaptured = false
  let ddlStarted = false
  let preexistingRoles = new Set()

  async function currentTouchedRoles() {
    const { rows } = await admin.query(
      'select rolname from pg_roles where rolname = any($1::text[])',
      [FR055_TOUCHED_ROLES],
    )
    return new Set(rows.map(({ rolname }) => rolname))
  }

  async function cleanupTestChanges() {
    if (!adminConnected || !baselineCaptured) return
    await cleanupFr055DatabaseTestChanges(admin, preexistingRoles, ddlStarted)
    ddlStarted = false
  }

  beforeAll(async () => {
    await admin.connect()
    adminConnected = true
    await runPostgresSetupWithCleanup(admin, async () => {
      await verifyDisposableClusterMarker(admin, target.clusterMarker)
      preexistingRoles = await currentTouchedRoles()
      baselineCaptured = true
      const existingFixedRoles = FR055_FIXED_TEST_ROLES.filter((role) => preexistingRoles.has(role))
      if (existingFixedRoles.length > 0) {
        throw new Error('LINE_ACTIVATION_TEST_CLUSTER_NOT_PRISTINE')
      }
      const { rows: [databaseState] } = await admin.query(`
        select
          current_setting('server_version_num')::integer as server_version,
          to_regnamespace('zuri_core') is not null as zuri_schema_exists
      `)
      if (databaseState.server_version < 170000) throw new Error('LINE_ACTIVATION_TEST_REQUIRES_POSTGRES_17')
      if (databaseState.zuri_schema_exists) throw new Error('LINE_ACTIVATION_TEST_DATABASE_NOT_PRISTINE')

      ddlStarted = true
      for (const role of FR055_API_ROLES) {
        if (!preexistingRoles.has(role)) await admin.query(`create role ${role} nologin`)
      }
      await admin.query(migrationSql('_production_tenant_bootstrap.sql'))
      await admin.query(migrationSql('_controlled_line_activation.sql'))
      await admin.query(`alter role ${loginRole} password '${localPassword}'`)
    }, cleanupTestChanges)
  }, 30_000)

  beforeEach(async () => {
    await admin.query('delete from zuri_core.line_activation_event')
    await admin.query(`
      update zuri_core.line_channel_binding
      set external_channel_id_hash = null, credential_hash = null, status = 'PENDING',
        valid_from = null, expires_at = null, rotated_at = null, version = 1
      where id = $1
    `, [scope.bindingId])
  })

  afterAll(async () => {
    if (!adminConnected) return
    try {
      await cleanupTestChanges()
    } finally {
      await admin.end()
    }
  })

  it('activates exact scope with HMAC hashes/event/version, rejects duplicate correlation, then rolls back routing only', async () => {
    const pool = new Pool({ connectionString: operatorUrl(), max: 1 })
    try {
      const service = createService(pool)
      const correlationId = crypto.randomUUID()
      const input = activationInput({ correlationId })
      const activated = await service.activate(activationRequest(input))

      expect(activated).toMatchObject({
        dryRun: false,
        receipt: {
          correlationId,
          eventType: 'ACTIVATION',
          receiptState: 'EVIDENCE_VERIFIED',
          bindingVersionBefore: 1,
          bindingVersionAfter: 2,
          ...evidence,
        },
      })
      const { rows: [binding] } = await admin.query(`
        select status, version, external_channel_id_hash, credential_hash
        from zuri_core.line_channel_binding where id = $1
      `, [scope.bindingId])
      expect(binding).toEqual({
        status: 'ACTIVE',
        version: 2,
        external_channel_id_hash: hashBindingSecret(fakeSecrets.pepper, fakeSecrets.destination),
        credential_hash: hashBindingSecret(fakeSecrets.pepper, fakeSecrets.bearer),
      })
      const { rows: eventsAfterActivation } = await admin.query(`
        select correlation_id, event_type, receipt_state, binding_version_before, binding_version_after,
          canary_plan_sha256, golden_report_sha256, isolation_report_sha256
        from zuri_core.line_activation_event
      `)
      expect(eventsAfterActivation).toEqual([{
        correlation_id: correlationId,
        event_type: 'ACTIVATION',
        receipt_state: 'EVIDENCE_VERIFIED',
        binding_version_before: 1,
        binding_version_after: 2,
        canary_plan_sha256: evidence.canaryPlanSha256,
        golden_report_sha256: evidence.goldenReportSha256,
        isolation_report_sha256: evidence.isolationReportSha256,
      }])

      await expect(service.activate(activationRequest(input)))
        .rejects.toThrow('LINE_ACTIVATION_CORRELATION_CONFLICT')
      const { rows: [afterDuplicate] } = await admin.query(`
        select status, version from zuri_core.line_channel_binding where id = $1
      `, [scope.bindingId])
      expect(afterDuplicate).toEqual({ status: 'ACTIVE', version: 2 })

      const rollbackInput = activationInput({
        correlationId: crypto.randomUUID(),
        version: 2,
        status: 'ACTIVE',
      })
      const rolledBack = await service.rollback({ input: rollbackInput, evidencePaths })
      expect(rolledBack.receipt).toMatchObject({ eventType: 'ROLLBACK', bindingVersionBefore: 2, bindingVersionAfter: 3 })
      const { rows: [disabled] } = await admin.query(`
        select status, version, external_channel_id_hash, credential_hash
        from zuri_core.line_channel_binding where id = $1
      `, [scope.bindingId])
      expect(disabled).toEqual({ ...binding, status: 'INACTIVE', version: 3 })
    } finally {
      await pool.end()
    }
  })

  it('uses the fresh post-lock database clock so expired approval or binding expiry performs zero mutation', async () => {
    const pool = new Pool({ connectionString: operatorUrl(), max: 1 })
    try {
      const historicalNow = new Date(Date.now() - 120_000)
      const service = createService(pool, { now: () => historicalNow })
      const expiredApproval = windowAround(historicalNow, { approvalOffsetMs: 60_000, bindingOffsetMs: 30_000 })
      await expect(service.activate(activationRequest(activationInput({ timeWindow: expiredApproval }))))
        .rejects.toThrow('LINE_ACTIVATION_COMPARE_AND_SWAP_FAILED')

      const parserNow = new Date(Date.now() - 60_000)
      const expiryService = createService(pool, { now: () => parserNow })
      const expiredBinding = windowAround(parserNow, { approvalOffsetMs: 180_000, bindingOffsetMs: 30_000 })
      await expect(expiryService.activate(activationRequest(activationInput({ timeWindow: expiredBinding }))))
        .rejects.toThrow('LINE_ACTIVATION_COMPARE_AND_SWAP_FAILED')

      const { rows: [proof] } = await admin.query(`
        select status, version, external_channel_id_hash, credential_hash,
          (select count(*)::integer from zuri_core.line_activation_event) as event_count
        from zuri_core.line_channel_binding where id = $1
      `, [scope.bindingId])
      expect(proof).toEqual({
        status: 'PENDING', version: 1, external_channel_id_hash: null, credential_hash: null, event_count: 0,
      })
    } finally {
      await pool.end()
    }
  })

  it('rolls the binding update back when the append-only event insert fails', async () => {
    const eventId = crypto.randomUUID()
    await admin.query(`
      insert into zuri_core.line_activation_event (
        id, correlation_id, event_type, receipt_state, project_ref, tenant_id, business_id,
        binding_id, binding_version_before, binding_version_after, canary_plan_sha256,
        golden_report_sha256, isolation_report_sha256, provider_id, model_id, approval_ref,
        occurred_at, actor_fingerprint
      ) values ($1, $2, 'ACTIVATION', 'EVIDENCE_VERIFIED', $3, $4, $5, $6, 1, 2,
        $7, $8, $9, 'openai', 'gpt-5-mini', 'FR055-W4-SEED', now(), $10)
    `, [
      eventId, crypto.randomUUID(), scope.projectRef, scope.tenantId, scope.businessId, scope.bindingId,
      evidence.canaryPlanSha256, evidence.goldenReportSha256, evidence.isolationReportSha256, 'd'.repeat(64),
    ])

    const pool = new Pool({ connectionString: operatorUrl(), max: 1 })
    try {
      const service = createService(pool, { randomUUID: () => eventId })
      await expect(service.activate(activationRequest(activationInput())))
        .rejects.toMatchObject({ code: '23505' })
      const { rows: [proof] } = await admin.query(`
        select status, version, external_channel_id_hash, credential_hash,
          (select count(*)::integer from zuri_core.line_activation_event) as event_count
        from zuri_core.line_channel_binding where id = $1
      `, [scope.bindingId])
      expect(proof).toEqual({
        status: 'PENDING', version: 1, external_channel_id_hash: null, credential_hash: null, event_count: 1,
      })
    } finally {
      await pool.end()
    }
  })

  it('denies wrong scope, wrong login and a login without the operator role with zero mutation', async () => {
    const operatorPool = new Pool({ connectionString: operatorUrl(), max: 1 })
    const adminPool = new Pool({ connectionString: adminUrl, max: 1 })
    try {
      const service = createService(operatorPool)
      await expect(service.activate(activationRequest(activationInput({
        scopeOverrides: { businessId: crypto.randomUUID() },
      }))))
        .rejects.toThrow('LINE_ACTIVATION_BINDING_MISMATCH')

      const wrongLogin = createService(adminPool)
      await expect(wrongLogin.activate(activationRequest(activationInput())))
        .rejects.toThrow('LINE_ACTIVATION_DATABASE_SESSION_FORBIDDEN')

      await admin.query(`revoke ${operatorRole} from ${loginRole}`)
      await expect(service.activate(activationRequest(activationInput())))
        .rejects.toMatchObject({ code: '42501' })
      await admin.query(`grant ${operatorRole} to ${loginRole}`)

      const { rows: [proof] } = await admin.query(`
        select status, version, external_channel_id_hash, credential_hash,
          (select count(*)::integer from zuri_core.line_activation_event) as event_count
        from zuri_core.line_channel_binding where id = $1
      `, [scope.bindingId])
      expect(proof).toEqual({
        status: 'PENDING', version: 1, external_channel_id_hash: null, credential_hash: null, event_count: 0,
      })
    } finally {
      await admin.query(`grant ${operatorRole} to ${loginRole}`)
      await Promise.all([operatorPool.end(), adminPool.end()])
    }
  })
})
