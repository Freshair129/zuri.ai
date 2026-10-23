// @req FR-236 — ADR-090 proof 7: Thai PII fixtures are refused at creation and
//   at decision; no candidate is admitted without an OWNER or LINE_OA_PUBLISHER
//   decision; approval and rejection are audited. Plus: consent gating (fail
//   closed on anything other than GRANTED), role gating (OWNER, LINE_OA_
//   PUBLISHER, others refused), idempotent draft/approve, one immutable
//   LINE_FAQ_CANDIDATE source per approval through the existing ADR-072
//   admission service, and Business scoping.
// @req FR-232 — erasure tombstones source-bound candidates and withdraws admitted
//   Knowledge source membership in the same local transaction.
// @spec ADR-090 D6; ADR-072; SEC-032; BR-002; SEC-001
// @tested tests/integration/fr236-knowledge-candidate.test.js
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { recordCustomerConsent } from '@/modules/crm/customer-consent-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import {
  decideKnowledgeCandidate,
  draftKnowledgeCandidate,
  getKnowledgeCandidate,
  listKnowledgeCandidates,
  updateKnowledgeCandidate,
} from '@/modules/knowledge/application/knowledge-candidate-service'
import { admitKnowledge } from '@/modules/knowledge/knowledge-admission-service'

const CRM_KNOWLEDGE = ['customer', 'knowledge']
const saved = {}

let portfolio, tenant, business, otherBusiness
let owner, publisher, memberNoRole, outsiderOwner
let conversationId, messageId

async function person(code) {
  return prisma.person.create({ data: { id: randomUUID(), code: `PER-KC-${code}-${randomUUID().slice(0, 6)}`, displayName: `Person ${code}` } })
}
async function viewerFor(personRow, over) {
  return makeViewer({ ...over, principal: { id: personRow.id, code: personRow.code, displayName: personRow.displayName } })
}

async function draftAConversation({ suffix, consentStatus = 'GRANTED' }) {
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `Ukc${suffix}`, displayName: `ลูกค้า ${suffix}`,
    threadId: `TH-KC-${suffix}`, text: 'สอบถามค่าจัดส่ง', externalMessageId: `MSG-KC-${suffix}`,
  })
  await prisma.customer.update({ where: { id: result.customerId }, data: { consentStatus } })
  return result
}

const CLEAN = { question: 'ค่าจัดส่งไปต่างจังหวัดเท่าไหร่', answer: 'ค่าจัดส่งมาตรฐานคือ 50 บาท (Product.code: SHIP-STD)' }
const DIRTY = { question: 'ติดต่อยังไง', answer: 'โทร 081-234-5678 หาคุณสมชาย ใจดี ได้เลย' }

describe('FR-236 KnowledgeCandidate (ADR-090 D6)', () => {
  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `KC portfolio ${suffix}`, code: `KC-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `KC tenant ${suffix}`, code: `KC-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `KC business ${suffix}`, code: `KC-BU-${suffix}` })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: `KC other ${suffix}`, code: `KC-BU2-${suffix}` })
    // @req FR-236 — candidates are off by default per Business (TASK-ZAI-099);
    // this suite predates that gate and exercises every OTHER refusal/success
    // path on an already-enabled Business, so it turns the flag on directly
    // here rather than through the audited service (that service has its own
    // suite: tests/integration/fr236-knowledge-candidates-business-toggle.test.js).
    business = await prisma.business.update({ where: { id: business.id }, data: { knowledgeCandidatesEnabled: true } })

    const scope = {
      portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id,
      workspaceId: 'workspace-kc', agentId: 'agent-kc', visibility: 'private',
    }
    process.env.ZURI_KNOWLEDGE_ENABLED = '1'
    process.env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    // admitKnowledge's runtime resolver validates a credential/transport are
    // configured even though this test never runs the Stage 1-17 worker
    // (admission only queues the immutable source row) — mirrored from
    // tests/integration/smartgift-catalog-admission.test.js.
    process.env.MSP_PIPELINE_PRINCIPALS = JSON.stringify([{ role: 'source', credential: 'test-credential', scope }])
    process.env.ZURI_MSP_COMMAND = process.execPath

    const ownerPerson = await person('OWNER')
    const publisherPerson = await person('PUBLISHER')
    const memberPerson = await person('MEMBER')
    const outsiderPerson = await person('OUTSIDER')
    await prisma.membership.create({ data: { personId: ownerPerson.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } })
    await prisma.membership.create({ data: { personId: publisherPerson.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(CRM_KNOWLEDGE) } })
    await prisma.membership.create({ data: { personId: memberPerson.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(CRM_KNOWLEDGE) } })
    await prisma.membership.create({ data: { personId: outsiderPerson.id, tenantId: tenant.id, businessId: otherBusiness.id, role: 'OWNER', status: 'ACTIVE' } })

    owner = await viewerFor(ownerPerson, { visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] })
    publisher = await viewerFor(publisherPerson, { visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: CRM_KNOWLEDGE, rolesByBusinessId: { [business.id]: [ROLE_LINE_OA_PUBLISHER] } })
    memberNoRole = await viewerFor(memberPerson, { visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: CRM_KNOWLEDGE })
    outsiderOwner = await viewerFor(outsiderPerson, { visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: [...VIEWER_DOMAINS] })

    const drafted = await draftAConversation({ suffix: '1' })
    conversationId = drafted.conversationId
    messageId = drafted.messageId
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await prisma.$disconnect()
  })

  it('refuses a draft from a MEMBER with neither OWNER nor LINE_OA_PUBLISHER authority', async () => {
    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], ...CLEAN }, { viewer: memberNoRole }))
      .rejects.toMatchObject({ status: 403, code: 'KNOWLEDGE_CANDIDATE_FORBIDDEN' })
  })

  it('refuses a draft naming a Business the viewer does not own (Business scoping)', async () => {
    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], ...CLEAN }, { viewer: outsiderOwner }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('refuses Zero-PII at creation — a Thai phone number and a Thai name', async () => {
    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], ...DIRTY }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' })
  })

  it('fails closed on a conversation whose consent is not GRANTED', async () => {
    const declined = await draftAConversation({ suffix: 'declined', consentStatus: 'DECLINED' })
    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId: declined.conversationId, messageIds: [declined.messageId], ...CLEAN }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_CONSENT_NOT_GRANTED' })

    const pending = await draftAConversation({ suffix: 'pending', consentStatus: 'PENDING' })
    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId: pending.conversationId, messageIds: [pending.messageId], ...CLEAN }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_CONSENT_NOT_GRANTED' })
  })

  it('fails closed on an unknown conversation', async () => {
    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId: randomUUID(), messageIds: [], ...CLEAN }, { viewer: owner }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('fails closed at decision time when consent is withdrawn after the draft', async () => {
    const drawn = await draftAConversation({ suffix: 'withdrawn-later' })
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId: drawn.conversationId, messageIds: [drawn.messageId], idempotencyKey: 'withdrawn-later-test', ...CLEAN }, { viewer: owner })
    await prisma.customer.update({ where: { id: drawn.customerId }, data: { consentStatus: 'DECLINED' } })
    await expect(decideKnowledgeCandidate(draft.id, { decision: 'APPROVE', version: draft.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_CONSENT_NOT_GRANTED' })
    expect(await prisma.knowledgeSource.count({ where: { sourceKey: `knowledge-candidate:${draft.id}` } })).toBe(0)
  })

  it('fails closed at decision time when sourceRef names no readable conversation (missing/malformed, never a bypass)', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: 'malformed-source-ref-test', ...CLEAN }, { viewer: owner })
    // Simulate a row whose sourceRef never named a conversation (or was
    // corrupted) — this must refuse exactly like a withdrawn one, never admit.
    await prisma.knowledgeCandidate.update({ where: { id: draft.id }, data: { sourceRefJson: '{}' } })
    await expect(decideKnowledgeCandidate(draft.id, { decision: 'APPROVE', version: draft.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_CONSENT_NOT_GRANTED' })
    expect(await prisma.knowledgeSource.count({ where: { sourceKey: `knowledge-candidate:${draft.id}` } })).toBe(0)
  })

  it('drafts, is idempotent on a redelivered extraction, and conflicts on a changed payload for the same key', async () => {
    const key = `extract-${randomUUID().slice(0, 8)}`
    const first = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: key, ...CLEAN }, { viewer: owner })
    expect(first).toMatchObject({ status: 'PENDING_REVIEW', businessId: business.id, conversationId, version: 1 })
    expect(first.sourceRef).toMatchObject({ conversationId, messageIds: [messageId] })

    const replay = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: key, ...CLEAN }, { viewer: owner })
    expect(replay.id).toBe(first.id) // redelivered extraction did not duplicate

    await expect(draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: key, question: 'คำถามอื่น', answer: 'คำตอบอื่น' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_IDEMPOTENCY_CONFLICT' })

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'KNOWLEDGE_CANDIDATE', entityId: first.id } })
    expect(audits.map((a) => a.action)).toEqual(['KNOWLEDGE_CANDIDATE_DRAFTED'])
  })

  it('a LINE_OA_PUBLISHER may edit a draft; Zero-PII re-runs and refuses a dirty edit', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: 'edit-test', ...CLEAN }, { viewer: publisher })
    await expect(updateKnowledgeCandidate(draft.id, { answer: DIRTY.answer, version: draft.version }, { viewer: publisher }))
      .rejects.toMatchObject({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' })

    const edited = await updateKnowledgeCandidate(draft.id, { answer: 'ค่าจัดส่งคือ 60 บาท (Product.code: SHIP-STD)', version: draft.version }, { viewer: publisher })
    expect(edited.answer).toBe('ค่าจัดส่งคือ 60 บาท (Product.code: SHIP-STD)')
    expect(edited.version).toBe(draft.version + 1)

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'KNOWLEDGE_CANDIDATE', entityId: draft.id, action: 'KNOWLEDGE_CANDIDATE_EDITED' } })
    expect(audits).toHaveLength(1)
  })

  it('REJECT is audited and never admits a source', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: 'reject-test', ...CLEAN }, { viewer: owner })
    const rejected = await decideKnowledgeCandidate(draft.id, { decision: 'REJECT', version: draft.version, reason: 'ไม่เกี่ยวกับสินค้า' }, { viewer: owner })
    expect(rejected).toMatchObject({ status: 'REJECTED', decisionReason: 'ไม่เกี่ยวกับสินค้า', admittedSourceId: null, admittedIngestionId: null })
    expect(rejected.decidedByPersonId).toBeTruthy()

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'KNOWLEDGE_CANDIDATE', entityId: draft.id, action: 'KNOWLEDGE_CANDIDATE_REJECTED' } })
    expect(audits).toHaveLength(1)
    expect(await prisma.knowledgeSource.count({ where: { sourceKey: `knowledge-candidate:${draft.id}` } })).toBe(0)

    await expect(decideKnowledgeCandidate(draft.id, { decision: 'APPROVE', version: rejected.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_NOT_PENDING' })
  })

  it('ADR-090 proof 7 — APPROVE by a LINE_OA_PUBLISHER admits one immutable LINE_FAQ_CANDIDATE source through the existing ADR-072 service, audited; a second APPROVE does not admit a second source', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: 'approve-test', ...CLEAN }, { viewer: publisher })
    const approved = await decideKnowledgeCandidate(draft.id, { decision: 'APPROVE', version: draft.version }, { viewer: publisher })
    expect(approved.status).toBe('APPROVED')
    expect(approved.admittedSourceId).toBeTruthy()
    expect(approved.admittedIngestionId).toBeTruthy()
    expect(approved.decidedByPersonId).toBeTruthy()

    const source = await prisma.knowledgeSource.findUnique({ where: { id: approved.admittedSourceId } })
    expect(source).toMatchObject({ kind: 'LINE_FAQ_CANDIDATE', sourceKey: `knowledge-candidate:${draft.id}` })
    const ingestion = await prisma.knowledgeIngestion.findUnique({ where: { id: approved.admittedIngestionId } })
    expect(ingestion.sourceId).toBe(source.id)
    expect(JSON.parse(ingestion.content)).toMatchObject(CLEAN)
    const meta = JSON.parse(ingestion.sourceMetaJson)
    expect(meta.structured).toMatchObject({ provider: 'LINE_FAQ_CANDIDATE' })

    // Never a Tier 1 call to gks_knowledge_promote and never a second write path:
    // the only sources this test created came from admitKnowledge, and there is
    // exactly one, keyed by this candidate's id.
    expect(await prisma.knowledgeSource.count({ where: { sourceKey: `knowledge-candidate:${draft.id}` } })).toBe(1)

    // Idempotency: approving twice must not admit two sources.
    await expect(decideKnowledgeCandidate(draft.id, { decision: 'APPROVE', version: approved.version }, { viewer: publisher }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_NOT_PENDING' })
    expect(await prisma.knowledgeSource.count({ where: { sourceKey: `knowledge-candidate:${draft.id}` } })).toBe(1)

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'KNOWLEDGE_CANDIDATE', entityId: draft.id, action: 'KNOWLEDGE_CANDIDATE_APPROVED' } })
    expect(audits).toHaveLength(1)
  })

  it('rolls back the candidate approval reservation when source admission fails', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: `admission-rollback-${randomUUID()}`, ...CLEAN }, { viewer: owner })
    const seed = await admitKnowledge({
      businessId: business.id,
      idempotencyKey: `admission-rollback-seed-${randomUUID()}`,
      source: { kind: 'TEXT', sourceKey: `admission-rollback-seed-${randomUUID()}`, version: '1', title: 'Admission rollback seed', content: 'Seed source' },
    }, { viewer: owner })
    const candidateSourceKey = `knowledge-candidate:${draft.id}`
    const conflictingSource = await prisma.knowledgeSource.create({ data: {
      corpusId: seed.corpus.id,
      sourceKey: candidateSourceKey,
      kind: 'TEXT',
      title: 'Conflicting source key',
    } })

    await expect(decideKnowledgeCandidate(draft.id, { decision: 'APPROVE', version: draft.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_SOURCE_CONFLICT' })

    const unchanged = await prisma.knowledgeCandidate.findUnique({ where: { id: draft.id } })
    expect(unchanged).toMatchObject({ status: 'PENDING_REVIEW', version: draft.version, admittedSourceId: null, admittedIngestionId: null })
    expect(await prisma.knowledgeSource.findUnique({ where: { id: conflictingSource.id } })).toMatchObject({ kind: 'TEXT', sourceKey: candidateSourceKey })
    expect(await prisma.knowledgeIngestion.count({ where: { sourceId: conflictingSource.id } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { entityType: 'KNOWLEDGE_CANDIDATE', entityId: draft.id, action: 'KNOWLEDGE_CANDIDATE_APPROVED' } })).toBe(0)
  })

  it('FR-232 principal erasure tombstones source-bound candidates and withdraws an admitted source', async () => {
    const erased = await draftAConversation({ suffix: `erase-${randomUUID().slice(0, 8)}` })
    const unrelated = await draftAConversation({ suffix: `keep-${randomUUID().slice(0, 8)}` })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: erased.conversationId, messageIds: [erased.messageId],
      idempotencyKey: `erase-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })
    const admitted = await decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, { viewer: owner })
    const unrelatedCandidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: unrelated.conversationId, messageIds: [unrelated.messageId],
      idempotencyKey: `keep-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })
    const sourceBefore = await prisma.knowledgeSource.findUnique({ where: { id: admitted.admittedSourceId } })
    const corpusBefore = await prisma.knowledgeCorpus.findUnique({ where: { id: sourceBefore.corpusId } })

    const erasedCounts = await erasePrincipal({ tenantId: tenant.id, personId: erased.personId, reason: 'TEST_ERASURE' })

    const tombstoned = await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })
    const sourceAfter = await prisma.knowledgeSource.findUnique({ where: { id: admitted.admittedSourceId } })
    const ingestionAfter = await prisma.knowledgeIngestion.findUnique({ where: { id: admitted.admittedIngestionId } })
    const corpusAfter = await prisma.knowledgeCorpus.findUnique({ where: { id: corpusBefore.id } })
    const correctedGeneration = await prisma.knowledgeCorpusGeneration.findUnique({
      where: { corpusId_number: { corpusId: corpusBefore.id, number: corpusBefore.generation + 1 } },
    })

    expect(tombstoned).toMatchObject({ status: 'TOMBSTONED', tombstonedAt: expect.any(Date) })
    expect(erasedCounts).toMatchObject({ tombstonedKnowledgeCandidates: 1, withdrawnKnowledgeSources: 1 })
    expect(sourceAfter.revokedAt).toEqual(expect.any(Date))
    expect(ingestionAfter.status).toBe('WITHDRAWN')
    expect(corpusAfter.generation).toBe(corpusBefore.generation + 1)
    expect(JSON.parse(correctedGeneration.manifestJson).entries.some((entry) => entry.sourceId === sourceAfter.id)).toBe(false)
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: unrelatedCandidate.id } })).status).toBe('PENDING_REVIEW')
    await expect(decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: tombstoned.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_NOT_PENDING' })

    const repeated = await erasePrincipal({ tenantId: tenant.id, personId: erased.personId, reason: 'TEST_ERASURE' })
    expect(repeated.tombstonedKnowledgeCandidates).toBe(0)
    expect((await prisma.knowledgeCorpus.findUnique({ where: { id: corpusBefore.id } })).generation).toBe(corpusAfter.generation)
  })

  it('FR-232 consent DECLINED tombstones only that Customer source and leaves the principal record live', async () => {
    const declined = await draftAConversation({ suffix: `decline-${randomUUID().slice(0, 8)}` })
    const unrelated = await draftAConversation({ suffix: `other-${randomUUID().slice(0, 8)}` })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: declined.conversationId, messageIds: [declined.messageId],
      idempotencyKey: `decline-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })
    const admitted = await decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, { viewer: owner })
    const unrelatedCandidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: unrelated.conversationId, messageIds: [unrelated.messageId],
      idempotencyKey: `unrelated-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })

    await recordCustomerConsent(declined.customerId, { businessId: business.id, status: 'DECLINED' }, { viewer: owner })

    const tombstoned = await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })
    const sourceAfter = await prisma.knowledgeSource.findUnique({ where: { id: admitted.admittedSourceId } })
    expect(tombstoned).toMatchObject({ status: 'TOMBSTONED', tombstonedAt: expect.any(Date) })
    expect(sourceAfter.revokedAt).toEqual(expect.any(Date))
    expect((await prisma.knowledgeIngestion.findUnique({ where: { id: admitted.admittedIngestionId } })).status).toBe('WITHDRAWN')
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: unrelatedCandidate.id } })).status).toBe('PENDING_REVIEW')
    expect((await prisma.customer.findUnique({ where: { id: declined.customerId } })).deletedAt).toBeNull()
    expect((await prisma.person.findUnique({ where: { id: declined.personId } })).displayName).not.toBe('[erased]')
  })

  it('FR-232 commits approval, source and ingestion together before a caller interruption', async () => {
    const interrupted = await draftAConversation({ suffix: `recover-${randomUUID().slice(0, 8)}` })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: interrupted.conversationId, messageIds: [interrupted.messageId],
      idempotencyKey: `recover-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })

    await expect(decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, {
      viewer: owner,
      admit: async (input, context) => {
        await admitKnowledge(input, context)
        throw new Error('simulated interruption after durable admission')
      },
    })).rejects.toThrow('simulated interruption after durable admission')

    const source = await prisma.knowledgeSource.findFirst({ where: { sourceKey: `knowledge-candidate:${candidate.id}` } })
    expect(source).toBeTruthy()
    expect(await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })).toMatchObject({
      status: 'APPROVED',
      admittedSourceId: source.id,
      admittedIngestionId: expect.any(String),
    })

    await erasePrincipal({ tenantId: tenant.id, personId: interrupted.personId, reason: 'TEST_ERASURE' })

    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })).status).toBe('TOMBSTONED')
    expect((await prisma.knowledgeSource.findUnique({ where: { id: source.id } })).revokedAt).toEqual(expect.any(Date))
    const admittedIngestion = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: source.id } })
    expect(admittedIngestion.status).toBe('WITHDRAWN')
  })

  it('FR-232 fences a late candidate admission after erasure even when the approval caller disappears', async () => {
    const erased = await draftAConversation({ suffix: `late-admission-${randomUUID().slice(0, 8)}` })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: erased.conversationId, messageIds: [erased.messageId],
      idempotencyKey: `late-admission-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })

    await expect(decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, {
      viewer: owner,
      admit: async (input, context) => {
        // Reproduce the durable erasure winning while the candidate source is
        // still absent, then let the already-dispatched admission arrive. The
        // thrown interruption models process loss before any caller-side
        // compensation or second erasure can run.
        await erasePrincipal({ tenantId: tenant.id, personId: erased.personId, reason: 'TEST_ERASURE' })
        expect(await prisma.knowledgeSource.findFirst({ where: { sourceKey: `knowledge-candidate:${candidate.id}` } })).toBeNull()
        const admission = await admitKnowledge(input, context)
        throw Object.assign(new Error('simulated approval caller loss after admission'), { admission })
      },
    })).rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_ADMISSION_CONFLICT' })

    const tombstoned = await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })
    const lateSource = await prisma.knowledgeSource.findFirst({ where: { sourceKey: `knowledge-candidate:${candidate.id}` } })
    expect(tombstoned.status).toBe('TOMBSTONED')
    expect(lateSource).toBeNull()
    const corpus = await prisma.knowledgeCorpus.findFirst({ where: { businessId: business.id, projectId: null, deletedAt: null } })
    if (corpus) {
      const current = await prisma.knowledgeCorpusGeneration.findUnique({
        where: { corpusId_number: { corpusId: corpus.id, number: corpus.generation } },
      })
      expect(JSON.parse(current.manifestJson).entries.some((entry) => entry.sourceKey === `knowledge-candidate:${candidate.id}`)).toBe(false)
    }
  })

  it('FR-232 leaves consent unchanged when an admitted-source link is out of scope, then succeeds on retry', async () => {
    const declined = await draftAConversation({ suffix: `retry-${randomUUID().slice(0, 8)}` })
    const unrelated = await draftAConversation({ suffix: `retry-other-${randomUUID().slice(0, 8)}` })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: declined.conversationId, messageIds: [declined.messageId],
      idempotencyKey: `retry-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })
    const approved = await decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, { viewer: owner })
    const otherCandidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: unrelated.conversationId, messageIds: [unrelated.messageId],
      idempotencyKey: `retry-other-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })
    const otherApproved = await decideKnowledgeCandidate(otherCandidate.id, { decision: 'APPROVE', version: otherCandidate.version }, { viewer: owner })

    await prisma.knowledgeCandidate.update({ where: { id: candidate.id }, data: { admittedSourceId: otherApproved.admittedSourceId } })
    await expect(recordCustomerConsent(declined.customerId, { businessId: business.id, status: 'DECLINED' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH' })

    expect((await prisma.customer.findUnique({ where: { id: declined.customerId } })).consentStatus).toBe('GRANTED')
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })).status).toBe('APPROVED')
    expect((await prisma.knowledgeSource.findUnique({ where: { id: approved.admittedSourceId } })).revokedAt).toBeNull()

    await prisma.knowledgeCandidate.update({ where: { id: candidate.id }, data: { admittedSourceId: approved.admittedSourceId } })
    await recordCustomerConsent(declined.customerId, { businessId: business.id, status: 'DECLINED' }, { viewer: owner })

    expect((await prisma.customer.findUnique({ where: { id: declined.customerId } })).consentStatus).toBe('DECLINED')
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })).status).toBe('TOMBSTONED')
    expect((await prisma.knowledgeSource.findUnique({ where: { id: approved.admittedSourceId } })).revokedAt).toEqual(expect.any(Date))
  })

  it('FR-232 erases only a shared-thread candidate whose complete source lineage includes the erased speaker', async () => {
    const suffix = randomUUID().slice(0, 8)
    const threadId = `TH-KC-SHARED-${suffix}`
    const first = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: `UkcA${suffix}`, displayName: `Customer A ${suffix}`,
      threadId, text: 'first speaker line', externalMessageId: `MSG-KC-A-${suffix}`,
    })
    const erasedSpeaker = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: `UkcB${suffix}`, displayName: `Customer B ${suffix}`,
      threadId, text: 'second speaker line', externalMessageId: `MSG-KC-B-${suffix}`,
    })
    expect(erasedSpeaker.conversationId).toBe(first.conversationId)
    await prisma.customer.updateMany({
      where: { id: { in: [first.customerId, erasedSpeaker.customerId] } },
      data: { consentStatus: 'GRANTED' },
    })

    const retained = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: first.conversationId, messageIds: [first.messageId],
      idempotencyKey: `shared-a-${suffix}`, ...CLEAN,
    }, { viewer: owner })
    const erased = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: first.conversationId, messageIds: [erasedSpeaker.messageId],
      idempotencyKey: `shared-b-${suffix}`, ...CLEAN,
    }, { viewer: owner })
    const retainedApproval = await decideKnowledgeCandidate(retained.id, { decision: 'APPROVE', version: retained.version }, { viewer: owner })
    const erasedApproval = await decideKnowledgeCandidate(erased.id, { decision: 'APPROVE', version: erased.version }, { viewer: owner })

    await erasePrincipal({ tenantId: tenant.id, personId: erasedSpeaker.personId, reason: 'TEST_ERASURE' })

    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: erased.id } })).status).toBe('TOMBSTONED')
    expect((await prisma.knowledgeSource.findUnique({ where: { id: erasedApproval.admittedSourceId } })).revokedAt).toEqual(expect.any(Date))
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: retained.id } })).status).toBe('APPROVED')
    expect((await prisma.knowledgeSource.findUnique({ where: { id: retainedApproval.admittedSourceId } })).revokedAt).toBeNull()
  })

  it('FR-232 consent decline by a shared-thread owner withdraws only that speaker source', async () => {
    const suffix = randomUUID().slice(0, 8)
    const threadId = `TH-KC-CONSENT-OWNER-${suffix}`
    const firstSpeaker = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: `UkcConsentOwner${suffix}`,
      displayName: `Customer owner ${suffix}`, threadId, text: 'first speaker consent source',
      externalMessageId: `MSG-KC-CONSENT-OWNER-${suffix}`,
    })
    const secondSpeaker = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: `UkcConsentOther${suffix}`,
      displayName: `Customer other ${suffix}`, threadId, text: 'second speaker retained source',
      externalMessageId: `MSG-KC-CONSENT-OTHER-${suffix}`,
    })
    expect(secondSpeaker.conversationId).toBe(firstSpeaker.conversationId)
    await prisma.customer.updateMany({
      where: { id: { in: [firstSpeaker.customerId, secondSpeaker.customerId] } },
      data: { consentStatus: 'GRANTED' },
    })
    const ownerSource = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: firstSpeaker.conversationId, messageIds: [firstSpeaker.messageId],
      idempotencyKey: `shared-consent-owner-${suffix}`, ...CLEAN,
    }, { viewer: owner })
    const otherSource = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: secondSpeaker.conversationId, messageIds: [secondSpeaker.messageId],
      idempotencyKey: `shared-consent-other-${suffix}`, ...CLEAN,
    }, { viewer: owner })

    await recordCustomerConsent(firstSpeaker.customerId, { businessId: business.id, status: 'DECLINED' }, { viewer: owner })

    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: ownerSource.id } })).status).toBe('TOMBSTONED')
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: otherSource.id } })).status).toBe('PENDING_REVIEW')
  })

  it('FR-232 consent decline by a non-owner speaker withdraws their source in the owner thread', async () => {
    const suffix = randomUUID().slice(0, 8)
    const threadId = `TH-KC-CONSENT-NONOWNER-${suffix}`
    const firstSpeaker = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: `UkcConsentFirst${suffix}`,
      displayName: `Customer first ${suffix}`, threadId, text: 'first speaker retained source',
      externalMessageId: `MSG-KC-CONSENT-FIRST-${suffix}`,
    })
    const secondSpeaker = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: `UkcConsentNonowner${suffix}`,
      displayName: `Customer nonowner ${suffix}`, threadId, text: 'non-owner consent source',
      externalMessageId: `MSG-KC-CONSENT-NONOWNER-${suffix}`,
    })
    expect(secondSpeaker.conversationId).toBe(firstSpeaker.conversationId)
    await prisma.customer.updateMany({
      where: { id: { in: [firstSpeaker.customerId, secondSpeaker.customerId] } },
      data: { consentStatus: 'GRANTED' },
    })
    const ownerSource = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: firstSpeaker.conversationId, messageIds: [firstSpeaker.messageId],
      idempotencyKey: `shared-consent-first-${suffix}`, ...CLEAN,
    }, { viewer: owner })
    const nonownerSource = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: secondSpeaker.conversationId, messageIds: [secondSpeaker.messageId],
      idempotencyKey: `shared-consent-nonowner-${suffix}`, ...CLEAN,
    }, { viewer: owner })

    await recordCustomerConsent(secondSpeaker.customerId, { businessId: business.id, status: 'DECLINED' }, { viewer: owner })

    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: nonownerSource.id } })).status).toBe('TOMBSTONED')
    expect((await prisma.knowledgeCandidate.findUnique({ where: { id: ownerSource.id } })).status).toBe('PENDING_REVIEW')
  })

  it('FR-232 refuses source admission when a concurrent rejection wins before the approval fence', async () => {
    const interrupted = await draftAConversation({ suffix: `reject-race-${randomUUID().slice(0, 8)}` })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: interrupted.conversationId, messageIds: [interrupted.messageId],
      idempotencyKey: `reject-race-${randomUUID()}`, ...CLEAN,
    }, { viewer: owner })

    await expect(decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, {
      viewer: owner,
      admit: async (input, context) => {
        await decideKnowledgeCandidate(candidate.id, {
          decision: 'REJECT', version: candidate.version, reason: 'concurrent review won',
        }, { viewer: owner })
        return admitKnowledge(input, context)
      },
    })).rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_CANDIDATE_ADMISSION_CONFLICT' })

    const rejected = await prisma.knowledgeCandidate.findUnique({ where: { id: candidate.id } })
    const source = await prisma.knowledgeSource.findFirst({ where: { sourceKey: `knowledge-candidate:${candidate.id}` } })
    expect(rejected.status).toBe('REJECTED')
    expect(source).toBeNull()
  })

  it('list/get are scoped to the Business and refuse an outsider', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: 'list-get-test', ...CLEAN }, { viewer: owner })
    const rows = await listKnowledgeCandidates({ businessId: business.id }, { viewer: owner })
    expect(rows.some((row) => row.id === draft.id)).toBe(true)
    await expect(listKnowledgeCandidates({ businessId: business.id }, { viewer: outsiderOwner })).rejects.toMatchObject({ status: 404 })
    await expect(getKnowledgeCandidate(draft.id, { viewer: outsiderOwner })).rejects.toMatchObject({ status: 404 })
    expect((await getKnowledgeCandidate(draft.id, { viewer: owner })).id).toBe(draft.id)
  })
})
