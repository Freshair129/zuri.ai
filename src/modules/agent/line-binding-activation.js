import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto'
import { readFile as nodeReadFile } from 'node:fs/promises'
import { hashBindingSecret } from './line-binding-resolver.js'
import {
  parseLineActivationInput,
  parseLineCanaryReceipt,
  parseLineRollbackInput,
} from './line-activation-contract.js'

// @req FR-055 — activate or disable one exact LINE binding through a controlled operator port.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — evidence-pinned CAS, replay safety and routing-first rollback.
// @tested tests/unit/line-binding-activation.test.js

const OPERATOR_ROLE = 'zuri_line_activation_operator'
const APPROVED_PROJECT_REF = 'qcnmhyglarzcpudjorzc'
const ACTOR_FINGERPRINT = createHash('sha256').update('zuri_line_activation_login').digest('hex')

function fail(code) {
  throw new Error(code)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function evidenceEntries(input, evidencePaths) {
  return [
    ['canaryPlanSha256', evidencePaths?.canaryPlan],
    ['goldenReportSha256', evidencePaths?.goldenReport],
    ['isolationReportSha256', evidencePaths?.isolationReport],
  ]
}

async function verifyEvidence(input, evidencePaths, readFile) {
  for (const [field, path] of evidenceEntries(input, evidencePaths)) {
    if (!path) fail('LINE_ACTIVATION_EVIDENCE_PATH_REQUIRED')
    const actual = sha256(await readFile(path))
    if (actual !== input.evidence[field]) fail('LINE_ACTIVATION_EVIDENCE_MISMATCH')
  }
}

function expectedReceipt(input, eventType, eventId, occurredAt) {
  return parseLineCanaryReceipt({
    contractVersion: '1.0.0', eventId, correlationId: input.correlationId,
    eventType, receiptState: 'EVIDENCE_VERIFIED', projectRef: input.scope.projectRef,
    tenantId: input.scope.tenantId, businessId: input.scope.businessId, bindingId: input.scope.bindingId,
    bindingVersionBefore: input.expectation.bindingVersion,
    bindingVersionAfter: input.expectation.bindingVersion + 1,
    ...input.evidence, providerId: input.expectation.providerId, modelId: input.expectation.modelId,
    approvalRef: input.approval.approvalRef, occurredAt, actorFingerprint: ACTOR_FINGERPRINT,
  })
}

const eventSelectSql = `
  select 1
  from zuri_core.line_activation_event
  where correlation_id = $1 and event_type in ('ACTIVATION', 'ROLLBACK')
  limit 1
`

function bindingLockSql(operation) {
  const activation = operation === 'ACTIVATION'
  return `
    select id, code, provider, tenant_id, business_id, external_channel_id_hash,
      credential_hash, status, version
    from zuri_core.line_channel_binding
    where id = $1 and tenant_id = $2 and business_id = $3 and code = $4 and provider = $5
      and version = $6 and status = '${activation ? 'PENDING' : 'ACTIVE'}'
      and external_channel_id_hash is ${activation ? '' : 'not '}null
      and credential_hash is ${activation ? '' : 'not '}null
    for update
  `
}

function bindingUpdateSql(operation) {
  if (operation === 'ACTIVATION') {
    return `
      with wall_clock as materialized (select clock_timestamp() as occurred_at)
      update zuri_core.line_channel_binding
      set external_channel_id_hash = $10, credential_hash = $11, status = 'ACTIVE',
        valid_from = wall_clock.occurred_at, expires_at = $9, updated_at = wall_clock.occurred_at,
        version = version + 1
      from wall_clock
      where id = $1 and tenant_id = $2 and business_id = $3 and code = $4 and provider = $5
        and version = $6 and status = 'PENDING'
        and external_channel_id_hash is null and credential_hash is null
        and wall_clock.occurred_at >= $7::timestamptz
        and wall_clock.occurred_at < $8::timestamptz
        and $9::timestamptz > wall_clock.occurred_at
        and $9::timestamptz <= $8::timestamptz
      returning version, wall_clock.occurred_at
    `
  }
  return `
    with wall_clock as materialized (select clock_timestamp() as occurred_at)
    update zuri_core.line_channel_binding
    set status = 'INACTIVE', updated_at = wall_clock.occurred_at, version = version + 1
    from wall_clock
    where id = $1 and tenant_id = $2 and business_id = $3 and code = $4 and provider = $5
      and version = $6 and status = 'ACTIVE'
      and external_channel_id_hash is not null and credential_hash is not null
      and wall_clock.occurred_at >= $7::timestamptz
      and wall_clock.occurred_at < $8::timestamptz
    returning version, wall_clock.occurred_at
  `
}

function validateDatabaseClock(input, operation, value) {
  const clock = new Date(value)
  if (Number.isNaN(clock.getTime())) fail('LINE_ACTIVATION_DATABASE_CLOCK_INVALID')
  if (clock < new Date(input.approval.notBefore) || clock >= new Date(input.approval.expiresAt)) {
    fail('LINE_ACTIVATION_APPROVAL_WINDOW_INACTIVE')
  }
  if (operation === 'ACTIVATION') {
    const bindingExpiry = new Date(input.bindingExpiresAt)
    if (bindingExpiry <= clock || bindingExpiry > new Date(input.approval.expiresAt)) {
      fail('LINE_ACTIVATION_BINDING_EXPIRY_OUT_OF_BOUNDS')
    }
  }
  return clock.toISOString()
}

const eventInsertSql = `
  insert into zuri_core.line_activation_event (
    id, correlation_id, event_type, receipt_state, project_ref, tenant_id, business_id,
    binding_id, binding_version_before, binding_version_after, canary_plan_sha256,
    golden_report_sha256, isolation_report_sha256, provider_id, model_id, approval_ref,
    occurred_at, actor_fingerprint
  ) values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
  )
`

export function createLineBindingActivationService({
  connect, readFile = nodeReadFile, now = () => new Date(), randomUUID = nodeRandomUUID,
}) {
  if (typeof connect !== 'function') fail('LINE_ACTIVATION_CONNECT_REQUIRED')

  async function execute(operation, request) {
    const executionTime = now()
    const input = operation === 'ACTIVATION'
      ? parseLineActivationInput(request.input, { now: executionTime })
      : parseLineRollbackInput(request.input, { now: executionTime })
    if (input.scope.projectRef !== APPROVED_PROJECT_REF) fail('LINE_ACTIVATION_SCOPE_FORBIDDEN')
    await verifyEvidence(input, request.evidencePaths, readFile)

    let destinationHash
    let credentialHash
    if (operation === 'ACTIVATION' && input.mode === 'APPLY') {
      const { destination, bearer, pepper } = request.secrets ?? {}
      if (!destination || !bearer || bearer.length < 32 || !pepper || pepper.length < 32) {
        fail('LINE_ACTIVATION_SECRETS_REQUIRED')
      }
      destinationHash = hashBindingSecret(pepper, destination)
      credentialHash = hashBindingSecret(pepper, bearer)
    }

    const client = await connect()
    let transactionStarted = false
    try {
      await client.query('begin')
      transactionStarted = true
      const session = await client.query('select session_user as session_user')
      if (session.rows?.[0]?.session_user !== 'zuri_line_activation_login') {
        fail('LINE_ACTIVATION_DATABASE_SESSION_FORBIDDEN')
      }
      await client.query(`set local role ${OPERATOR_ROLE}`)
      const role = await client.query('select current_user as current_user')
      if (role.rows?.[0]?.current_user !== OPERATOR_ROLE) {
        fail('LINE_ACTIVATION_DATABASE_ROLE_FORBIDDEN')
      }

      const replay = await client.query(eventSelectSql, [input.correlationId])
      if (replay.rows?.length) {
        fail('LINE_ACTIVATION_CORRELATION_CONFLICT')
      }

      const identityValues = [
        input.scope.bindingId, input.scope.tenantId, input.scope.businessId,
        input.expectation.bindingCode, input.expectation.channelProvider,
        input.expectation.bindingVersion,
      ]
      const locked = await client.query(bindingLockSql(operation), identityValues)
      if (locked.rowCount !== 1 || locked.rows?.length !== 1) fail('LINE_ACTIVATION_BINDING_MISMATCH')

      const eventId = randomUUID()
      if (input.mode === 'DRY_RUN') {
        const wallClock = await client.query('select clock_timestamp() as occurred_at')
        const occurredAt = validateDatabaseClock(input, operation, wallClock.rows?.[0]?.occurred_at)
        const preview = expectedReceipt(input, operation, eventId, occurredAt)
        await client.query('rollback')
        transactionStarted = false
        return { dryRun: true, preview }
      }

      const updateValues = operation === 'ACTIVATION'
        ? [...identityValues, input.approval.notBefore, input.approval.expiresAt,
            input.bindingExpiresAt, destinationHash, credentialHash]
        : [...identityValues, input.approval.notBefore, input.approval.expiresAt]
      const updated = await client.query(bindingUpdateSql(operation), updateValues)
      if (updated.rowCount !== 1 || updated.rows?.[0]?.version !== input.expectation.bindingVersion + 1) {
        fail('LINE_ACTIVATION_COMPARE_AND_SWAP_FAILED')
      }
      const occurredAt = validateDatabaseClock(input, operation, updated.rows[0].occurred_at)
      const receipt = expectedReceipt(input, operation, eventId, occurredAt)
      const inserted = await client.query(eventInsertSql, [
        receipt.eventId, receipt.correlationId, receipt.eventType, receipt.receiptState,
        receipt.projectRef, receipt.tenantId, receipt.businessId, receipt.bindingId,
        receipt.bindingVersionBefore, receipt.bindingVersionAfter, receipt.canaryPlanSha256,
        receipt.goldenReportSha256, receipt.isolationReportSha256, receipt.providerId,
        receipt.modelId, receipt.approvalRef, receipt.occurredAt, receipt.actorFingerprint,
      ])
      if (inserted.rowCount !== 1) fail('LINE_ACTIVATION_EVENT_INSERT_FAILED')
      await client.query('commit')
      transactionStarted = false
      return { dryRun: false, receipt }
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('rollback') } catch {}
      }
      throw error
    } finally {
      client.release?.()
    }
  }

  return {
    activate: (request) => execute('ACTIVATION', request),
    rollback: (request) => execute('ROLLBACK', request),
  }
}
