// @req FR-277 — the publisher/operator control for LineOaAccount.knowledgeGroundingShadow,
//   and the durable comparison row produced by the harness itself.
// @spec ADR-090 D1-D3 (Phase 3), ADR-060 D5, D11 (versioned, audited configuration writes)
// @tested tests/integration/fr277-line-grounding-shadow-compare.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { zLineOaAccountAction } from '@/modules/line-oa-studio/domain/line-oa-account'
import { runLineGroundingShadowCompare } from '@/modules/agent/line-grounding-shadow-compare'
import { createDeterministicBusinessModel } from '@/modules/agent/grounded-business-answer'
import { createLineGroundingReader } from '@/modules/agent/line-knowledge-grounding'

const { createCorpusKnowledgeReaderMock } = vi.hoisted(() => ({ createCorpusKnowledgeReaderMock: vi.fn() }))
vi.mock('@/modules/knowledge', () => ({
  createCorpusKnowledgeReader: (...args) => createCorpusKnowledgeReaderMock(...args),
}))

let business, owner, member, account

beforeEach(() => {
  createCorpusKnowledgeReaderMock.mockReset()
})

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

  it('persists GKS corpus evidence and its retrieval references for the paired shadow mode', async () => {
    const portfolio = await createPortfolio({ code: 'PF-KGSHADOW-CORPUS', name: 'Grounding shadow corpus evidence' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KGSHADOW-CORPUS', name: 'Grounding shadow corpus evidence' })
    const scopedBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-KGSHADOW-CORPUS', name: 'Grounding shadow corpus evidence' })
    const jobId = `job-${randomUUID()}`
    const retrievalRefs = [{ citationId: 'citation-corpus-1', sourceId: 'source-1', snapshotId: 'snapshot-1', generation: 3 }]
    createCorpusKnowledgeReaderMock.mockReturnValue({
      query: async () => ({
        records: [{ kind: 'CORPUS_CHUNK', text: 'จากเอกสารธุรกิจ', citationId: 'citation-corpus-1' }],
        retrievalRefs,
      }),
    })

    await runLineGroundingShadowCompare({
      job: { id: jobId, accountId: 'acct-shadow-corpus', account: { id: 'acct-shadow-corpus', knowledgeGroundingShadow: true } },
      primaryMode: 'BUSINESS_KNOWLEDGE',
      primaryAnswerText: 'คำตอบหลัก',
      tenantId: tenant.id,
      businessId: scopedBusiness.id,
      question: 'AB-1 ราคาเท่าไร',
      model: createDeterministicBusinessModel(),
      businessKnowledgeReader: { query: async () => ({ records: [] }) },
    })

    const row = await prisma.lineGroundingShadowComparison.findUnique({ where: { jobId } })
    expect(row).toMatchObject({
      primaryMode: 'BUSINESS_KNOWLEDGE',
      shadowMode: 'GKS_THEN_BUSINESS_KNOWLEDGE',
      shadowEvidenceSource: 'GKS_CORPUS',
      shadowEvidenceReason: null,
    })
    expect(JSON.parse(row.shadowRetrievalRefsJson)).toEqual(retrievalRefs)
  })

  it('persists the traced GKS_UNAVAILABLE fallback reason without exposing the reader error', async () => {
    const portfolio = await createPortfolio({ code: 'PF-KGSHADOW-FALLBACK', name: 'Grounding shadow fallback' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KGSHADOW-FALLBACK', name: 'Grounding shadow fallback' })
    const scopedBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-KGSHADOW-FALLBACK', name: 'Grounding shadow fallback' })
    const jobId = `job-${randomUUID()}`
    createCorpusKnowledgeReaderMock.mockReturnValue({
      query: async () => { throw new Error('worker unavailable; credential=must-not-escape') },
    })

    await runLineGroundingShadowCompare({
      job: { id: jobId, accountId: 'acct-shadow-fallback', account: { id: 'acct-shadow-fallback', knowledgeGroundingShadow: true } },
      primaryMode: 'BUSINESS_KNOWLEDGE',
      primaryAnswerText: 'คำตอบหลัก',
      tenantId: tenant.id,
      businessId: scopedBusiness.id,
      question: 'AB-1 ราคาเท่าไร',
      model: createDeterministicBusinessModel(),
      businessKnowledgeReader: { query: async () => ({ records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }] }) },
    })

    const row = await prisma.lineGroundingShadowComparison.findUnique({ where: { jobId } })
    expect(row).toMatchObject({
      primaryMode: 'BUSINESS_KNOWLEDGE',
      shadowMode: 'GKS_THEN_BUSINESS_KNOWLEDGE',
      shadowEvidenceSource: 'BUSINESS_KNOWLEDGE',
      shadowEvidenceReason: 'GKS_UNAVAILABLE',
    })
    expect(row.shadowRetrievalRefsJson).toBeNull()
    expect(JSON.stringify(row)).not.toContain('credential=must-not-escape')
  })

  it('rehearses switch, shadow collection, and rollback through existing actions on isolated data', async () => {
    const portfolio = await createPortfolio({ code: 'PF-KGSHADOW-REHEARSAL', name: 'Grounding isolated rehearsal' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KGSHADOW-REHEARSAL', name: 'Grounding isolated rehearsal' })
    const scopedBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-KGSHADOW-REHEARSAL', name: 'Grounding isolated rehearsal' })
    const scopedOwner = makeViewer({ visibleBusinessIds: [scopedBusiness.id], ownedBusinessIds: [scopedBusiness.id], visibleDomains: ['line-oa'] })
    const connection = await provisionLineServerConnection(
      { businessId: scopedBusiness.id, name: 'Rehearsal', destination: `U${'c'.repeat(32)}`, secretRef: 'deployment-secret:kgshadow-rehearsal' },
      { viewer: scopedOwner },
    )
    let scopedAccount = await connectLineOaAccount(
      { businessId: scopedBusiness.id, integrationConnectionId: connection.id, code: 'oa-kgshadow-rehearsal', displayName: 'Rehearsal' },
      { viewer: scopedOwner },
    )
    scopedAccount = await applyLineOaAccountAction(scopedAccount.id, {
      action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: scopedAccount.version,
      knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE',
    }, { viewer: scopedOwner })
    scopedAccount = await applyLineOaAccountAction(scopedAccount.id, {
      action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: scopedAccount.version,
      knowledgeGroundingShadow: true,
    }, { viewer: scopedOwner })

    const jobId = `job-${randomUUID()}`
    const comparison = await runLineGroundingShadowCompare({
      job: { id: jobId, accountId: scopedAccount.id, account: scopedAccount },
      primaryMode: scopedAccount.knowledgeGrounding,
      primaryAnswerText: 'คำตอบหลักจาก pilot mode',
      tenantId: scopedBusiness.tenantId,
      businessId: scopedBusiness.id,
      question: 'AB-1 ราคาเท่าไร',
      model: createDeterministicBusinessModel(),
      businessKnowledgeReader: { query: async () => ({ records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }] }) },
    })

    expect(comparison).toMatchObject({ status: 'COMPLETED', shadowMode: 'BUSINESS_KNOWLEDGE', persisted: true })
    const comparedRow = await prisma.lineGroundingShadowComparison.findUnique({ where: { jobId } })
    expect(comparedRow).toMatchObject({
      primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE',
      shadowMode: 'BUSINESS_KNOWLEDGE',
      shadowEvidenceSource: 'BUSINESS_KNOWLEDGE',
    })

    scopedAccount = await applyLineOaAccountAction(scopedAccount.id, {
      action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: scopedAccount.version,
      knowledgeGrounding: 'BUSINESS_KNOWLEDGE',
    }, { viewer: scopedOwner })
    scopedAccount = await applyLineOaAccountAction(scopedAccount.id, {
      action: 'CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW', version: scopedAccount.version,
      knowledgeGroundingShadow: false,
    }, { viewer: scopedOwner })

    expect(scopedAccount.knowledgeGrounding).toBe('BUSINESS_KNOWLEDGE')
    expect(scopedAccount.knowledgeGroundingShadow).toBe(false)
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: scopedAccount.id, action: { in: [
        'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED',
        'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_SHADOW_CONFIGURED',
      ] } },
      orderBy: { occurredAt: 'asc' },
    })
    const payloads = audits.map((event) => JSON.parse(event.payloadJson ?? event.payload ?? '{}'))
    expect(payloads.filter((payload) => payload.to?.knowledgeGrounding).map((payload) => [payload.from?.knowledgeGrounding, payload.to.knowledgeGrounding])).toEqual([
      ['BUSINESS_KNOWLEDGE', 'GKS_THEN_BUSINESS_KNOWLEDGE'],
      ['GKS_THEN_BUSINESS_KNOWLEDGE', 'BUSINESS_KNOWLEDGE'],
    ])
    expect(payloads.filter((payload) => typeof payload.to?.knowledgeGroundingShadow === 'boolean').map((payload) => payload.to.knowledgeGroundingShadow)).toEqual([true, false])
  })
})

describe('FR-235/FR-277 — the pilot mode selects corpus evidence and traces fallback on isolated data', () => {
  it('records GKS corpus evidence and a traced BUSINESS_KNOWLEDGE fallback when the corpus is empty', async () => {
    const corpusRefs = [{ citationId: 'citation-primary-1', sourceId: 'source-primary-1', snapshotId: 'snapshot-primary-1', generation: 4 }]
    const corpusHops = []
    const corpusReader = createLineGroundingReader({
      mode: 'GKS_THEN_BUSINESS_KNOWLEDGE',
      corpusReader: { query: async () => ({ records: [{ kind: 'CORPUS_CHUNK', text: 'เอกสารธุรกิจ', citationId: 'citation-primary-1' }], retrievalRefs: corpusRefs }) },
      businessKnowledgeReader: { query: async () => ({ records: [] }) },
      trace: { recordEvidence: async (_input, _evidence, metadata) => corpusHops.push(metadata) },
    })
    const corpusEvidence = await corpusReader.query({ tenantId: 'tenant-1', businessId: 'business-1', queryId: 'product_detail' })

    expect(corpusEvidence.records[0].citationId).toBe('citation-primary-1')
    expect(corpusHops).toHaveLength(1)
    expect(corpusHops[0]).toMatchObject({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', source: 'GKS_CORPUS', reason: null, retrievalRefs: corpusRefs })

    const fallbackHops = []
    const fallbackReader = createLineGroundingReader({
      mode: 'GKS_THEN_BUSINESS_KNOWLEDGE',
      corpusReader: { query: async () => ({ records: [] }) },
      businessKnowledgeReader: { query: async () => ({ records: [{ product_code: 'AB-1' }] }) },
      trace: { recordEvidence: async (_input, _evidence, metadata) => fallbackHops.push(metadata) },
    })
    const fallbackEvidence = await fallbackReader.query({ tenantId: 'tenant-1', businessId: 'business-1', queryId: 'product_detail' })

    expect(fallbackEvidence.records).toEqual([{ product_code: 'AB-1' }])
    expect(fallbackHops.map(({ source, reason }) => ({ source, reason }))).toEqual([
      { source: 'GKS_CORPUS', reason: 'NO_EVIDENCE' },
      { source: 'BUSINESS_KNOWLEDGE', reason: 'NO_EVIDENCE' },
    ])
  })
})
