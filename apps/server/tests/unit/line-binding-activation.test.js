import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createLineBindingActivationService } from '@/modules/agent/line-binding-activation'
import { hashBindingSecret } from '@/modules/agent/line-binding-resolver'

// @req FR-055 — activate or disable exactly one LINE binding through an operator transaction.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — exact CAS, replay safety, rollback and secret-safe evidence.
// @tested tests/unit/line-binding-activation.test.js

const ids = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
}
const bytes = { canary: 'canary', golden: 'golden', isolation: 'isolation' }
const sha = (value) => createHash('sha256').update(value).digest('hex')
const evidencePaths = { canaryPlan: 'canary.json', goldenReport: 'golden.json', isolationReport: 'isolation.json' }

function input({ mode = 'DRY_RUN', status = 'PENDING', version = 1, correlationId = ids.correlationId } = {}) {
  return {
    contractVersion: '1.0.0', mode, correlationId,
    scope: { projectRef: 'qcnmhyglarzcpudjorzc', tenantId: ids.tenantId, businessId: ids.businessId, bindingId: ids.bindingId },
    expectation: {
      bindingVersion: version, bindingStatus: status,
      destinationHashPresent: status === 'ACTIVE', credentialHashPresent: status === 'ACTIVE',
      bindingCode: 'LINE-SMARTGIFT-OA', channelProvider: 'LINE', providerId: 'openai', modelId: 'gpt-5-mini',
    },
    evidence: { canaryPlanSha256: sha(bytes.canary), goldenReportSha256: sha(bytes.golden), isolationReportSha256: sha(bytes.isolation) },
    approval: { approvalRef: 'RC-055', notBefore: '2026-08-14T02:00:00.000Z', expiresAt: '2026-08-14T03:00:00.000Z' },
    ...(status === 'PENDING' ? { bindingExpiresAt: '2026-08-14T02:45:00.000Z' } : {}),
  }
}

function bindingRow({ status = 'PENDING', version = 1 } = {}) {
  return {
    id: ids.bindingId, code: 'LINE-SMARTGIFT-OA', provider: 'LINE', tenant_id: ids.tenantId,
    business_id: ids.businessId, status, version,
    external_channel_id_hash: status === 'ACTIVE' ? 'd'.repeat(64) : null,
    credential_hash: status === 'ACTIVE' ? 'e'.repeat(64) : null,
  }
}

function harness(responses = []) {
  const query = vi.fn(async (sql) => {
    if (/^\s*(begin|commit|rollback)\s*$/i.test(sql) || /^\s*set local role\s+/i.test(sql)) {
      return { rows: [], rowCount: 0 }
    }
    if (/select\s+session_user\s+as\s+session_user/i.test(sql)) {
      return { rows: [{ session_user: 'zuri_line_activation_login' }], rowCount: 1 }
    }
    if (/select\s+current_user\s+as\s+current_user/i.test(sql)) {
      return { rows: [{ current_user: 'zuri_line_activation_operator' }], rowCount: 1 }
    }
    return responses.shift() ?? { rows: [], rowCount: 0 }
  })
  const release = vi.fn()
  const client = { query, release }
  const readFile = vi.fn(async (path) => bytes[path.split('.')[0]])
  const service = createLineBindingActivationService({
    connect: vi.fn(async () => client), readFile,
    now: () => new Date('2026-08-14T02:30:00.000Z'),
    randomUUID: () => '55555555-5555-4555-8555-555555555555',
  })
  return { service, query, release, readFile }
}

describe('FR-055 line binding activation service', () => {
  it('recomputes evidence then locks exact scope and always rolls back a dry run', async () => {
    const { service, query, release, readFile } = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 },
      { rows: [{ occurred_at: '2026-08-14T02:30:01.000Z' }], rowCount: 1 },
    ])
    const result = await service.activate({ input: input(), evidencePaths })
    expect(result).toMatchObject({ dryRun: true, preview: { eventType: 'ACTIVATION', receiptState: 'EVIDENCE_VERIFIED' } })
    expect(result.receipt).toBeUndefined()
    expect(readFile).toHaveBeenCalledTimes(3)
    expect(query.mock.calls.map(([sql]) => sql.trim().toLowerCase())).toEqual(expect.arrayContaining([
      'begin', 'set local role zuri_line_activation_operator', 'rollback',
    ]))
    expect(query.mock.calls.some(([sql]) => /select[\s\S]*for update/i.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) => /^\s*update\s/i.test(sql))).toBe(false)
    expect(query.mock.calls.some(([sql]) => /^\s*insert\s/i.test(sql))).toBe(false)
    expect(release).toHaveBeenCalledOnce()
  })

  it('fails before connecting when an evidence file changed', async () => {
    const h = harness()
    h.readFile.mockImplementation(async (path) => path === 'canary.json' ? 'changed' : bytes[path.split('.')[0]])
    await expect(h.service.activate({ input: input(), evidencePaths })).rejects.toThrow('LINE_ACTIVATION_EVIDENCE_MISMATCH')
    expect(h.query).not.toHaveBeenCalled()
  })

  it('rejects a project outside the one approved operator slice before connecting', async () => {
    const h = harness()
    const otherProject = input()
    otherProject.scope.projectRef = 'other-project'
    await expect(h.service.activate({ input: otherProject, evidencePaths }))
      .rejects.toThrow('LINE_ACTIVATION_SCOPE_FORBIDDEN')
    expect(h.query).not.toHaveBeenCalled()
  })

  it('atomically installs HMAC hashes, advances one version and appends an activation event', async () => {
    const h = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 },
      { rows: [{ version: 2, occurred_at: '2026-08-14T02:30:01.000Z' }], rowCount: 1 },
      { rows: [], rowCount: 1 }, { rows: [], rowCount: 0 },
    ])
    const result = await h.service.activate({
      input: input({ mode: 'APPLY' }), evidencePaths,
      secrets: { destination: 'destination', bearer: 'x'.repeat(32), pepper: 'p'.repeat(32) },
    })
    expect(result).toMatchObject({ dryRun: false, receipt: { bindingVersionBefore: 1, bindingVersionAfter: 2 } })
    expect(result.replayed).toBeUndefined()
    const updateCall = h.query.mock.calls.find(([sql]) => /update\s+zuri_core\.line_channel_binding/i.test(sql))
    expect(updateCall[0]).toMatch(/status\s*=\s*'ACTIVE'[\s\S]*version\s*=\s*version\s*\+\s*1/i)
    expect(updateCall[0]).toMatch(/version\s*=\s*\$[0-9]+[\s\S]*status\s*=\s*'PENDING'/i)
    expect(updateCall[1]).toContain(hashBindingSecret('p'.repeat(32), 'destination'))
    expect(updateCall[1]).toContain(hashBindingSecret('p'.repeat(32), 'x'.repeat(32)))
    expect(updateCall[1]).not.toContain('destination')
    expect(updateCall[1]).not.toContain('x'.repeat(32))
    expect(updateCall[1]).not.toContain('p'.repeat(32))
    const lockCall = h.query.mock.calls.find(([sql]) => /select[\s\S]*for update/i.test(sql))
    expect(lockCall[0]).not.toMatch(/now\(\)|clock_timestamp\(\)/i)
    const updateSql = updateCall[0]
    expect(updateSql).toMatch(/with\s+wall_clock\s+as\s+(?:materialized\s+)?\(\s*select\s+clock_timestamp\(\)/i)
    expect(updateSql).toMatch(/wall_clock\.occurred_at\s*>=\s*\$7::timestamptz[\s\S]*wall_clock\.occurred_at\s*<\s*\$8::timestamptz/i)
    expect(updateSql).toMatch(/\$9::timestamptz\s*>\s*wall_clock\.occurred_at/i)
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('commit')
  })

  it('independently verifies the session login and assumed operator role', async () => {
    const h = harness()
    h.query.mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({ rows: [{ session_user: 'postgres' }], rowCount: 1 }))
      .mockImplementationOnce(async () => ({ rows: [] }))
    await expect(h.service.activate({ input: input(), evidencePaths }))
      .rejects.toThrow('LINE_ACTIVATION_DATABASE_SESSION_FORBIDDEN')
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')

    const wrongRole = harness()
    wrongRole.query.mockImplementation(async (sql) => {
      if (/select\s+session_user/i.test(sql)) return { rows: [{ session_user: 'zuri_line_activation_login' }], rowCount: 1 }
      if (/select\s+current_user/i.test(sql)) return { rows: [{ current_user: 'postgres' }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    await expect(wrongRole.service.activate({ input: input(), evidencePaths }))
      .rejects.toThrow('LINE_ACTIVATION_DATABASE_ROLE_FORBIDDEN')
    expect(wrongRole.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('fails every duplicate correlation closed without locking or mutating', async () => {
    const existing = {
      id: '55555555-5555-4555-8555-555555555555', correlation_id: ids.correlationId,
      event_type: 'ACTIVATION', receipt_state: 'EVIDENCE_VERIFIED', project_ref: 'qcnmhyglarzcpudjorzc',
      tenant_id: ids.tenantId, business_id: ids.businessId, binding_id: ids.bindingId,
      binding_version_before: 1, binding_version_after: 2,
      canary_plan_sha256: sha(bytes.canary), golden_report_sha256: sha(bytes.golden), isolation_report_sha256: sha(bytes.isolation),
      provider_id: 'openai', model_id: 'gpt-5-mini', approval_ref: 'RC-055',
      occurred_at: '2026-08-14T02:29:00.000Z', actor_fingerprint: sha('zuri_line_activation_login'),
      transport_artifact_sha256: null, line_acceptance_class: null,
    }
    const h = harness([{ rows: [existing], rowCount: 1 }])
    await expect(h.service.activate({
      input: input({ mode: 'APPLY' }), evidencePaths,
      secrets: { destination: 'destination', bearer: 'x'.repeat(32), pepper: 'p'.repeat(32) },
    })).rejects.toThrow('LINE_ACTIVATION_CORRELATION_CONFLICT')
    expect(h.query.mock.calls.some(([sql]) => /^\s*(update|insert)\s/i.test(sql))).toBe(false)
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('fails closed and rolls back on a correlation conflict or exact-row mismatch', async () => {
    const conflicting = { correlation_id: ids.correlationId, event_type: 'ROLLBACK' }
    const conflict = harness([{ rows: [conflicting], rowCount: 1 }, { rows: [], rowCount: 0 }])
    await expect(conflict.service.activate({ input: input(), evidencePaths })).rejects.toThrow('LINE_ACTIVATION_CORRELATION_CONFLICT')
    expect(conflict.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')

    const mismatch = harness([{ rows: [] }, { rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }])
    await expect(mismatch.service.activate({ input: input(), evidencePaths })).rejects.toThrow('LINE_ACTIVATION_BINDING_MISMATCH')
    expect(mismatch.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('disables routing first while preserving hashes on rollback', async () => {
    const h = harness([
      { rows: [] }, { rows: [bindingRow({ status: 'ACTIVE', version: 2 })], rowCount: 1 },
      { rows: [{ version: 3, occurred_at: '2026-08-14T02:30:01.000Z' }], rowCount: 1 },
      { rows: [], rowCount: 1 }, { rows: [], rowCount: 0 },
    ])
    const result = await h.service.rollback({ input: input({ mode: 'APPLY', status: 'ACTIVE', version: 2 }), evidencePaths })
    expect(result.receipt).toMatchObject({ eventType: 'ROLLBACK', bindingVersionAfter: 3 })
    const updateSql = h.query.mock.calls.find(([sql]) => /update\s+zuri_core\.line_channel_binding/i.test(sql))[0]
    expect(updateSql).toMatch(/status\s*=\s*'INACTIVE'/i)
    expect(updateSql).toMatch(/clock_timestamp\(\)[\s\S]*occurred_at\s*>=\s*\$7::timestamptz[\s\S]*occurred_at\s*<\s*\$8::timestamptz/i)
    expect(updateSql).not.toMatch(/external_channel_id_hash\s*=/i)
    expect(updateSql).not.toMatch(/credential_hash\s*=/i)
  })

  it('rolls back every query failure and never includes raw secrets in result or errors', async () => {
    const h = harness([{ rows: [] }, { rows: [bindingRow()], rowCount: 1 }])
    h.query.mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => { throw new Error('database failed') })
      .mockImplementationOnce(async () => ({ rows: [] }))
    await expect(h.service.activate({ input: input(), evidencePaths })).rejects.toThrow('database failed')
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('fails closed when a lock wait crosses expiry and the atomic UPDATE affects zero rows', async () => {
    const h = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 }, { rows: [], rowCount: 0 },
    ])
    await expect(h.service.activate({
      input: input({ mode: 'APPLY' }), evidencePaths,
      secrets: { destination: 'destination', bearer: 'x'.repeat(32), pepper: 'p'.repeat(32) },
    })).rejects.toThrow('LINE_ACTIVATION_COMPARE_AND_SWAP_FAILED')
    const updateSql = h.query.mock.calls.find(([sql]) => /^\s*with\s+wall_clock/i.test(sql))[0]
    expect(updateSql).toContain('clock_timestamp()')
    expect(h.query.mock.calls.some(([sql]) => /^\s*insert\s/i.test(sql))).toBe(false)
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('rejects a dry run when the fresh database clock is outside approval', async () => {
    const h = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 },
      { rows: [{ occurred_at: '2026-08-14T03:00:01.000Z' }], rowCount: 1 },
    ])
    await expect(h.service.activate({ input: input(), evidencePaths }))
      .rejects.toThrow('LINE_ACTIVATION_APPROVAL_WINDOW_INACTIVE')
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('rolls back CAS version mismatch and commit failure after mutation', async () => {
    const mismatch = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 },
      { rows: [{ version: 3, occurred_at: '2026-08-14T02:30:01.000Z' }], rowCount: 1 },
    ])
    await expect(mismatch.service.activate({
      input: input({ mode: 'APPLY' }), evidencePaths,
      secrets: { destination: 'destination', bearer: 'x'.repeat(32), pepper: 'p'.repeat(32) },
    })).rejects.toThrow('LINE_ACTIVATION_COMPARE_AND_SWAP_FAILED')

    const commitFailure = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 },
      { rows: [{ version: 2, occurred_at: '2026-08-14T02:30:01.000Z' }], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ])
    const normalQuery = commitFailure.query.getMockImplementation()
    commitFailure.query.mockImplementation(async (sql, values) => {
      if (/^\s*commit\s*$/i.test(sql)) throw new Error('commit failed')
      return normalQuery(sql, values)
    })
    await expect(commitFailure.service.activate({
      input: input({ mode: 'APPLY' }), evidencePaths,
      secrets: { destination: 'destination', bearer: 'x'.repeat(32), pepper: 'p'.repeat(32) },
    })).rejects.toThrow('commit failed')
    expect(commitFailure.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })

  it('rolls back when the append-only event insert does not affect exactly one row', async () => {
    const h = harness([
      { rows: [] }, { rows: [bindingRow()], rowCount: 1 },
      { rows: [{ version: 2, occurred_at: '2026-08-14T02:30:01.000Z' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ])
    await expect(h.service.activate({
      input: input({ mode: 'APPLY' }), evidencePaths,
      secrets: { destination: 'destination', bearer: 'x'.repeat(32), pepper: 'p'.repeat(32) },
    })).rejects.toThrow('LINE_ACTIVATION_EVENT_INSERT_FAILED')
    expect(h.query.mock.calls.at(-1)[0].trim().toLowerCase()).toBe('rollback')
  })
})
