import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { admitLineConversation, claimRuntimeConversationJob } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { CONVERSATION_RUNTIME_GROUNDING_MODES, conversationRuntimeServesGroundingMode } from '@/modules/agent/line-knowledge-grounding'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-235 — the Conversation Runtime cohort admits a turn only when Core
// `prepare` can serve the account's grounding mode, and Core `prepare` serves
// BUSINESS_KNOWLEDGE, GKS_CORPUS and GKS_THEN_BUSINESS_KNOWLEDGE through the real
// Core route, the runtime's own client/ports and the disposable SQLite database.
// Only the GKS corpus service (reached through MSP in production), the business
// knowledge reader, the model call and the LINE transport are local fakes.
// @spec ADR-106 D2-D3, ADR-090 D1-D3, SEC-032
// @tested tests/integration/conversation-runtime-grounding.test.js
const queryKnowledgeCorpusMock = vi.hoisted(() => vi.fn())
vi.mock('@/modules/knowledge/knowledge-corpus-service', async (importOriginal) => ({
  ...(await importOriginal()),
  queryKnowledgeCorpus: (...args) => queryKnowledgeCorpusMock(...args),
}))

const serviceToken = 'synthetic-runtime-grounding-core-token-0001'
const sealKey = '6d'.repeat(32)
const lineUser = 'synthetic-grounding-line-user'
const MODES = ['BUSINESS_KNOWLEDGE', 'GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']
const productRecord = { name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }
const corpusHit = { id: 'hit-1', text: 'AB-1 คือแก้วน้ำ ราคา 50 บาท', score: 0.9, citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1 }

let tenant, business, provider, actor, ownerViewer
let openJobs = []
let deliveries = []
let accountSeq = 0

async function createAccount({ runtimeOwner = 'SERVER', knowledgeGrounding = 'BUSINESS_KNOWLEDGE' } = {}) {
  accountSeq += 1
  const suffix = `grounding-${accountSeq}`
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: `Synthetic ${suffix} connection`, externalAccountId: `synthetic-${suffix}-destination`, status: 'ACTIVE' })
  const account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: `cr-${suffix}`, displayName: `Synthetic ${suffix} OA`,
    bindingCode: `cr-${suffix}-binding`, status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner, knowledgeGrounding } })
  const linkedAt = new Date()
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  return account
}

async function admit(accountId, eventId, text = 'AB-1 ราคาเท่าไร') {
  const current = await prisma.lineOaAccount.findUnique({ where: { id: accountId } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current,
    env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, correlationId: eventId, now: new Date(),
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
      source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}

function inProcessFetch(handlers) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    const request = new Request(target, init)
    return operation === 'health' ? handlers.GET(request, { params: { operation } }) : handlers.POST(request, { params: { operation } })
  }
}

function build({ businessRecords = [productRecord], generate } = {}) {
  const businessKnowledge = { query: vi.fn(async () => ({ records: businessRecords.map(record => ({ ...record })) })) }
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey, ZURI_LINE_KNOWLEDGE_BUDGET_MS: '200' },
    businessPorts: async () => ({ businessKnowledge }),
    credentialResolver: async () => ({ provider: 'prp', model: 'controlled-model', apiKey: 'synthetic-provider-key' }),
    linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-grounding-reply' } } },
      pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-grounding-push' } } } }) })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core)) })
  const ports = createCorePorts({ client, model: { generate: generate ?? (async () => { throw new Error('MODEL_NOT_EXPECTED') }) } })
  return { ports, businessKnowledge }
}

async function evidenceHops(jobId) {
  const rows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'EVIDENCE_SELECTED' }, orderBy: { createdAt: 'asc' } })
  return rows.map(row => {
    const payload = JSON.parse(row.payloadJson)
    return { source: payload.source, mode: payload.mode, reason: payload.reason, records: payload.evidence?.records?.length ?? 0 }
  })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Runtime grounding fixture', code: 'PF-CR-GROUNDING' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime grounding tenant', code: 'TNT-CR-GROUNDING' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Runtime grounding business', code: 'BUS-CR-GROUNDING' })
  actor = await prisma.person.create({ data: { code: 'PER-CR-GROUNDING', displayName: 'Synthetic grounding actor' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  ownerViewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
    visibleDomains: ['projects', 'people', 'platform', 'line-oa'] })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
})

afterEach(async () => {
  // Leave nothing claimable for the next case or the next suite in this run.
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_RUNTIME_GROUNDING_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  deliveries = []
  queryKnowledgeCorpusMock.mockReset()
})

describe('Conversation Runtime grounding-mode eligibility guard', () => {
  it('the runtime serves exactly the three known modes, checked on the raw stored value', () => {
    expect(CONVERSATION_RUNTIME_GROUNDING_MODES).toEqual(MODES)
    for (const mode of MODES) expect(conversationRuntimeServesGroundingMode(mode)).toBe(true)
    for (const mode of ['NOT_A_REAL_MODE', '', undefined, null]) expect(conversationRuntimeServesGroundingMode(mode)).toBe(false)
  })

  for (const mode of MODES) {
    it(`${mode}: CONFIGURE_EXECUTION opts the account in and admission pins eligible direct turns to the runtime`, async () => {
      const account = await createAccount({ knowledgeGrounding: mode })
      const updated = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_EXECUTION', version: account.version,
        allowDelayedPush: account.allowDelayedPush, runtimeOwner: 'CONVERSATION_RUNTIME' }, { viewer: ownerViewer })
      expect(updated).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: mode })
      const job = await admit(account.id, `synthetic-grounding-opt-in-${mode}`)
      expect(job).toMatchObject({ executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME', status: 'QUEUED' })
    })

    it(`${mode}: a runtime-owned account may switch its grounding to ${mode}`, async () => {
      const from = mode === 'BUSINESS_KNOWLEDGE' ? 'GKS_CORPUS' : 'BUSINESS_KNOWLEDGE'
      const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: from })
      const updated = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version,
        knowledgeGrounding: mode }, { viewer: ownerViewer })
      expect(updated).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: mode })
    })
  }

  it('an unrecognised stored mode stays in the SERVER cohort and cannot be opted in', async () => {
    const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: 'NOT_A_REAL_MODE' })
    const job = await admit(account.id, 'synthetic-grounding-unknown-mode')
    expect(job).toMatchObject({ executionMode: 'SERVER', runtimeOwner: 'SERVER', status: 'QUEUED' })
    expect(await claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-grounding-unknown', now: () => new Date() })).toBeNull()

    const serverOwned = await createAccount({ knowledgeGrounding: 'NOT_A_REAL_MODE' })
    await expect(applyLineOaAccountAction(serverOwned.id, { action: 'CONFIGURE_EXECUTION', version: serverOwned.version,
      allowDelayedPush: serverOwned.allowDelayedPush, runtimeOwner: 'CONVERSATION_RUNTIME' }, { viewer: ownerViewer }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_RUNTIME_GROUNDING_MODE_UNSUPPORTED' })
    expect((await prisma.lineOaAccount.findUnique({ where: { id: serverOwned.id } })).runtimeOwner).toBe('SERVER')
  })
})

describe('Core prepare serves every grounding mode through the real Core route', () => {
  const cases = [
    { mode: 'BUSINESS_KNOWLEDGE', corpus: [corpusHit], expected: [productRecord], corpusCalls: 0,
      hops: [{ source: 'BUSINESS_QUERY', mode: undefined, reason: undefined, records: 1 }] },
    { mode: 'GKS_CORPUS', corpus: [corpusHit], corpusCalls: 1,
      expected: [{ kind: 'CORPUS_CHUNK', text: corpusHit.text, citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, corpusGeneration: 4, manifestHash: 'h'.repeat(64) }],
      hops: [{ source: 'GKS_CORPUS', mode: 'GKS_CORPUS', reason: null, records: 1 }] },
    { mode: 'GKS_CORPUS', corpus: [], expected: [], corpusCalls: 1,
      hops: [{ source: 'GKS_CORPUS', mode: 'GKS_CORPUS', reason: 'NO_EVIDENCE', records: 0 },
        { source: 'NONE', mode: 'GKS_CORPUS', reason: 'NO_EVIDENCE', records: 0 }] },
    { mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpus: [], expected: [productRecord], corpusCalls: 1,
      hops: [{ source: 'GKS_CORPUS', mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', reason: 'NO_EVIDENCE', records: 0 },
        { source: 'BUSINESS_KNOWLEDGE', mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', reason: 'NO_EVIDENCE', records: 1 }] },
    { mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpus: 'THROWS', expected: [productRecord], corpusCalls: 1,
      hops: [{ source: 'GKS_CORPUS', mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', reason: 'GKS_UNAVAILABLE', records: 0 },
        { source: 'BUSINESS_KNOWLEDGE', mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', reason: 'GKS_UNAVAILABLE', records: 1 }] },
  ]
  for (const [index, testCase] of cases.entries()) {
    it(`${testCase.mode} (${testCase.corpus === 'THROWS' ? 'corpus unavailable' : `${testCase.corpus.length} corpus hit(s)`}): prepare returns the selected evidence and traces each hop on the job`, async () => {
      queryKnowledgeCorpusMock.mockImplementation(async () => {
        if (testCase.corpus === 'THROWS') throw new Error('MSP worker failed with SQL detail')
        return { corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: testCase.corpus }
      })
      const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: testCase.mode })
      const job = await admit(account.id, `synthetic-grounding-prepare-${index}`)
      expect(job.runtimeOwner).toBe('CONVERSATION_RUNTIME')
      const { ports } = build()
      const claim = await ports.job.claim({ claimantId: `runtime-grounding-${index}` })
      expect(claim?.jobId, 'another runtime-cohort job was queued ahead of this test').toBe(job.id)
      const authority = await ports.authority.resolve(claim)
      const turn = await ports.context.prepare(claim, authority)

      expect(turn).toEqual({ question: 'AB-1 ราคาเท่าไร', evidence: { records: testCase.expected }, slices: [], authorized: true,
        audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: null })
      expect(queryKnowledgeCorpusMock).toHaveBeenCalledTimes(testCase.corpusCalls)
      if (testCase.corpusCalls) {
        expect(queryKnowledgeCorpusMock.mock.calls[0][0]).toEqual({ businessId: business.id, query: 'AB-1', topK: 5 })
        expect(queryKnowledgeCorpusMock.mock.calls[0][1]).toEqual({ viewer: { visibleBusinessIds: [business.id] } })
      }
      expect(await evidenceHops(job.id)).toEqual(testCase.hops)
      const rows = await prisma.agentTraceEvent.findMany({ where: { turnId: job.id, kind: 'EVIDENCE_SELECTED' } })
      expect(rows.every(row => row.executionId === claim.executionId && row.businessId === business.id)).toBe(true)
      expect(rows.map(row => row.payloadJson).join('')).not.toContain('SQL detail')
    })
  }

  it('GKS_CORPUS: a full runtime turn answers from the corpus chunk and records the delivery', async () => {
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit] })
    const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: 'GKS_CORPUS' })
    const admitted = await admit(account.id, 'synthetic-grounding-full-turn')
    const modelInputs = []
    const { ports, businessKnowledge } = build({ generate: async input => {
      modelInputs.push(input.evidence)
      return `ตามข้อมูล: ${input.evidence.records[0].text}`
    } })
    const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-grounding-full-turn' }).runOne()
    expect(outcome).toMatchObject({ jobId: admitted.id })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.id } })
    expect(job, JSON.stringify(outcome)).toMatchObject({ status: 'RECORDED', answerText: `ตามข้อมูล: ${corpusHit.text}` })
    expect(modelInputs).toEqual([{ records: [expect.objectContaining({ kind: 'CORPUS_CHUNK', citationId: 'cit-1' })] }])
    expect(businessKnowledge.query).not.toHaveBeenCalled()
    expect(deliveries).toHaveLength(1)
    expect(await evidenceHops(admitted.id)).toEqual([{ source: 'GKS_CORPUS', mode: 'GKS_CORPUS', reason: null, records: 1 }])
  })
})
