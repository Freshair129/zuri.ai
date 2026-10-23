import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { reconcileLineMemoryDeliveries } from '@/modules/line-oa-studio/application/line-memory-delivery'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { createServerLineThreadMemory } from '@/modules/line-oa-studio/application/server-line-runtime'
import { createMspThreadMemoryPort } from '@/modules/agent/msp-thread-memory-port'
import { createMspMemoryPort } from '@/modules/agent/msp-memory-port'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { appendTraceEvent, TRACE_EVENT_KINDS } from '@/modules/agent/execution-trace'
import { memoryReceiptKey, memoryTextSha256 } from '@/modules/line-oa-studio/application/runtime-memory-receipts'
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
// Ordinary metadata turns exercise this suite; dedicated stock/price tests cover the fixed owner path.
// @tested tests/integration/conversation-runtime-memory.test.js
const serviceToken = 'synthetic-memory-runtime-core-token-00001'
const mspServiceKey = 'synthetic-msp-thread-service-key-00000001'
const providerKey = 'synthetic-memory-provider-key'
const sealKey = '6d'.repeat(32)
const lineUser = 'synthetic-memory-line-user'
const question = 'ขอชื่อสินค้า A1'
const evidenceRecords = [{ product_code: 'A1', name: 'สินค้าทดสอบ', sell_price: 12 }]
const providerReply = { choices: [{ message: { content: 'คำตอบจากโมเดล' } }] }
const schema = JSON.parse(readFileSync(new URL(
  '../../../../services/conversation-runtime/contracts/v1/operation.schema.json', import.meta.url), 'utf8'))

let tenant, business, workspace, project, account, actor
let switchBusiness, switchWorkspace, switchProject, switchAccount
let wire = []
let deliveries = []
let openJobs = []
let eventSequence = 0

const transportError = () => Object.assign(new Error('MSP request timed out: tools/call'), { code: 'MSP_TRANSPORT_UNAVAILABLE', status: 503 })
const killed = () => Object.assign(new Error('RUNTIME_KILLED'), { code: 'RUNTIME_KILLED' })
const sha256 = value => createHash('sha256').update(value).digest('hex')

function contextPacketSources(packet) {
  const memory = packet?.memory ?? {}
  const slice = (id, value) => ({ id, text: typeof value === 'string' ? value : JSON.stringify(value) })
  const list = key => Array.isArray(memory[key]) ? memory[key] : []
  return [
    ...list('participants').map((item, index) => slice(`participant:${item?.principalId ?? item?.id ?? index}`, item)),
    ...list('protectedMemory').map((item, index) => slice(`protected:${item?.recordId ?? index}`, item)),
    ...[...list('recentExchanges')].reverse().map((item, index) => slice(`exchange:${item?.exchangeId ?? index}`, item)),
    ...list('summaries').map((item, index) => slice(`summary:${item?.summaryId ?? index}`, item)),
    ...list('episodic').map((item, index) => slice(`episodic:${item?.id ?? item?.reference?.memoryId ?? index}`, item)),
  ]
}

function contextReceiptForPacket(packet, receiptId) {
  const slices = contextPacketSources(packet)
  const refs = { msp: slices.map(item => item.id), citations: [], records: [] }
  const budget = { max: 32_000, used: slices.reduce((sum, item) => sum + item.text.length, 0), trimmed: 0 }
  const dropped = []
  const facts = { refs, budget, dropped }
  return { receiptId, ...facts, hash: sha256(JSON.stringify(facts)) }
}

async function appendContextReceipt(ports, claim, packet, receipt) {
  return ports.trace.append(claim, { kind: 'CONTEXT_RECEIPT', payload: receipt,
    contextBinding: { contextReceiptId: receipt.receiptId, contextReceiptHash: receipt.hash, contextPacket: packet } })
}

function flatContextPacket(slices) {
  let startByte = 0
  const sourceSegments = slices.map((slice, index) => {
    if (index > 0) startByte += Buffer.byteLength('\n', 'utf8')
    const byteLength = Buffer.byteLength(slice.text, 'utf8')
    const segment = { id: slice.id, startByte, byteLength }
    startByte += byteLength
    return segment
  })
  return { policyDecision: 'ALLOW', text: slices.map(slice => slice.text).join('\n'), sourceSegments }
}

function runtimeThreadPacket(packet) {
  if (!packet) return null
  const memory = packet.memory ?? {}
  const list = key => Array.isArray(memory[key]) ? memory[key] : []
  return { ...packet, knowledge: null, memory: { ...memory, participants: list('participants'),
    protectedMemory: list('protectedMemory'), recentExchanges: list('recentExchanges'), summaries: list('summaries'), episodic: list('episodic') } }
}

function contextReceiptForSlices(slices, receiptId) {
  const refs = { msp: slices.map(slice => slice.id), citations: [], records: [] }
  const budget = { max: 4_000, used: slices.reduce((sum, slice) => sum + slice.text.length, 0), trimmed: 0 }
  const dropped = []
  const facts = { refs, budget, dropped }
  return { receiptId, ...facts, hash: sha256(JSON.stringify(facts)) }
}

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
      const message = messages.find(item => item.sourceEventId === input.source_event_id)
      return { receiptId: input.receipt_id, ...(message ? { messageId: message.messageId } : {}), outcome: 'ACCEPTED' }
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

function inProcessFetch(handlers, beforeOperation) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    if (init.body) {
      const envelope = JSON.parse(init.body)
      wire.push({ operation: envelope.operation, payload: envelope.payload, idempotencyKey: envelope.idempotencyKey })
      await beforeOperation?.(envelope.operation, envelope.payload)
    }
    const request = new Request(target, init)
    return operation === 'health'
      ? handlers.GET(request, { params: { operation } })
      : handlers.POST(request, { params: { operation } })
  }
}

function build({ msp, env = {}, records = evidenceRecords, threadMemoryFactory, coreOptions = {}, onModelGenerate,
  beforeOperation } = {}) {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey,
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true', ...env },
    credentialResolver: async () => ({ provider: 'openrouter', model: 'test-model', apiKey: providerKey }),
    prepareTurn: async job => ({ question: job.inbound.body, evidence: { records }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 4_000, workCommand: null }),
    threadMemoryFactory: threadMemoryFactory ?? (msp ? () => mspPort(msp) : null),
    linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-memory-reply' } } },
      pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-memory-push' } } } }),
    ...coreOptions })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core), beforeOperation) })
  const providerCalls = []
  const modelInputs = []
  const provider = createModelPort({ timeoutMs: 1000, fetchFn: captureFetch(providerCalls) })
  const ports = createCorePorts({ client, model: { generate: async input => {
    modelInputs.push(input)
    await onModelGenerate?.(input)
    return provider.generate(input)
  } } })
  return { core, ports, providerCalls, modelInputs }
}

async function expectPersistedContextBinding(jobId, receipt, packet) {
  const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId }, select: { executionId: true } })
  const receiptRows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' },
    select: { executionId: true, payloadJson: true } })
  expect(receiptRows).toHaveLength(1)
  expect(receiptRows[0].executionId).toBe(job.executionId)
  expect(JSON.parse(receiptRows[0].payloadJson)).toEqual(receipt)
  expect(Object.keys(JSON.parse(receiptRows[0].payloadJson)).sort())
    .toEqual(['budget', 'dropped', 'hash', 'receiptId', 'refs'])

  const bindingKey = `${jobId}:core-memory:runtime-context-binding:${job.executionId}:MEMORY_THREAD_READ`
  const bindingRows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_THREAD_READ',
    idempotencyKey: bindingKey }, select: { executionId: true, payloadJson: true } })
  expect(bindingRows).toHaveLength(1)
  expect(bindingRows[0].executionId).toBe(job.executionId)
  const binding = JSON.parse(bindingRows[0].payloadJson)
  expect(binding).toEqual({ source: 'CONTEXT_RECEIPT_BINDING', executionId: job.executionId,
    receiptId: receipt.receiptId, receiptHash: receipt.hash,
    packetHash: packet === null ? null : sha256(JSON.stringify(packet)), mspRefs: receipt.refs.msp })
  expect(JSON.stringify(binding)).not.toContain('authorized episodic fact')
  return binding
}

async function prepareMemoryTurn(ports, claim) {
  const authority = await ports.authority.resolve(claim)
  await ports.context.prepare(claim, authority)
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

async function admit({ memory = true, text = question, selectedAccount = account } = {}) {
  const eventId = `synthetic-memory-event-${++eventSequence}`
  const current = await prisma.lineOaAccount.findUnique({ where: { id: selectedAccount.id } })
  if (!memory) await prisma.lineOaAccount.update({ where: { id: selectedAccount.id }, data: { memoryPolicy: 'OFF' } })
  let jobId
  try {
    const admitted = await admitLineConversation({ db: prisma, account: current,
      env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey, ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' },
      correlationId: eventId, now: new Date(),
      event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
        source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
    jobId = admitted.jobId
  } finally {
    if (!memory) await prisma.lineOaAccount.update({ where: { id: selectedAccount.id }, data: { memoryPolicy: 'ON' } })
  }
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
  const answer = createServerLineAnswer({ env: { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' }, threadMemory: msp ? mspPort(msp) : null,
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
  workspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: business.id,
    name: 'Runtime memory workspace', code: 'WS-CR-MEM' })
  const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  project = await createProject({ workspaceId: workspace.id, businessId: business.id,
    name: 'Runtime memory project', code: 'PR-CR-MEM' }, { viewer: owner })
  switchBusiness = await createBusiness({ tenantId: tenant.id, name: 'Runtime memory switch business', code: 'BUS-CR-MEM-SWITCH' })
  switchWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: switchBusiness.id,
    name: 'Runtime memory switch workspace', code: 'WS-CR-MEM-SWITCH' })
  const switchOwner = makeViewer({ visibleBusinessIds: [switchBusiness.id], ownedBusinessIds: [switchBusiness.id] })
  switchProject = await createProject({ workspaceId: switchWorkspace.id, businessId: switchBusiness.id,
    name: 'Runtime memory switch project', code: 'PR-CR-MEM-SWITCH' }, { viewer: switchOwner })
  actor = await prisma.person.create({ data: { code: 'PER-CR-MEM', displayName: 'Synthetic memory customer' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: switchBusiness.id, role: 'MEMBER' } })
  await prisma.customer.create({ data: { code: 'CUS-CR-MEM', tenantId: tenant.id, businessId: null,
    personId: actor.id, displayName: 'Consented memory customer', consentStatus: 'GRANTED' } })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: 'Synthetic memory LINE connection', externalAccountId: 'synthetic-memory-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-memory-account', displayName: 'Synthetic memory OA',
    bindingCode: 'cr-memory-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner: 'CONVERSATION_RUNTIME', memoryPolicy: 'ON', memoryProjectId: project.id } })
  const switchConnection = await createIntegrationConnection({ tenantId: tenant.id, businessId: switchBusiness.id,
    providerId: provider.id, name: 'Synthetic memory switch LINE connection', externalAccountId: 'synthetic-memory-destination-switch', status: 'ACTIVE' })
  switchAccount = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: switchBusiness.id,
    integrationConnectionId: switchConnection.id, code: 'cr-memory-account-switch', displayName: 'Synthetic memory switch OA',
    bindingCode: 'cr-memory-binding-switch', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner: 'CONVERSATION_RUNTIME', memoryPolicy: 'ON', memoryProjectId: switchProject.id } })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: switchAccount.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_MEMORY_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  wire = []
  deliveries = []
  await prisma.business.update({ where: { id: business.id }, data: { status: 'ACTIVE' } })
  await prisma.business.update({ where: { id: switchBusiness.id }, data: { status: 'ACTIVE' } })
  await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
    tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: lineUser } },
  data: { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() } })
  await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
    tenantId: tenant.id, channel: 'LINE', channelAccountId: switchAccount.bindingCode, providerSubject: lineUser } },
  data: { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() } })
})

describe('Conversation Runtime memory-sync turns', () => {
  it('routes the same principal A to B to A through each Business memory scope', async () => {
    const episodicScopes = []
    const episodicCalls = []
    const episodicMemory = createMspMemoryPort({
      vaultSetResolver: { resolve: async authorization => {
        const scope = authorization.authContext.scope
        episodicScopes.push({ ...scope, principalId: authorization.authContext.actor.principalId,
          episodicMemoryAllowed: authorization.authContext.policy.episodicMemoryAllowed })
        return { workspacePrivateVaultId: `api010-${scope.businessId}`,
          globalPrivateVaultIds: ['api010-global-fallback'], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.RUNTIME-SWITCH' } }
      } },
      transport: async (name, input) => {
        episodicCalls.push({ name, input })
        if (name !== 'msp_memory_list') return {}
        return { entities: [{ entity_id: `episode-${input.vault_id}`, vault_id: input.vault_id, current_version: 1,
          body_json: { fact: `private fact for ${input.vault_id}` }, source_hash: 'b'.repeat(64),
          recorded_at: '2026-10-04T00:00:00.000Z' }] }
      },
    })
    const msp = createFakeMsp()
    const built = build({ msp, env: { ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true' }, coreOptions: {
      businessPorts: async () => ({ episodicMemory }),
      memoryAuthorizationResolver: resolveAgentAuthorization,
    } })
    const turns = [
      { selectedAccount: account, businessId: business.id, workspaceId: workspace.id, projectId: project.id },
      { selectedAccount: switchAccount, businessId: switchBusiness.id, workspaceId: switchWorkspace.id, projectId: switchProject.id },
      { selectedAccount: account, businessId: business.id, workspaceId: workspace.id, projectId: project.id },
    ]
    const jobIds = []
    for (const [index, turn] of turns.entries()) {
      const jobId = await admit({ selectedAccount: turn.selectedAccount })
      jobIds.push(jobId)
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({
        tenantId: tenant.id, businessId: turn.businessId, memorySyncOptIn: true, episodicMemoryOptIn: true,
        episodicWorkspaceId: turn.workspaceId, episodicProjectId: turn.projectId,
      })
      const outcome = await createConversationRuntime({ ports: built.ports,
        claimantId: `runtime-memory-business-switch-${index + 1}` }).runOne()
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ jobId, status: 'RECORDED' })
    }

    expect(jobIds).toHaveLength(3)
    expect(episodicScopes).toEqual([
      { tenantId: tenant.id, businessId: business.id, workspaceId: workspace.id, projectId: project.id,
        principalId: actor.id, episodicMemoryAllowed: true },
      { tenantId: tenant.id, businessId: switchBusiness.id, workspaceId: switchWorkspace.id, projectId: switchProject.id,
        principalId: actor.id, episodicMemoryAllowed: true },
      { tenantId: tenant.id, businessId: business.id, workspaceId: workspace.id, projectId: project.id,
        principalId: actor.id, episodicMemoryAllowed: true },
    ])
    expect(episodicCalls.filter(call => call.name === 'msp_memory_list').map(call => call.input.vault_id))
      .toEqual([`api010-${business.id}`, `api010-${switchBusiness.id}`, `api010-${business.id}`])
    const modelPackets = built.modelInputs.map(input => JSON.stringify(input.contextPacket))
    expect(modelPackets[0]).toContain(`private fact for api010-${business.id}`)
    expect(modelPackets[1]).toContain(`private fact for api010-${switchBusiness.id}`)
    expect(modelPackets[1]).not.toContain(`private fact for api010-${business.id}`)
    expect(modelPackets[2]).toContain(`private fact for api010-${business.id}`)
    expect(modelPackets[2]).not.toContain(`private fact for api010-${switchBusiness.id}`)

    const resolutions = msp.calls.filter(call => call.name === 'msp_thread_resolve')
    expect(resolutions.map(call => call.input.business_id)).toEqual([
      business.id, business.id, switchBusiness.id, switchBusiness.id, business.id, business.id,
    ])
    const contexts = msp.calls.filter(call => call.name === 'msp_thread_context')
    expect(contexts).toHaveLength(3)
    expect(contexts[0].input.thread_id).toBe(contexts[2].input.thread_id)
    expect(contexts[0].input.thread_id).not.toBe(contexts[1].input.thread_id)
  })

  it('admits a memory-sync opt-in direct message to the runtime cohort', async () => {
    const jobId = await admit()
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({
      executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true, status: 'QUEUED' })
    // A corpus-grounding account's memory turns join the cohort too (W12): Core
    // composes GKS evidence and thread memory under one budget in `memory read`.
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'GKS_CORPUS' } })
    try {
      const corpusJobId = await admit()
      expect(await prisma.lineConversationJob.findUnique({ where: { id: corpusJobId } }))
        .toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true })
      const plainJobId = await admit({ memory: false })
      expect(await prisma.lineConversationJob.findUnique({ where: { id: plainJobId } }))
        .toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: false })
    } finally {
      await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } })
    }
  })

  it('recalls API-010 episodic memory with API-011 disabled and makes no thread-memory call or append', async () => {
    const jobId = await admit()
    const admitted = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    expect(admitted).toMatchObject({ episodicMemoryOptIn: true, episodicWorkspaceId: workspace.id, episodicProjectId: project.id })
    const episodicCalls = []
    const episodicMemory = createMspMemoryPort({
      vaultSetResolver: { resolve: async authorization => {
        expect(authorization.policy.episodicMemoryAllowed).toBe(true)
        return { workspacePrivateVaultId: 'api010-private-vault', globalPrivateVaultIds: [], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.fixture' } }
      } },
      transport: async (name, input) => {
        episodicCalls.push({ name, input })
        return name === 'msp_memory_list' ? { entities: [{ entity_id: 'episode-1', vault_id: 'api010-private-vault',
          current_version: 1, body_json: { fact: 'authorized episodic fact' }, source_hash: 'e'.repeat(64),
          recorded_at: '2026-10-04T00:00:00.000Z' }] } : {}
      },
    })
    let bindingAtProvider = null
    const built = build({ onModelGenerate: async input => {
      bindingAtProvider = await expectPersistedContextBinding(jobId, input.contextReceipt, input.contextPacket)
    }, coreOptions: {
      env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey,
        ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true', ZURI_MSP_THREAD_MEMORY_ENABLED: 'false' },
      businessPorts: async () => ({ episodicMemory }),
      threadMemoryFactory: () => { throw new Error('API_011_MUST_STAY_DISABLED') },
    } })

    const outcome = await createConversationRuntime({ ports: built.ports, claimantId: 'runtime-api010-independent' }).runOne()

    expect(outcome).toMatchObject({ jobId, status: 'RECORDED' })
    expect(episodicCalls.map(call => call.name)).toEqual(['msp_memory_list'])
    expect(built.modelInputs).toHaveLength(1)
    expect(built.providerCalls).toHaveLength(1)
    expect(JSON.stringify(built.modelInputs[0].contextPacket)).toContain('authorized episodic fact')
    expect(built.modelInputs[0].contextReceipt.refs.msp).toEqual(built.modelInputs[0].contextPacket.sourceSegments.map(segment => segment.id))
    expect(bindingAtProvider).toMatchObject({ source: 'CONTEXT_RECEIPT_BINDING',
      mspRefs: built.modelInputs[0].contextReceipt.refs.msp, packetHash: sha256(JSON.stringify(built.modelInputs[0].contextPacket)) })
    expect(memoryWire()).toEqual([])
  })

  it('revalidates API-010 authorization on the final Core resolve after binding and before provider entry', async () => {
    const jobId = await admit()
    let episodicAllowed = true
    let revokedAfterBinding = false
    const episodicMemory = createMspMemoryPort({
      vaultSetResolver: { resolve: async authorization => {
        expect(authorization.policy.episodicMemoryAllowed).toBe(true)
        return { workspacePrivateVaultId: 'api010-private-vault', globalPrivateVaultIds: [], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.fixture' } }
      } },
      transport: async name => name === 'msp_memory_list' ? { entities: [{ entity_id: 'episode-1', vault_id: 'api010-private-vault',
        current_version: 1, body_json: { fact: 'authorized episodic fact' }, source_hash: 'e'.repeat(64),
        recorded_at: '2026-10-04T00:00:00.000Z' }] } : {},
    })
    const built = build({ beforeOperation: async (operation, payload) => {
      if (operation !== 'resolve' || revokedAfterBinding) return
      const bindingKey = `${jobId}:core-memory:runtime-context-binding:${payload.claim.executionId}:MEMORY_THREAD_READ`
      const binding = await prisma.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
        tenantId: tenant.id, businessId: business.id, idempotencyKey: bindingKey } } })
      if (binding) { episodicAllowed = false; revokedAfterBinding = true }
    }, coreOptions: {
      env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey,
        ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true', ZURI_MSP_THREAD_MEMORY_ENABLED: 'false' },
      businessPorts: async () => ({ episodicMemory }),
      memoryAuthorizationResolver: async input => {
        const resolved = await resolveAgentAuthorization(input)
        if (episodicAllowed) return resolved
        const policy = { ...resolved.policy, episodicMemoryAllowed: false }
        return { ...resolved, policy,
          authContext: { ...resolved.authContext, policy: { ...resolved.authContext.policy, episodicMemoryAllowed: false } } }
      },
      threadMemoryFactory: () => { throw new Error('API_011_MUST_STAY_DISABLED') },
    } })

    const outcome = await createConversationRuntime({ ports: built.ports, claimantId: 'runtime-api010-policy-revoked' }).runOne()

    expect(revokedAfterBinding).toBe(true)
    expect(outcome).toMatchObject({ jobId, status: 'FAILED' })
    expect(built.modelInputs).toEqual([])
    expect(built.providerCalls).toEqual([])
    expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' } })).toHaveLength(1)
    expect(memoryWire()).toEqual([])
  })

  it('Core refuses an API-010 packet whose source bytes differ from its prepared manifest', async () => {
    const jobId = await admit()
    const episodicMemory = createMspMemoryPort({
      vaultSetResolver: { resolve: async authorization => {
        expect(authorization.policy.episodicMemoryAllowed).toBe(true)
        return { workspacePrivateVaultId: 'api010-private-vault', globalPrivateVaultIds: [], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.fixture' } }
      } },
      transport: async name => name === 'msp_memory_list' ? { entities: [{ entity_id: 'episode-1', vault_id: 'api010-private-vault',
        current_version: 1, body_json: { fact: 'authorized episodic fact' }, source_hash: 'e'.repeat(64),
        recorded_at: '2026-10-04T00:00:00.000Z' }] } : {},
    })
    const built = build({ coreOptions: {
      env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey,
        ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true', ZURI_MSP_THREAD_MEMORY_ENABLED: 'false' },
      businessPorts: async () => ({ episodicMemory }),
      threadMemoryFactory: () => { throw new Error('API_011_MUST_STAY_DISABLED') },
    } })
    const claim = await built.ports.job.claim({ claimantId: 'runtime-api010-altered-binding' })
    const authority = await built.ports.authority.resolve(claim)
    const turn = await built.ports.context.prepare(claim, authority)
    const slices = turn.slices.filter(slice => slice.source === 'MSP')
    expect(slices.map(slice => slice.id)).toContain('episodic:0')
    const receipt = contextReceiptForSlices(slices, `ctxrcpt_${randomUUID()}`)
    const altered = flatContextPacket(slices)
    altered.text += ' forged'

    await expect(appendContextReceipt(built.ports, claim, altered, receipt))
      .rejects.toMatchObject({ code: 'MEMORY_CONTEXT_RECEIPT_MISMATCH' })
    expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' } })).toHaveLength(0)
    const bindingRows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_THREAD_READ' },
      select: { payloadJson: true } })
    expect(bindingRows.map(row => JSON.parse(row.payloadJson)).some(payload => payload.source === 'CONTEXT_RECEIPT_BINDING')).toBe(false)
  })

  it('does not send API-010 context to the model when erasure commits during recall', async () => {
    const jobId = await admit()
    const episodicCalls = []
    const episodicMemory = createMspMemoryPort({
      vaultSetResolver: { resolve: async authorization => {
        expect(authorization.policy.episodicMemoryAllowed).toBe(true)
        return { workspacePrivateVaultId: 'api010-private-vault', globalPrivateVaultIds: [], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.fixture' } }
      } },
      transport: async (name, input) => {
        episodicCalls.push({ name, input })
        if (name === 'msp_memory_list') {
          const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
          const inbound = await prisma.message.findUnique({ where: { id: job.inboundMessageId } })
          await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id,
            conversationIds: [inbound.conversationId] }))
          return { entities: [{ entity_id: 'episode-after-erasure', vault_id: 'api010-private-vault',
            current_version: 1, body_json: { fact: 'must not reach the model' }, source_hash: 'a'.repeat(64),
            recorded_at: '2026-10-04T00:00:00.000Z' }] }
        }
        return {}
      },
    })
    const built = build({ coreOptions: {
      env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey,
        ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true', ZURI_MSP_THREAD_MEMORY_ENABLED: 'false' },
      businessPorts: async () => ({ episodicMemory }),
      threadMemoryFactory: () => { throw new Error('API_011_MUST_STAY_DISABLED') },
    } })

    const outcome = await createConversationRuntime({ ports: built.ports, claimantId: 'runtime-api010-erasure-race' }).runOne()

    expect(outcome.status).not.toBe('RECORDED')
    expect(episodicCalls.map(call => call.name)).toEqual(['msp_memory_list'])
    expect(built.providerCalls).toEqual([])
    expect(built.modelInputs).toEqual([])
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
      .toMatchObject({ status: 'CANCELLED', errorCode: 'PDPA_ERASURE', episodicMemoryOptIn: false })
    expect(memoryWire()).toEqual([])
  })

  it('composes GKS evidence with API-010 under one budget while API-011 is disabled', async () => {
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'GKS_CORPUS' } })
    try {
      const jobId = await admit()
      const episodicCalls = []
      const episodicMemory = createMspMemoryPort({
        vaultSetResolver: { resolve: async authorization => {
          expect(authorization.policy.episodicMemoryAllowed).toBe(true)
          return { workspacePrivateVaultId: 'api010-private-vault', globalPrivateVaultIds: [], sharedVaultIds: [],
            permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.fixture' } }
        } },
        transport: async (name, input) => {
          episodicCalls.push({ name, input })
          return name === 'msp_memory_list' ? { entities: [{ entity_id: 'episode-gks', vault_id: 'api010-private-vault',
            current_version: 1, body_json: { fact: 'authorized episodic fact beside corpus evidence' },
            source_hash: 'f'.repeat(64), recorded_at: '2026-10-04T00:00:00.000Z' }] } : {}
        },
      })
      const corpusRecords = [{ citationId: 'gks-citation-1', text: 'published GKS product fact' }]
      const coreOptions = {
        env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey,
          ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true', ZURI_MSP_THREAD_MEMORY_ENABLED: 'false' },
        prepareTurn: undefined,
        corpusReaderFactory: () => ({ query: async () => ({ records: corpusRecords }) }),
        businessPorts: async () => ({ businessKnowledge: { query: async () => ({ records: [] }) }, episodicMemory }),
        threadMemoryFactory: () => { throw new Error('API_011_MUST_STAY_DISABLED') },
      }
      const built = build({ coreOptions })

      const outcome = await createConversationRuntime({ ports: built.ports, claimantId: 'runtime-api010-gks-independent' }).runOne()

      expect(outcome).toMatchObject({ jobId, status: 'RECORDED' })
      expect(episodicCalls.map(call => call.name)).toEqual(['msp_memory_list'])
      expect(memoryWire()).toEqual([])
      expect(built.modelInputs).toHaveLength(1)
      expect(built.modelInputs[0].evidence.records).toEqual(corpusRecords)
      expect(built.modelInputs[0].contextPacket.text).not.toContain('published GKS product fact')
      expect(built.modelInputs[0].contextPacket.text).toContain('authorized episodic fact beside corpus evidence')
      expect(built.modelInputs[0].contextReceipt.refs.citations).toEqual(['gks-citation-1'])
      expect(built.modelInputs[0].contextReceipt.refs.msp.some(id => id.startsWith('episodic:'))).toBe(true)

      const noEvidenceJobId = await admit()
      corpusRecords[0] = { ...corpusRecords[0], text: 'oversized corpus record '.repeat(250) }
      const noEvidenceBuilt = build({ coreOptions })
      const noEvidenceOutcome = await createConversationRuntime({ ports: noEvidenceBuilt.ports,
        claimantId: 'runtime-api010-gks-budget' }).runOne()

      expect(noEvidenceOutcome).toMatchObject({ jobId: noEvidenceJobId, status: 'RECORDED' })
      expect(noEvidenceBuilt.modelInputs).toEqual([])
      expect(JSON.stringify(deliveries.at(-1))).toContain('ยังไม่พบข้อมูลสินค้า')
    } finally {
      await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } })
    }
  })

  it('records one canonical pre-provider receipt and binds API-010/API-011 injection to the exact bounded packet', async () => {
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding: 'GKS_CORPUS' } })
    try {
      const jobId = await admit()
      const msp = createFakeMsp()
      const episodicMemory = createMspMemoryPort({
        vaultSetResolver: { resolve: async () => ({ workspacePrivateVaultId: 'api010-receipt-vault',
          globalPrivateVaultIds: [], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.RECEIPT' } }) },
        transport: async name => name === 'msp_memory_list' ? { entities: [{ entity_id: 'episode-receipt',
          vault_id: 'api010-receipt-vault', current_version: 1,
          body_json: { fact: 'authorized API-010 fact for receipt binding' }, source_hash: 'e'.repeat(64),
          recorded_at: '2026-10-04T00:00:00.000Z' }] } : {},
      })
      const corpusRecords = Array.from({ length: 12 }, (_, index) => ({
        citationId: `gks-receipt-${index + 1}`, text: `published GKS fact ${index + 1} ${'x'.repeat(2_800)}`,
      }))
      msp.hooks.after = (name, _input, result) => {
        if (name === 'msp_thread_context') result.threadSummaries = [{ summaryId: 'large-summary', text: 'S'.repeat(28_500) }]
      }
      const built = build({ msp, env: { ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true' }, coreOptions: {
        prepareTurn: undefined,
        corpusReaderFactory: () => ({ query: async () => ({ records: corpusRecords }) }),
        threadMemoryFactory: () => createMspThreadMemoryPort({ transport: msp.transport, serviceKey: mspServiceKey,
          workspaceId: 'w5-workspace', maxContextBytes: 30_000 }),
        businessPorts: async () => ({ businessKnowledge: { query: async () => ({ records: [] }) }, episodicMemory }),
      } })

      const outcome = await createConversationRuntime({ ports: built.ports,
        claimantId: 'runtime-memory-canonical-receipt' }).runOne()

      expect(outcome, JSON.stringify({ outcome, memoryWire: memoryWire(), msp: mspNames(msp) })).toMatchObject({ jobId, status: 'RECORDED' })
      expect(built.providerCalls).toHaveLength(1)
      expect(built.modelInputs).toHaveLength(1)
      const modelInput = built.modelInputs[0]
      const receipt = modelInput.contextReceipt
      const readReceipt = JSON.parse((await prisma.agentTraceEvent.findFirst({ where: { turnId: jobId,
        idempotencyKey: memoryReceiptKey(jobId, 'read') }, select: { payloadJson: true } })).payloadJson)
      expect(readReceipt.contextReceiptId).toBe(receipt.receiptId)
      const executionId = (await prisma.lineConversationJob.findUnique({ where: { id: jobId }, select: { executionId: true } })).executionId
      const sourceManifest = JSON.parse((await prisma.agentTraceEvent.findFirst({ where: { turnId: jobId,
        idempotencyKey: `${jobId}:core-memory:runtime-context-sources:${executionId}:MEMORY_THREAD_READ` },
      select: { payloadJson: true } })).payloadJson)
      expect(Object.keys(receipt).sort()).toEqual(['budget', 'dropped', 'hash', 'receiptId', 'refs'])
      expect(receipt.receiptId).toMatch(/^ctxrcpt_[0-9a-f-]{36}$/)
      expect(Object.keys(receipt.refs).sort()).toEqual(['citations', 'msp', 'records'])
      expect(receipt.refs.citations).toEqual(modelInput.evidence.records.map(record => record.citationId))
      expect(receipt.refs.msp.some(id => id.startsWith('exchange:'))).toBe(true)
      expect(receipt.refs.msp.some(id => id.startsWith('episodic:'))).toBe(true)
      expect(modelInput.evidence.records.length).toBeLessThan(corpusRecords.length)
      expect(modelInput.evidence.records.every(record => corpusRecords.some(source =>
        JSON.stringify(source) === JSON.stringify(record)))).toBe(true)
      expect(JSON.stringify(modelInput.contextPacket)).toContain('authorized API-010 fact for receipt binding')
      expect(JSON.stringify(modelInput.contextPacket)).toContain('สวัสดีค่ะ')
      expect(modelInput.contextPacket.sourceSegments.map(segment => segment.id)).toEqual(receipt.refs.msp)
      const packetBytes = Buffer.from(modelInput.contextPacket.text, 'utf8')
      const sourceTexts = new Map(sourceManifest.slices.map(source => [source.id, source]))
      for (const slice of contextPacketSources(JSON.parse(readReceipt.contextPacketJson))) {
        sourceTexts.set(slice.id, { id: slice.id, byteLength: Buffer.byteLength(slice.text, 'utf8'),
          hash: sha256(slice.text), text: slice.text })
      }
      for (const segment of modelInput.contextPacket.sourceSegments) {
        const source = sourceTexts.get(segment.id)
        const spanText = packetBytes.subarray(segment.startByte, segment.startByte + segment.byteLength).toString('utf8')
        expect(segment.byteLength).toBe(source.byteLength)
        expect(sha256(spanText)).toBe(source.hash)
        if (source.text !== undefined) expect(spanText).toBe(source.text)
      }
      expect(JSON.stringify(receipt)).not.toContain('authorized API-010 fact for receipt binding')
      expect(JSON.stringify(receipt)).not.toContain('published GKS fact for receipt binding')
      const receiptFacts = { refs: receipt.refs, budget: receipt.budget, dropped: receipt.dropped }
      expect(receipt.hash).toBe(sha256(JSON.stringify(receiptFacts)))
      expect(receipt.budget.used).toBeLessThanOrEqual(receipt.budget.max)
      expect(receipt.budget.trimmed).toBe(receipt.dropped.filter(item => item.reason === 'BUDGET_TRIMMED').length)

      const traceReceipts = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' },
        select: { payloadJson: true } })
      expect(traceReceipts).toHaveLength(1)
      expect(JSON.parse(traceReceipts[0].payloadJson)).toEqual(receipt)
      const injectionTrace = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_INJECTION_RECORDED' },
        select: { payloadJson: true }, orderBy: { occurredAt: 'asc' } })
      expect(injectionTrace.map(row => JSON.parse(row.payloadJson))).toEqual(['RESOLVED', 'SUBMITTED', 'COMPLETED'].map(state => ({
        operationId: `${jobId}:memory-injection`, state, contextReceiptId: receipt.receiptId,
        contextReceiptHash: receipt.hash, packetHash: sha256(JSON.stringify(modelInput.contextPacket)),
      })))

      const injections = msp.injections.filter(item => item.state !== 'FAILED')
      expect(injections.map(item => item.state)).toEqual(['RESOLVED', 'SUBMITTED', 'COMPLETED'])
      expect(injections.every(item => item.injectionId === receipt.receiptId)).toBe(true)
      const packetHash = sha256(JSON.stringify(modelInput.contextPacket))
      expect(injections.every(item => item.packetHash === packetHash)).toBe(true)
      const injectionRequests = wire.filter(call => call.operation === 'memory'
        && call.payload.operation === 'receipt' && call.payload.input.state)
      expect(injectionRequests).toHaveLength(3)
      expect(injectionRequests.map(call => call.payload.input.contextReceiptId))
        .toEqual(Array(3).fill(receipt.receiptId))
      expect(injectionRequests.every(call => JSON.stringify(call.payload.input.contextPacket)
        === JSON.stringify(modelInput.contextPacket))).toBe(true)
      const receiptWireIndex = wire.findIndex(call => call.operation === 'trace' && call.payload.kind === 'CONTEXT_RECEIPT')
      const resolvedWireIndex = wire.findIndex(call => call.operation === 'memory' && call.payload.operation === 'receipt'
        && call.payload.input.state === 'RESOLVED')
      expect(receiptWireIndex).toBeGreaterThanOrEqual(0)
      expect(receiptWireIndex).toBeLessThan(resolvedWireIndex)
      expect(built.providerCalls[0].body).not.toContain('sourceSegments')
      expect(Buffer.byteLength(JSON.stringify(modelInput.evidence), 'utf8')).toBeLessThanOrEqual(32 * 1024)
      expect(Buffer.byteLength(JSON.stringify(modelInput.contextPacket), 'utf8')).toBeLessThanOrEqual(32 * 1024)
      const evidenceTrim = await prisma.agentTraceEvent.findFirst({ where: { turnId: jobId, kind: 'EVIDENCE_TRIMMED' },
        select: { payloadJson: true } })
      expect(JSON.parse(evidenceTrim.payloadJson)).toMatchObject({ phase: 'memory-read', recordsBefore: 12 })
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
    expect(outcome, JSON.stringify({ outcome, memoryWire: memoryWire(), msp: mspNames(runtimeMsp) })).toMatchObject({ jobId, status: 'RECORDED' })

    // Same MSP calls in the same order with the same inputs and signed claims.
    expect(mspNames(runtimeMsp)).toEqual(['resolve', 'append INBOUND', 'resolve', 'context',
      'injection RESOLVED', 'injection SUBMITTED', 'injection COMPLETED', 'append OUTBOUND'])
    expect(comparableCalls(runtimeMsp.calls)).toEqual(comparableCalls(legacyMsp.calls))
    expect(runtimeMsp.calls.every(call => typeof call.input.access?.signature === 'string')).toBe(true)
    expect(runtimeMsp.calls.every(call => call.input.access.grant.writePrivate !== true)).toBe(true)

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
    // The scanner is installation-wide by design and takes a bounded batch; other
    // suites in this run's shared database leave RECORDED memory jobs of their own
    // that could fill it. Scope only this test's view of the job table to its tenant
    // (the same pattern as line-server-backup.test.js).
    const jobsOfThisTenant = new Proxy(prisma.lineConversationJob, { get(target, prop) {
      if (prop !== 'findMany') { const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value }
      return (args = {}) => target.findMany({ ...args, where: { AND: [args.where ?? {}, { tenantId: tenant.id }, { id: jobId }] } })
    } })
    const scopedDb = new Proxy(prisma, { get(target, prop) {
      if (prop === 'lineConversationJob') return jobsOfThisTenant
      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const scanned = await reconcileLineMemoryDeliveries({ db: scopedDb, env: { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' }, threadMemory: mspPort(runtimeMsp), workerId: 'memory-scanner-w5' })
    expect(scanned.acknowledged, JSON.stringify(scanned)).toBe(1)
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
    let bindingAtProvider = null
    const { ports, modelInputs } = build({ msp, onModelGenerate: async input => {
      bindingAtProvider = await expectPersistedContextBinding(jobId, input.contextReceipt, input.contextPacket ?? null)
    } })
    const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-off' }).runOne()
    expect(outcome).toMatchObject({ jobId, status: 'RECORDED' })
    expect(memoryWire()).toEqual([])
    expect(msp.calls).toEqual([])
    expect(modelInputs).toHaveLength(1)
    expect(modelInputs[0].contextPacket).toBeNull()
    expect(modelInputs[0].contextReceipt.refs.msp).toEqual([])
    expect(bindingAtProvider).toMatchObject({ packetHash: null, mspRefs: [] })
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
    await expect(ports.memory.receipt(claim, 'injection', { state: 'RESOLVED' }))
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

    it('keeps an unknown SUBMITTED injection receipt UNKNOWN without starting the provider', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      msp.hooks.before = (name, input) => { if (name === 'msp_thread_injection_record' && input.state === 'SUBMITTED') throw transportError() }
      const { ports, providerCalls } = build({ msp })
      const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-memory-receipt-unknown' }).runOne()
      expect(outcome).toMatchObject({ jobId, status: 'UNKNOWN', code: 'MSP_INJECTION_RECEIPT_UNKNOWN' })
      expect(providerCalls).toHaveLength(0)
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(deliveries).toEqual([])
      // The legacy worker's durable outcome for the same failure.
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).toMatchObject({
        status: 'UNKNOWN', errorCode: 'MSP_INJECTION_RECEIPT_UNKNOWN', answerText: null })
      expect(await createConversationRuntime({ ports, claimantId: 'runtime-memory-receipt-unknown-2' }).runOne()).toEqual({ status: 'IDLE' })
      expect(providerCalls).toHaveLength(0)
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

    it.each([
      ['privateMemoryAllowed', { privateMemoryAllowed: false }],
      ['mspAuthorization.read', { mspAuthorization: { read: false } }],
    ])('rechecks API-011 private-memory permission before RESOLVED when %s is withdrawn after binding', async (_dimension, withdrawal) => {
      const jobId = await admit()
      const msp = createFakeMsp()
      let revoke = false
      let revokedAfterBinding = false
      const built = build({ msp, beforeOperation: async (operation, payload) => {
        if (operation !== 'memory' || payload.operation !== 'receipt' || payload.input.state !== 'RESOLVED'
          || revokedAfterBinding) return
        const bindingKey = `${jobId}:core-memory:runtime-context-binding:${payload.claim.executionId}:MEMORY_THREAD_READ`
        const binding = await prisma.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
          tenantId: tenant.id, businessId: business.id, idempotencyKey: bindingKey } } })
        expect(binding, 'the canonical context binding must be durable before the policy changes').not.toBeNull()
        revoke = true
        revokedAfterBinding = true
      }, coreOptions: { memoryAuthorizationResolver: async input => {
        const resolved = await resolveAgentAuthorization(input)
        if (!revoke) return resolved
        const policy = { ...resolved.policy, ...withdrawal,
          ...(withdrawal.mspAuthorization ? { mspAuthorization: { ...resolved.policy.mspAuthorization,
            ...withdrawal.mspAuthorization } } : {}) }
        const authPolicy = { ...resolved.authContext.policy, ...withdrawal,
          ...(withdrawal.mspAuthorization ? { mspAuthorization: { ...resolved.authContext.policy.mspAuthorization,
            ...withdrawal.mspAuthorization } } : {}) }
        return { ...resolved, policy, authContext: { ...resolved.authContext, policy: authPolicy } }
      } } })

      const outcome = await createConversationRuntime({ ports: built.ports,
        claimantId: `runtime-memory-${_dimension.replace('.', '-')}-revoked-before-resolved` }).runOne()

      expect(revokedAfterBinding).toBe(true)
      expect(outcome).toMatchObject({ jobId, status: 'FAILED', code: 'LINE_MEMORY_POLICY_REVOKED' })
      expect(built.modelInputs).toEqual([])
      expect(built.providerCalls).toEqual([])
      expect(msp.injections).toEqual([])
      expect(threadMessages(msp, 'OUTBOUND')).toEqual([])
      expect(deliveries).toEqual([])
      expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' } })).toHaveLength(1)
      const injectionRows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_INJECTION_RECORDED' } })
      expect(injectionRows).toEqual([])
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

  // Review of #588: the runtime must not forge Core-owned memory receipts or trace
  // kinds through `trace`; its content-free ContextReceipt is separately closed by
  // the canonical receipt validator. Core builds every MSP grant from its own route.
  describe('Core-owned receipts cannot be forged by the runtime', () => {
    const RUNTIME_KINDS = ['MODEL_STARTED', 'MODEL_COMPLETED', 'MODEL_FAILED', 'EXECUTION_FAILED', 'CONTEXT_COMMITTED', 'CONTEXT_RECEIPT']
    const traceRows = jobId => prisma.agentTraceEvent.findMany({ where: { turnId: jobId }, select: { kind: true, idempotencyKey: true } })

    it('refuses every Core-owned trace kind and every foreign operation id, and writes nothing', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-forge-kinds' })
      expect(claim.jobId).toBe(jobId)
      const before = await traceRows(jobId)
      const coreKinds = TRACE_EVENT_KINDS.filter(kind => !RUNTIME_KINDS.includes(kind))
      expect(coreKinds).toEqual(expect.arrayContaining(['MEMORY_THREAD_READ', 'MEMORY_THREAD_APPENDED', 'MEMORY_INJECTION_RECORDED',
        'RETENTION_TOMBSTONE', 'EVIDENCE_SELECTED', 'MEMORY_DELIVERY_ACKNOWLEDGED', 'OUTBOUND_RECORDED',
        'SEND_RESULT', 'MEMORY_WRITTEN', 'ANSWER_READY']))
      for (const kind of coreKinds) {
        await expect(ports.trace.append(claim, { kind, payload: { operationId: `${jobId}:memory-append`,
          textSha256: memoryTextSha256('forged answer') } }), kind).rejects.toMatchObject({ code: 'TRACE_KIND_NOT_PERMITTED' })
      }
      for (const [kind, operationId] of [['MODEL_COMPLETED', `${jobId}:memory-append`], ['MODEL_STARTED', `${jobId}:turn-answer`],
        ['MODEL_FAILED', `${jobId}:runtime-model`], ['EXECUTION_FAILED', `${jobId}:memory-read`], ['CONTEXT_COMMITTED', `${jobId}:turn-answer`],
        ['MODEL_COMPLETED', `other-job:runtime-model`]]) {
        await expect(ports.trace.append(claim, { kind, payload: { operationId, text: 'x' } }), `${kind} ${operationId}`)
          .rejects.toMatchObject({ code: 'TRACE_OPERATION_ID_INVALID' })
      }
      expect(await traceRows(jobId)).toEqual(before)
      expect(msp.calls).toEqual([])
    })

    it('a forged append receipt cannot complete a memory turn with no MSP append', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-forge-append' })
      const forged = { operationId: `${jobId}:memory-append`, textSha256: memoryTextSha256('forged answer') }
      await expect(ports.trace.append(claim, { kind: 'MEMORY_THREAD_APPENDED', payload: forged })).rejects.toMatchObject({ code: 'TRACE_KIND_NOT_PERMITTED' })
      // The runtime's own allowed events carry nothing Core reads as a memory receipt.
      await expect(ports.trace.append(claim, { kind: 'MODEL_COMPLETED', payload: { operationId: `${jobId}:runtime-model`,
        text: 'forged answer', textSha256: forged.textSha256 } })).rejects.toMatchObject({ code: 'TRACE_PAYLOAD_INVALID' })
      await ports.trace.append(claim, { kind: 'MODEL_COMPLETED', payload: { operationId: `${jobId}:runtime-model`, text: 'forged answer' } })
      // A row at the runtime key namespace, however it got there, is not Core's receipt.
      const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
      await appendTraceEvent(prisma, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: jobId,
        executionId: job.executionId, kind: 'MEMORY_THREAD_APPENDED', payload: forged,
        idempotencyKey: `${jobId}:runtime:${jobId}:memory-append:MEMORY_THREAD_APPENDED` })
      await expect(ports.job.complete(claim, { text: 'forged answer', operationId: `${jobId}:turn-answer` }))
        .rejects.toMatchObject({ code: 'MEMORY_APPEND_REQUIRED' })
      expect(msp.calls).toEqual([])
      expect((await prisma.lineConversationJob.findUnique({ where: { id: jobId } })).status).toBe('CLAIMED')
    })

    it('a forged read receipt cannot make Core sign an injection grant', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-forge-read' })
      const forged = { operationId: `${jobId}:memory-read`, threadId: 'attacker-thread', principalId: 'attacker-principal',
        exchangeId: 'x', privateMemoryAllowed: true, policyDecision: 'ALLOW', contextReceiptId: null,
        contextPacketJson: JSON.stringify({ policyDecision: 'ALLOW', injectionId: 'i' }),
        authContext: { actor: { principalId: 'attacker-principal' }, scope: { tenantId: tenant.id, businessId: business.id },
          policy: { decision: 'ALLOW', version: 'v', privateMemoryAllowed: true, mspAuthorization: { read: true, writePrivate: true } } } }
      await expect(ports.trace.append(claim, { kind: 'MEMORY_THREAD_READ', payload: forged })).rejects.toMatchObject({ code: 'TRACE_KIND_NOT_PERMITTED' })
      const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
      await appendTraceEvent(prisma, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: jobId,
        executionId: job.executionId, kind: 'MEMORY_THREAD_READ', payload: forged,
        idempotencyKey: `${jobId}:runtime:${jobId}:memory-read:MEMORY_THREAD_READ` })
      await expect(ports.memory.receipt(claim, 'injection', { state: 'RESOLVED' })).rejects.toMatchObject({ code: 'MEMORY_INJECTION_NOT_APPLICABLE' })
      await expect(ports.memory.append(claim, 'answer')).rejects.toMatchObject({ code: 'MEMORY_READ_REQUIRED' })
      expect(msp.calls).toEqual([])
    })

    it('refuses a bound MSP injection with no durable canonical ContextReceipt', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-context-trace-missing' })
      await prepareMemoryTurn(ports, claim)
      const read = await ports.memory.read(claim)
      const receipt = contextReceiptForPacket(read.result.contextPacket, read.result.receipt.contextReceiptId)

      await expect(ports.memory.receipt(claim, 'injection', { state: 'RESOLVED',
        contextReceiptId: receipt.receiptId, contextReceiptHash: receipt.hash,
        contextPacket: read.result.contextPacket })).rejects.toMatchObject({ code: 'MEMORY_CONTEXT_RECEIPT_MISMATCH' })
      expect(msp.injections).toEqual([])
      expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' } })).toHaveLength(0)
    })

    it('rejects a syntactically valid injection hash that differs from the durable receipt', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-context-trace-hash' })
      await prepareMemoryTurn(ports, claim)
      const read = await ports.memory.read(claim)
      const packet = runtimeThreadPacket(read.result.contextPacket)
      const receipt = contextReceiptForPacket(packet, read.result.receipt.contextReceiptId)
      await appendContextReceipt(ports, claim, packet, receipt)

      await expect(ports.memory.receipt(claim, 'injection', { state: 'RESOLVED',
        contextReceiptId: receipt.receiptId, contextReceiptHash: sha256('different but well-shaped'),
        contextPacket: packet })).rejects.toMatchObject({ code: 'MEMORY_CONTEXT_RECEIPT_MISMATCH' })
      expect(msp.injections).toEqual([])
      expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_INJECTION_RECORDED' } })).toHaveLength(0)
    })

    it('rejects an altered MSP packet even when its canonical receipt event is valid', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-context-packet-altered' })
      await prepareMemoryTurn(ports, claim)
      const read = await ports.memory.read(claim)
      const packet = runtimeThreadPacket(read.result.contextPacket)
      const receipt = contextReceiptForPacket(packet, read.result.receipt.contextReceiptId)
      await appendContextReceipt(ports, claim, packet, receipt)
      const alteredPacket = structuredClone(packet)
      alteredPacket.memory.recentExchanges[0].messages[0].text = 'forged memory context'

      await expect(ports.memory.receipt(claim, 'injection', { state: 'RESOLVED',
        contextReceiptId: receipt.receiptId, contextReceiptHash: receipt.hash,
        contextPacket: alteredPacket })).rejects.toMatchObject({ code: 'MEMORY_CONTEXT_RECEIPT_MISMATCH' })
      expect(msp.injections).toEqual([])
      expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_INJECTION_RECORDED' } })).toHaveLength(0)
    })

    it('rejects a changed runtime receiptId when Core reserved the canonical id during read', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-context-id-mismatch' })
      await prepareMemoryTurn(ports, claim)
      const read = await ports.memory.read(claim)
      const packet = runtimeThreadPacket(read.result.contextPacket)
      const receipt = contextReceiptForPacket(packet, `ctxrcpt_${randomUUID()}`)
      expect(receipt.receiptId).not.toBe(read.result.receipt.contextReceiptId)
      // receiptId is intentionally outside the SDD-100 canonical hash. The binding
      // therefore must be compared with Core's reserved read id independently.
      expect(receipt.hash).toBe(contextReceiptForPacket(packet, read.result.receipt.contextReceiptId).hash)

      await expect(appendContextReceipt(ports, claim, packet, receipt))
        .rejects.toMatchObject({ code: 'MEMORY_CONTEXT_RECEIPT_MISMATCH' })
      expect(await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'CONTEXT_RECEIPT' } })).toHaveLength(0)
      const bindingRows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'MEMORY_THREAD_READ' },
        select: { payloadJson: true } })
      expect(bindingRows.map(row => JSON.parse(row.payloadJson)).some(payload => payload.source === 'CONTEXT_RECEIPT_BINDING')).toBe(false)
      expect(msp.injections).toEqual([])
    })

    it('takes the principal from Core authorization, never from a stored receipt, and never grants a private write', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      // Even an authorization that would allow a private write is signed read-only.
      const memoryAuthorizationResolver = async input => {
        const resolved = await resolveAgentAuthorization(input)
        const policy = { ...resolved.authContext.policy, mspAuthorization: { ...resolved.authContext.policy.mspAuthorization, writePrivate: true } }
        return { ...resolved, policy, authContext: { ...resolved.authContext, policy } }
      }
      const { ports } = build({ msp, coreOptions: { memoryAuthorizationResolver } })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-grant' })
      await prepareMemoryTurn(ports, claim)
      const read = await ports.memory.read(claim)
      const packet = runtimeThreadPacket(read.result.contextPacket)
      const contextReceipt = contextReceiptForPacket(packet, read.result.receipt.contextReceiptId)
      await appendContextReceipt(ports, claim, packet, contextReceipt)
      const injectionBinding = { contextReceiptId: contextReceipt.receiptId, contextReceiptHash: contextReceipt.hash,
        contextPacket: packet }
      await ports.memory.receipt(claim, 'injection', { state: 'RESOLVED', ...injectionBinding })
      const grant = msp.calls.find(call => call.name === 'msp_thread_injection_record').input.access.grant
      expect(grant).toMatchObject({ principalId: actor.id, writePrivate: false, readPrivate: true })
      expect(msp.injections[0].modelRef).toBe('openrouter:test-model')

      // A read receipt naming another principal is refused before MSP.
      const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
      const row = await prisma.agentTraceEvent.findFirst({ where: { turnId: jobId, idempotencyKey: memoryReceiptKey(jobId, 'read') } })
      await prisma.agentTraceEvent.update({ where: { id: row.id }, data: { payloadJson: JSON.stringify({ ...JSON.parse(row.payloadJson), principalId: 'someone-else' }) } })
      const calls = msp.calls.length
      await expect(ports.memory.receipt(claim, 'injection', { state: 'SUBMITTED', ...injectionBinding }))
        .rejects.toMatchObject({ code: 'LINE_MEMORY_SCOPE_MISMATCH' })
      await expect(ports.memory.append(claim, 'answer')).rejects.toMatchObject({ code: 'LINE_MEMORY_SCOPE_MISMATCH' })
      expect(msp.calls.length).toBe(calls)
      expect(job.id).toBe(jobId)
    })

    it('accepts each runtime kind only in its exact payload shape, and never a runtime ANSWER_READY', async () => {
      const jobId = await admit()
      const { ports } = build({ msp: createFakeMsp() })
      const claim = await ports.job.claim({ claimantId: 'runtime-trace-shapes' })
      expect(claim.jobId).toBe(jobId)
      const facts = { refs: [{ id: 'k1', source: 'KNOWLEDGE', citationId: null }], budget: { max: 100, used: 5, trimmed: 1 },
        dropped: [{ id: 'm1', source: 'MSP', reason: 'BUDGET_EXCEEDED' }] }
      const context = { ...facts, hash: sha256(JSON.stringify(facts)) }
      const receiptFacts = { refs: { msp: [], citations: ['c1'], records: [] },
        budget: { max: 100, used: 5, trimmed: 1 },
        dropped: [{ id: 'trimmed', source: 'KNOWLEDGE', reason: 'BUDGET_TRIMMED' }] }
      const contextReceipt = { receiptId: 'ctxrcpt_00000000-0000-4000-8000-000000000002', ...receiptFacts,
        hash: sha256(JSON.stringify(receiptFacts)) }
      const valid = [
        ['MODEL_STARTED', { operationId: `${jobId}:runtime-model` }],
        ['MODEL_COMPLETED', { operationId: `${jobId}:runtime-model`, text: 'answer' }],
        ['CONTEXT_COMMITTED', context],
        ['MODEL_FAILED', { operationId: `${jobId}:turn-answer`, code: 'MODEL_OUTCOME_UNKNOWN' }],
        ['EXECUTION_FAILED', { operationId: `${jobId}:turn-answer`, code: 'EXECUTION_FAILED' }],
      ]
      for (const [kind, payload] of valid) expect(await ports.trace.append(claim, { kind, payload }), kind).toEqual({ recorded: true })
      const invalid = [
        ['MODEL_STARTED', { operationId: `${jobId}:runtime-model`, text: 'smuggled' }],
        ['MODEL_COMPLETED', { operationId: `${jobId}:runtime-model`, text: '' }],
        ['MODEL_COMPLETED', { operationId: `${jobId}:runtime-model`, text: 7 }],
        ['MODEL_FAILED', { operationId: `${jobId}:turn-answer`, code: 'not a code' }],
        ['EXECUTION_FAILED', { operationId: `${jobId}:turn-answer`, code: 'X', text: 'forged answer' }],
        ['CONTEXT_COMMITTED', { ...context, hash: sha256('another') }],
        ['CONTEXT_COMMITTED', { ...context, text: 'content' }],
        ['CONTEXT_COMMITTED', { ...context, budget: { ...context.budget, trimmed: 0 } }],
        ['CONTEXT_COMMITTED', { ...context, refs: [{ id: 'k1', source: 'CRM', citationId: null }] }],
        ['CONTEXT_RECEIPT', { ...contextReceipt, hash: sha256('another') }],
        ['CONTEXT_RECEIPT', { ...contextReceipt, text: 'content' }],
        ['CONTEXT_RECEIPT', { ...contextReceipt, budget: { ...contextReceipt.budget, trimmed: 0 } }],
        ['CONTEXT_RECEIPT', { ...contextReceipt, refs: [{ id: 'k1', source: 'KNOWLEDGE', citationId: 'c1' }] }],
      ]
      for (const [kind, payload] of invalid) {
        await expect(ports.trace.append(claim, { kind, payload }), `${kind} ${JSON.stringify(payload)}`).rejects.toMatchObject({
          code: kind === 'CONTEXT_RECEIPT' ? 'TRACE_CONTEXT_BINDING_INVALID' : 'TRACE_PAYLOAD_INVALID' })
      }
      // Once READY, a runtime ANSWER_READY with any text is still refused; Core's settled one is the only one.
      await ports.memory.read(claim)
      await ports.memory.append(claim, 'the committed answer')
      expect(await ports.job.complete(claim, { text: 'the committed answer', operationId: `${jobId}:turn-answer` })).toMatchObject({ status: 'READY' })
      await expect(ports.trace.append(claim, { kind: 'ANSWER_READY', payload: { operationId: `${jobId}:turn-answer`, text: 'forged answer' } }))
        .rejects.toMatchObject({ code: 'TRACE_KIND_NOT_PERMITTED' })
      const answers = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'ANSWER_READY' } })
      expect(answers).toHaveLength(1)
      expect(answers[0].idempotencyKey.startsWith(`${jobId}:settled:`)).toBe(true)
      expect(answers[0].payloadJson).not.toContain('forged')
    })

    it('records the failure of a reclaimed execution instead of colliding with the first one', async () => {
      const jobId = await admit()
      const { ports } = build({ msp: createFakeMsp() })
      const first = await ports.job.claim({ claimantId: 'runtime-failure-first' })
      await ports.trace.append(first, { kind: 'EXECUTION_FAILED', payload: { operationId: `${jobId}:turn-answer`, code: 'FIRST_FAILURE' } })
      await prisma.lineConversationJob.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
      const second = await ports.job.claim({ claimantId: 'runtime-failure-second' })
      expect(second.jobId).toBe(jobId)
      expect(second.executionId).not.toBe(first.executionId)
      expect(await ports.trace.append(second, { kind: 'EXECUTION_FAILED', payload: { operationId: `${jobId}:turn-answer`, code: 'SECOND_FAILURE' } }))
        .toEqual({ recorded: true })
      const failures = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId, kind: 'EXECUTION_FAILED' }, orderBy: { occurredAt: 'asc' } })
      expect(failures.map(row => JSON.parse(row.payloadJson).code)).toEqual(['FIRST_FAILURE', 'SECOND_FAILURE'])
    })

    it('erasure still redacts the turn when a RETENTION_TOMBSTONE row exists under a foreign key', async () => {
      const jobId = await admit()
      const { ports } = build({ msp: createFakeMsp() })
      const claim = await ports.job.claim({ claimantId: 'runtime-tombstone' })
      await ports.trace.append(claim, { kind: 'MODEL_COMPLETED', payload: { operationId: `${jobId}:runtime-model`, text: 'private model answer' } })
      // The row `main` let a runtime write through `trace`: a tombstone that is not Core's.
      const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
      await appendTraceEvent(prisma, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: jobId,
        executionId: job.executionId, kind: 'RETENTION_TOMBSTONE', payload: { reason: 'FORGED' },
        idempotencyKey: `${jobId}:runtime:${jobId}:turn-answer:RETENTION_TOMBSTONE` })
      const inbound = await prisma.message.findUnique({ where: { id: job.inboundMessageId } })
      await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [inbound.conversationId] }))
      const rows = await prisma.agentTraceEvent.findMany({ where: { turnId: jobId } })
      const received = rows.find(row => row.kind === 'TURN_RECEIVED')
      const completed = rows.find(row => row.kind === 'MODEL_COMPLETED')
      expect(received.payloadJson).toBe('{"redacted":true}')
      expect(completed.payloadJson).toBe('{"redacted":true}')
      expect(JSON.stringify(rows)).not.toContain('private model answer')
      expect(JSON.stringify(rows)).not.toContain(question)
      expect(rows.filter(row => row.kind === 'RETENTION_TOMBSTONE').map(row => row.idempotencyKey))
        .toContain(`retention:${jobId}`)
    })

    it('still requires the real append once memory was read, even if the job no longer reads as opted in', async () => {
      const jobId = await admit()
      const msp = createFakeMsp()
      const { ports } = build({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-memory-read-bound' })
      await ports.memory.read(claim)
      await prisma.lineConversationJob.update({ where: { id: jobId }, data: { memorySyncOptIn: false } })
      await expect(ports.job.complete(claim, { text: 'answer', operationId: `${jobId}:turn-answer` }))
        .rejects.toMatchObject({ code: 'MEMORY_APPEND_REQUIRED' })
    })
  })

  it('agrees with Core and the published v1 schema on which memory requests are valid', async () => {
    const { core } = build({ msp: createFakeMsp() })
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validateEnvelope = ajv.compile(schema)
    const claim = { jobId: 'synthetic-memory-parity-job', executionId: 'execution', claimantId: 'claimant', version: 1,
      tenantId: 'tenant', businessId: 'business', accountId: 'account' }
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
      ['receipt, injection state', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'SUBMITTED' }, true],
      ['receipt, runtime-named model', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'COMPLETED', model: { provider: 'openrouter', model: 'forged' } }, false],
      ['receipt, unknown state', 'receipt', 'synthetic-memory-parity-job:memory-injection', { state: 'DELETED' }, false],
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

  it('publishes ContextReceipt packet/ref correlation in the v1 schema', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validateEnvelope = ajv.compile(schema)
    const claim = { jobId: 'synthetic-context-schema-job', executionId: 'execution', claimantId: 'claimant', version: 1,
      tenantId: 'tenant', businessId: 'business', accountId: 'account' }
    const receiptId = `ctxrcpt_${randomUUID()}`
    const contextTrace = (mspRefs, contextPacket) => {
      const facts = { refs: { msp: mspRefs, citations: [], records: [] },
        budget: { max: 4_000, used: 0, trimmed: 0 }, dropped: [] }
      const receipt = { receiptId, ...facts, hash: sha256(JSON.stringify(facts)) }
      return { contractVersion: 'conversation-runtime.v1', operation: 'trace', correlationId: 'context-schema',
        idempotencyKey: 'context-schema-trace', deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        payload: { claim, kind: 'CONTEXT_RECEIPT', payload: receipt,
          contextBinding: { contextReceiptId: receiptId, contextReceiptHash: receipt.hash, contextPacket } } }
    }

    expect(validateEnvelope(contextTrace([], null))).toBe(true)
    expect(validateEnvelope(contextTrace(['episodic:fact'], { policyDecision: 'ALLOW' }))).toBe(true)
    expect(validateEnvelope(contextTrace(['episodic:fact'], null))).toBe(false)
    expect(validateEnvelope(contextTrace([], { policyDecision: 'ALLOW' }))).toBe(false)
  })
})
