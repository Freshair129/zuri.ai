import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, runLineConversationWorker, LINE_TEXT_MAX_CHARS } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createModelPort } from '../../../../services/conversation-runtime/src/model-port.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'
import { MAX_RESPONSE_BYTES, MAX_TURN_QUESTION_CHARS } from '../../../../services/conversation-runtime/src/contracts.js'

// @req FR-149, FR-171 — a runtime turn accepts and delivers exactly what the legacy Server path does.
// @spec ADR-106 D2-D4, SDD-110 — admission, Core `prepare`/`send` and the runtime agree on bounds and outcomes.
// @tested tests/integration/conversation-runtime-legacy-parity.test.js

// Both paths read business knowledge through the same factory. Core's default `prepare` imports it lazily,
// so the mock is the one seam both paths share.
const smallEvidence = { records: [{ product: 'synthetic-parity-product', answer: 'มีสินค้าในชุดทดสอบ' }] }
let evidence = smallEvidence
const answerText = 'มีสินค้าในชุดทดสอบค่ะ'
const legacyCalls = []
const knowledgePorts = () => ({
  businessKnowledge: { query: async () => evidence },
  resolveModel: async () => ({ provider: 'synthetic', model: 'synthetic-parity-model',
    async generate({ question, evidence: seen }) {
      legacyCalls.push({ question, evidence: seen })
      return { provider: 'synthetic', model: 'synthetic-parity-model', status: 'ok', text: answerText }
    } }),
})
vi.mock('@/modules/agent/phase1-runtime', () => ({ createPhase1BusinessAgentPortsFromEnv: async () => knowledgePorts() }))

const serviceToken = 'synthetic-conversation-runtime-parity-token-01'
const sealKey = '5c'.repeat(32)
const lineUser = 'synthetic-parity-line-user'
const utf8 = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
// Thai text is three UTF-8 bytes per UTF-16 unit, so a full-length message also exercises the byte bounds.
const message = length => 'ขอราคาชุดของขวัญพรีเมียมสำหรับลูกค้าองค์กร '.repeat(Math.ceil(length / 40)).slice(0, length)
// 64 records (the prepare record cap) of Thai text, just under the 32 KiB evidence bound.
const nearLimitEvidence = () => {
  const records = Array.from({ length: 64 }, (_, index) => ({ product: `synthetic-parity-product-${String(index).padStart(2, '0')}`,
    answer: 'ข้อมูลสินค้าในชุดทดสอบ'.repeat(6) }))
  while (utf8({ records }) < 32 * 1024 - 64) records[records.length - 1].answer += 'ก'
  return { records }
}
const evidenceLine = prompt => JSON.parse(prompt.slice(prompt.indexOf('\nEVIDENCE: ') + '\nEVIDENCE: '.length).split('\n')[0])

let tenant, business, runtimeAccount, legacyAccount

async function lineAccount(code, runtimeOwner) {
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: `Synthetic ${code} connection`, externalAccountId: `synthetic-${code}-destination`, status: 'ACTIVE' })
  return prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code, displayName: `Synthetic ${code}`,
    bindingCode: `${code}-binding`, status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', runtimeOwner } })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Runtime parity fixture', code: 'PF-CR-PARITY' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime parity tenant', code: 'TNT-CR-PARITY' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Runtime parity business', code: 'BUS-CR-PARITY' })
  const person = await prisma.person.create({ data: { code: 'PER-CR-PARITY', displayName: 'Synthetic parity actor' } })
  runtimeAccount = await lineAccount('cr-parity-runtime', 'CONVERSATION_RUNTIME')
  legacyAccount = await lineAccount('cr-parity-legacy', 'SERVER')
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: person.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  for (const account of [runtimeAccount, legacyAccount]) {
    await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: person.id, channel: 'LINE',
      channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  }
})

beforeEach(() => { evidence = smallEvidence })

const admit = (account, eventId, text) => admitLineConversation({ db: prisma, account, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
  correlationId: eventId, now: new Date(),
  event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
    source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })

async function legacyAnswer(text) {
  legacyCalls.length = 0
  const answer = createServerLineAnswer({ env: {}, runtimeFactory: async () => knowledgePorts() })
  try {
    const reply = await answer({ tenantId: tenant.id, businessId: business.id, memorySyncOptIn: false,
      inbound: { body: text }, account: { tenantId: tenant.id, businessId: business.id, knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } })
    return { accepted: true, reply, model: legacyCalls[0] ?? null }
  } catch (error) { return { accepted: false, code: error?.code ?? error?.message } }
}

// Transports that accept, optionally racing one competing writer onto the READY row just before the send
// claim (resolveAccount runs between the sender's read and its compare-and-set).
function linePorts({ deliveries, contendOnce = false }) {
  let contended = !contendOnce
  return () => ({
    resolveAccount: async id => {
      if (!contended) {
        contended = true
        await prisma.lineConversationJob.updateMany({ where: { accountId: id, status: 'READY' }, data: { version: { increment: 1 } } })
      }
      return prisma.lineOaAccount.findUnique({ where: { id } })
    },
    replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-parity-acceptance' } } },
    pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-parity-acceptance' } } },
  })
}

async function runtimeTurns(jobId, { contendOnce = false, coreOverrides = {}, turns = 8 } = {}) {
  const modelPrompts = []
  const deliveries = []
  const outcomes = []
  const coreErrors = []
  const sendResponses = []
  const deliveryStatusReads = []
  const core = createConversationRuntimeCore({ db: prisma, env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    credentialResolver: async () => ({ provider: 'prp', model: 'synthetic-parity-model', apiKey: 'synthetic-provider-key',
      baseUrl: 'http://synthetic-model.test' }),
    linePorts: linePorts({ deliveries, contendOnce }), ...coreOverrides })
  const handlers = createConversationRuntimeRouteHandlers(core)
  const client = createCoreClient({ baseUrl: 'http://synthetic-core.test', token: serviceToken,
    fetchFn: async (url, init) => {
      const operation = String(url).split('/').pop()
      const envelope = JSON.parse(init.body)
      if (operation === 'status' && envelope.payload.operationId.endsWith(':delivery')) deliveryStatusReads.push(envelope.payload.operationId)
      const response = await handlers.POST(new Request(url, init), { params: { operation } })
      const body = await response.clone().json()
      if (operation === 'send') sendResponses.push({ status: response.status, body })
      if (response.status >= 400) coreErrors.push(`${operation} ${response.status} ${body.error?.code}`)
      return response
    } })
  const model = createModelPort({ fetchFn: async (url, init) => {
    modelPrompts.push(JSON.parse(init.body).messages[0].content)
    return new Response(JSON.stringify({ choices: [{ message: { content: answerText } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  } })
  const runtime = createConversationRuntime({ ports: createCorePorts({ client, model }), claimantId: 'synthetic-parity-runtime' })
  let job
  for (let turn = 0; turn < turns; turn += 1) {
    const outcome = await runtime.runOne()
    outcomes.push(outcome)
    job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    if (outcome.status === 'IDLE' || ['RECORDED', 'FAILED', 'UNKNOWN', 'CANCELLED'].includes(job.status)) break
  }
  return { status: job.status, errorCode: job.errorCode, coreErrors, modelPrompts, deliveries, outcomes, sendResponses, deliveryStatusReads }
}

describe('Conversation Runtime question length parity with the legacy Server answer path', () => {
  it('uses one bound for admission, Core prepare and the runtime', () => {
    expect(LINE_TEXT_MAX_CHARS).toBe(10_000)
    expect(MAX_TURN_QUESTION_CHARS).toBe(LINE_TEXT_MAX_CHARS)
  })

  it.each([8_000, 8_001, 10_000])('answers a %i-character message exactly as the legacy path does', async length => {
    const text = message(length)
    expect(text).toHaveLength(length)

    const legacy = await legacyAnswer(text)
    // Legacy accepts every admitted message whole: no truncation, no refusal.
    expect(legacy).toEqual({ accepted: true, reply: answerText, model: { question: text, evidence } })

    const { jobId } = await admit(runtimeAccount, `synthetic-parity-${length}`, text)
    const inbound = await prisma.lineConversationJob.findUnique({ where: { id: jobId }, include: { inbound: true } })
    expect(inbound.inbound.body).toBe(text)
    const runtime = await runtimeTurns(jobId)
    expect(runtime.coreErrors).toEqual([])
    expect(runtime).toMatchObject({ status: 'RECORDED', errorCode: null })
    expect(runtime.modelPrompts).toHaveLength(1)
    expect(runtime.modelPrompts[0]).toContain(`QUESTION: ${legacy.model.question}\n`)
    expect(runtime.deliveries).toEqual([[{ type: 'text', text: legacy.reply }]])
  })

  it('answers a 10,000-character Thai question with near-limit evidence, all of it reaching the model', async () => {
    evidence = nearLimitEvidence()
    expect(utf8(evidence)).toBeGreaterThan(32 * 1024 - 128)
    expect(utf8(evidence)).toBeLessThanOrEqual(32 * 1024)
    const text = message(LINE_TEXT_MAX_CHARS)
    // The prepared turn alone is far over the 32 KiB whole-result cap Core once applied.
    expect(utf8({ question: text, evidence })).toBeGreaterThan(60 * 1024)

    const legacy = await legacyAnswer(text)
    expect(legacy).toEqual({ accepted: true, reply: answerText, model: { question: text, evidence } })

    const { jobId } = await admit(runtimeAccount, 'synthetic-parity-near-limit-evidence', text)
    const runtime = await runtimeTurns(jobId)
    expect(runtime.coreErrors).toEqual([])
    expect(runtime).toMatchObject({ status: 'RECORDED', errorCode: null })
    expect(runtime.modelPrompts).toHaveLength(1)
    expect(runtime.modelPrompts[0]).toContain(`QUESTION: ${text}\n`)
    expect(evidenceLine(runtime.modelPrompts[0])).toEqual(evidence)
    expect(runtime.deliveries).toEqual([[{ type: 'text', text: legacy.reply }]])
  })

  it('keeps an escape-heavy full-length question whole and trims only evidence to fit the response cap', async () => {
    evidence = nearLimitEvidence()
    // Six JSON bytes per character: the worst any admissible text can serialize to.
    const text = '\u0001'.repeat(LINE_TEXT_MAX_CHARS)
    expect(utf8({ question: text, evidence })).toBeGreaterThan(MAX_RESPONSE_BYTES)

    const legacy = await legacyAnswer(text)
    expect(legacy).toEqual({ accepted: true, reply: answerText, model: { question: text, evidence } })

    const { jobId } = await admit(runtimeAccount, 'synthetic-parity-escape-heavy', text)
    const runtime = await runtimeTurns(jobId)
    expect(runtime.coreErrors).toEqual([])
    expect(runtime).toMatchObject({ status: 'RECORDED', errorCode: null })
    expect(runtime.modelPrompts).toHaveLength(1)
    expect(runtime.modelPrompts[0]).toContain(`QUESTION: ${text}\n`)
    const kept = evidenceLine(runtime.modelPrompts[0]).records
    // The highest-ranked records survive, in order; only the tail is dropped.
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(evidence.records.length)
    expect(kept).toEqual(evidence.records.slice(0, kept.length))
    expect(runtime.deliveries).toEqual([[{ type: 'text', text: legacy.reply }]])
    // The drop is traced, with counts only: no record, citation or question text.
    const trimmed = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'EVIDENCE_TRIMMED' } })
    expect(trimmed).toHaveLength(1)
    expect(JSON.parse(trimmed[0].payloadJson)).toEqual({ phase: 'prepare', recordsBefore: evidence.records.length,
      recordsKept: kept.length, recordsDropped: evidence.records.length - kept.length })
    expect(Object.keys(JSON.parse(trimmed[0].payloadJson)).sort()).toEqual(['phase', 'recordsBefore', 'recordsDropped', 'recordsKept'])
  })

  it('refuses one character over the bound at admission, before either path runs', async () => {
    await expect(admit(runtimeAccount, 'synthetic-parity-over-bound', message(LINE_TEXT_MAX_CHARS + 1)))
      .rejects.toMatchObject({ status: 400, message: 'LINE_TEXT_TOO_LONG' })
  })
})

describe('Conversation Runtime send outcomes parity with the legacy worker', () => {
  it('reports a contended send and delivers once on the next tick, as the legacy worker does', async () => {
    const legacyDeliveries = []
    const legacyPorts = linePorts({ deliveries: legacyDeliveries, contendOnce: true })()
    const tick = () => runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, workerId: 'synthetic-parity-legacy',
      answer: async () => answerText, ...legacyPorts })
    const { jobId: legacyJobId } = await admit(legacyAccount, 'synthetic-parity-legacy-contended', 'ถามข้อมูลสินค้า')
    expect(await tick()).toMatchObject({ status: 'CONTENDED' })
    expect((await prisma.lineConversationJob.findUnique({ where: { id: legacyJobId } })).status).toBe('READY')
    expect(await tick()).toMatchObject({ id: legacyJobId, status: 'RECORDED' })
    expect(legacyDeliveries).toEqual([[{ type: 'text', text: answerText }]])

    const { jobId } = await admit(runtimeAccount, 'synthetic-parity-runtime-contended', 'ถามข้อมูลสินค้า')
    const runtime = await runtimeTurns(jobId, { contendOnce: true })
    expect(runtime.coreErrors).toEqual([])
    expect(runtime.deliveryStatusReads).toEqual([])
    expect(runtime.sendResponses.map(({ status, body }) => [status, body.data?.id, body.data?.status]))
      .toEqual([[200, jobId, 'CONTENDED'], [200, jobId, 'RECORDED']])
    expect(runtime.outcomes.map(outcome => outcome.status)).toEqual(['CONTENDED', 'RECORDED'])
    expect(runtime).toMatchObject({ status: 'RECORDED', errorCode: null })
    expect(runtime.deliveries).toEqual(legacyDeliveries)
  })

  it('reports a job that vanished during reconciliation as MISSING instead of a contract error', async () => {
    const { jobId } = await admit(runtimeAccount, 'synthetic-parity-runtime-missing', 'ถามข้อมูลสินค้า')
    // reconcileAccepted answers `{ id, status: 'MISSING' }` when the row is gone under it; the legacy worker
    // reports that result as it is.
    const runtime = await runtimeTurns(jobId, { turns: 1,
      coreOverrides: { send: async claim => ({ id: claim.jobId, status: 'MISSING' }) } })
    expect(runtime.coreErrors).toEqual([])
    expect(runtime.deliveryStatusReads).toEqual([])
    expect(runtime.sendResponses).toEqual([{ status: 200,
      body: { contractVersion: 'conversation-runtime.v1', ok: true, data: { id: jobId, status: 'MISSING' } } }])
    expect(runtime.outcomes).toEqual([{ jobId, status: 'MISSING' }])
    await prisma.lineConversationJob.updateMany({ where: { id: jobId, status: 'READY' },
      data: { status: 'CANCELLED', errorCode: 'TEST_MISSING_CLEANUP', version: { increment: 1 } } })
  })
})
