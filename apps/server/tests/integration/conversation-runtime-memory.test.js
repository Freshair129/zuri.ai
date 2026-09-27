import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { reconcileLineMemoryDeliveries } from '@/modules/line-oa-studio/application/line-memory-delivery'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { createServerLineThreadMemory } from '@/modules/line-oa-studio/application/server-line-runtime'
import { createMspThreadMemoryPort } from '@/modules/agent/msp-thread-memory-port'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { validateMemoryRequest } from '../../../../services/conversation-runtime/src/contracts.js'
import { createModelPort } from '../../../../services/conversation-runtime/src/model-port.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-171 — memory-sync opt-in turns run in the Conversation Runtime cohort.
// @spec ADR-106 D2-D4, SDD-110 — Memory/Knowledge `read`, `append`, `receipt`: Core is
// the only MSP caller and runs the legacy memory phases under the legacy fences.
// Nothing on either side of the port is mocked: runtime turn runner → runtime ports →
// runtime Core client → Core route handler → Core memory façade → the legacy memory
// phases (`server-line-answer.js`) → the real MSP thread-memory port with a signed
// service key → an in-memory MSP stand-in that deduplicates by source event id, as
// API-010 does. The model is the real provider adapter on each side over a capturing
// fetch, so "what the model received" is the provider request body itself.
// Parity: the same claimed job is answered once by the legacy Server answer and once
// by the runtime, each against a fresh MSP stand-in with identical history, and the
// MSP calls, their signed claims and the provider request are compared.
// @tested tests/integration/conversation-runtime-memory.test.js
const serviceToken = 'synthetic-memory-runtime-core-token-00001'
const mspServiceKey = 'synthetic-msp-thread-service-key-00000001'
const providerKey = 'synthetic-memory-provider-key'
const sealKey = '6d'.repeat(32)
const lineUser = 'synthetic-memory-line-user'
const question = 'ราคาเท่าไร'
const evidenceRecords = [{ product_code: 'A1', name: 'สินค้าทดสอบ', sell_price: 12 }]
const providerReply = { choices: [{ message: { content: 'คำตอบจากโมเดล' } }] }
const schema = JSON.parse(readFileSync(new URL(
  '../../../../services/conversation-runtime/contracts/v1/operation.schema.json', import.meta.url), 'utf8'))

let tenant, business, account, actor
let wire = []
let deliveries = []
let openJobs = []
let eventSequence = 0

const transportError = () => Object.assign(new Error('MSP request timed out: tools/call'), { code: 'MSP_TRANSPORT_UNAVAILABLE', status: 503 })
const killed = () => Object.assign(new Error('RUNTIME_KILLED'), { code: 'RUNTIME_KILLED' })
const sha256 = value => createHash('sha256').update(value).digest('hex')

/** API-010 stand-in: stable threads per route, source-event-id deduplication, exchanges, receipts. */
function createFakeMsp() {
  const calls = []
  const threads = new Map()
  const messages = []
  const injections = []
  const deliveryReceipts = []
  const hooks = { before: null, after: null }
  let counter = 0
  const next = prefix => `${prefix}-${++counter}`
  const threadById = id => [...threads.values()].find(thread => thread.threadId === id)
  function handle(name, input) {
    if (name === 'msp_thread_resolve') {
      const key = [input.tenant_id, input.channel_account_id, input.external_room_ref].join('|')
      let thread = threads.get(key)
      const created = !thread
      if (!thread) {
        thread = { threadId: next('thread'), businessId: input.business_id, audienceKind: input.audience_kind }
        threads.set(key, thread)
        // One earlier exchange, so the recalled packet carries real history.
        const exchangeId = next('exchange')
        messages.push({ threadId: thread.threadId, messageId: next('message'), exchangeId, sequence: ++counter,
          direction: 'INBOUND', speakerId: 'earlier-speaker', speakerKind: 'HUMAN', text: 'สวัสดีค่ะ', sessionId: 'session-1' })
        messages.push({ threadId: thread.threadId, messageId: next('message'), exchangeId, sequence: ++counter,
          direction: 'OUTBOUND', speakerId: 'zuri-line-agent', speakerKind: 'AGENT', text: 'สวัสดีค่ะ ยินดีให้บริการ', sessionId: 'session-1' })
      }
      return { thread, created }
    }
    if (name === 'msp_thread_message_append') {
      const existing = input.source_event_id && messages.find(message => message.threadId === input.thread_id
        && message.sourceEventId === input.source_event_id)
      if (existing) {
        return { message: { messageId: existing.messageId, exchangeId: existing.exchangeId, sequence: existing.sequence },
          session: { sessionId: existing.sessionId }, deduplicated: true }
      }
      const message = { threadId: input.thread_id, messageId: next('message'),
        exchangeId: input.direction === 'INBOUND' ? next('exchange') : input.exchange_id, sequence: ++counter,
        direction: input.direction, speakerId: input.speaker_id, speakerKind: input.speaker_kind, text: input.text,
        sourceEventId: input.source_event_id, sessionId: input.session_id ?? 'session-1' }
      messages.push(message)
      return { message: { messageId: message.messageId, exchangeId: message.exchangeId, sequence: message.sequence },
        session: { sessionId: message.sessionId }, deduplicated: false }
    }
    if (name === 'msp_thread_context') {
      const thread = threadById(input.thread_id)
      const exchanges = []
      for (const message of messages.filter(item => item.threadId === input.thread_id)) {
        let exchange = exchanges.find(item => item.exchangeId === message.exchangeId)
        if (!exchange) exchanges.push(exchange = { exchangeId: message.exchangeId, messages: [] })
        exchange.messages.push({ sequence: message.sequence, speakerId: message.speakerId,
          speakerKind: message.speakerKind, direction: message.direction, text: message.text })
      }
      return { thread, session: { sessionId: 'session-1' },
        participants: [{ speakerId: 'zuri-line-agent', speakerKind: 'AGENT' }],
        recentExchanges: exchanges.slice(-input.recent_exchange_count), protectedRecords: [], threadSummaries: [], coverageGap: null }
    }
    if (name === 'msp_thread_injection_record') {
      injections.push({ state: input.state, injectionId: input.injection_id, packetHash: input.packet_hash, modelRef: input.model_ref })
      return { recorded: true, state: input.state }
    }
    if (name === 'msp_thread_delivery_record') {
      deliveryReceipts.push(input.receipt_id)
      return { receiptId: input.receipt_id, messageId: next('delivery'), outcome: 'ACCEPTED' }
    }
    return {}
  }
  async function transport(name, input) {
    calls.push({ name, input: JSON.parse(JSON.stringify(input)) })
    if (hooks.before) await hooks.before(name, input)
    const result = handle(name, input)
    if (hooks.after) await hooks.after(name, input, result)
    return result
  }
  return { transport, calls, messages, injections, deliveryReceipts, hooks }
}

const mspPort = msp => createMspThreadMemoryPort({ transport: msp.transport, serviceKey: mspServiceKey, workspaceId: 'w5-workspace' })

/** Drop the per-call signing material; keep the tool, its input and every signed claim. */
function comparableCalls(calls) {
  return calls.map(({ name, input }) => {
    const { access, ...rest } = input
    const grant = access?.grant ? (({ nonce, expiresAt, payloadHash, ...claims }) => claims)(access.grant) : null
    // The injection id and packet hash are random per packet (contextId/injectionId);
    // they are compared for internal consistency separately.
    if (name === 'msp_thread_injection_record') { rest.injection_id = '<injection>'; rest.packet_hash = '<hash>' }
    return { name, input: rest, grant, signed: typeof access?.signature === 'string' }
  })
}

const randomPacketIds = value => value
  .replace(/\\"contextId\\":\\"context_[0-9a-f-]+\\"/g, '\\"contextId\\":\\"<context>\\"')
  .replace(/\\"injectionId\\":\\"injection_[0-9a-f-]+\\"/g, '\\"injectionId\\":\\"<injection>\\"')

function captureFetch(calls) {
  return async (url, options) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(options.headers)), body: options.body })
    return new Response(JSON.stringify(providerReply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

function inProcessFetch(handlers) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    if (init.body) {
      const envelope = JSON.parse(init.body)
      wire.push({ operation: envelope.operation, payload: envelope.payload, idempotencyKey: envelope.idempotencyKey })
    }
    const request = new Request(target, init)
    return operation === 'health'
      ? handlers.GET(request, { params: { operation } })
      : handlers.POST(request, { params: { operation } })
  }
}

function build({ msp, env = {}, records = evidenceRecords, threadMemoryFactory } = {}) {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...env },
    credentialResolver: async () => ({ provider: 'openrouter', model: 'test-model', apiKey: providerKey }),
    prepareTurn: async job => ({ question: job.inbound.body, evidence: { records }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }),
    threadMemoryFactory: threadMemoryFactory ?? (msp ? () => mspPort(msp) : null),
    linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-memory-reply' } } },
      pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-memory-push' } } } }) })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core)) })
  const providerCalls = []
  const modelInputs = []
  const provider = createModelPort({ timeoutMs: 1000, fetchFn: captureFetch(providerCalls) })
  const ports = createCorePorts({ client, model: { generate: input => { modelInputs.push(input); return provider.generate(input) } } })
  return { core, ports, providerCalls, modelInputs }
}

/** Every port function throws once `dies` says the process died; nothing after that reaches Core. */
function mortal(ports, dies) {
  let dead = false
  const wrap = (group, name, fn) => async (...args) => {
    if (dead) throw killed()
    const result = await fn(...args)
    if (dies(`${group}.${name}`, args, result)) dead = true
    return result
  }
  return Object.fromEntries(Object.entries(ports).map(([group, methods]) => [group,
    Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, wrap(group, name, fn)]))]))
}

async function admit({ memory = true, text = question } = {}) {
  const eventId = `synthetic-memory-event-${++eventSequence}`
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current,
    env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...(memory ? { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' } : {}) },
    correlationId: eventId, now: new Date(),
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
      source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  return jobId
}

const loadJob = id => prisma.lineConversationJob.findUnique({ where: { id },
  include: { account: true, inbound: { include: { conversation: true } } } })

/** The legacy Server answer for the same job: same MSP port type, same provider adapter. */
async function legacyAnswer(jobId, msp, { records = evidenceRecords, runtimeFactory } = {}) {
  const providerCalls = []
  const modelInputs = []
  const provider = createModelProviderPort({ provider: 'openrouter', model: 'test-model', credential: providerKey,
    timeoutMs: 1000, fetchFn: captureFetch(providerCalls) })
  const answer = createServerLineAnswer({ threadMemory: msp ? mspPort(msp) : null,
    runtimeFactory: runtimeFactory ?? (async () => ({ businessKnowledge: { query: async () => ({ records }) },
      resolveModel: async () => ({ ...provider, generate: input => { modelInputs.push(input); return provider.generate(input) } }) })) })
  let text
  let failure
  try { text = await answer(await loadJob(jobId)) } catch (error) { failure = error }
  return { text, failure, providerCalls, modelInputs }
}

const memoryWire = () => wire.filter(call => call.operation === 'memory')
  .map(call => `${call.payload.operation} ${call.payload.operationId.split(':').pop()}${call.payload.input.state ? ` ${call.payload.input.state}` : ''}`)
const mspNames = msp => msp.calls.map(call => call.name === 'msp_thread_message_append' ? `append ${call.input.direction}`
  : call.name === 'msp_thread_injection_record' ? `injection ${call.input.state}` : call.name.replace('msp_thread_', ''))
const threadMessages = (msp, direction) => msp.messages.filter(message => message.direction === direction && message.sourceEventId)

beforeAll(async () => {
  // Leave no other suite's runtime-cohort work claimable ahead of these cases.
  await prisma.lineConversationJob.updateMany({ where: { runtimeOwner: 'CONVERSATION_RUNTIME', status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_MEMORY_SUITE_ISOLATION', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  const portfolio = await createPortfolio({ name: 'Runtime memory fixture', code: 'PF-CR-MEM' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime memory tenant', code: 'TNT-CR-MEM' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Runtime memory business', code: 'BUS-CR-MEM' })
  actor = await prisma.person.create({ data: { code: 'PER-CR-MEM', displayName: 'Synthetic memory customer' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' } })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: 'Synthetic memory LINE connection', externalAccountId: 'synthetic-memory-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-memory-account', displayName: 'Synthetic memory OA',
    bindingCode: 'cr-memory-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner: 'CONVERSATION_RUNTIME' } })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_MEMORY_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  wire = []
  deliveries = []
  await prisma.business.update({ where: { id: business.id }, data: { status: 'ACTIVE' } })
  await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
    tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: lineUser } },
  data: { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() } })
})

describe('Conversation Runtime memory-sync turns', () => {
  it('admits a memory-sync opt-in direct message to the runtime cohort', async () => {
    const jobId = await admit()
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({
      executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true, status: 'QUEUED' })
    // A corpus-grounding account keeps memory turns on the Server, which alone
    // composes GKS evidence and thread memory under one budget (FR-235).
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'GKS_CORPUS' } })
    try {
      const serverJobId = await admit()
      expect(await prisma.lineConversationJob.findUnique({ where: { id: serverJobId } }))
        .toMatchObject({ runtimeOwner: 'SERVER', memorySyncOptIn: true })
      const plainJobId = await admit({ memory: false })
      expect(await prisma.lineConversationJob.findUnique({ where: { id: plainJobId } }))
        .toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: false })
    } finally {
      await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } })
    }
  })

  it('makes the legacy MSP calls, signed claims and provider request, then records the turn and its delivery receipt', async () => {
    const jobId = await admit()
    const legacyMsp = createFakeMsp()
    const legacy = await legacyAnswer(jobId, legacyMsp)
    expect(legacy.failure).toBeUndefined()

    const runtimeMsp = createFakeMsp()
    const { ports, providerCalls, modelInputs } = build({ msp: runtimeMsp })
    const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-parity' }).runOne()
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ jobId, status: 'RECORDED' })

    // Same MSP calls in the same order with the same inputs and signed claims.
    expect(mspNames(runtimeMsp)).toEqual(['resolve', 'append INBOUND', 'resolve', 'context',
      'injection RESOLVED', 'injection SUBMITTED', 'injection COMPLETED', 'append OUTBOUND'])
    expect(comparableCalls(runtimeMsp.calls)).toEqual(comparableCalls(legacyMsp.calls))
    expect(runtimeMsp.calls.every(call => typeof call.input.access?.signature === 'string')).toBe(true)

    // The provider saw the same request, context packet included.
    expect(providerCalls).toHaveLength(1)
    expect(legacy.providerCalls).toHaveLength(1)
    expect(providerCalls[0].url).toBe(legacy.providerCalls[0].url)
    expect(providerCalls[0].headers).toEqual(legacy.providerCalls[0].headers)
    expect(randomPacketIds(providerCalls[0].body)).toBe(randomPacketIds(legacy.providerCalls[0].body))
    expect(providerCalls[0].body).toContain('THREAD CONTEXT PACKET')
    expect(providerCalls[0].body).toContain('สวัสดีค่ะ ยินดีให้บริการ')

    // One packet identity across the three injection states, hashed over exactly
    // the packet the model received.
    const packet = modelInputs[0].contextPacket
    expect(packet.policyDecision).toBe('ALLOW')
    expect(new Set(runtimeMsp.injections.map(item => item.injectionId)).size).toBe(1)
    expect(runtimeMsp.injections.map(item => item.packetHash)).toEqual(Array(3).fill(sha256(JSON.stringify(packet))))
    expect(runtimeMsp.injections[0].modelRef).toBe('openrouter:test-model')
    expect(legacyMsp.injections[0].modelRef).toBe('openrouter:test-model')

    // The appended exchange is the committed, delivered answer.
    const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    expect(job).toMatchObject({ status: 'RECORDED', answerText: legacy.text, memoryDeliveryState: 'PENDING' })
    expect(threadMessages(runtimeMsp, 'OUTBOUND').map(message => message.text)).toEqual([legacy.text])
    expect(threadMessages(legacyMsp, 'OUTBOUND').map(message => message.text)).toEqual([legacy.text])
    expect(deliveries).toEqual([[{ type: 'text', text: legacy.text }]])
    expect(memoryWire()).toEqual(['read memory-read', 'receipt memory-injection RESOLVED',
      'receipt memory-injection SUBMITTED', 'receipt memory-injection COMPLETED', 'receipt memory-append', 'append memory-append'])

    // The provider-accepted reply reaches MSP through the Core-owned receipt
    // scanner, exactly as for a Server-cohort job.
    const scanned = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: mspPort(runtimeMsp), workerId: 'memory-scanner-w5' })
    expect(scanned.acknowledged).toBeGreaterThanOrEqual(1)
    expect(runtimeMsp.deliveryReceipts).toHaveLength(1)
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({ memoryDeliveryState: 'ACKNOWLEDGED' })
  })

  it('reads and appends memory without a model call when no evidence matches, as the legacy path does', async () => {
    const jobId = await admit()
    const legacyMsp = createFakeMsp()
    const legacy = await legacyAnswer(jobId, legacyMsp, { records: [] })
    const runtimeMsp = createFakeMsp()
    const { ports, providerCalls } = build({ msp: runtimeMsp, records: [] })
    const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-no-evidence' }).runOne()
    expect(outcome).toMatchObject({ jobId, status: 'RECORDED' })
    expect(providerCalls).toEqual([])
    expect(legacy.providerCalls).toEqual([])
    expect(mspNames(runtimeMsp)).toEqual(['resolve', 'append INBOUND', 'resolve', 'context', 'append OUTBOUND'])
    expect(mspNames(runtimeMsp)).toEqual(mspNames(legacyMsp))
    // The no-evidence reply text is the runtime's existing wording, which already
    // differs from the legacy wording for every runtime turn; everything else matches.
    const without = calls => comparableCalls(calls).map(call => call.name === 'msp_thread_message_append' && call.input.direction === 'OUTBOUND'
      ? { ...call, input: { ...call.input, text: '<answer>' } } : call)
    expect(without(runtimeMsp.calls)).toEqual(without(legacyMsp.calls))
    const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    expect(threadMessages(runtimeMsp, 'OUTBOUND').map(message => message.text)).toEqual([job.answerText])
  })

  it('makes no memory call and no MSP call for a turn admitted without memory sync', async () => {
    const jobId = await admit({ memory: false })
    const msp = createFakeMsp()
    const { ports } = build({ msp })
    const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-off' }).runOne()
    expect(outcome).toMatchObject({ jobId, status: 'RECORDED' })
    expect(memoryWire()).toEqual([])
    expect(msp.calls).toEqual([])
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({ answerText: 'คำตอบจากโมเดล' })
  })

  it('refuses every memory operation for a job without memory consent', async () => {
    const jobId = await admit({ memory: false })
    const msp = createFakeMsp()
    const { ports } = build({ msp })
    const claim = await ports.job.claim({ claimantId: 'runtime-memory-consent-absent' })
    expect(claim.jobId).toBe(jobId)
    await expect(ports.memory.read(claim)).rejects.toMatchObject({ code: 'MEMORY_NOT_ENABLED' })
    await expect(ports.memory.append(claim, 'answer')).rejects.toMatchObject({ code: 'MEMORY_NOT_ENABLED' })
    await expect(ports.memory.receipt(claim, 'injection', { state: 'RESOLVED', model: { provider: 'openrouter', model: 'm' } }))
      .rejects.toMatchObject({ code: 'MEMORY_NOT_ENABLED' })
    expect(msp.calls).toEqual([])
  })

  describe('MSP unavailable', () => {
    it('fails the turn before the model when MSP is down, as the legacy path fails it', async () => {
      const jobId = await admit()
      const legacyMsp = createFakeMsp()
      legacyMsp.hooks.before = () => { throw transportError() }
      const legacy = await legacyAnswer(jobId, legacyMsp)
      expect(legacy.failure).toMatchObject({ code: 'LINE_ANSWER_UNAVAILABLE' })
      expect(legacy.providerCalls).toEqual([])

      const runtimeMsp = createFakeMsp()
      runtimeMsp.hooks.before = () => { throw transportError() }
      const { ports, providerCalls } = build({ msp: runtimeMsp })
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-msp-down' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'FAILED', code: 'MSP_TRANSPORT_UNAVAILABLE' })
      expect(providerCalls).toEqual([])
      expect(deliveries).toEqual([])
      expect(wire.map(call => call.operation)).not.toContain('credential')
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
        .toMatchObject({ status: 'FAILED', errorCode: 'MSP_TRANSPORT_UNAVAILABLE', answerText: null })
    })

    it('fails the turn with the typed MSP_TRANSPORT_MISCONFIGURED code where the legacy scanner degrades to absent', async () => {
      const directory = path.join(tmpdir(), `zuri-w5-missing-${Date.now()}`)
      const env = { ZURI_MSP_THREAD_SERVICE_KEY: mspServiceKey, ZURI_MSP_COMMAND: process.execPath,
        MSP_GKS_TRANSPORT: 'http', GKS_MSP_RELAY_CREDENTIAL_FILE: path.join(directory, 'relay-credential') }
      // Legacy: the deployment port is absent, and the Phase 1 fallback's transport
      // construction throws, so the turn fails without an MSP or model call.
      expect(createServerLineThreadMemory(env)).toBeNull()
      const jobId = await admit()
      const legacy = await legacyAnswer(jobId, null, { runtimeFactory: async () => {
        createMspTransportFromEnvironment(env)
        throw new Error('unreachable')
      } })
      expect(legacy.failure).toMatchObject({ code: 'LINE_ANSWER_UNAVAILABLE' })

      const { ports, providerCalls } = build({ env })
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-misconfigured' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'FAILED', code: 'MSP_TRANSPORT_MISCONFIGURED' })
      expect(providerCalls).toEqual([])
      expect(deliveries).toEqual([])
      const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
      expect(job).toMatchObject({ status: 'FAILED', errorCode: 'MSP_TRANSPORT_MISCONFIGURED' })
      expect(JSON.stringify(job)).not.toContain(directory)
    })

    it('fails closed when no MSP transport or service key is configured', async () => {
      const jobId = await admit()
      const { ports } = build({ env: {} })
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-unconfigured' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'FAILED', code: 'MSP_THREAD_SERVICE_KEY_REQUIRED' })
      expect(deliveries).toEqual([])
    })

    it('keeps an unknown injection receipt UNKNOWN: no append, no delivery, no second model call', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      msp.hooks.before = (name, input) => { if (name === 'msp_thread_injection_record' && input.state === 'SUBMITTED') throw transportError() }
      const { ports, providerCalls } = build({ msp })
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-receipt-unknown' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'UNKNOWN', code: 'MSP_INJECTION_RECEIPT_UNKNOWN' })
      expect(providerCalls).toHaveLength(1)
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(deliveries).toEqual([])
      // The legacy worker's durable outcome for the same failure.
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({
        status: 'UNKNOWN', errorCode: 'MSP_INJECTION_RECEIPT_UNKNOWN', answerText: null })
      expect(await createConversationRuntime({ ports, claimantId: 'runtime-memory-receipt-unknown-2' }).runOne()).toEqual({ status: 'IDLE' })
      expect(providerCalls).toHaveLength(1)
    })
  })

  describe('consent and erasure races', () => {
    it('erasure between read and append prevents the append, the completion and the delivery', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-erasure-port' })
      expect(claim.jobId).toBe(jobId)
      const read = await ports.memory.read(claim)
      expect(read.result.contextPacket.policyDecision).toBe('ALLOW')
      const inbound = await prisma.message.findUnique({ where: { id: (await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).inboundMessageId } })
      await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [inbound.conversationId] }))
      const callsBefore = msp.calls.length
      await expect(ports.memory.append(claim, 'answer after erasure')).rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
      await expect(ports.memory.read(claim)).rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
      expect(msp.calls.length).toBe(callsBefore)
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({ status: 'CANCELLED', errorCode: 'PDPA_ERASURE' })
    })

    it('erasure right after the read stops the turn before the model and the append', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const built = build({ msp })
      const ports = { ...built.ports, memory: { ...built.ports.memory, read: async (...args) => {
        const read = await built.ports.memory.read(...args)
        const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
        const inbound = await prisma.message.findUnique({ where: { id: job.inboundMessageId } })
        await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [inbound.conversationId] }))
        return read
      } } }
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-erasure-after-read' }).runOne()
      expect(outcome.status).not.toBe('RECORDED')
      expect(built.providerCalls).toEqual([])
      expect(msp.injections).toEqual([])
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(deliveries).toEqual([])
    })

    it('erasure during the model call stops the turn before the thread append', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const built = build({ msp })
      const ports = { ...built.ports, model: { ...built.ports.model, generate: async input => {
        const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
        const inbound = await prisma.message.findUnique({ where: { id: job.inboundMessageId } })
        await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [inbound.conversationId] }))
        return built.ports.model.generate(input)
      } } }
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-erasure-turn' }).runOne()
      expect(outcome.status).not.toBe('RECORDED')
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      // SUBMITTED races the erasure; COMPLETED is refused after it.
      expect(msp.injections.map(item => item.state)).not.toContain('COMPLETED')
      expect(deliveries).toEqual([])
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({ status: 'CANCELLED', errorCode: 'PDPA_ERASURE', answerText: null })
    })

    it('honours a private-memory policy withdrawal mid-turn: no append, FAILED, nothing sent', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const built = build({ msp })
      const ports = { ...built.ports, model: { ...built.ports.model, generate: async input => {
        await prisma.business.update({ where: { id: business.id }, data: { status: 'SUSPENDED' } })
        return built.ports.model.generate(input)
      } } }
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-policy-revoked' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'FAILED', code: 'LINE_MEMORY_POLICY_REVOKED' })
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(deliveries).toEqual([])
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
        .toMatchObject({ status: 'FAILED', errorCode: 'LINE_MEMORY_POLICY_REVOKED', answerText: null })
    })

    it('honours a channel-identity revocation mid-turn: no append and nothing sent', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const built = build({ msp })
      const ports = { ...built.ports, model: { ...built.ports.model, generate: async input => {
        await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
          tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: lineUser } },
        data: { status: 'REVOKED', revokedAt: new Date() } })
        return built.ports.model.generate(input)
      } } }
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-identity-revoked' }).runOne()
      // Core refuses the next claimed-job write after the revocation (the model
      // result trace), so the turn ends before the memory append is attempted.
      expect(outcome).toMatchObject({ jobId })
      expect(outcome.status).not.toBe('RECORDED')
      expect(memoryWire()).not.toContain('append memory-append')
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(deliveries).toEqual([])
      expect((await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).status).not.toBe('READY')
    })

    it('never replays stored private context after the policy was withdrawn', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-replay-policy' })
      expect((await ports.memory.read(claim)).result.contextPacket).not.toBeNull()
      await prisma.business.update({ where: { id: business.id }, data: { status: 'SUSPENDED' } })
      const callsBefore = msp.calls.length
      await expect(ports.memory.read(claim)).rejects.toMatchObject({ code: 'LINE_MEMORY_POLICY_REVOKED' })
      expect(msp.calls.length).toBe(callsBefore)
      expect(jobId).toBe(claim.jobId)
    })

    it('refuses to complete a memory turn whose answer was not appended, or differs from the appended text', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-complete-fence' })
      expect(claim.jobId).toBe(jobId)
      await expect(ports.job.complete(claim, { text: 'unappended', operationId: `${jobId}:turn-answer` }))
        .rejects.toMatchObject({ code: 'MEMORY_APPEND_REQUIRED' })
      await expect(ports.memory.append(claim, 'appended answer')).rejects.toMatchObject({ code: 'MEMORY_READ_REQUIRED' })
      await ports.memory.read(claim)
      await ports.memory.append(claim, 'appended answer')
      await expect(ports.memory.append(claim, 'a different answer')).rejects.toMatchObject({ code: 'MEMORY_APPEND_CONFLICT' })
      await expect(ports.job.complete(claim, { text: 'a different answer', operationId: `${jobId}:turn-answer` }))
        .rejects.toMatchObject({ code: 'MEMORY_APPEND_CONFLICT' })
      expect(await ports.job.complete(claim, { text: 'appended answer', operationId: `${jobId}:turn-answer` }))
        .toMatchObject({ status: 'READY' })
      expect(threadMessages(msp, 'OUTBOUND').map(message => message.text)).toEqual(['appended answer'])
    })
  })

  describe('idempotency across a runtime kill and reclaim', () => {
    const expireLease = jobId => prisma.lineConversationJob.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })

    it('killed after the append: the reclaimed runtime replays every receipt and appends nothing twice', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const built = build({ msp })
      const first = await createConversationRuntime({ claimantId: 'runtime-memory-killed-after-append',
        ports: mortal(built.ports, name => name === 'memory.append') }).runOne()
      // The process died after Core saved the append receipt: nothing after it reached Core.
      expect(first, JSON.stringify({ first, wire: memoryWire() })).toMatchObject({ jobId, status: 'UNKNOWN', code: 'COMPLETION_OUTCOME_UNKNOWN' })
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({ status: 'CLAIMED' })
      expect(threadMessages(msp, 'OUTBOUND')).toHaveLength(1)
      expect(deliveries).toEqual([])

      await expireLease(jobId)
      wire = []
      const second = await createConversationRuntime({ ports: built.ports, claimantId: 'runtime-memory-reclaimer' }).runOne()
      expect(second, JSON.stringify({ second, wire: wire.map(call => call.operation) })).toMatchObject({ jobId, status: 'RECORDED' })
      expect(mspNames(msp)).toEqual(['resolve', 'append INBOUND', 'resolve', 'context',
        'injection RESOLVED', 'injection SUBMITTED', 'injection COMPLETED', 'append OUTBOUND'])
      expect(threadMessages(msp, 'INBOUND')).toHaveLength(1)
      expect(threadMessages(msp, 'OUTBOUND')).toHaveLength(1)
      expect(built.providerCalls).toHaveLength(1)
      expect(deliveries).toHaveLength(1)
      // The reclaim replayed the read and found the append receipt; it made no append.
      expect(memoryWire()).toEqual(['read memory-read', 'receipt memory-append'])
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
        .toMatchObject({ status: 'RECORDED', answerText: threadMessages(msp, 'OUTBOUND')[0].text })
    })

    it('killed after the read: the reclaim replays the same context packet and MSP is not read again', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const built = build({ msp })
      const first = await createConversationRuntime({ claimantId: 'runtime-memory-killed-after-read',
        ports: mortal(built.ports, name => name === 'memory.read') }).runOne()
      expect(first).toMatchObject({ jobId, code: 'RUNTIME_KILLED' })
      expect(built.providerCalls).toEqual([])

      await expireLease(jobId)
      const second = await createConversationRuntime({ ports: built.ports, claimantId: 'runtime-memory-read-reclaimer' }).runOne()
      expect(second).toMatchObject({ jobId, status: 'RECORDED' })
      expect(mspNames(msp)).toEqual(['resolve', 'append INBOUND', 'resolve', 'context',
        'injection RESOLVED', 'injection SUBMITTED', 'injection COMPLETED', 'append OUTBOUND'])
      expect(built.providerCalls).toHaveLength(1)
      expect(msp.injections[0].packetHash).toBe(sha256(JSON.stringify(built.modelInputs[0].contextPacket)))
    })

    it('a lost MSP append response is retried once under the same source event id and MSP keeps one message', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      let lost = 0
      msp.hooks.after = (name, input) => {
        if (name === 'msp_thread_message_append' && input.direction === 'OUTBOUND' && lost++ === 0) throw transportError()
      }
      const { ports } = build({ msp })
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-lost-append' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'RECORDED' })
      const outboundCalls = msp.calls.filter(call => call.name === 'msp_thread_message_append' && call.input.direction === 'OUTBOUND')
      expect(outboundCalls).toHaveLength(2)
      expect(new Set(outboundCalls.map(call => call.input.source_event_id)).size).toBe(1)
      expect(threadMessages(msp, 'OUTBOUND')).toHaveLength(1)
      expect(deliveries).toHaveLength(1)
      expect(memoryWire()).toEqual(['read memory-read', 'receipt memory-injection RESOLVED', 'receipt memory-injection SUBMITTED',
        'receipt memory-injection COMPLETED', 'receipt memory-append', 'append memory-append', 'receipt memory-append', 'append memory-append'])
    })
  })

  it('agrees with Core and the published v1 schema on which memory requests are valid', async () => {
    const { core } = build({ msp: createFakeMsp() })
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validateEnvelope = ajv.compile(schema)
    const claim = { jobId: 'synthetic-memory-parity-job', executionId: 'execution', claimantId: 'claimant', version: 1,
      tenantId: 'tenant', businessId: 'business', accountId: 'account' }
    const model = { provider: 'openrouter', model: 'test-model' }
    const cases = [
      ['read, empty input', 'read', 'synthetic-memory-parity-job:memory-read', {}, true],
      ['read, any field', 'read', 'synthetic-memory-parity-job:memory-read', { threadId: 'forged' }, false],
      ['append, text', 'append', 'synthetic-memory-parity-job:memory-append', { text: 'answer' }, true],
      ['append, 5000 chars', 'append', 'synthetic-memory-parity-job:memory-append', { text: 'x'.repeat(5000) }, true],
      ['append, 5001 chars', 'append', 'synthetic-memory-parity-job:memory-append', { text: 'x'.repeat(5001) }, false],
      ['append, blank text', 'append', 'synthetic-memory-parity-job:memory-append', { text: '   ' }, false],
      ['append, missing text', 'append', 'synthetic-memory-parity-job:memory-append', {}, false],
      ['append, forged thread', 'append', 'synthetic-memory-parity-job:memory-append', { text: 'answer', threadId: 'forged' }, false],
      ['receipt, lookup', 'receipt', 'synthetic-memory-parity-job:memory-append', {}, true],
      ['receipt, injection state', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'SUBMITTED', model }, true],
      ['receipt, state without model', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'COMPLETED' }, false],
      ['receipt, model without state', 'receipt', 'synthetic-memory-parity-job:memory-injection', { model }, false],
      ['receipt, unknown state', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'DELETED', model }, false],
      ['receipt, extra model field', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'RESOLVED', model: { ...model, apiKey: 'x' } }, false],
      ['receipt, provider over 32', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'RESOLVED', model: { provider: 'p'.repeat(33), model: 'm' } }, false],
      ['receipt, actor field', 'receipt', 'synthetic-memory-parity-job:memory-append', { actor: 'forged' }, false],
      ['operation id with space', 'read', 'synthetic-memory-parity-job memory-read', {}, false],
      ['unknown operation', 'erase', 'synthetic-memory-parity-job:memory-erase', {}, false],
    ]
    const verdicts = []
    for (const [label, operation, operationId, input, expected] of cases) {
      let runtime = true
      try { validateMemoryRequest({ operation, operationId, input }) } catch { runtime = false }
      const envelope = { contractVersion: 'conversation-runtime.v1', operation: 'memory',
        correlationId: 'synthetic-memory-parity', idempotencyKey: 'synthetic-memory-parity-op',
        deadlineAt: new Date(Date.now() + 30_000).toISOString(), payload: { claim, operation, operationId, input } }
      const published = validateEnvelope(envelope)
      const response = await core.handle(new Request('http://core.invalid/api/internal/conversation-runtime/v1/memory', {
        method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(envelope) }), { operation: 'memory' })
      const body = await response.json()
      const provider = response.status !== 400
      if (provider) expect(body.error.code, label).toBe('CONVERSATION_JOB_AUTHORITY_REVOKED')
      else expect(body.error.code, label).toMatch(/^MEMORY_(REQUEST|INPUT)_INVALID$/)
      verdicts.push({ label, runtime, provider, published })
    }
    expect(verdicts).toEqual(cases.map(([label, , , , expected]) => ({ label, runtime: expected, provider: expected, published: expected })))
  })
})
