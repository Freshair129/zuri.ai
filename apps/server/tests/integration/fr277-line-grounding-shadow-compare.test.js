// @req FR-277 — the publisher/operator control for LineOaAccount.knowledgeGroundingShadow,
//   and the durable comparison row produced by the harness itself.
// @spec ADR-090 D1-D3 (Phase 3), ADR-060 D5, D11 (versioned, audited configuration writes)
// @tested tests/integration/fr277-line-grounding-shadow-compare.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { zLineOaAccountAction } from '@/modules/line-oa-studio/domain/line-oa-account'
import { runLineGroundingShadowCompare } from '@/modules/agent/line-grounding-shadow-compare'
import { createDeterministicBusinessModel } from '@/modules/agent/grounded-business-answer'

let business, owner, member, account

describe('FR-277 — LineOaAccount knowledgeGroundingShadow publisher control', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-KGSHADOW', name: 'Knowledge grounding shadow' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KGSHADOW', name: 'Knowledge grounding shadow' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-KGSHADOW', name: 'Knowledge grounding shadow' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['line-oa'] })

    const connection = await provisionLineServerConnection(
      { businessId: business.id, name: 'Main', destination: `U${'b'.repeat(32)}`, secretRef: 'deployment-secret:kgshadow' },
      { viewer: owner },
    )
    account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: 'oa-kgshadow-main', displayName: 'Main' }, { viewer: owner })
  })

  it('defaults a new account to knowledgeGroundingShadow: false — no behaviour changes until an operator turns it on', () => {
    expect(account.knowledgeGroundingShadow).toBe(false)
  })

  it('the zod schema requires a boolean for this action', () => {
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version, knowledgeGroundingShadow: true })).not.toThrow()
  })

  it('a non-owner cannot switch it; the row is unchanged', async () => {
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version, knowledgeGroundingShadow: true }, { viewer: member }))
      .rejects.toMatchObject({ status: 404 })
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).knowledgeGroundingShadow).toBe(false)
  })

  it('an owner turns it on; the write is versioned and audited with no secret and no customer content', async () => {
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version, knowledgeGroundingShadow: true }, { viewer: owner })
    expect(account.knowledgeGroundingShadow).toBe(true)

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: account.id, action: 'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_SHADOW_CONFIGURED' }, orderBy: { occurredAt: 'desc' } })
    expect(audit).toBeTruthy()
    const payload = JSON.parse(audit.payloadJson ?? audit.payload ?? '{}')
    expect(payload.from.knowledgeGroundingShadow).toBe(false)
    expect(payload.to.knowledgeGroundingShadow).toBe(true)
    expect(JSON.stringify(payload)).not.toMatch(/secret|token|password/i)
  })

  // @req FR-277 — a health-only write, like CONFIGURE_KNOWLEDGE_GROUNDING itself.
  it('never fences in-flight work: transportEpoch is unchanged', async () => {
    const beforeEpoch = account.transportEpoch
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version, knowledgeGroundingShadow: false }, { viewer: owner })
    expect(account.transportEpoch).toBe(beforeEpoch)
  })

  it('turning it on again is a conflict, not a silent no-op write', async () => {
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version, knowledgeGroundingShadow: true }, { viewer: owner })
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: account.version, knowledgeGroundingShadow: true }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_KNOWLEDGE_GROUNDING_SHADOW_UNCHANGED' })
  })

  it('an archived account may not have shadow-compare switched', async () => {
    const archived = await applyLineOaAccountAction(account.id, { action: 'ARCHIVE', version: account.version }, { viewer: owner })
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: archived.version, knowledgeGroundingShadow: false }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_ARCHIVED' })
  })
})

describe('FR-277 — the harness persists a real comparison row through the shared Prisma client', () => {
  it('writes a LineGroundingShadowComparison row scoped to tenant/business/account/job, never touching the customer answer', async () => {
    const portfolio = await createPortfolio({ code: 'PF-KGSHADOW2', name: 'Knowledge grounding shadow harness' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KGSHADOW2', name: 'Knowledge grounding shadow harness' })
    const scopedBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-KGSHADOW2', name: 'Knowledge grounding shadow harness' })
    const jobId = `job-${randomUUID()}`

    const result = await runLineGroundingShadowCompare({
      job: { id: jobId, accountId: 'acct-real-db-test', account: { id: 'acct-real-db-test', knowledgeGroundingShadow: true } },
      primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE',
      primaryAnswerText: 'ยังไม่พบข้อมูลสินค้า',
      tenantId: tenant.id,
      businessId: scopedBusiness.id,
      question: 'AB-1 ราคาเท่าไร',
      model: createDeterministicBusinessModel(),
      businessKnowledgeReader: { query: async () => ({ records: [] }) },
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.persisted).toBe(true)

    const row = await prisma.lineGroundingShadowComparison.findUnique({ where: { jobId } })
    expect(row).toBeTruthy()
    expect(row.tenantId).toBe(tenant.id)
    expect(row.businessId).toBe(scopedBusiness.id)
    expect(row.accountId).toBe('acct-real-db-test')
    expect(row.primaryMode).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')
    expect(row.shadowMode).toBe('BUSINESS_KNOWLEDGE')
    expect(row.shadowEvidenceSource).toBe('NONE')
    expect(row.shadowEvidenceReason).toBe('NO_EVIDENCE')
  })
})
