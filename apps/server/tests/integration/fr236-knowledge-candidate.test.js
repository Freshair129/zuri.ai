// @req FR-236 — ADR-090 proof 7: Thai PII fixtures are refused at creation and
//   at decision; no candidate is admitted without an OWNER or LINE_OA_PUBLISHER
//   decision; approval and rejection are audited. Plus: consent gating (fail
//   closed on anything other than GRANTED), role gating (OWNER, LINE_OA_
//   PUBLISHER, others refused), idempotent draft/approve, one immutable
//   LINE_FAQ_CANDIDATE source per approval through the existing ADR-072
//   admission service, and Business scoping.
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
import {
  decideKnowledgeCandidate,
  draftKnowledgeCandidate,
  getKnowledgeCandidate,
  listKnowledgeCandidates,
  updateKnowledgeCandidate,
} from '@/modules/knowledge/application/knowledge-candidate-service'

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

  it('list/get are scoped to the Business and refuse an outsider', async () => {
    const draft = await draftKnowledgeCandidate({ businessId: business.id, conversationId, messageIds: [messageId], idempotencyKey: 'list-get-test', ...CLEAN }, { viewer: owner })
    const rows = await listKnowledgeCandidates({ businessId: business.id }, { viewer: owner })
    expect(rows.some((row) => row.id === draft.id)).toBe(true)
    await expect(listKnowledgeCandidates({ businessId: business.id }, { viewer: outsiderOwner })).rejects.toMatchObject({ status: 404 })
    await expect(getKnowledgeCandidate(draft.id, { viewer: outsiderOwner })).rejects.toMatchObject({ status: 404 })
    expect((await getKnowledgeCandidate(draft.id, { viewer: owner })).id).toBe(draft.id)
  })
})
