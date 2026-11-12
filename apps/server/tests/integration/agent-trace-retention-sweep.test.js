import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { LINE_OA_PROVIDER_CODE, createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { setTenantRetentionOverride, getEffectiveRetentionWindowDays } from '@/modules/crm/retention-override-service'
import {
  appendTraceEvent, readExecutionTrace, playbackTrace, redactTraceTurn, retentionTombstoneKey,
} from '@/modules/agent/execution-trace'
import {
  runAgentTraceRetentionSweep, sweepAgentTraceTurnsForTenant,
  AGENT_TRACE_RETENTION_AUDIT_ACTION, AGENT_TRACE_RETENTION_AUDIT_ENTITY,
  AGENT_TRACE_RETENTION_CHUNK_SIZE,
} from '@/modules/agent/trace-retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

// @req FR-230 — Agent-owned AGENT_TRACE_EVENT retention by complete turn age.
// @spec SEC-031, SEC-001, ADR-091 D2
// @tested tests/integration/agent-trace-retention-sweep.test.js

const DAY_MS = 24 * 60 * 60 * 1000
const CLASS = 'AGENT_TRACE_EVENT'
let provider

async function bundle(label) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`.toUpperCase()
  const portfolio = await createPortfolio({ name: `${label} portfolio`, code: `PF-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `${label} tenant`, code: `TN-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `${label} business`, code: `BU-${suffix}` })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: `${label} LINE connection`, externalAccountId: `OA-${suffix}`, status: 'ACTIVE' })
  const account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `oa-${suffix}`, displayName: `${label} OA`, bindingCode: `binding-${suffix}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED',
  } })
  return { tenant, business, connection, account }
}

async function makeJob(owner, { status = 'QUEUED', memoryDeliveryState = 'NONE' } = {}) {
  const message = await ingestLineMessage({ tenantId: owner.tenant.id, businessId: owner.business.id,
    lineUserId: `user-${randomUUID()}`, threadId: `thread-${randomUUID()}`, text: 'job fixture',
    externalMessageId: `message-${randomUUID()}` })
  return prisma.lineConversationJob.create({ data: {
    accountId: owner.account.id, inboundMessageId: message.messageId, eventId: `event-${randomUUID()}`,
    tenantId: owner.tenant.id, businessId: owner.business.id, channelAccountId: 'LINE:TRACE-RETENTION',
    transportEpoch: 1, executionMode: 'SERVER', modelAccess: 'EXTERNAL_MODEL_ALLOWED',
    recipientId: 'recipient', sourceUserId: 'source-user', status,
    expiresAt: new Date(Date.now() + DAY_MS), correlationId: `correlation-${randomUUID()}`,
    memoryDeliveryState, memorySyncOptIn: memoryDeliveryState === 'PENDING',
    acceptedAt: memoryDeliveryState === 'PENDING' ? new Date() : null,
    memoryDeliveryNextAttemptAt: memoryDeliveryState === 'PENDING' ? new Date() : null,
  } })
}

async function append(owner, turnId, { now = new Date(), kind = 'ANSWER_READY', ageDays = 91, occurredAt,
  payload = { privatePrompt: `sensitive-${randomUUID()}` }, idempotencyKey } = {}) {
  const createdAt = new Date(now.getTime() - ageDays * DAY_MS)
  const event = await appendTraceEvent(prisma, {
    scope: { tenantId: owner.tenant.id, businessId: owner.business.id },
    turnId, executionId: null, kind, idempotencyKey: idempotencyKey ?? `${turnId}:${kind}:${randomUUID()}`,
    payload, occurredAt: occurredAt ?? createdAt,
  })
  await prisma.agentTraceEvent.update({ where: { id: event.id }, data: { createdAt } })
  return prisma.agentTraceEvent.findUnique({ where: { id: event.id } })
}

async function createOldTurns(owner, count, now = new Date(), prefix = 'backlog') {
  const createdAt = new Date(now.getTime() - 91 * DAY_MS)
  const turns = Array.from({ length: count }, (_, index) => ({
    turnId: randomUUID(), id: randomUUID(), index,
  }))
  await prisma.agentTraceEvent.createMany({ data: turns.map(({ id, turnId, index }) => ({
    id, tenantId: owner.tenant.id, businessId: owner.business.id, turnId, executionId: null,
    kind: 'ANSWER_READY', idempotencyKey: `${prefix}:${index}:${randomUUID()}`,
    payloadJson: JSON.stringify({ privatePrompt: `${prefix}-${index}` }),
    occurredAt: createdAt, createdAt,
  })) })
  return turns
}

function scopedDb(tenantIds, { failOnTraceId, traceQueries = [] } = {}) {
  const wrapTrace = delegate => new Proxy(delegate, {
    get(model, method) {
      if (method === 'groupBy') return args => {
        traceQueries.push(args)
        return Reflect.get(model, method, model).call(model, args)
      }
      if (method === 'updateMany') return args => {
        if (failOnTraceId && args.where?.id?.in?.includes(failOnTraceId)) {
          throw Object.assign(new Error('injected failure'), { code: 'INJECTED_SWEEP_FAILURE' })
        }
        return Reflect.get(model, method, model).call(model, args)
      }
      return Reflect.get(model, method, model)
    },
  })
  const wrapTx = tx => new Proxy(tx, {
    get(target, property) {
      if (property === 'agentTraceEvent') return wrapTrace(target.agentTraceEvent)
      return Reflect.get(target, property, target)
    },
  })
  return new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction') return (work, options) => target.$transaction(tx => work(wrapTx(tx)), options)
      if (property === 'tenant') return new Proxy(target.tenant, {
        get(delegate, method) {
          if (method === 'findMany') return args => delegate.findMany({
            ...args, where: { AND: [args.where ?? {}, { id: { in: tenantIds } }] },
          })
          return Reflect.get(delegate, method, delegate)
        },
      })
      if (property === 'agentTraceEvent') return wrapTrace(target.agentTraceEvent)
      return Reflect.get(target, property, target)
    },
  })
}

function eventEnvelope(row) {
  return Object.fromEntries(['id', 'tenantId', 'businessId', 'turnId', 'executionId', 'kind',
    'idempotencyKey', 'occurredAt', 'createdAt', 'version'].map(key => [key, row[key]]))
}

describe('Agent trace payload retention sweep — FR-230', () => {
  beforeAll(async () => {
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  })

  it('leaves a turn inside the installation window unchanged', async () => {
    const owner = await bundle('trace-inside')
    const now = new Date()
    const turnId = randomUUID()
    const event = await append(owner, turnId, { now, ageDays: 1 })

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedTurns: 0, skippedNonTerminalJob: 0,
      skippedPendingMemoryDelivery: 0, skippedOpenErasure: 0 })
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })).payloadJson).toBe(event.payloadJson)
  })

  it('redacts only a wholly expired turn, preserves its envelope, and appends the retention close marker', async () => {
    const owner = await bundle('trace-expired')
    const now = new Date()
    const turnId = randomUUID()
    const event = await append(owner, turnId, { now, ageDays: RETENTION_DEFAULT_WINDOW_DAYS[CLASS] + 1,
      occurredAt: new Date(now.getTime() + 365 * DAY_MS) })
    const envelope = eventEnvelope(event)

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })
    const after = await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })
    const events = await readExecutionTrace(prisma, {
      scope: { tenantId: owner.tenant.id, businessId: owner.business.id }, turnId,
    })
    const tombstone = events.find(row => row.kind === 'RETENTION_TOMBSTONE'
      && row.idempotencyKey === retentionTombstoneKey(turnId))

    expect(result).toMatchObject({ redactedTurns: 1, redactedEvents: 1 })
    expect(result.tenantFailure).toBeUndefined()
    expect(after.payloadJson).toBe('{"redacted":true}')
    expect(eventEnvelope(after)).toEqual(envelope)
    expect(JSON.parse(tombstone.payloadJson)).toMatchObject({ reason: 'RETENTION_EXPIRED' })
    expect(playbackTrace(events).reasons).toContain('RETENTION_TOMBSTONE')
  })

  it('honors a shortened Tenant retention window', async () => {
    const owner = await bundle('trace-short-window')
    const now = new Date()
    await setTenantRetentionOverride({ tenantId: owner.tenant.id, dataClass: CLASS, windowDays: 5 })
    const expired = await append(owner, randomUUID(), { now, ageDays: 10 })
    const recent = await append(owner, randomUUID(), { now, ageDays: 3 })

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedTurns).toBe(1)
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: expired.id } })).payloadJson).toBe('{"redacted":true}')
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: recent.id } })).payloadJson).toBe(recent.payloadJson)
  })

  it('refuses a longer override and clamps a directly inserted invalid value to the default', async () => {
    const owner = await bundle('trace-long-window')
    const now = new Date()
    await expect(setTenantRetentionOverride({ tenantId: owner.tenant.id, dataClass: CLASS, windowDays: 91 }))
      .rejects.toMatchObject({ status: 422 })
    await prisma.tenantRetentionOverride.create({ data: {
      tenantId: owner.tenant.id, dataClass: CLASS, windowDays: 500,
    } })
    expect(await getEffectiveRetentionWindowDays({ tenantId: owner.tenant.id, dataClass: CLASS })).toBe(90)
    const event = await append(owner, randomUUID(), { now, ageDays: 91 })

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedTurns).toBe(1)
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })).payloadJson).toBe('{"redacted":true}')
  })

  it('is row-idempotent on a second service run and writes an audit event for each run', async () => {
    const owner = await bundle('trace-second-run')
    const now = new Date()
    const turnId = randomUUID()
    await append(owner, turnId, { now, ageDays: 91 })
    const db = scopedDb([owner.tenant.id])

    const first = await runAgentTraceRetentionSweep({ db, now })
    const second = await runAgentTraceRetentionSweep({ db, now })

    expect(first.auditEventId).not.toBe(second.auditEventId)
    expect(first.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(second.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(first.countsByClass[CLASS].redactedTurns).toBe(1)
    expect(second.countsByClass[CLASS].redactedTurns).toBe(0)
    expect(second.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(await prisma.auditEvent.count({ where: { id: { in: [first.auditEventId, second.auditEventId] } } })).toBe(2)
  })

  it('stops after a failed turn, keeps earlier commits, and continues with the next Tenant', async () => {
    const owners = [await bundle('trace-page-failure'), await bundle('trace-following-tenant')]
      .sort((a, b) => a.tenant.id.localeCompare(b.tenant.id))
    const [failing, following] = owners
    const now = new Date()
    const turns = await createOldTurns(failing, AGENT_TRACE_RETENTION_CHUNK_SIZE + 2, now, 'failure')
    const failTurnId = turns.map(turn => turn.turnId).sort()[AGENT_TRACE_RETENTION_CHUNK_SIZE]
    const failEvent = turns.find(turn => turn.turnId === failTurnId)
    const followingTurn = randomUUID()
    const followingEvent = await append(following, followingTurn, { now, ageDays: 91 })
    const result = await runAgentTraceRetentionSweep({
      db: scopedDb(owners.map(owner => owner.tenant.id), { failOnTraceId: failEvent.id }), now,
    })
    const counts = result.countsByClass[CLASS]

    expect(counts.tenantFailures).toEqual([{ tenantId: failing.tenant.id, code: 'INJECTED_SWEEP_FAILURE' }])
    // The failed turn's transaction contributes zero; this total is 100
    // committed turns from the first Tenant plus the following Tenant's turn.
    expect(counts.redactedTurns).toBe(AGENT_TRACE_RETENTION_CHUNK_SIZE + 1)
    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    expect(JSON.parse(audit.payloadJson).countsByClass[CLASS]).toMatchObject({
      redactedTurns: AGENT_TRACE_RETENTION_CHUNK_SIZE + 1,
      tenantFailures: [{ tenantId: failing.tenant.id, code: 'INJECTED_SWEEP_FAILURE' }],
    })
    const firstPageTurnIds = turns.map(turn => turn.turnId).sort().slice(0, AGENT_TRACE_RETENTION_CHUNK_SIZE)
    const firstPage = await prisma.agentTraceEvent.findMany({
      where: { tenantId: failing.tenant.id, turnId: { in: firstPageTurnIds }, kind: 'ANSWER_READY' },
      select: { payloadJson: true },
    })
    expect(firstPage).toHaveLength(AGENT_TRACE_RETENTION_CHUNK_SIZE)
    expect(firstPage.every(row => row.payloadJson === '{"redacted":true}')).toBe(true)
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: failEvent.id } })).payloadJson)
      .toContain('failure-')
    const lastTurn = turns.find(turn => turn.turnId === turns.map(item => item.turnId).sort().at(-1))
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: lastTurn.id } })).payloadJson).toContain('failure-')
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: followingEvent.id } })).payloadJson)
      .toBe('{"redacted":true}')
  })

  it('skips and counts a turn referenced by a non-terminal LINE job', async () => {
    const owner = await bundle('trace-live-job')
    const now = new Date()
    const job = await makeJob(owner, { status: 'ACCEPTED' })
    const event = await append(owner, job.id, { now, ageDays: 100 })

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedTurns: 0, skippedNonTerminalJob: 1 })
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })).payloadJson).toBe(event.payloadJson)
  })

  it('skips and counts terminal turns whose MSP memory delivery is still pending', async () => {
    const owner = await bundle('trace-memory-pending')
    const now = new Date()
    const job = await makeJob(owner, { status: 'RECORDED', memoryDeliveryState: 'PENDING' })
    const event = await append(owner, job.id, { now, ageDays: 100, kind: 'MEMORY_DELIVERY_PENDING',
      payload: { jobId: job.id, externalThreadRef: 'private-thread' } })

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedTurns: 0, skippedPendingMemoryDelivery: 1 })
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })).payloadJson).toBe(event.payloadJson)
  })

  it('keeps pending memory erasures with FAILED events open and allows acknowledged erasures to expire', async () => {
    const owner = await bundle('trace-erasure-fence')
    const now = new Date()
    const openTurn = randomUUID()
    const pending = await append(owner, openTurn, { now, ageDays: 100, kind: 'MEMORY_THREAD_ERASURE_PENDING',
      payload: { principalId: 'private-principal' } })
    const failed = await append(owner, openTurn, { now, ageDays: 99, kind: 'MEMORY_THREAD_ERASURE_FAILED',
      payload: { code: 'MSP_UNAVAILABLE' } })
    const closedTurn = randomUUID()
    await append(owner, closedTurn, { now, ageDays: 100, kind: 'MEMORY_THREAD_ERASURE_PENDING' })
    const deferred = await append(owner, closedTurn, { now, ageDays: 99,
      kind: 'MEMORY_THREAD_ERASURE_DEFERRED', occurredAt: new Date(now.getTime() + 30 * DAY_MS) })
    const acknowledged = await append(owner, closedTurn, { now, ageDays: 98, kind: 'MEMORY_THREAD_ERASURE_ACKNOWLEDGED' })

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedTurns: 1, skippedOpenErasure: 1 })
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: pending.id } })).payloadJson).toBe(pending.payloadJson)
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: failed.id } })).payloadJson).toBe(failed.payloadJson)
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: deferred.id } })).payloadJson).toBe('{"redacted":true}')
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: acknowledged.id } })).payloadJson).toBe('{"redacted":true}')
  })

  it('leaves an already tombstoned turn unchanged and uncounted', async () => {
    const owner = await bundle('trace-existing-tombstone')
    const now = new Date()
    const turnId = randomUUID()
    const event = await append(owner, turnId, { now, ageDays: 100 })
    const payload = JSON.stringify({ reason: 'PDPA_ERASURE', redactedAt: now.toISOString() })
    await prisma.agentTraceEvent.create({ data: {
      tenantId: owner.tenant.id, businessId: owner.business.id, turnId, executionId: null,
      kind: 'RETENTION_TOMBSTONE', idempotencyKey: retentionTombstoneKey(turnId), payloadJson: payload,
      occurredAt: new Date(now.getTime() - 95 * DAY_MS), createdAt: new Date(now.getTime() - 95 * DAY_MS),
    } })
    const before = (await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })).payloadJson

    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedTurns).toBe(0)
    expect((await prisma.agentTraceEvent.findUnique({ where: { id: event.id } })).payloadJson).toBe(before)
  })

  it('sweeps a backlog of at least 250 turns in multiple pages without tenant failures', async () => {
    const owner = await bundle('trace-backlog')
    const now = new Date()
    const turns = await createOldTurns(owner, 250, now)
    const traceQueries = []

    const result = await sweepAgentTraceTurnsForTenant(scopedDb([owner.tenant.id], { traceQueries }), {
      tenantId: owner.tenant.id, now,
    })

    expect(result.redactedTurns).toBe(250)
    expect(result.redactedEvents).toBe(250)
    expect(result.tenantFailure).toBeUndefined()
    expect(traceQueries.length).toBeGreaterThan(1)
    expect(traceQueries.every(query => query.take === AGENT_TRACE_RETENTION_CHUNK_SIZE
      && query.having.createdAt._max.lt instanceof Date
      && query.orderBy.every(order => ['businessId', 'turnId'].some(field => field in order)))).toBe(true)
    const tombstones = await prisma.agentTraceEvent.count({
      where: { tenantId: owner.tenant.id, turnId: { in: turns.map(turn => turn.turnId) }, kind: 'RETENTION_TOMBSTONE' },
    })
    expect(tombstones).toBe(250)
  })

  it('writes its own audit shape without matching the CRM route guard', async () => {
    const owner = await bundle('trace-audit')
    const now = new Date()
    await append(owner, randomUUID(), { now, ageDays: 91 })
    const result = await runAgentTraceRetentionSweep({ db: scopedDb([owner.tenant.id]), now })
    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    const payload = JSON.parse(audit.payloadJson)

    expect(audit).toMatchObject({ entityType: AGENT_TRACE_RETENTION_AUDIT_ENTITY,
      action: AGENT_TRACE_RETENTION_AUDIT_ACTION, actorType: 'SYSTEM', tenantId: null, businessId: null })
    expect(result.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(payload).toMatchObject({ ranAt: now.toISOString(), countsByClass: {
      [CLASS]: { redactedTurns: 1, redactedEvents: 1, skippedNonTerminalJob: 0,
        skippedPendingMemoryDelivery: 0, skippedOpenErasure: 0 },
    } })
    expect(result.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(audit.payloadJson).not.toContain('sensitive-')
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const crmGuardResult = await prisma.auditEvent.findFirst({
      where: { entityType: 'RETENTION_SWEEP', action: 'RETENTION_SWEEP_COMPLETED',
        occurredAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) } },
      select: { id: true },
    })
    expect(crmGuardResult?.id).not.toBe(result.auditEventId)
  })

  it('does not replace a retention reason when a later PDPA erasure arrives', async () => {
    const owner = await bundle('trace-late-erasure')
    const now = new Date()
    const turnId = randomUUID()
    await append(owner, turnId, { now, ageDays: 91 })
    const result = await sweepAgentTraceTurnsForTenant(prisma, { tenantId: owner.tenant.id, now })
    expect(result.redactedTurns).toBe(1)

    await redactTraceTurn(prisma, {
      scope: { tenantId: owner.tenant.id, businessId: owner.business.id }, turnId,
      now: new Date(now.getTime() + DAY_MS),
    })
    const tombstone = await prisma.agentTraceEvent.findFirst({
      where: { tenantId: owner.tenant.id, businessId: owner.business.id, turnId,
        kind: 'RETENTION_TOMBSTONE', idempotencyKey: retentionTombstoneKey(turnId) },
    })
    expect(JSON.parse(tombstone.payloadJson).reason).toBe('RETENTION_EXPIRED')
  })
})
