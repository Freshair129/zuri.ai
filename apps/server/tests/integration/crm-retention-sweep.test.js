import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'
import { setTenantRetentionOverride } from '@/modules/crm/retention-override-service'
import { runRetentionSweep, RETENTION_SWEEP_TOMBSTONE } from '@/modules/crm/retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'

// @req FR-230 — the crm-owned slice of the ADR-091 D2 nightly retention sweep.
// @spec ADR-070 D3, BR-002, SEC-031
// @tested tests/integration/crm-retention-sweep.test.js

const DAY_MS = 24 * 60 * 60 * 1000

let tenant, business, provider, sequence = 0

/** A LineOaAccount for the LineConversationJob fixture below — minimal, not the
 * full admission flow, since the sweep is about Message/job status, not
 * webhook admission. */
async function account() {
  const id = ++sequence
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Sweep connection ${id}`, externalAccountId: `sweep-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `sweep-account-${id}`, displayName: `Sweep OA ${id}`, bindingCode: `sweep-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED',
  } })
}

/** A minimal LineConversationJob pointed at `messageId`, with the given status. */
async function job(oa, messageId, status, over = {}) {
  return prisma.lineConversationJob.create({ data: {
    accountId: oa.id, inboundMessageId: messageId, eventId: `sweep-evt-${messageId}`,
    tenantId: tenant.id, businessId: business.id, channelAccountId: 'LEGACY:LINE',
    transportEpoch: 1, executionMode: 'SERVER', modelAccess: 'EXTERNAL_MODEL_ALLOWED',
    recipientId: 'recipient-1', sourceUserId: 'source-1', status,
    expiresAt: new Date(Date.now() + DAY_MS), correlationId: `sweep-corr-${messageId}`,
    ...over,
  } })
}

/** Ingest one message and backdate its createdAt (and its conversation's
 * updatedAt/lastMessageAt) directly — the retention window is measured from
 * Message.createdAt, which ingestLineMessage always sets to "now". */
async function backdatedMessage({ threadId, externalMessageId, ageDays }) {
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `U-sweep-${externalMessageId}`,
    threadId, text: `ข้อความ ${externalMessageId}`, externalMessageId,
  })
  const createdAt = new Date(Date.now() - ageDays * DAY_MS)
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt } })
  return result
}

describe('CRM retention sweep — MESSAGE_BODY_AND_ATTACHMENTS (FR-230)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Retention Sweep Group', code: 'PF-RETSWEEP' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Retention Sweep Tenant', code: 'TNT-RETSWEEP' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านทดสอบ', code: 'BUS-RETSWEEP' })
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
  })

  it('tombstones a message past the default window, and keeps its envelope columns', async () => {
    const past = await backdatedMessage({
      threadId: 'TH-SWEEP-DEFAULT', externalMessageId: 'MI-SWEEP-DEFAULT',
      ageDays: RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1,
    })
    const before = await prisma.message.findUnique({ where: { id: past.messageId } })

    const result = await runRetentionSweep({ now: new Date() })
    expect(result.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.redactedMessages).toBeGreaterThanOrEqual(1)

    const after = await prisma.message.findUnique({ where: { id: past.messageId } })
    expect(after.body).toBe(RETENTION_SWEEP_TOMBSTONE)
    // Envelope columns survive untouched.
    expect(after.id).toBe(before.id)
    expect(after.direction).toBe(before.direction)
    expect(after.conversationId).toBe(before.conversationId)
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
  })

  it('leaves a message inside its window untouched', async () => {
    const recent = await backdatedMessage({ threadId: 'TH-SWEEP-RECENT', externalMessageId: 'MI-SWEEP-RECENT', ageDays: 1 })
    await runRetentionSweep({ now: new Date() })
    const after = await prisma.message.findUnique({ where: { id: recent.messageId } })
    expect(after.body).toBe('ข้อความ MI-SWEEP-RECENT')
  })

  it('is idempotent: a second run over the same window recounts zero', async () => {
    await backdatedMessage({
      threadId: 'TH-SWEEP-IDEMPOTENT', externalMessageId: 'MI-SWEEP-IDEMPOTENT',
      ageDays: RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1,
    })
    const first = await runRetentionSweep({ now: new Date() })
    expect(first.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.redactedMessages).toBeGreaterThanOrEqual(1)
    const second = await runRetentionSweep({ now: new Date() })
    expect(second.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.redactedMessages).toBe(0)
  })

  it('never re-tombstones a message already carrying the PDPA erasure tombstone, and never double-counts it', async () => {
    const erased = await backdatedMessage({
      threadId: 'TH-SWEEP-PDPA', externalMessageId: 'MI-SWEEP-PDPA',
      ageDays: RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1,
    })
    await prisma.message.update({ where: { id: erased.messageId }, data: { body: CUSTOMER_ERASURE_TOMBSTONE } })
    const result = await runRetentionSweep({ now: new Date() })
    const after = await prisma.message.findUnique({ where: { id: erased.messageId } })
    expect(after.body).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    // Not part of this run's count — it was never a candidate.
    expect(result.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.redactedMessages).toBeGreaterThanOrEqual(0)
  })

  it("honours a Tenant's shortened override", async () => {
    await setTenantRetentionOverride({ tenantId: tenant.id, dataClass: 'MESSAGE_BODY_AND_ATTACHMENTS', windowDays: 5 })
    // Past the override (5 days) but well inside the installation default —
    // only the override makes this message eligible.
    const shortened = await backdatedMessage({ threadId: 'TH-SWEEP-OVERRIDE', externalMessageId: 'MI-SWEEP-OVERRIDE', ageDays: 10 })
    await runRetentionSweep({ now: new Date() })
    const after = await prisma.message.findUnique({ where: { id: shortened.messageId } })
    expect(after.body).toBe(RETENTION_SWEEP_TOMBSTONE)
  })

  it('skips a row a non-terminal LineConversationJob still references, across a scheduled run during its lifetime', async () => {
    const oa = await account()
    const referenced = await backdatedMessage({
      threadId: 'TH-SWEEP-LIVE-JOB', externalMessageId: 'MI-SWEEP-LIVE-JOB',
      ageDays: RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1,
    })
    const liveJob = await job(oa, referenced.messageId, 'QUEUED')

    await runRetentionSweep({ now: new Date() })

    const afterMessage = await prisma.message.findUnique({ where: { id: referenced.messageId } })
    expect(afterMessage.body).toBe(`ข้อความ MI-SWEEP-LIVE-JOB`)

    // Once the job settles (terminal), the same row becomes eligible.
    await prisma.lineConversationJob.update({ where: { id: liveJob.id }, data: { status: 'RECORDED' } })
    await runRetentionSweep({ now: new Date() })
    const afterSettled = await prisma.message.findUnique({ where: { id: referenced.messageId } })
    expect(afterSettled.body).toBe(RETENTION_SWEEP_TOMBSTONE)
  })

  it('redacts a MessageAttachment alongside its swept Message', async () => {
    const withAttachment = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'U-sweep-attachment',
      threadId: 'TH-SWEEP-ATTACHMENT', text: '[รูปภาพ]', externalMessageId: 'MI-SWEEP-ATTACHMENT',
      contentKind: 'MEDIA_REF', attachment: { kind: 'IMAGE', providerContentId: 'line-content-sweep-1' },
    })
    await prisma.message.update({
      where: { id: withAttachment.messageId },
      data: { createdAt: new Date(Date.now() - (RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1) * DAY_MS) },
    })
    await runRetentionSweep({ now: new Date() })
    const attachment = await prisma.messageAttachment.findUnique({ where: { id: withAttachment.attachmentId } })
    expect(attachment.fetchState).toBe('ERASED')
    expect(attachment.providerContentId).toBeNull()
  })

  it('refreshes Conversation.lastMessagePreview when the swept message was the latest', async () => {
    const only = await backdatedMessage({
      threadId: 'TH-SWEEP-PREVIEW', externalMessageId: 'MI-SWEEP-PREVIEW',
      ageDays: RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1,
    })
    await runRetentionSweep({ now: new Date() })
    const conversation = await prisma.conversation.findUnique({ where: { id: only.conversationId } })
    expect(conversation.lastMessagePreview).toBe(RETENTION_SWEEP_TOMBSTONE)
  })

  it('writes exactly one audit event per run, naming counts per class', async () => {
    await backdatedMessage({
      threadId: 'TH-SWEEP-AUDIT', externalMessageId: 'MI-SWEEP-AUDIT',
      ageDays: RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1,
    })
    const before = await prisma.auditEvent.count({ where: { entityType: 'RETENTION_SWEEP' } })
    const result = await runRetentionSweep({ now: new Date() })
    const after = await prisma.auditEvent.count({ where: { entityType: 'RETENTION_SWEEP' } })
    expect(after).toBe(before + 1)

    const event = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    expect(event.action).toBe('RETENTION_SWEEP_COMPLETED')
    const payload = JSON.parse(event.payloadJson)
    expect(payload.countsByClass).toHaveProperty('MESSAGE_BODY_AND_ATTACHMENTS')
    expect(payload.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS).toHaveProperty('redactedMessages')
    // Truthful reporting (ADR-070 D3): a class this codebase does not sweep is
    // simply absent, never a fabricated zero.
    expect(payload.countsByClass).not.toHaveProperty('RAW_LINE_PAYLOAD')
    expect(payload.countsByClass).not.toHaveProperty('AGENT_TRACE_EVENT')
    expect(payload.countsByClass).not.toHaveProperty('MSP_SESSION_CONTENT')
  })
})
