import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, LINE_TEXT_MAX_CHARS } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createModelPort } from '../../../../services/conversation-runtime/src/model-port.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'
import { MAX_TURN_QUESTION_CHARS } from '../../../../services/conversation-runtime/src/contracts.js'

// @req FR-149, FR-171 — a runtime turn accepts exactly the LINE text the legacy Server answer path accepts.
// @spec ADR-106 D2-D4, SDD-110 — admission, Core `prepare` and the runtime share one question bound.
// @tested tests/integration/conversation-runtime-text-length-parity.test.js

// Both paths read business knowledge through the same factory. Core's default `prepare` imports it lazily,
// so the mock is the one seam both paths share; it records nothing about who called.
const evidence = { records: [{ product: 'synthetic-parity-product', answer: 'มีสินค้าในชุดทดสอบ' }] }
const answerText = 'มีสินค้าในชุดทดสอบค่ะ'
const legacyQuestions = []
const knowledgePorts = () => ({
  businessKnowledge: { query: async () => evidence },
  resolveModel: async () => ({ provider: 'synthetic', model: 'synthetic-parity-model',
    async generate({ question }) {
      legacyQuestions.push(question)
      return { provider: 'synthetic', model: 'synthetic-parity-model', status: 'ok', text: answerText }
    } }),
})
vi.mock('@/modules/agent/phase1-runtime', () => ({ createPhase1BusinessAgentPortsFromEnv: async () => knowledgePorts() }))

const serviceToken = 'synthetic-conversation-runtime-parity-token-01'
const sealKey = '5c'.repeat(32)
const lineUser = 'synthetic-parity-line-user'
// Thai text is three UTF-8 bytes per UTF-16 unit, so a full-length message also exercises the byte bounds.
const message = length => 'ขอราคาชุดของขวัญพรีเมียมสำหรับลูกค้าองค์กร '.repeat(Math.ceil(length / 40)).slice(0, length)

let tenant, business, account

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Runtime parity fixture', code: 'PF-CR-PARITY' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime parity tenant', code: 'TNT-CR-PARITY' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Runtime parity business', code: 'BUS-CR-PARITY' })
  const person = await prisma.person.create({ data: { code: 'PER-CR-PARITY', displayName: 'Synthetic parity actor' } })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: 'Synthetic parity connection', externalAccountId: 'synthetic-parity-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-parity-account', displayName: 'Synthetic parity OA',
    bindingCode: 'cr-parity-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner: 'CONVERSATION_RUNTIME' } })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: person.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: person.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
})

const admit = (eventId, text) => admitLineConversation({ db: prisma, account, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
  correlationId: eventId, now: new Date(),
  event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
    source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })

async function legacyAnswer(text) {
  legacyQuestions.length = 0
  const answer = createServerLineAnswer({ env: {}, runtimeFactory: async () => knowledgePorts() })
  try {
    const reply = await answer({ tenantId: tenant.id, businessId: business.id, memorySyncOptIn: false,
      inbound: { body: text }, account: { tenantId: tenant.id, businessId: business.id, knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } })
    return { accepted: true, reply, modelQuestion: legacyQuestions[0] ?? null }
  } catch (error) { return { accepted: false, code: error?.code ?? error?.message } }
}

async function runtimeTurn(jobId) {
  const modelPrompts = []
  const deliveries = []
  const core = createConversationRuntimeCore({ db: prisma, env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    credentialResolver: async () => ({ provider: 'prp', model: 'synthetic-parity-model', apiKey: 'synthetic-provider-key',
      baseUrl: 'http://synthetic-model.test' }),
    linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-parity-acceptance' } } },
      pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-parity-acceptance' } } } }),
  })
  const handlers = createConversationRuntimeRouteHandlers(core)
  const coreErrors = []
  const client = createCoreClient({ baseUrl: 'http://synthetic-core.test', token: serviceToken,
    fetchFn: async (url, init) => {
      const operation = String(url).split('/').pop()
      const response = await handlers.POST(new Request(url, init), { params: { operation } })
      if (response.status >= 400) coreErrors.push(`${operation} ${response.status} ${(await response.clone().json()).error?.code}`)
      return response
    } })
  const model = createModelPort({ fetchFn: async (url, init) => {
    modelPrompts.push(JSON.parse(init.body).messages[0].content)
    return new Response(JSON.stringify({ choices: [{ message: { content: answerText } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  } })
  const runtime = createConversationRuntime({ ports: createCorePorts({ client, model }), claimantId: 'synthetic-parity-runtime' })
  let job
  for (let turn = 0; turn < 8; turn += 1) {
    const outcome = await runtime.runOne()
    job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    if (outcome.status === 'IDLE' || ['RECORDED', 'FAILED', 'UNKNOWN', 'CANCELLED'].includes(job.status)) break
  }
  return { status: job.status, errorCode: job.errorCode, coreErrors, modelPrompts, deliveries }
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
    expect(legacy).toEqual({ accepted: true, reply: answerText, modelQuestion: text })

    const { jobId } = await admit(`synthetic-parity-${length}`, text)
    const inbound = await prisma.lineConversationJob.findUnique({ where: { id: jobId }, include: { inbound: true } })
    expect(inbound.inbound.body).toBe(text)
    const runtime = await runtimeTurn(jobId)
    expect(runtime.coreErrors).toEqual([])
    expect(runtime).toMatchObject({ status: 'RECORDED', errorCode: null })
    expect(runtime.modelPrompts).toHaveLength(1)
    expect(runtime.modelPrompts[0]).toContain(`QUESTION: ${legacy.modelQuestion}\n`)
    expect(runtime.deliveries).toEqual([[{ type: 'text', text: legacy.reply }]])
  })

  it('refuses one character over the bound at admission, before either path runs', async () => {
    await expect(admit('synthetic-parity-over-bound', message(LINE_TEXT_MAX_CHARS + 1)))
      .rejects.toMatchObject({ status: 400, message: 'LINE_TEXT_TOO_LONG' })
  })
})
