import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { LINE_OA_PROVIDER_CODE, createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { setTenantRetentionOverride, getEffectiveRetentionWindowDays } from '@/modules/crm/retention-override-service'
import {
  runRawLineRetentionSweep, sweepRawLinePayloadsForTenant,
  RAW_LINE_RETENTION_AUDIT_ACTION, RAW_LINE_RETENTION_AUDIT_ENTITY,
  RAW_RETENTION_SWEEP_CHUNK_SIZE,
} from '@/platform/integrations/core/raw-line-retention-sweep-service'
import {
  rawRecordErasureTombstone, rawRecordRetentionTombstone, RAW_RECORD_RETENTION_REASON,
  RAW_RECORD_TOMBSTONE_PREFIXES, tombstoneRawRecordsForExternalIds,
} from '@/platform/integrations/core/raw-record-redaction'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

// @req FR-230 — Integration-owned RAW_LINE_PAYLOAD retention with Tenant
//   overrides, terminal tombstones, and bounded/audited failure isolation.
// @spec SEC-031, SEC-001, ADR-091 D2
// @tested tests/integration/raw-line-retention-sweep.test.js

const DAY_MS = 24 * 60 * 60 * 1000
const CLASS = 'RAW_LINE_PAYLOAD'
let lineProvider, otherProvider, sequence = 0

async function bundle(label) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`.toUpperCase()
  const portfolio = await createPortfolio({ name: `${label} portfolio`, code: `PF-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `${label} tenant`, code: `TN-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `${label} business`, code: `BU-${suffix}` })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: lineProvider.id, name: `${label} LINE connection`, externalAccountId: `OA-${suffix}`, status: 'ACTIVE' })
  const account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `oa-${suffix}`, displayName: `${label} OA`, bindingCode: `binding-${suffix}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED',
  } })
  return { tenant, business, connection, account }
}

async function raw(owner, { now = new Date(), ageDays, externalId = `event-${++sequence}-${randomUUID()}`,
  provider = LINE_OA_PROVIDER_CODE, processingStatus = 'PROCESSED', entityType = 'LINE_MESSAGE' } = {}) {
  return prisma.rawExternalRecord.create({ data: {
    tenantId: owner.tenant.id, businessId: owner.business.id,
    connectionId: owner.connection.id, provider, lane: 'CUSTOMER', entityType,
    externalId, sourceType: 'WEBHOOK', schemaVersion: 'line.messaging-api.webhook.v1',
    sourceUri: 'https://line.invalid/hook', payloadJson: JSON.stringify({ event: { message: { id: externalId, text: `private ${externalId}` } } }),
    payloadHash: `hash-${randomUUID()}`, idempotencyKey: `idem-${randomUUID()}`,
    receivedAt: new Date(now.getTime() - ageDays * DAY_MS), processingStatus,
  } })
}

async function lineJob(owner, row, status = 'QUEUED') {
  const message = await ingestLineMessage({ tenantId: owner.tenant.id, businessId: owner.business.id,
    lineUserId: `user-${randomUUID()}`, threadId: `thread-${randomUUID()}`, text: 'job fixture',
    externalMessageId: `message-${randomUUID()}` })
  return prisma.lineConversationJob.create({ data: {
    accountId: owner.account.id, inboundMessageId: message.messageId, eventId: row.externalId,
    tenantId: owner.tenant.id, businessId: owner.business.id, channelAccountId: 'LINE:RETENTION',
    transportEpoch: 1, executionMode: 'SERVER', modelAccess: 'EXTERNAL_MODEL_ALLOWED',
    recipientId: 'recipient', sourceUserId: 'source-user', status,
    expiresAt: new Date(Date.now() + DAY_MS), correlationId: `correlation-${randomUUID()}`,
  } })
}

function scopedDb(tenantIds, { failOnRawId, rawQueries = [] } = {}) {
  return new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction') {
        return () => { throw new Error('RAW_SWEEP_MUST_NOT_OPEN_INTERACTIVE_TRANSACTION') }
      }
      if (property === 'tenant') {
        return new Proxy(target.tenant, {
          get(delegate, method) {
            if (method === 'findMany') return args => delegate.findMany({
              ...args,
              where: { AND: [args.where ?? {}, { id: { in: tenantIds } }] },
            })
            return Reflect.get(delegate, method, delegate)
          },
        })
      }
      if (property === 'rawExternalRecord') {
        return new Proxy(target.rawExternalRecord, {
          get(delegate, method) {
            if (method === 'findMany') return args => {
              rawQueries.push(args)
              return delegate.findMany(args)
            }
            if (method === 'updateMany') return args => {
              if (failOnRawId && args.where?.id?.in?.includes(failOnRawId)) {
                throw Object.assign(new Error('injected failure'), { code: 'INJECTED_SWEEP_FAILURE' })
              }
              return delegate.updateMany(args)
            }
            return Reflect.get(delegate, method, delegate)
          },
        })
      }
      return Reflect.get(target, property, target)
    },
  })
}

function rawEnvelope(row) {
  // updatedAt is a write timestamp and is expected to advance with redaction.
  return Object.fromEntries(['id', 'tenantId', 'businessId', 'connectionId', 'ingestionRunId', 'provider', 'lane',
    'entityType', 'externalId', 'sourceType', 'sourceUri', 'schemaVersion', 'payloadHash', 'idempotencyKey',
    'receivedAt', 'processingStatus', 'processingError', 'processedAt', 'createdAt']
    .map(key => [key, row[key]]))
}

describe('raw LINE payload retention sweep — FR-230', () => {
  beforeAll(async () => {
    lineProvider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
    otherProvider = await registerIntegrationProvider({ code: 'RETENTION_OTHER_PROVIDER', name: 'Other provider' })
  })

  it('leaves a payload inside the installation window unchanged', async () => {
    const owner = await bundle('raw-inside')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: 1 })

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedRawRecords: 0, skippedNonTerminalJob: 0, skippedAdmitting: 0 })
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson).toBe(row.payloadJson)
  })

  it('tombstones an expired payload and preserves evidence envelope fields', async () => {
    const owner = await bundle('raw-expired')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: RETENTION_DEFAULT_WINDOW_DAYS[CLASS] + 1 })
    const envelope = rawEnvelope(row)

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })
    const after = await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })

    expect(result.redactedRawRecords).toBe(1)
    expect(JSON.parse(after.payloadJson)).toEqual(JSON.parse(rawRecordRetentionTombstone(now)))
    expect(JSON.parse(after.payloadJson).reason).toBe(RAW_RECORD_RETENTION_REASON)
    expect(rawEnvelope(after)).toEqual(envelope)
  })

  it('honors a shortened Tenant retention window', async () => {
    const owner = await bundle('raw-short-window')
    const now = new Date()
    await setTenantRetentionOverride({ tenantId: owner.tenant.id, dataClass: CLASS, windowDays: 5 })
    const expired = await raw(owner, { now, ageDays: 10 })
    const recent = await raw(owner, { now, ageDays: 3 })

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedRawRecords).toBe(1)
    expect(JSON.parse((await prisma.rawExternalRecord.findUnique({ where: { id: expired.id } })).payloadJson).reason)
      .toBe(RAW_RECORD_RETENTION_REASON)
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: recent.id } })).payloadJson).toBe(recent.payloadJson)
  })

  it('refuses a longer override and clamps a directly inserted invalid value to the default', async () => {
    const owner = await bundle('raw-long-window')
    const now = new Date()
    await expect(setTenantRetentionOverride({ tenantId: owner.tenant.id, dataClass: CLASS, windowDays: 91 }))
      .rejects.toMatchObject({ status: 422 })
    await prisma.tenantRetentionOverride.create({ data: {
      tenantId: owner.tenant.id, dataClass: CLASS, windowDays: 500,
    } })
    expect(await getEffectiveRetentionWindowDays({ tenantId: owner.tenant.id, dataClass: CLASS })).toBe(90)
    const row = await raw(owner, { now, ageDays: 91 })

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedRawRecords).toBe(1)
    expect(JSON.parse((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson).reason)
      .toBe(RAW_RECORD_RETENTION_REASON)
  })

  it('is row-idempotent on a second service run and writes an audit event for each run', async () => {
    const owner = await bundle('raw-second-run')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: 91 })
    const db = scopedDb([owner.tenant.id])

    const first = await runRawLineRetentionSweep({ db, now })
    const second = await runRawLineRetentionSweep({ db, now })

    expect(first.auditEventId).not.toBe(second.auditEventId)
    expect(first.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(second.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(first.countsByClass[CLASS].redactedRawRecords).toBe(1)
    expect(second.countsByClass[CLASS].redactedRawRecords).toBe(0)
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson)
      .toBe(rawRecordRetentionTombstone(now))
    expect(await prisma.auditEvent.count({ where: { id: { in: [first.auditEventId, second.auditEventId] } } })).toBe(2)
  })

  it('stops a failed Tenant after its current page, retains committed work, and continues to the next Tenant', async () => {
    const owners = [await bundle('raw-page-failure'), await bundle('raw-following-tenant')]
      .sort((a, b) => a.tenant.id.localeCompare(b.tenant.id))
    const [failing, following] = owners
    const now = new Date()
    const defaults = Array.from({ length: RAW_RETENTION_SWEEP_CHUNK_SIZE * 2 + 5 }, (_, index) => ({
      id: randomUUID(), tenantId: failing.tenant.id, businessId: failing.business.id,
      connectionId: failing.connection.id, provider: LINE_OA_PROVIDER_CODE, lane: 'CUSTOMER', entityType: 'LINE_MESSAGE',
      externalId: `failure-${index}-${randomUUID()}`, sourceType: 'WEBHOOK', schemaVersion: 'line.messaging-api.webhook.v1',
      payloadJson: JSON.stringify({ event: { message: { text: `private failure ${index}` } } }),
      payloadHash: `hash-${randomUUID()}`, idempotencyKey: `idem-${randomUUID()}`,
      receivedAt: new Date(now.getTime() - 91 * DAY_MS), processingStatus: 'PROCESSED',
    }))
    await prisma.rawExternalRecord.createMany({ data: defaults })
    const ordered = await prisma.rawExternalRecord.findMany({
      where: { tenantId: failing.tenant.id, externalId: { startsWith: 'failure-' } },
      select: { id: true }, orderBy: { id: 'asc' },
    })
    const failId = ordered[RAW_RETENTION_SWEEP_CHUNK_SIZE].id
    const nextTenantRow = await raw(following, { now, ageDays: 91 })
    const result = await runRawLineRetentionSweep({
      db: scopedDb(owners.map(owner => owner.tenant.id), { failOnRawId: failId }), now,
    })
    const counts = result.countsByClass[CLASS]

    expect(counts.tenantFailures).toEqual([{ tenantId: failing.tenant.id, code: 'INJECTED_SWEEP_FAILURE' }])
    // The failed page contributes zero; this total is 100 committed rows from
    // the first Tenant plus the one row from the following Tenant.
    expect(counts.redactedRawRecords).toBe(RAW_RETENTION_SWEEP_CHUNK_SIZE + 1)
    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    expect(JSON.parse(audit.payloadJson).countsByClass[CLASS]).toMatchObject({
      redactedRawRecords: RAW_RETENTION_SWEEP_CHUNK_SIZE + 1,
      tenantFailures: [{ tenantId: failing.tenant.id, code: 'INJECTED_SWEEP_FAILURE' }],
    })
    const firstPage = await prisma.rawExternalRecord.findMany({
      where: { tenantId: failing.tenant.id, externalId: { startsWith: 'failure-' } },
      select: { payloadJson: true }, orderBy: { id: 'asc' }, take: RAW_RETENTION_SWEEP_CHUNK_SIZE,
    })
    expect(firstPage.every(row => row.payloadJson.startsWith(RAW_RECORD_TOMBSTONE_PREFIXES[1]))).toBe(true)
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: failId } })).payloadJson).toContain('private failure')
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: ordered.at(-1).id } })).payloadJson)
      .toContain('private failure')
    expect(JSON.parse((await prisma.rawExternalRecord.findUnique({ where: { id: nextTenantRow.id } })).payloadJson).reason)
      .toBe(RAW_RECORD_RETENTION_REASON)
  })

  it('skips and counts a row referenced by a non-terminal LINE job', async () => {
    const owner = await bundle('raw-live-job')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: 91 })
    const job = await lineJob(owner, row, 'UNKNOWN')

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedRawRecords: 0, skippedNonTerminalJob: 1 })
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson).toBe(row.payloadJson)
    expect((await prisma.lineConversationJob.findUnique({ where: { id: job.id } })).status).toBe('UNKNOWN')
  })

  it('skips and counts ADMITTING rows for the payload-reading reconciler', async () => {
    const owner = await bundle('raw-admitting')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: 91, processingStatus: 'ADMITTING' })

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result).toMatchObject({ redactedRawRecords: 0, skippedAdmitting: 1 })
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson).toBe(row.payloadJson)
  })

  it('leaves both PDPA and retention tombstones unchanged and uncounted', async () => {
    const owner = await bundle('raw-tombstones')
    const now = new Date()
    const erased = await raw(owner, { now, ageDays: 91 })
    const retained = await raw(owner, { now, ageDays: 91 })
    const erasedPayload = rawRecordErasureTombstone(now)
    const retainedPayload = rawRecordRetentionTombstone(now)
    await prisma.rawExternalRecord.update({ where: { id: erased.id }, data: { payloadJson: erasedPayload } })
    await prisma.rawExternalRecord.update({ where: { id: retained.id }, data: { payloadJson: retainedPayload } })

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedRawRecords).toBe(0)
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: erased.id } })).payloadJson).toBe(erasedPayload)
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: retained.id } })).payloadJson).toBe(retainedPayload)
  })

  it('does not touch raw records from another provider', async () => {
    const owner = await bundle('raw-other-provider')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: 91, provider: otherProvider.code })

    const result = await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    expect(result.redactedRawRecords).toBe(0)
    expect((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson).toBe(row.payloadJson)
  })

  it('sweeps a backlog larger than two pages without selecting payloads', async () => {
    const owner = await bundle('raw-backlog')
    const now = new Date()
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: randomUUID(), tenantId: owner.tenant.id, businessId: owner.business.id,
      connectionId: owner.connection.id, provider: LINE_OA_PROVIDER_CODE, lane: 'CUSTOMER', entityType: 'LINE_MESSAGE',
      externalId: `backlog-${index}-${randomUUID()}`, sourceType: 'WEBHOOK', schemaVersion: 'line.messaging-api.webhook.v1',
      payloadJson: JSON.stringify({ event: { message: { text: `private backlog ${index}` } } }),
      payloadHash: `hash-${randomUUID()}`, idempotencyKey: `idem-${randomUUID()}`,
      receivedAt: new Date(now.getTime() - 91 * DAY_MS), processingStatus: 'PROCESSED',
    }))
    await prisma.rawExternalRecord.createMany({ data: rows })
    const rawQueries = []

    const result = await sweepRawLinePayloadsForTenant(scopedDb([owner.tenant.id], { rawQueries }), {
      tenantId: owner.tenant.id, now,
    })

    expect(result.redactedRawRecords).toBe(250)
    expect(rawQueries.length).toBeGreaterThan(1)
    expect(rawQueries.every(query => query.take <= RAW_RETENTION_SWEEP_CHUNK_SIZE
      && JSON.stringify(query.select) === JSON.stringify({ id: true, externalId: true, processingStatus: true })
      && !JSON.stringify(query.select).includes('payloadJson'))).toBe(true)
    const remaining = await prisma.rawExternalRecord.count({
      where: { tenantId: owner.tenant.id, externalId: { startsWith: 'backlog-' }, payloadJson: { not: { startsWith: RAW_RECORD_TOMBSTONE_PREFIXES[1] } } },
    })
    expect(remaining).toBe(0)
  })

  it('writes its own audit shape without matching the CRM route guard', async () => {
    const owner = await bundle('raw-audit')
    const now = new Date()
    await raw(owner, { now, ageDays: 91 })
    const result = await runRawLineRetentionSweep({ db: scopedDb([owner.tenant.id]), now })
    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    const payload = JSON.parse(audit.payloadJson)

    expect(audit).toMatchObject({ entityType: RAW_LINE_RETENTION_AUDIT_ENTITY, action: RAW_LINE_RETENTION_AUDIT_ACTION,
      actorType: 'SYSTEM', tenantId: null, businessId: null })
    expect(result.countsByClass[CLASS].tenantFailures).toBeUndefined()
    expect(payload).toMatchObject({ ranAt: now.toISOString(), countsByClass: {
      [CLASS]: { redactedRawRecords: 1, skippedNonTerminalJob: 0, skippedAdmitting: 0 },
    } })
    expect(audit.payloadJson).not.toContain('private')
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const crmGuardResult = await prisma.auditEvent.findFirst({
      where: { entityType: 'RETENTION_SWEEP', action: 'RETENTION_SWEEP_COMPLETED',
        occurredAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) } },
      select: { id: true },
    })
    expect(crmGuardResult?.id).not.toBe(result.auditEventId)
  })

  it('does not count a later PDPA erasure of a retention-tombstoned record', async () => {
    const owner = await bundle('raw-late-erasure')
    const now = new Date()
    const row = await raw(owner, { now, ageDays: 91 })
    await sweepRawLinePayloadsForTenant(prisma, { tenantId: owner.tenant.id, now })

    const erasure = await tombstoneRawRecordsForExternalIds(prisma, {
      tenantId: owner.tenant.id, externalIds: [row.externalId], now: new Date(now.getTime() + DAY_MS),
    })

    expect(erasure.tombstonedRawRecords).toBe(0)
    expect(JSON.parse((await prisma.rawExternalRecord.findUnique({ where: { id: row.id } })).payloadJson).reason)
      .toBe(RAW_RECORD_RETENTION_REASON)
  })
})
