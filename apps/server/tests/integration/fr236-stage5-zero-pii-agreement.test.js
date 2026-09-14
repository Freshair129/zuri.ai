// @req FR-236 — the candidate-decision verdict and the Stage 5 classify
//   verdict must agree, for every fixture, because both now run the exact
//   same candidate prose policy function on the exact same composed text
//   (ADR-090 D6, revised 2026-09-14, owner decision). Plus: an approved
//   candidate containing "ขอใบเสนอราคาได้ไหม" passes Stage 5; one with a Thai
//   name or phone is refused at creation and would be refused at Stage 5; a
//   SmartGift catalog record containing "customer" in a key is still denied
//   by the unchanged FR-187 policy.
// @spec ADR-090 D6 (revised 2026-09-14); ADR-075 D5; FR-187
// @tested tests/integration/fr236-stage5-zero-pii-agreement.test.js
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { GENESIS_RAG17_SCHEMA_VERSION, canonicalGenesisRag17Json } from '@/modules/knowledge/genesisrag17-contract'
import { assertZeroPii } from '@/modules/knowledge/structured-record-policy'
import { composeCandidateContent, findCandidateProseViolation } from '@/modules/knowledge/knowledge-candidate-zero-pii'
import { draftKnowledgeCandidate, decideKnowledgeCandidate } from '@/modules/knowledge/application/knowledge-candidate-service'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { CLEAN, MUST_PASS_ANSWERS, MUST_REFUSE_ANSWERS } from '../fixtures/knowledge-candidate-prose-fixtures'

let portfolio, tenant, business, operator, owner, connection
const saved = {}

const scopeFor = () => ({
  portfolioId: portfolio.id,
  tenantId: tenant.id,
  businessId: business.id,
  workspaceId: 'workspace-kc-stage5',
  agentId: 'agent-kc-stage5',
  visibility: 'private',
})

const transport = (name, request) => Promise.resolve({
  schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
  scope: request.scope,
  batchId: request.batch?.batchId,
  decisionId: null,
  status: 'PENDING',
})

/** Run a LINE_FAQ_CANDIDATE raw entry through Stage 1-8, returning null on success or the thrown error. */
async function stage5Verdict(content) {
  const input = {
    scope: scopeFor(),
    sourceId: `knowledge-candidate:probe-${randomUUID().slice(0, 8)}`,
    documentId: `doc-kc-${randomUUID().slice(0, 8)}`,
    version: randomUUID(),
    content,
    connectionId: connection.id,
    provider: 'LINE_FAQ_CANDIDATE',
    entityType: 'LINE_FAQ_CANDIDATE',
    contentType: 'application/json',
    policy: { allowEmbedding: true, allowPublication: true },
  }
  try {
    await ingestGenesisRag17Raw(input, { db: prisma, viewer: operator, now: () => new Date('2026-09-14T09:00:00.000Z'), transport, credential: 'test-source' })
    return null
  } catch (error) {
    return error
  }
}

describe('FR-236 candidate-decision / Stage-5 Zero-PII agreement (ADR-090 D6, revised 2026-09-14)', () => {
  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `KC5 portfolio ${suffix}`, code: `KC5-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `KC5 tenant ${suffix}`, code: `KC5-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `KC5 business ${suffix}`, code: `KC5-BU-${suffix}` })
    operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] })
    const provider = await prisma.integrationProvider.create({ data: { code: `KC5-${suffix}`, name: 'Knowledge candidate Stage 5 test source', status: 'ACTIVE' } })
    connection = await prisma.integrationConnection.create({
      data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'Knowledge candidate Stage 5 connection', status: 'ACTIVE' },
    })
    const scope = scopeFor()
    process.env.ZURI_KNOWLEDGE_ENABLED = '1'
    process.env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    process.env.MSP_PIPELINE_PRINCIPALS = JSON.stringify([{ role: 'source', credential: 'test-credential', scope }])
    process.env.ZURI_MSP_COMMAND = process.execPath
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await prisma.$disconnect()
  })

  it.each(MUST_PASS_ANSWERS)('agrees (both pass): %s', async (answer) => {
    const content = composeCandidateContent({ ...CLEAN, answer })
    expect(findCandidateProseViolation(content)).toBeNull()
    expect(await stage5Verdict(content)).toBeNull()
  })

  it.each(MUST_REFUSE_ANSWERS.map((f) => f.answer))('agrees (both refuse): %s', async (answer) => {
    const content = composeCandidateContent({ ...CLEAN, answer })
    expect(findCandidateProseViolation(content)).not.toBeNull()
    const error = await stage5Verdict(content)
    expect(error).toMatchObject({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' })
  })

  it('an approved candidate containing "ขอใบเสนอราคาได้ไหม" passes Stage 5 (the literal case FR-187 would have denied)', async () => {
    const drafted = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Ukc5-quote', displayName: 'ลูกค้า ใบเสนอราคา',
      threadId: 'TH-KC5-QUOTE', text: 'ขอใบเสนอราคาได้ไหม', externalMessageId: 'MSG-KC5-QUOTE',
    })
    await prisma.customer.update({ where: { id: drafted.customerId }, data: { consentStatus: 'GRANTED' } })
    const candidate = await draftKnowledgeCandidate({
      businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId],
      idempotencyKey: 'stage5-quote-test', question: 'ลูกค้าถามว่าขอใบเสนอราคาได้ไหม', answer: 'ขอใบเสนอราคาได้ไหม',
    }, { viewer: owner })
    const approved = await decideKnowledgeCandidate(candidate.id, { decision: 'APPROVE', version: candidate.version }, { viewer: owner })
    expect(approved.status).toBe('APPROVED')

    const ingestion = await prisma.knowledgeIngestion.findUnique({ where: { id: approved.admittedIngestionId } })
    expect(await stage5Verdict(ingestion.content)).toBeNull()
  })

  it('a candidate with a Thai name is refused at creation, and the same admitted text would be refused at Stage 5', async () => {
    const drafted = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Ukc5-name', displayName: 'ลูกค้า สอง',
      threadId: 'TH-KC5-NAME', text: 'สอบถามสินค้า', externalMessageId: 'MSG-KC5-NAME',
    })
    await prisma.customer.update({ where: { id: drafted.customerId }, data: { consentStatus: 'GRANTED' } })
    const dirtyAnswer = 'ติดต่อคุณสมชาย ใจดี ได้เลยครับ'
    await expect(draftKnowledgeCandidate({
      businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId],
      idempotencyKey: 'stage5-name-test', question: CLEAN.question, answer: dirtyAnswer,
    }, { viewer: owner })).rejects.toMatchObject({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' })

    // The exact text that would have been admitted, checked directly against Stage 5.
    const content = composeCandidateContent({ ...CLEAN, answer: dirtyAnswer })
    expect(await stage5Verdict(content)).toMatchObject({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' })
  })

  it('a candidate with a phone number is refused at creation, and the same admitted text would be refused at Stage 5', async () => {
    const dirtyAnswer = 'โทรกลับที่ 081-234-5678 ได้เลย'
    const content = composeCandidateContent({ ...CLEAN, answer: dirtyAnswer })
    expect(findCandidateProseViolation(content)).toMatchObject({ term: 'phone_number' })
    expect(await stage5Verdict(content)).toMatchObject({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' })
  })

  it('REGRESSION — a SmartGift catalog record containing "customer" in a key is still denied by the unchanged FR-187 policy', async () => {
    // Direct proof the FR-187 function itself is untouched, independent of
    // any pipeline plumbing: a `customerName` field is structural evidence
    // of a CRM shape and is denied exactly as it was before this change.
    // Shape mirrors the real SmartGift ProductMaster record structured
    // parsing requires (tests/integration/smartgift-catalog-admission.test.js).
    const record = {
      entityType: 'ProductMaster',
      externalId: 'PM-REGRESSION',
      code: 'PM-REGRESSION',
      nameTh: 'ของขวัญ',
      customerName: 'someone',
      priceTiersThb: [],
      provenance: { upstreamFile: 'data-pipeline/02_prepared/ProductMaster.json', upstreamRecordId: 'pm:PM-REGRESSION' },
    }
    expect(() => assertZeroPii(record, { sourceId: 'smartgift-catalog:regression#PM-REGRESSION' })).toThrow(
      expect.objectContaining({ status: 422, code: 'GENESISRAG17_ZERO_PII_DENIED' }),
    )

    // And through the real Stage 5 gate, for a SMARTGIFT_CATALOG source —
    // proof the executor's provider->policy routing still sends this
    // provider to the unchanged FR-187 function, not the candidate policy.
    const content = canonicalGenesisRag17Json(record)
    const input = {
      scope: scopeFor(),
      sourceId: `smartgift-catalog:regression#PM-REGRESSION-${randomUUID().slice(0, 6)}`,
      documentId: `doc-sg-regression-${randomUUID().slice(0, 6)}`,
      version: randomUUID(),
      content,
      connectionId: connection.id,
      provider: 'SMARTGIFT_CATALOG',
      entityType: 'ProductMaster',
      contentType: 'application/json',
      policy: { allowEmbedding: true, allowPublication: true },
    }
    let thrown
    try {
      await ingestGenesisRag17Raw(input, { db: prisma, viewer: operator, now: () => new Date('2026-09-14T09:00:00.000Z'), transport, credential: 'test-source' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ status: 422, code: 'GENESISRAG17_ZERO_PII_DENIED' })
  })
})
