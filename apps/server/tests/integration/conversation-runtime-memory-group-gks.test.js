import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { MEMORY_ERASURE_ACTOR, MEMORY_ERASURE_GRACE_MS, MEMORY_ERASURE_KINDS, MEMORY_ERASURE_MAX_ATTEMPTS, MEMORY_ERASURE_BACKOFF_MS,
  MEMORY_ERASURE_SCAN_MAX_PAGES, MEMORY_ERASURE_SCAN_PAGE, reconcileLineMemoryErasures, recordMemoryThreadErasures } from '@/modules/line-oa-studio/application/line-memory-erasure'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { memoryReceiptKey } from '@/modules/line-oa-studio/application/runtime-memory-receipts'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import { createMspThreadMemoryPort } from '@/modules/agent/msp-thread-memory-port'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createModelPort } from '../../../../services/conversation-runtime/src/model-port.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-235 — memory-sync turns in a GROUP or ROOM, and memory-sync turns
// under the GKS_CORPUS / GKS_THEN_BUSINESS_KNOWLEDGE grounding modes, run in the
// Conversation Runtime cohort with the legacy Server tick's exact MSP calls, signed
// claims and provider request (W12).
// @spec ADR-106 D2-D4, SDD-110, ADR-090 D1-D3 — Core is the only MSP and GKS caller;
// thread, route and principal come from the persisted job; one composition budget.
//
// Parity method: the same conversation is played twice on one OA account — first
// in the SERVER cohort through the legacy tick (`runLineConversationWorker` with the
// Server answer port, one execution at a time), then in the runtime cohort through
// the real runtime turn runner, Core route handler and Core memory façade. Each
// phase talks to a fresh API-010 stand-in with identical history. The MSP tool
// calls (inputs and signed grant claims, minus per-call nonce/signature) and the
// provider request bodies are compared as strings after replacing only the
// per-phase identifiers (event ids, job and inbound-message ids, random packet ids).
// @tested tests/integration/conversation-runtime-memory-group-gks.test.js

// `timeline` records MSP tool calls and GKS corpus reads in the order they happen,
// so each cohort's ordering (the MSP phases, then the corpus read) is compared too.
const corpusMock = vi.hoisted(() => ({ fn: null, calls: [], timeline: [] }))
vi.mock('@/modules/knowledge/knowledge-corpus-service', () => ({
  queryKnowledgeCorpus: async (...args) => { corpusMock.calls.push(args[0]); corpusMock.timeline.push('gks:corpus'); return corpusMock.fn(...args) },
}))

const serviceToken = 'synthetic-w12-runtime-core-token-000000001'
const mspServiceKey = 'synthetic-w12-msp-thread-service-key-0001'
const providerKey = 'synthetic-w12-provider-key'
const sealKey = '7e'.repeat(32)
const groupId = 'synthetic-w12-group'
const roomId = 'synthetic-w12-room'
const speakers = { A: 'synthetic-w12-speaker-a', B: 'synthetic-w12-speaker-b', C: 'synthetic-w12-speaker-c',
  D: 'synthetic-w12-speaker-d', E: 'synthetic-w12-speaker-e', F: 'synthetic-w12-speaker-f', G: 'synthetic-w12-speaker-g',
  H: 'synthetic-w12-speaker-h',
  // W11 x W12: U has no LINE identity at all; P has a Person whose LINE identity is PENDING.
  U: 'synthetic-w12-speaker-unlinked', P: 'synthetic-w12-speaker-pending' }
const erasureGroupId = 'synthetic-w12-erasure-group'
const providerReply = { choices: [{ message: { content: 'รับทราบค่ะ' } }] }
const productRecord = { name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }
const knowledgeEnv = { ZURI_LINE_KNOWLEDGE_BUDGET_MS: '2000' }

let tenant, business, account, persons = {}
let deliveries = []
let wire = []
let sequence = 0
let run = 0

const transportError = () => Object.assign(new Error('MSP request timed out: tools/call'), { code: 'MSP_TRANSPORT_UNAVAILABLE', status: 503 })
const killed = () => Object.assign(new Error('RUNTIME_KILLED'), { code: 'RUNTIME_KILLED' })

/** API-010 stand-in: one thread per route, source-event-id deduplication, exchanges and receipts. */
function createFakeMsp({ history = true } = {}) {
  const calls = []
  const threads = new Map()
  const messages = []
  const hooks = { before: null }
  const erasures = []
  let counter = 0
  const next = prefix => `${prefix}-${++counter}`
  function handle(name, input) {
    if (name === 'msp_thread_resolve') {
      const key = [input.tenant_id, input.channel_account_id, input.external_room_ref].join('|')
      let thread = threads.get(key)
      const created = !thread
      if (!thread) {
        thread = { threadId: next('thread'), businessId: input.business_id, audienceKind: input.audience_kind }
        threads.set(key, thread)
        if (history) {
          const exchangeId = next('exchange')
          messages.push({ threadId: thread.threadId, messageId: next('message'), exchangeId, sequence: ++counter,
            direction: 'INBOUND', speakerId: 'earlier-speaker', speakerKind: 'HUMAN', text: `private history of ${input.external_room_ref}`, sessionId: 'session-1' })
          messages.push({ threadId: thread.threadId, messageId: next('message'), exchangeId, sequence: ++counter,
            direction: 'OUTBOUND', speakerId: 'zuri-line-agent', speakerKind: 'AGENT', text: 'x'.repeat(900), sessionId: 'session-1' })
        }
      }
      return { thread, created }
    }
    if (name === 'msp_thread_message_append') {
      const existing = input.source_event_id && messages.find(message => message.threadId === input.thread_id
        && message.sourceEventId === input.source_event_id)
      if (existing) return { message: { messageId: existing.messageId, exchangeId: existing.exchangeId, sequence: existing.sequence },
        session: { sessionId: existing.sessionId }, deduplicated: true }
      const message = { threadId: input.thread_id, messageId: next('message'),
        exchangeId: input.direction === 'INBOUND' ? next('exchange') : input.exchange_id, sequence: ++counter,
        direction: input.direction, speakerId: input.speaker_id, speakerKind: input.speaker_kind, text: input.text,
        identityAssurance: input.identity_assurance, sourceEventId: input.source_event_id, sessionId: input.session_id ?? 'session-1' }
      messages.push(message)
      return { message: { messageId: message.messageId, exchangeId: message.exchangeId, sequence: message.sequence },
        session: { sessionId: message.sessionId }, deduplicated: false }
    }
    if (name === 'msp_thread_context') {
      const thread = [...threads.values()].find(item => item.threadId === input.thread_id)
      const exchanges = []
      for (const message of messages.filter(item => item.threadId === input.thread_id && item.redactionState !== 'tombstoned')) {
        let exchange = exchanges.find(item => item.exchangeId === message.exchangeId)
        if (!exchange) exchanges.push(exchange = { exchangeId: message.exchangeId, messages: [] })
        exchange.messages.push({ sequence: message.sequence, speakerId: message.speakerId, speakerKind: message.speakerKind,
          direction: message.direction, text: message.text })
      }
      return { thread, session: { sessionId: 'session-1' }, participants: [{ speakerId: 'zuri-line-agent', speakerKind: 'AGENT' }],
        recentExchanges: exchanges.slice(-input.recent_exchange_count), protectedRecords: [], threadSummaries: [], coverageGap: null }
    }
    if (name === 'msp_thread_injection_record') return { recorded: true, state: input.state }
    if (name === 'msp_thread_principal_erase') {
      // The contract at the deployed MSP pin (API-011; msp-core thread-memory.mjs
      // `erasePrincipal`): NOT thread-bound. It spans every thread of the grant's
      // tenant the principal ever spoke in: their own HUMAN messages are tombstoned
      // (text blanked, row kept), their participant rows closed, and session
      // summaries and delivery receipts tombstoned only in threads where they are
      // the sole human. AGENT replies are kept, in every thread. Idempotent by
      // (tenant, idempotency_key): a replay changes nothing and says so.
      const grant = input.access?.grant ?? {}
      const seen = erasures.find(item => item.tenantId === grant.tenantId && item.idempotencyKey === input.idempotency_key)
      if (seen) return { erasureReceiptId: seen.erasureReceiptId, tablesAffected: seen.tablesAffected, replay: true }
      const tenantThreads = new Set([...threads.entries()].filter(([key]) => key.startsWith(`${grant.tenantId}|`))
        .map(([, thread]) => thread.threadId))
      let tombstoned = 0
      for (const message of messages) {
        if (tenantThreads.has(message.threadId) && message.speakerId === input.principal_id && message.speakerKind === 'HUMAN'
          && message.redactionState !== 'tombstoned') {
          message.text = ''
          message.redactionState = 'tombstoned'
          tombstoned += 1
        }
      }
      const erasureReceiptId = next('erasure-receipt')
      const tablesAffected = { threadMessages: tombstoned, protectedMemoryRecords: 0, sessionSummaries: 0, threadDeliveryReceipts: 0, threadParticipants: 0 }
      erasures.push({ idempotencyKey: input.idempotency_key, principalId: input.principal_id, tenantId: grant.tenantId, grant,
        erasureReceiptId, tablesAffected })
      return { erasureReceiptId, tablesAffected, replay: false, principalId: input.principal_id, tenantId: grant.tenantId }
    }
    return {}
  }
  async function transport(name, input) {
    calls.push({ name, input: JSON.parse(JSON.stringify(input)) })
    corpusMock.timeline.push(`msp:${name}`)
    if (hooks.before) await hooks.before(name, input)
    return handle(name, input)
  }
  return { transport, calls, messages, hooks, erasures }
}

const mspPort = msp => createMspThreadMemoryPort({ transport: msp.transport, serviceKey: mspServiceKey, workspaceId: 'w12-workspace' })

function captureFetch(calls) {
  return async (url, options) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(options.headers)), body: options.body })
    return new Response(JSON.stringify(providerReply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

function businessKnowledge(records = [productRecord]) {
  return { query: vi.fn(async () => ({ records: records.map(record => ({ ...record })) })) }
}

/** Legacy SERVER-cohort tick, one execution per tick, until idle. */
async function runLegacy({ msp, records } = {}) {
  const providerCalls = []
  const provider = createModelProviderPort({ provider: 'openrouter', model: 'test-model', credential: providerKey,
    timeoutMs: 1000, fetchFn: captureFetch(providerCalls) })
  const answer = createServerLineAnswer({ env: knowledgeEnv, threadMemory: mspPort(msp),
    runtimeFactory: async () => ({ businessKnowledge: businessKnowledge(records), resolveModel: async () => provider }) })
  const send = async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `legacy-${deliveries.length}` } }
  for (let tick = 0; tick < 12; tick += 1) {
    const result = await runLineConversationWorker({ db: prisma, answer, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
      resolveAccount: id => prisma.lineOaAccount.findUnique({ where: { id } }), replyTransport: { send }, pushTransport: { send },
      threadMemory: null, executionConcurrency: 1, sendBatch: 1, workerId: `legacy-worker-${tick}` })
    if (result?.status === 'IDLE') break
  }
  return { providerCalls }
}

function inProcessFetch(handlers) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    if (init.body) {
      const envelope = JSON.parse(init.body)
      wire.push({ operation: envelope.operation, payload: envelope.payload })
    }
    const request = new Request(target, init)
    return operation === 'health' ? handlers.GET(request, { params: { operation } }) : handlers.POST(request, { params: { operation } })
  }
}

function buildRuntime({ msp, records, corpusReaderFactory } = {}) {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...knowledgeEnv },
    credentialResolver: async () => ({ provider: 'openrouter', model: 'test-model', apiKey: providerKey }),
    businessPorts: { businessKnowledge: businessKnowledge(records) },
    threadMemoryFactory: () => mspPort(msp),
    ...(corpusReaderFactory ? { corpusReaderFactory } : {}),
    linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `runtime-${deliveries.length}` } } },
      pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `runtime-${deliveries.length}` } } } }) })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core)) })
  const providerCalls = []
  const provider = createModelPort({ timeoutMs: 1000, fetchFn: captureFetch(providerCalls) })
  const ports = createCorePorts({ client, model: provider })
  return { ports, providerCalls, core }
}

async function runRuntime(built, { until = 12, ports = built.ports } = {}) {
  const outcomes = []
  for (let turn = 0; turn < until; turn += 1) {
    const outcome = await createConversationRuntime({ ports, claimantId: `runtime-${++sequence}` }).runOne()
    if (outcome.status === 'IDLE') break
    outcomes.push(outcome)
  }
  return outcomes
}

/** Every port throws once `dies` says the process died; nothing after reaches Core. */
function mortal(ports, dies) {
  let dead = false
  const wrap = (group, name, fn) => async (...args) => {
    if (dead) throw killed()
    const result = await fn(...args)
    if (dies(`${group}.${name}`)) dead = true
    return result
  }
  return Object.fromEntries(Object.entries(ports).map(([group, methods]) => [group,
    Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, wrap(group, name, fn)]))]))
}

const setOwner = runtimeOwner => prisma.lineOaAccount.update({ where: { id: account.id }, data: { runtimeOwner } })
const setGrounding = knowledgeGrounding => prisma.lineOaAccount.update({ where: { id: account.id }, data: { knowledgeGrounding } })

function event(phase, n, { audience = 'GROUP', speaker = 'A', text, group = groupId } = {}) {
  const userId = speakers[speaker]
  const source = audience === 'GROUP' ? { type: 'group', groupId: group, userId }
    : audience === 'ROOM' ? { type: 'room', roomId, userId } : { type: 'user', userId }
  const body = text ?? (audience === 'DIRECT' ? 'AB-1 ราคาเท่าไร' : `ซูริ AB-1 ราคาเท่าไร (${speaker})`)
  const tag = `${phase}${run}`
  return { type: 'message', webhookEventId: `${tag}-event-${n}`, replyToken: `${tag}-reply-${n}`, timestamp: Date.now(),
    source, message: { type: 'text', id: `${tag}-message-${n}`, text: body } }
}

async function admit(phase, n, options) {
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const admitted = await admitLineConversation({ db: prisma, account: current, now: new Date(), correlationId: `${phase}-${n}`,
    env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey, ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' }, event: event(phase, n, options) })
  return prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })
}

/** Replace only what differs by phase: event/message ids, job and inbound ids, random packet ids. */
function normalize(value, jobs) {
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  jobs.forEach((job, index) => {
    text = text.split(job.id).join(`<job-${index}>`).split(job.inboundMessageId).join(`<inbound-${index}>`)
  })
  return text.replace(/\b(legacy|runtime)\d+-(event|message|reply)-/g, 'phase-$2-')
    .replace(/context_[0-9a-f-]{36}/g, 'context_<id>').replace(/injection_[0-9a-f-]{36}/g, 'injection_<id>')
    .replace(/ctxrcpt_[0-9a-f-]{36}/g, 'ctxrcpt_<id>')
}

function comparableCalls(calls) {
  return calls.map(({ name, input }) => {
    const { access, ...rest } = input
    const grant = access?.grant ? (({ nonce, expiresAt, payloadHash, ...claims }) => claims)(access.grant) : null
    if (name === 'msp_thread_injection_record') rest.packet_hash = '<hash>'
    return { name, input: rest, grant }
  })
}
const mspNames = msp => msp.calls.map(call => call.name === 'msp_thread_message_append' ? `append ${call.input.direction}`
  : call.name === 'msp_thread_injection_record' ? `injection ${call.input.state}` : call.name.replace('msp_thread_', ''))

async function linkSpeaker(key, { member = true } = {}) {
  const person = await prisma.person.create({ data: { code: `PER-W12-${key}`, displayName: `Synthetic W12 speaker ${key}` } })
  if (member) await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' } })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: person.id, provider: 'LINE',
    providerSubject: speakers[key], verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: person.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: speakers[key], status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  return person
}

beforeAll(async () => {
  await prisma.lineConversationJob.updateMany({ where: { status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_W12_ISOLATION', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  const portfolio = await createPortfolio({ name: 'W12 fixture', code: 'PF-CR-W12' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'W12 tenant', code: 'TNT-CR-W12' })
  business = await createBusiness({ tenantId: tenant.id, name: 'W12 business', code: 'BUS-CR-W12' })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Synthetic W12 LINE connection', externalAccountId: 'synthetic-w12-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-w12-account', displayName: 'Synthetic W12 OA', bindingCode: 'cr-w12-binding',
    status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', runtimeOwner: 'SERVER' } })
  persons.A = await linkSpeaker('A')
  persons.B = await linkSpeaker('B')
  // A customer with no staff grant, so a PDPA erasure may run for them.
  persons.C = await linkSpeaker('C', { member: false })
  for (const key of ['D', 'E', 'F', 'G', 'H']) persons[key] = await linkSpeaker(key, { member: false })
  // A member whose LINE identity is PENDING: a verified link would open private memory.
  persons.P = await prisma.person.create({ data: { code: 'PER-W12-P', displayName: 'Synthetic W12 pending speaker' } })
  await prisma.membership.create({ data: { personId: persons.P.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' } })
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: persons.P.id, provider: 'LINE', providerSubject: speakers.P } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: persons.P.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: speakers.P, status: 'PENDING' } })
})

afterEach(async () => {
  run += 1
  await prisma.lineConversationJob.updateMany({ where: { tenantId: tenant.id, status: { in: ['QUEUED', 'CLAIMED', 'READY', 'SENDING'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_W12_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  await setOwner('SERVER')
  await setGrounding('BUSINESS_KNOWLEDGE')
  deliveries = []
  wire = []
  corpusMock.fn = null
  corpusMock.calls.length = 0
})

// Hygiene for the rest of the run: this suite's RECORDED memory jobs would sit as
// PENDING MSP deliveries in the shared database and fill the installation-wide
// delivery scanner's batch in later suites. Close them; nothing here reads them after.
afterAll(async () => {
  await prisma.lineConversationJob.updateMany({ where: { tenantId: tenant.id, memoryDeliveryState: 'PENDING' },
    data: { memoryDeliveryState: 'CLOSED', memoryDeliveryNextAttemptAt: null, memoryDeliveryLeaseUntil: null } })
})

/** Play the same turns through the legacy tick, then the runtime; return both sides. */
async function playBoth(turns, { records, runtimeHook, legacyHook, beforeRuntimeRun, beforeLegacyRun, betweenPhases } = {}) {
  await setOwner('SERVER')
  const legacyMsp = createFakeMsp()
  const legacyJobs = []
  for (const [index, turn] of turns.entries()) legacyJobs.push(await admit('legacy', index, turn))
  expect(legacyJobs.map(job => job?.runtimeOwner), JSON.stringify(legacyJobs.map(job => job && { id: job.id, owner: job.runtimeOwner, status: job.status }))).toEqual(legacyJobs.map(() => 'SERVER'))
  if (legacyHook) legacyMsp.hooks.before = legacyHook
  if (beforeLegacyRun) await beforeLegacyRun(legacyJobs)
  corpusMock.timeline.length = 0
  const legacy = await runLegacy({ msp: legacyMsp, records })
  const legacyTimeline = [...corpusMock.timeline]
  const legacyDeliveries = deliveries
  deliveries = []
  if (betweenPhases) await betweenPhases()

  await setOwner('CONVERSATION_RUNTIME')
  const runtimeMsp = createFakeMsp()
  const runtimeJobs = []
  for (const [index, turn] of turns.entries()) runtimeJobs.push(await admit('runtime', index, turn))
  expect(runtimeJobs.every(job => job.runtimeOwner === 'CONVERSATION_RUNTIME'), 'W12 admits these turns to the runtime cohort').toBe(true)
  if (runtimeHook) runtimeMsp.hooks.before = runtimeHook
  const built = buildRuntime({ msp: runtimeMsp, records })
  corpusMock.timeline.length = 0
  if (beforeRuntimeRun) await beforeRuntimeRun(runtimeJobs, built)
  const outcomes = await runRuntime(built)
  const runtimeTimeline = [...corpusMock.timeline]
  return { legacyMsp, runtimeMsp, legacyJobs, runtimeJobs, legacy, built, outcomes, legacyDeliveries, runtimeDeliveries: deliveries,
    legacyTimeline, runtimeTimeline }
}

function expectSameMsp(side) {
  expect(side.runtimeTimeline).toEqual(side.legacyTimeline)
  expect(normalize(comparableCalls(side.runtimeMsp.calls), side.runtimeJobs))
    .toBe(normalize(comparableCalls(side.legacyMsp.calls), side.legacyJobs))
}
function expectSameProvider(side) {
  expect(side.built.providerCalls.map(call => normalize(call.body, side.runtimeJobs)))
    .toEqual(side.legacy.providerCalls.map(call => normalize(call.body, side.legacyJobs)))
}

describe('W12 — GROUP and ROOM memory-sync turns', () => {
  for (const audience of ['GROUP', 'ROOM']) {
    it(`${audience}: several speakers make the legacy tick's MSP calls, claims, prompts and replies`, async () => {
      const side = await playBoth([{ audience, speaker: 'A' }, { audience, speaker: 'B' }, { audience, speaker: 'A' }])
      expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED', 'RECORDED'])
      // One MSP thread for the room, each turn labelled with its own speaker; private
      // recall is denied for a shared audience, so no context read and no injection.
      expect(mspNames(side.runtimeMsp)).toEqual(Array(3).fill(['resolve', 'append INBOUND', 'resolve', 'append OUTBOUND']).flat())
      expectSameMsp(side)
      expectSameProvider(side)
      const room = audience === 'GROUP' ? groupId : roomId
      const resolves = side.runtimeMsp.calls.filter(call => call.name === 'msp_thread_resolve')
      expect(new Set(resolves.map(call => `${call.input.thread_kind}|${call.input.external_room_ref}`))).toEqual(new Set([`${audience}|${room}`]))
      const inbound = side.runtimeMsp.calls.filter(call => call.name === 'msp_thread_message_append' && call.input.direction === 'INBOUND')
      expect(inbound.map(call => call.input.speaker_id)).toEqual([persons.A.id, persons.B.id, persons.A.id])
      expect(inbound.map(call => call.input.access.grant.principalId)).toEqual([persons.A.id, persons.B.id, persons.A.id])
      expect(side.runtimeMsp.calls.every(call => call.input.access.grant.readPrivate !== true && call.input.access.grant.writePrivate !== true)).toBe(true)
      expect(side.built.providerCalls.every(call => !call.body.includes('THREAD CONTEXT PACKET') && !call.body.includes('private history'))).toBe(true)
      expect(side.runtimeDeliveries).toEqual(side.legacyDeliveries)
      const rows = await prisma.lineConversationJob.findMany({ where: { id: { in: side.runtimeJobs.map(job => job.id) } } })
      expect(rows.every(row => row.status === 'RECORDED' && row.recipientId === room)).toBe(true)
    })
  }

  it('a speaker whose consent is withdrawn mid-queue gets no MSP write, exactly as on the legacy tick; the others are unaffected', async () => {
    const identityOf = subject => ({ tenantId_channel_channelAccountId_providerSubject: {
      tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: subject } })
    const revoke = () => prisma.channelIdentity.update({ where: identityOf(speakers.B), data: { status: 'REVOKED', revokedAt: new Date() } })
    const restore = () => prisma.channelIdentity.update({ where: identityOf(speakers.B),
      data: { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() } })
    try {
      // B's turn is admitted while B is verified; B withdraws before it is answered.
      const side = await playBoth([{ speaker: 'A' }, { speaker: 'B' }, { speaker: 'A' }], {
        beforeLegacyRun: revoke, betweenPhases: restore, beforeRuntimeRun: revoke })
      // Legacy: the answer port cannot resolve B's revoked principal, so B's turn
      // fails before any MSP call. Runtime: Core's sender fence never lets B's turn
      // be claimed. Neither cohort writes B's words to the group thread or replies.
      const touchesB = call => call.input.access?.grant?.principalId === persons.B.id || JSON.stringify(call.input).includes('(B)')
      expect(side.legacyMsp.calls.filter(touchesB)).toEqual([])
      expect(side.runtimeMsp.calls.filter(touchesB)).toEqual([])
      expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
      expectSameMsp(side)
      expectSameProvider(side)
      expect(side.runtimeDeliveries).toEqual(side.legacyDeliveries)
      expect(side.runtimeDeliveries).toHaveLength(2)
      expect((await prisma.lineConversationJob.findUnique({ where: { id: side.legacyJobs[1].id } })).status).toBe('FAILED')
      expect((await prisma.lineConversationJob.findUnique({ where: { id: side.runtimeJobs[1].id } })).status).toBe('QUEUED')
    } finally { await restore() }
  })

  it('erasing the speaker who opened a group erases only their queued turn, in both cohorts; the other speaker\'s turn matches the legacy tick', async () => {
    const turns = [{ speaker: 'C', group: erasureGroupId }, { speaker: 'B', group: erasureGroupId }]
    await setOwner('SERVER')
    const legacyJobs = []
    for (const [index, turn] of turns.entries()) legacyJobs.push(await admit('legacy', index, turn))
    await setOwner('CONVERSATION_RUNTIME')
    const runtimeJobs = []
    for (const [index, turn] of turns.entries()) runtimeJobs.push(await admit('runtime', index, turn))
    expect(legacyJobs.map(job => job.runtimeOwner)).toEqual(['SERVER', 'SERVER'])
    expect(runtimeJobs.map(job => job.runtimeOwner)).toEqual(['CONVERSATION_RUNTIME', 'CONVERSATION_RUNTIME'])
    // #596: erasure follows the speaker, so C's turns are erased and B's are not.
    await erasePrincipal({ tenantId: tenant.id, personId: persons.C.id, reason: 'TEST' })
    const rows = await prisma.lineConversationJob.findMany({ where: { id: { in: [...legacyJobs, ...runtimeJobs].map(job => job.id) } } })
    const byId = new Map(rows.map(row => [row.id, row]))
    expect([legacyJobs[0], runtimeJobs[0]].map(job => byId.get(job.id).errorCode)).toEqual(['PDPA_ERASURE', 'PDPA_ERASURE'])
    expect([legacyJobs[1], runtimeJobs[1]].map(job => byId.get(job.id).errorCode)).toEqual([null, null])
    await setOwner('SERVER')
    const legacyMsp = createFakeMsp()
    const legacy = await runLegacy({ msp: legacyMsp })
    const legacyDeliveries = deliveries
    deliveries = []
    await setOwner('CONVERSATION_RUNTIME')
    const runtimeMsp = createFakeMsp()
    const built = buildRuntime({ msp: runtimeMsp })
    expect((await runRuntime(built)).map(outcome => outcome.status)).toEqual(['RECORDED'])
    const touchesC = call => call.input.access?.grant?.principalId === persons.C.id || JSON.stringify(call.input).includes('(C)')
    expect(legacyMsp.calls.filter(touchesC)).toEqual([])
    expect(runtimeMsp.calls.filter(touchesC)).toEqual([])
    expect(normalize(comparableCalls(runtimeMsp.calls), [runtimeJobs[1]])).toBe(normalize(comparableCalls(legacyMsp.calls), [legacyJobs[1]]))
    expect(built.providerCalls.map(call => normalize(call.body, [runtimeJobs[1]])))
      .toEqual(legacy.providerCalls.map(call => normalize(call.body, [legacyJobs[1]])))
    expect(deliveries).toEqual(legacyDeliveries)
    expect(deliveries).toHaveLength(1)
  })

  it('a kill after the read, then reclaim, repeats no MSP write and still matches the legacy tick', async () => {
    const side = await playBoth([{ speaker: 'A' }, { speaker: 'B' }], {
      beforeRuntimeRun: async (jobs, built) => {
        const first = await createConversationRuntime({ claimantId: 'runtime-killed',
          ports: mortal(built.ports, name => name === 'memory.read') }).runOne()
        expect(first).toMatchObject({ jobId: jobs[0].id, code: 'RUNTIME_KILLED' })
        await prisma.lineConversationJob.update({ where: { id: jobs[0].id }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
      } })
    expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
    expectSameMsp(side)
    expectSameProvider(side)
  })
})

describe('W12 — memory-sync turns under a corpus grounding mode', () => {
  const hit = (id, text) => ({ id, text, score: 0.9, citationId: `cit-${id}`, sourceId: `src-${id}`, snapshotId: 'snap-1', generation: 1 })
  // Four ~1,100-character hits plus the thread history exceed the composer's 4,000
  // character budget: knowledge outranks memory, so the last hit and the older
  // thread turns are dropped. Both paths must drop the same ones.
  const pressure = () => ({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
    results: ['a', 'b', 'c', 'd'].map(id => hit(id, `AB-1 ${id} `.padEnd(1100, id))) })

  for (const mode of ['GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']) {
    it(`${mode}: GKS evidence and the thread compose under one budget exactly as the legacy tick composes them`, async () => {
      await setGrounding(mode)
      corpusMock.fn = async () => pressure()
      const side = await playBoth([{ audience: 'DIRECT', speaker: 'A' }, { audience: 'DIRECT', speaker: 'A', text: 'AB-1 มีสีอะไรบ้าง' }])
      expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
      expect(mspNames(side.runtimeMsp)).toEqual(Array(2).fill(['resolve', 'append INBOUND', 'resolve', 'context',
        'injection RESOLVED', 'injection SUBMITTED', 'injection COMPLETED', 'append OUTBOUND']).flat())
      expectSameMsp(side)
      expectSameProvider(side)
      const body = JSON.parse(side.built.providerCalls[0].body).messages[0].content
      expect(body).toContain('cit-a')
      expect(body).not.toContain('cit-d')
      expect(body).not.toContain('private history')
      // One corpus read per turn in each cohort: `prepare` reads nothing for these turns.
      expect(corpusMock.calls).toHaveLength(4)
      const receipts = await prisma.agentTraceEvent.findMany({ where: { turnId: { in: side.runtimeJobs.map(job => job.id) }, kind: 'CONTEXT_RECEIPT' } })
      expect(receipts).toHaveLength(2)
    })
  }

  it('GROUP under GKS_CORPUS: knowledge is still composed while private memory stays denied, as on the Server', async () => {
    await setGrounding('GKS_CORPUS')
    corpusMock.fn = async () => pressure()
    const side = await playBoth([{ speaker: 'A' }, { speaker: 'B' }])
    expectSameMsp(side)
    expectSameProvider(side)
    expect(side.built.providerCalls).toHaveLength(2)
    expect(side.built.providerCalls.every(call => !call.body.includes('THREAD CONTEXT PACKET'))).toBe(true)
  })

  it('no composed knowledge: no model, no ContextReceipt, the legacy reply', async () => {
    await setGrounding('GKS_CORPUS')
    corpusMock.fn = async () => ({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const side = await playBoth([{ audience: 'DIRECT', speaker: 'A' }])
    expect(side.built.providerCalls).toEqual([])
    expect(side.legacy.providerCalls).toEqual([])
    expectSameMsp(side)
    expect(side.runtimeDeliveries).toEqual(side.legacyDeliveries)
    expect(await prisma.agentTraceEvent.count({ where: { turnId: side.runtimeJobs[0].id, kind: 'CONTEXT_RECEIPT' } })).toBe(0)
  })

  it('a kill after the read replays the composed evidence without a second corpus read', async () => {
    await setGrounding('GKS_THEN_BUSINESS_KNOWLEDGE')
    corpusMock.fn = async () => pressure()
    const side = await playBoth([{ audience: 'DIRECT', speaker: 'A' }], {
      beforeRuntimeRun: async (jobs, built) => {
        const first = await createConversationRuntime({ claimantId: 'runtime-gks-killed',
          ports: mortal(built.ports, name => name === 'memory.read') }).runOne()
        expect(first).toMatchObject({ jobId: jobs[0].id, code: 'RUNTIME_KILLED' })
        await prisma.lineConversationJob.update({ where: { id: jobs[0].id }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
      } })
    expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED'])
    expect(corpusMock.calls).toHaveLength(2)
    expectSameMsp(side)
    expectSameProvider(side)
  })


  it('composed evidence over the evidence bound is trimmed from the lowest rank, not refused', async () => {
    await setGrounding('GKS_CORPUS')
    await setOwner('CONVERSATION_RUNTIME')
    const msp = createFakeMsp()
    // Tiny `text` (what the composer counts), large other fields: the composer keeps
    // all three, but together they exceed the 32 KiB evidence bound in bytes.
    const records = ['r1', 'r2', 'r3'].map((id, index) => ({ kind: 'CORPUS_CHUNK', citationId: `cit-${id}`, text: `AB-1 ${id}`,
      detail: 'ข'.repeat(index === 2 ? 10 : 7_000) }))
    const corpusReaderFactory = () => ({ query: async () => ({ records: records.map(record => ({ ...record })) }) })
    const job = await admit('runtime', 0, { audience: 'DIRECT', speaker: 'A' })
    const built = buildRuntime({ msp, corpusReaderFactory })
    expect((await runRuntime(built)).map(outcome => outcome.status)).toEqual(['RECORDED'])
    const prompt = JSON.parse(built.providerCalls[0].body).messages[0].content
    // r1 + r2 alone are ~42 KB: the lowest-ranked go first (r3, then r2).
    expect(prompt).toContain('cit-r1')
    expect(prompt).not.toContain('cit-r2')
    expect(prompt).not.toContain('cit-r3')
    // The drop is traced once, with counts only (no citation, record or text).
    const trimmed = await prisma.agentTraceEvent.findMany({ where: { turnId: job.id, kind: 'EVIDENCE_TRIMMED' } })
    expect(trimmed.map(row => JSON.parse(row.payloadJson)))
      .toEqual([{ phase: 'memory-read', recordsBefore: 3, recordsKept: 1, recordsDropped: 2 }])
    expect(trimmed[0].payloadJson).not.toMatch(/cit-|AB-1/)
  })


  it('an out-of-hours GROUP memory turn under a corpus mode: memory read is refused with no MSP call and no corpus read', async () => {
    await setGrounding('GKS_CORPUS')
    await setOwner('CONVERSATION_RUNTIME')
    corpusMock.fn = async () => pressure()
    // Closed at every minute but 00:00 (Bangkok), so this admission is out of hours.
    await prisma.lineOaAccount.update({ where: { id: account.id },
      data: { businessHoursOpen: '00:00', businessHoursClose: '00:00', outOfHoursReplyText: 'ปิดทำการแล้วค่ะ' } })
    try {
      const msp = createFakeMsp()
      const job = await admit('runtime', 0, { speaker: 'A' })
      expect(job).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true, audienceKind: 'GROUP', answerText: 'ปิดทำการแล้วค่ะ' })
      const { ports } = buildRuntime({ msp })
      const claim = await ports.job.claim({ claimantId: 'runtime-out-of-hours-memory' })
      expect(claim.jobId).toBe(job.id)
      await expect(ports.memory.read(claim)).rejects.toMatchObject({ code: 'MEMORY_NOT_APPLICABLE' })
      await expect(ports.memory.append(claim, 'ปิดทำการแล้วค่ะ')).rejects.toMatchObject({ code: 'MEMORY_NOT_APPLICABLE' })
      expect(msp.calls).toEqual([])
      expect(corpusMock.calls).toEqual([])
    } finally {
      await prisma.lineOaAccount.update({ where: { id: account.id },
        data: { businessHoursOpen: null, businessHoursClose: null, outOfHoursReplyText: null } })
    }
  })

  it('MSP down under a corpus mode fails before any corpus read or model call', async () => {
    await setGrounding('GKS_CORPUS')
    corpusMock.fn = async () => pressure()
    await setOwner('CONVERSATION_RUNTIME')
    const msp = createFakeMsp()
    msp.hooks.before = () => { throw transportError() }
    await admit('runtime', 0, { audience: 'DIRECT', speaker: 'A' })
    const built = buildRuntime({ msp })
    const [outcome] = await runRuntime(built)
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'MSP_TRANSPORT_UNAVAILABLE' })
    expect(corpusMock.calls).toEqual([])
    expect(built.providerCalls).toEqual([])
  })
})

// @req FR-149, FR-171, FR-235 — W11's PENDING memory mode is not DIRECT-only: an
//   unverified speaker's memory turn in a GROUP or ROOM, and under a corpus grounding
//   mode, runs in the runtime with the legacy tick's exact MSP calls, claims, prompts
//   and replies, and Core records the read under PENDING assurance.
describe('W11 x W12 — unverified speakers\' memory turns in shared audiences and under a corpus mode', () => {
  const PENDING_TURN = ['resolve', 'append INBOUND', 'resolve', 'append OUTBOUND']
  const inboundAppends = msp => msp.calls.filter(call => call.name === 'msp_thread_message_append' && call.input.direction === 'INBOUND')
  async function readReceiptOf(job) {
    const row = await prisma.agentTraceEvent.findFirst({ where: { turnId: job.id, idempotencyKey: memoryReceiptKey(job.id, 'read') } })
    return row ? JSON.parse(row.payloadJson) : null
  }
  async function expectPendingJobs(jobs) {
    for (const job of jobs) {
      expect(await prisma.agentTraceEvent.count({ where: { turnId: job.id, kind: 'CHANNEL_IDENTITY_ADMITTED' } })).toBe(1)
      expect(await readReceiptOf(job)).toMatchObject({ identityAssurance: 'PENDING', privateMemoryAllowed: false })
    }
  }

  for (const audience of ['GROUP', 'ROOM']) {
    it(`${audience}: verified, unlinked and PENDING speakers make the legacy tick's MSP calls, claims, prompts and replies`, async () => {
      const side = await playBoth([{ audience, speaker: 'A' }, { audience, speaker: 'U' }, { audience, speaker: 'P' }])
      expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED', 'RECORDED'])
      expect(mspNames(side.runtimeMsp)).toEqual(Array(3).fill(PENDING_TURN).flat())
      expectSameMsp(side)
      expectSameProvider(side)
      expect(side.runtimeDeliveries).toEqual(side.legacyDeliveries)
      for (const msp of [side.legacyMsp, side.runtimeMsp]) {
        const [verified, unlinked, pending] = inboundAppends(msp)
        expect(verified.input.identity_assurance).not.toBe('PENDING')
        expect(unlinked.input.identity_assurance).toBe('PENDING')
        expect(pending.input.identity_assurance).toBe('PENDING')
        expect(msp.calls.every(call => call.input.access?.grant?.readPrivate !== true && call.input.access?.grant?.writePrivate !== true)).toBe(true)
      }
      await expectPendingJobs(side.runtimeJobs.slice(1))
      expect((await readReceiptOf(side.runtimeJobs[0]))?.identityAssurance).not.toBe('PENDING')
    })
  }

  for (const mode of ['GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']) {
    it(`DIRECT under ${mode}: an unlinked and a PENDING speaker get the composed evidence, no recall, PENDING appends`, async () => {
      await setGrounding(mode)
      corpusMock.fn = async () => ({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
        results: [{ id: 'a', text: 'AB-1 a', score: 0.9, citationId: 'cit-a', sourceId: 'src-a', snapshotId: 'snap-1', generation: 1 }] })
      const side = await playBoth([{ audience: 'DIRECT', speaker: 'U' }, { audience: 'DIRECT', speaker: 'P' }])
      expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
      expect(mspNames(side.runtimeMsp)).not.toContain('context')
      expectSameMsp(side)
      expectSameProvider(side)
      expect(side.runtimeDeliveries).toEqual(side.legacyDeliveries)
      // One corpus read per turn in each cohort, and the evidence reaches the model.
      expect(corpusMock.calls).toHaveLength(4)
      expect(side.built.providerCalls).toHaveLength(2)
      for (const call of side.built.providerCalls) {
        expect(call.body).toContain('cit-a')
        expect(call.body).not.toContain('private history')
        expect(call.body).not.toContain('THREAD CONTEXT PACKET')
      }
      for (const msp of [side.legacyMsp, side.runtimeMsp]) {
        expect(inboundAppends(msp).map(call => call.input.identity_assurance)).toEqual(['PENDING', 'PENDING'])
      }
      await expectPendingJobs(side.runtimeJobs)
    })
  }

  it('GROUP under GKS_CORPUS: a verified and an unlinked speaker match the legacy tick', async () => {
    await setGrounding('GKS_CORPUS')
    corpusMock.fn = async () => ({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
      results: [{ id: 'g', text: 'AB-1 g', score: 0.9, citationId: 'cit-g', sourceId: 'src-g', snapshotId: 'snap-1', generation: 1 }] })
    const side = await playBoth([{ speaker: 'A' }, { speaker: 'U' }])
    expect(side.outcomes.map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
    expectSameMsp(side)
    expectSameProvider(side)
    expect(side.runtimeDeliveries).toEqual(side.legacyDeliveries)
    expect(inboundAppends(side.runtimeMsp).map(call => call.input.identity_assurance === 'PENDING')).toEqual([false, true])
    await expectPendingJobs(side.runtimeJobs.slice(1))
  })
})

describe('W12 — the runtime cannot redirect memory or read another speaker\'s memory', () => {
  it('each job reaches only its own thread and speaker, and a group job never recalls anyone\'s private memory', async () => {
    await setOwner('CONVERSATION_RUNTIME')
    const msp = createFakeMsp()
    const directA = await admit('runtime', 0, { audience: 'DIRECT', speaker: 'A' })
    const directB = await admit('runtime', 1, { audience: 'DIRECT', speaker: 'B' })
    const groupB = await admit('runtime', 2, { speaker: 'B' })
    const built = buildRuntime({ msp })
    expect((await runRuntime(built)).map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED', 'RECORDED'])
    const byRoom = room => msp.calls.filter(call => call.name === 'msp_thread_resolve' && call.input.external_room_ref === room)
    expect(byRoom(speakers.A)).toHaveLength(2)
    expect(byRoom(speakers.B)).toHaveLength(2)
    expect(byRoom(groupId)).toHaveLength(2)
    // B's DIRECT prompt carries B's own thread history only; the group prompt none.
    expect(built.providerCalls[1].body).toContain(`private history of ${speakers.B}`)
    expect(built.providerCalls[1].body).not.toContain(`private history of ${speakers.A}`)
    expect(built.providerCalls[2].body).not.toContain('private history')
    const contexts = msp.calls.filter(call => call.name === 'msp_thread_context')
    expect(contexts.map(call => call.input.access.grant.principalId)).toEqual([persons.A.id, persons.B.id])
    expect(contexts.map(call => call.input.access.grant.externalRoomRef)).toEqual([speakers.A, speakers.B])
    expect([directA.id, directB.id, groupB.id]).toHaveLength(3)
  })

  it('a claim for one group job cannot operate on another job\'s memory, and no request field names a thread or speaker', async () => {
    await setOwner('CONVERSATION_RUNTIME')
    const msp = createFakeMsp()
    const first = await admit('runtime', 0, { speaker: 'A' })
    const second = await admit('runtime', 1, { audience: 'ROOM', speaker: 'B' })
    const { ports } = buildRuntime({ msp })
    const claim = await ports.job.claim({ claimantId: 'runtime-redirect' })
    expect(claim.jobId).toBe(first.id)
    for (const forged of [{ ...claim, jobId: second.id }, { ...claim, accountId: 'another-account' }, { ...claim, executionId: 'forged' }]) {
      await expect(ports.memory.read(forged)).rejects.toMatchObject({ code: expect.stringMatching(/^(CONVERSATION_JOB_AUTHORITY_REVOKED|MEMORY_OPERATION_ID_INVALID)$/) })
    }
    await expect(ports.memory.read({ ...claim })).resolves.toMatchObject({ status: 'COMPLETED' })
    const handlers = createConversationRuntimeRouteHandlers(buildRuntime({ msp }).core)
    for (const input of [{ threadId: 'thread-9' }, { externalRoomRef: roomId }, { speakerId: persons.B.id }, { principalId: persons.B.id }]) {
      const response = await handlers.POST(new Request('http://core.invalid/api/internal/conversation-runtime/v1/memory', {
        method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ contractVersion: 'conversation-runtime.v1', operation: 'memory', correlationId: 'w12-forge',
          idempotencyKey: 'w12-forge', deadlineAt: new Date(Date.now() + 30_000).toISOString(),
          payload: { claim: { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
            tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId },
          operation: 'read', operationId: `${claim.jobId}:memory-read`, input } }) }), { params: { operation: 'memory' } })
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('MEMORY_INPUT_INVALID')
    }
    const resolves = msp.calls.filter(call => call.name === 'msp_thread_resolve')
    expect(resolves.every(call => call.input.external_room_ref === groupId)).toBe(true)
    expect(msp.calls.filter(call => call.name === 'msp_thread_message_append').map(call => call.input.speaker_id)).toEqual([persons.A.id])
  })
})

describe('W12 — erasing one speaker removes only their contributions from a group\'s MSP thread memory', () => {
  const eraseGroup = 'synthetic-w12-erasure-memory-group'
  // What MSP still holds of a speaker: tombstoned rows (text blanked by an erasure) are gone.
  const speakerLines = (msp, personId) => msp.messages.filter(message => message.speakerId === personId && message.redactionState !== 'tombstoned')
  const pendingRows = () => prisma.agentTraceEvent.findMany({ where: { kind: MEMORY_ERASURE_KINDS.pending } })

  /** Turns from two speakers in one group, first in the SERVER cohort, then in the runtime cohort. */
  async function bothCohorts({ first, second, group }) {
    const msp = createFakeMsp({ history: false })
    await setOwner('SERVER')
    await admit('legacy', 0, { speaker: first, group })
    await admit('legacy', 1, { speaker: second, group })
    await runLegacy({ msp })
    await setOwner('CONVERSATION_RUNTIME')
    await admit('runtime', 0, { speaker: first, group })
    await admit('runtime', 1, { speaker: second, group })
    const built = buildRuntime({ msp })
    expect((await runRuntime(built)).map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
    expect(speakerLines(msp, persons[first].id)).toHaveLength(2)
    expect(speakerLines(msp, persons[second].id)).toHaveLength(2)
    expect(threadMessagesOf(msp)).toHaveLength(8)
    return { msp, built }
  }
  const threadMessagesOf = msp => msp.messages.filter(message => message.sourceEventId)

  for (const [erased, kept, label] of [['E', 'D', 'erase B'], ['F', 'G', 'erase A (the speaker who opened the group)']]) {
    it(`${label}: only that speaker's exchanges leave the group thread, in both cohorts; the other speaker and the thread still work`, async () => {
      const group = `${eraseGroup}-${erased}`
      const opener = erased === 'F' ? erased : kept
      const other = opener === erased ? kept : erased
      const { msp } = await bothCohorts({ first: opener, second: other, group })
      // The erased speaker also has a DIRECT memory thread. Core sends no MSP call
      // for it (unchanged; owner decision pending), but the MSP erase Core sends for
      // the group is tenant-wide, so it tombstones this DIRECT line too (below).
      await admit('runtime', 9, { audience: 'DIRECT', speaker: erased })
      expect((await runRuntime(buildRuntime({ msp }))).map(outcome => outcome.status)).toEqual(['RECORDED'])
      const keptLines = speakerLines(msp, persons[kept].id).map(message => message.text)
      const callsBefore = msp.calls.length

      await erasePrincipal({ tenantId: tenant.id, personId: persons[erased].id, reason: 'TEST' })
      // Nothing reached MSP inside the erasure transaction: one pending record.
      expect(msp.calls.length).toBe(callsBefore)
      const pending = (await pendingRows()).filter(row => row.payloadJson.includes(persons[erased].id))
      // Exactly one: the group thread (both cohorts' turns share it), never the DIRECT thread.
      expect(pending).toHaveLength(1)
      expect(JSON.parse(pending[0].payloadJson)).toMatchObject({ principalId: persons[erased].id,
        route: { externalRoomRef: group, audienceKind: 'GROUP', channelAccountId: account.bindingCode } })

      // Core's Server tick carries the erasure; Core is the only MSP caller.
      await runLineConversationWorker({ db: prisma, answer: async () => { throw new Error('no turn is queued') },
        env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, resolveAccount: id => prisma.lineOaAccount.findUnique({ where: { id } }),
        replyTransport: { send: async () => ({ status: 'ACCEPTED_BY_LINE' }) }, pushTransport: { send: async () => ({ status: 'ACCEPTED_BY_LINE' }) },
        threadMemory: mspPort(msp), workerId: 'w12-erasure-tick', now: () => new Date(Date.now() + MEMORY_ERASURE_GRACE_MS + 60_000) })
      // (The tick is global: it may also carry another test's pending erasure.)
      const ours = msp.erasures.filter(item => item.grant.externalRoomRef === group)
      expect(ours).toHaveLength(1)
      expect(ours[0]).toMatchObject({ principalId: persons[erased].id })
      expect(ours[0].grant).toMatchObject({ principalId: MEMORY_ERASURE_ACTOR, externalRoomRef: group,
        dataSubjectAccess: true, dataSubjectAdmin: true })
      expect(ours[0].grant.readPrivate).not.toBe(true)
      expect(ours[0].grant.writePrivate).not.toBe(true)
      const groupThread = msp.calls.find(call => call.name === 'msp_thread_resolve' && call.input.external_room_ref === group)
      // MSP's contract: every line the erased speaker wrote in the tenant is
      // tombstoned, the group's two and the DIRECT one; nobody else's line is.
      expect(speakerLines(msp, persons[erased].id)).toEqual([])
      expect(speakerLines(msp, persons[kept].id).map(message => message.text)).toEqual(keptLines)
      expect(groupThread).toBeDefined()
      const tombstoned = msp.messages.filter(message => message.redactionState === 'tombstoned')
      expect(tombstoned.every(message => message.speakerId === persons[erased].id && message.text === '')).toBe(true)
      expect(tombstoned).toHaveLength(3)
      const groupThreadId = speakerLines(msp, persons[kept].id)[0].threadId
      const directThreadId = tombstoned.find(message => message.threadId !== groupThreadId).threadId
      expect(groupThreadId).not.toBe(directThreadId)
      // AGENT replies are not the principal's content and stay, in both threads:
      // the group keeps its 8 rows (2 tombstoned), the DIRECT thread its 2 (1 tombstoned).
      const live = threadId => threadMessagesOf(msp).filter(message => message.threadId === threadId && message.redactionState !== 'tombstoned')
      expect(threadMessagesOf(msp).filter(message => message.threadId === groupThreadId)).toHaveLength(8)
      expect(live(groupThreadId)).toHaveLength(6)
      expect(live(groupThreadId).filter(message => message.direction === 'OUTBOUND')).toHaveLength(4)
      expect(live(directThreadId).map(message => message.direction)).toEqual(['OUTBOUND'])
      // The acknowledged record is redacted: Core keeps no list of the erased person's groups.
      const after = await prisma.agentTraceEvent.findMany({ where: { turnId: pending[0].turnId } })
      expect(after.every(row => row.kind === 'RETENTION_TOMBSTONE' || row.payloadJson === '{"redacted":true}')).toBe(true)
      expect(JSON.stringify(after)).not.toContain(persons[erased].id)
      expect(JSON.stringify(after)).not.toContain(group)

      // The group thread still works for the remaining speaker, in the runtime cohort.
      await setOwner('CONVERSATION_RUNTIME')
      await admit('runtime', 2, { speaker: kept, group })
      const built = buildRuntime({ msp })
      expect((await runRuntime(built)).map(outcome => outcome.status)).toEqual(['RECORDED'])
      expect(speakerLines(msp, persons[kept].id)).toHaveLength(3)
      expect(speakerLines(msp, persons[erased].id).filter(message => message.text.includes('ซูริ'))).toEqual([])
    })
  }


  describe('the erasure scanner is never blocked by records it cannot finish', () => {
    const stuckJobs = (prefix, count) => Array.from({ length: count }, (_, index) => ({ memorySyncOptIn: true, audienceKind: 'GROUP',
      channelAccountId: account.bindingCode, businessId: business.id, sourceUserId: `${prefix}-user-${index}`, recipientId: `${prefix}-room-${index}` }))
    async function seed(prefix, count, occurredAt) {
      const jobs = stuckJobs(prefix, count)
      for (const job of jobs) {
        await recordMemoryThreadErasures(prisma, { tenantId: tenant.id, principalId: `${prefix}-principal-${job.recipientId}`, jobs: [job],
          speakers: [{ channelAccountId: job.channelAccountId, providerSubject: job.sourceUserId }], now: occurredAt })
      }
      return jobs
    }
    const refusing = prefix => (name, input) => {
      if (name === 'msp_thread_principal_erase' && String(input.access?.grant?.externalRoomRef).startsWith(prefix)) {
        throw Object.assign(new Error('vault_scope_denied'), { code: 'MSP_REFUSED' })
      }
    }

    it('twelve records MSP keeps refusing do not keep a fresh erasure from being sent', async () => {
      const base = Date.now()
      await seed('stuck', 12, new Date(base - 3_600_000))
      await seed('fresh', 1, new Date(base - 1_800_000))
      const msp = createFakeMsp({ history: false })
      msp.hooks.before = refusing('stuck')
      const sent = () => msp.calls.filter(call => call.name === 'msp_thread_principal_erase').map(call => call.input.access.grant.externalRoomRef)
      // Scan 1 reaches the ten oldest (all refused, now deferred); scan 2, a second
      // later, is not handed them again and reaches the fresh record.
      await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(base) })
      expect(sent().filter(room => room.startsWith('stuck'))).toHaveLength(10)
      expect(sent().filter(room => room.startsWith('fresh'))).toEqual([])
      const second = await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(base + 1_000) })
      expect(second).toMatchObject({ acknowledged: 1 })
      expect(sent().filter(room => room.startsWith('fresh'))).toEqual(['fresh-room-0'])
      expect(sent().filter(room => room.startsWith('stuck'))).toHaveLength(12)
    })

    it('spent attempts end FAILED with one alert and no further MSP call; the record is kept for manual erasure', async () => {
      await seed('spent', 1, new Date(Date.now() - 3_600_000))
      const msp = createFakeMsp({ history: false })
      msp.hooks.before = refusing('spent')
      const alerts = []
      let clock = Date.now()
      for (let attempt = 1; attempt <= MEMORY_ERASURE_MAX_ATTEMPTS + 2; attempt += 1) {
        await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(clock), alert: entry => alerts.push(entry) })
        clock += 2 * 86_400_000
      }
      const calls = msp.calls.filter(call => call.name === 'msp_thread_principal_erase' && call.input.access.grant.externalRoomRef === 'spent-room-0')
      expect(calls).toHaveLength(MEMORY_ERASURE_MAX_ATTEMPTS)
      expect(new Set(calls.map(call => call.input.idempotency_key)).size).toBe(1)
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({ event: 'line-memory-erasure.failed', severity: 'error', attempts: MEMORY_ERASURE_MAX_ATTEMPTS, code: 'MSP_REFUSED' })
      expect(JSON.stringify(alerts[0])).not.toContain('spent-principal')
      expect(JSON.stringify(alerts[0])).not.toContain('spent-room')
      const [pending] = (await prisma.agentTraceEvent.findMany({ where: { kind: MEMORY_ERASURE_KINDS.pending } }))
        .filter(row => row.payloadJson.includes('spent-room-0'))
      expect(JSON.parse(pending.payloadJson)).toMatchObject({ principalId: 'spent-principal-spent-room-0' })
      expect(await prisma.agentTraceEvent.count({ where: { turnId: pending.turnId, kind: MEMORY_ERASURE_KINDS.failed } })).toBe(1)
    })

    it('FAILED records never grow what a tick reads: each query is bounded and a fresh erasure behind them is sent', async () => {
      // More FAILED records than one candidate page holds, all older than the fresh one.
      const failedCount = MEMORY_ERASURE_SCAN_PAGE + 20
      const base = Date.now()
      await seed('failedmass', failedCount, new Date(base - 7_200_000))
      const failedRows = (await pendingRows()).filter(row => row.payloadJson.includes('failedmass-room-'))
      expect(failedRows).toHaveLength(failedCount)
      for (const row of failedRows) {
        await appendTraceEvent(prisma, { scope: { tenantId: row.tenantId, businessId: row.businessId }, turnId: row.turnId, executionId: null,
          kind: MEMORY_ERASURE_KINDS.failed, idempotencyKey: `${row.turnId}:failed`, payload: { attemptNumber: MEMORY_ERASURE_MAX_ATTEMPTS, code: 'MSP_REFUSED' },
          occurredAt: new Date(base - 3_600_000) })
      }
      await seed('behindfailed', 1, new Date(base - 1_800_000))
      const reads = []
      const traceModel = new Proxy(prisma.agentTraceEvent, { get(target, prop) {
        const value = Reflect.get(target, prop)
        if (prop !== 'findMany') return typeof value === 'function' ? value.bind(target) : value
        return args => { reads.push(args); return target.findMany(args) }
      } })
      let pages = 0
      const observedDb = new Proxy(prisma, { get(target, prop) {
        if (prop === 'agentTraceEvent') return traceModel
        if (prop === '$queryRaw') return (...args) => { pages += 1; return target.$queryRaw(...args) }
        const value = Reflect.get(target, prop)
        return typeof value === 'function' ? value.bind(target) : value
      } })
      const msp = createFakeMsp({ history: false })
      const result = await reconcileLineMemoryErasures({ db: observedDb, threadMemory: mspPort(msp), now: () => new Date(base) })
      const sent = msp.calls.filter(call => call.name === 'msp_thread_principal_erase').map(call => call.input.access.grant.externalRoomRef)
      expect(sent).toContain('behindfailed-room-0')
      expect(sent.filter(room => room.startsWith('failedmass'))).toEqual([])
      expect(result.acknowledged).toBeGreaterThanOrEqual(1)
      // The FAILED records occupied no candidate page, and no read carried a
      // list of held or failed turns: the old unbounded `notIn` filter is gone.
      expect(pages).toBeLessThanOrEqual(MEMORY_ERASURE_SCAN_MAX_PAGES)
      for (const args of reads) {
        const text = JSON.stringify(args?.where ?? {})
        expect(text).not.toContain('notIn')
        for (const list of [args?.where?.id?.in, args?.where?.turnId?.in].filter(Boolean)) {
          expect(list.length).toBeLessThanOrEqual(MEMORY_ERASURE_SCAN_PAGE)
        }
      }
      // A record whose attempts are spent is still never retried.
      await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(base + 86_400_000) })
      expect(msp.calls.filter(call => call.name === 'msp_thread_principal_erase'
        && String(call.input.access.grant.externalRoomRef).startsWith('failedmass'))).toEqual([])
    })
  })

  it('is idempotent: a failed attempt retries under the same key, a repeat scan or a repeat erasure sends nothing more', async () => {
    const group = `${eraseGroup}-idempotent`
    const msp = createFakeMsp({ history: false })
    await setOwner('CONVERSATION_RUNTIME')
    // Re-create E's identity for this test: an earlier test erased E.
    const subject = 'synthetic-w12-speaker-e2'
    speakers.E2 = subject
    persons.E2 = await (async () => {
      const person = await prisma.person.create({ data: { code: 'PER-W12-E2', displayName: 'Synthetic W12 speaker E2' } })
      const linkedAt = new Date()
      await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: person.id, provider: 'LINE', providerSubject: subject, verifiedAt: linkedAt, linkedAt } })
      await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: person.id, channel: 'LINE', channelAccountId: account.bindingCode,
        providerSubject: subject, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
      return person
    })()
    await admit('runtime', 0, { speaker: 'G', group })
    await admit('runtime', 1, { speaker: 'E2', group })
    expect((await runRuntime(buildRuntime({ msp }))).map(outcome => outcome.status)).toEqual(['RECORDED', 'RECORDED'])
    await erasePrincipal({ tenantId: tenant.id, personId: persons.E2.id, reason: 'TEST' })
    const [pending] = (await pendingRows()).filter(row => row.payloadJson.includes(group))
    expect(pending).toBeDefined()

    // MSP down: the record stays PENDING with one attempt; nothing is lost.
    msp.hooks.before = name => { if (name === 'msp_thread_principal_erase') throw transportError() }
    // Within the grace period (a late append may still be in flight) nothing is sent.
    expect(await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp) })).toMatchObject({ scanned: 0 })
    expect(msp.calls.filter(call => call.name === 'msp_thread_principal_erase')).toEqual([])
    const t0 = new Date(Date.now() + MEMORY_ERASURE_GRACE_MS + 1_000)
    expect(await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => t0 })).toMatchObject({ acknowledged: 0 })
    expect(speakerLines(msp, persons.E2.id)).toHaveLength(1)
    // Within the backoff nothing is retried.
    expect(await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(t0.getTime() + 100) }))
      .toMatchObject({ scanned: 0 })
    msp.hooks.before = null
    const t1 = new Date(t0.getTime() + MEMORY_ERASURE_BACKOFF_MS[0] + 1_000)
    expect(await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => t1 })).toMatchObject({ acknowledged: 1 })
    // The acknowledging scan itself redacts the record.
    const record = await prisma.agentTraceEvent.findMany({ where: { turnId: pending.turnId } })
    expect(record.some(row => row.kind === 'RETENTION_TOMBSTONE')).toBe(true)
    expect(JSON.stringify(record)).not.toContain(persons.E2.id)
    const eraseCalls = msp.calls.filter(call => call.name === 'msp_thread_principal_erase'
      && call.input.access.grant.externalRoomRef === group)
    // One failed attempt, then one acknowledged attempt, both under one key.
    expect(eraseCalls).toHaveLength(2)
    expect(new Set(eraseCalls.map(call => call.input.idempotency_key)).size).toBe(1)
    expect(speakerLines(msp, persons.E2.id)).toEqual([])
    expect(speakerLines(msp, persons.G.id)).toHaveLength(1)

    // Nothing more: a repeat scan, and a repeat erasure of the same person.
    const callsAfter = msp.calls.length
    await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(t1.getTime() + 600_000) })
    try { await erasePrincipal({ tenantId: tenant.id, personId: persons.E2.id, reason: 'TEST' }) } catch { /* an already-erased person may be refused */ }
    await reconcileLineMemoryErasures({ db: prisma, threadMemory: mspPort(msp), now: () => new Date(t1.getTime() + 1_200_000) })
    expect(msp.calls.length).toBe(callsAfter)
    expect((await pendingRows()).filter(row => row.payloadJson.includes(group))).toEqual([])
  })

})
