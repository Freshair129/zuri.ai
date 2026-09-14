// @req FR-235 — the publisher control for LineOaAccount.knowledgeGrounding.
// @spec ADR-090 D1, ADR-060 D5, D11 (versioned, audited configuration writes)
// @tested tests/integration/fr235-line-oa-knowledge-grounding-control.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { zLineOaAccountAction } from '@/modules/line-oa-studio/domain/line-oa-account'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'

let business, owner, member, account

describe('FR-235 — LineOaAccount knowledgeGrounding publisher control', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-KGROUND', name: 'Knowledge grounding' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KGROUND', name: 'Knowledge grounding' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-KGROUND', name: 'Knowledge grounding' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['line-oa'] })

    const connection = await provisionLineServerConnection(
      { businessId: business.id, name: 'Main', destination: `U${'a'.repeat(32)}`, secretRef: 'deployment-secret:kground' },
      { viewer: owner },
    )
    account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: 'oa-kground-main', displayName: 'Main' }, { viewer: owner })
  })

  it('defaults a new account to BUSINESS_KNOWLEDGE — nothing reads a corpus until a publisher switches it', () => {
    expect(account.knowledgeGrounding).toBe('BUSINESS_KNOWLEDGE')
  })

  it('the zod schema requires knowledgeGrounding for this action and rejects an unrecognised mode', () => {
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: 'NOT_A_MODE' })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: 'GKS_CORPUS' })).not.toThrow()
  })

  it('a non-owner cannot switch the mode; the row is unchanged', async () => {
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: 'GKS_CORPUS' }, { viewer: member }))
      .rejects.toMatchObject({ status: 404 })
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).knowledgeGrounding).toBe('BUSINESS_KNOWLEDGE')
  })

  it('an owner switches the mode; the write is versioned and audited with no secret and no customer content', async () => {
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }, { viewer: owner })
    expect(account.knowledgeGrounding).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: account.id, action: 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED' }, orderBy: { occurredAt: 'desc' } })
    expect(audit).toBeTruthy()
    const payload = JSON.parse(audit.payloadJson ?? audit.payload ?? '{}')
    expect(payload.from.knowledgeGrounding).toBe('BUSINESS_KNOWLEDGE')
    expect(payload.to.knowledgeGrounding).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')
    expect(JSON.stringify(payload)).not.toMatch(/secret|token|password/i)
  })

  // @req FR-235 — a grounding-mode switch is not a transport, credential or
  // execution-permission change: it never fences (bumps the transport epoch
  // or cancels QUEUED/CLAIMED/READY jobs), unlike CONFIGURE_EXECUTION,
  // SWITCH_TRANSPORT_MODE, ENABLE_SERVER, DISABLE_SERVER, PAUSE and ARCHIVE.
  it('never fences in-flight work: transportEpoch is unchanged and a queued job survives the switch', async () => {
    const inbound = await ingestLineMessage({
      tenantId: account.tenantId, businessId: account.businessId, channelAccountId: account.id,
      lineUserId: 'line-fence-user', threadId: 'line-fence-thread', text: 'Hello',
      externalMessageId: `fence-check-${randomUUID()}`,
    })
    const job = await prisma.lineConversationJob.create({ data: {
      accountId: account.id, inboundMessageId: inbound.messageId, eventId: `event-${randomUUID()}`,
      tenantId: account.tenantId, businessId: account.businessId, channelAccountId: account.id,
      transportEpoch: account.transportEpoch, executionMode: 'SERVER', modelAccess: 'LOCAL_ONLY',
      recipientId: 'line-fence-user', sourceUserId: 'line-fence-user',
      status: 'QUEUED', expiresAt: new Date(Date.now() + 60000), correlationId: `fence-check-${randomUUID()}`,
    } })
    const beforeEpoch = account.transportEpoch
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: 'GKS_CORPUS' }, { viewer: owner })
    expect(account.transportEpoch).toBe(beforeEpoch)
    const survivedJob = await prisma.lineConversationJob.findUnique({ where: { id: job.id } })
    expect(survivedJob.status).toBe('QUEUED')
    expect(survivedJob.transportEpoch).toBe(beforeEpoch)
  })

  it('a stale version conflicts rather than silently applying', async () => {
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version - 1, knowledgeGrounding: 'GKS_CORPUS' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409 })
  })

  it('switching to the same mode again is a conflict, not a silent no-op write', async () => {
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: account.knowledgeGrounding }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_KNOWLEDGE_GROUNDING_UNCHANGED' })
  })

  it('switching back to BUSINESS_KNOWLEDGE is a normal, symmetric write', async () => {
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version, knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }, { viewer: owner })
    expect(account.knowledgeGrounding).toBe('BUSINESS_KNOWLEDGE')
  })

  it('an archived account may not have its grounding mode switched', async () => {
    const archived = await applyLineOaAccountAction(account.id, { action: 'ARCHIVE', version: account.version }, { viewer: owner })
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: archived.version, knowledgeGrounding: 'GKS_CORPUS' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_ARCHIVED' })
  })
})
