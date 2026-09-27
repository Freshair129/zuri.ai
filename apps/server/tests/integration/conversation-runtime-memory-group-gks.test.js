import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
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
const speakers = { A: 'synthetic-w12-speaker-a', B: 'synthetic-w12-speaker-b', C: 'synthetic-w12-speaker-c' }
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
      for (const message of messages.filter(item => item.threadId === input.thread_id)) {
        let exchange = exchanges.find(item => item.exchangeId === message.exchangeId)
        if (!exchange) exchanges.push(exchange = { exchangeId: message.exchangeId, messages: [] })
        exchange.messages.push({ sequence: message.sequence, speakerId: message.speakerId, speakerKind: message.speakerKind,
          direction: message.direction, text: message.text })
      }
      return { thread, session: { sessionId: 'session-1' }, participants: [{ speakerId: 'zuri-line-agent', speakerKind: 'AGENT' }],
        recentExchanges: exchanges.slice(-input.recent_exchange_count), protectedRecords: [], threadSummaries: [], coverageGap: null }
    }
    if (name === 'msp_thread_injection_record') return { recorded: true, state: input.state }
    return {}
  }
  async function transport(name, input) {
    calls.push({ name, input: JSON.parse(JSON.stringify(input)) })
    corpusMock.timeline.push(`msp:${name}`)
    if (hooks.before) await hooks.before(name, input)
    return handle(name, input)
  }
  return { transport, calls, messages, hooks }
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

function buildRuntime({ msp, records } = {}) {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...knowledgeEnv },
    credentialResolver: async () => ({ provider: 'openrouter', model: 'test-model', apiKey: providerKey }),
    businessPorts: { businessKnowledge: businessKnowledge(records) },
    threadMemoryFactory: () => mspPort(msp),
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

  it('erasing the speaker who opened a group erases every queued turn of that group in both cohorts; no MSP call follows', async () => {
    const turns = [{ speaker: 'C', group: erasureGroupId }, { speaker: 'B', group: erasureGroupId }]
    await setOwner('SERVER')
    const legacyJobs = []
    for (const [index, turn] of turns.entries()) legacyJobs.push(await admit('legacy', index, turn))
    await setOwner('CONVERSATION_RUNTIME')
    const runtimeJobs = []
    for (const [index, turn] of turns.entries()) runtimeJobs.push(await admit('runtime', index, turn))
    expect(legacyJobs.map(job => job.runtimeOwner)).toEqual(['SERVER', 'SERVER'])
    expect(runtimeJobs.map(job => job.runtimeOwner)).toEqual(['CONVERSATION_RUNTIME', 'CONVERSATION_RUNTIME'])
    await erasePrincipal({ tenantId: tenant.id, personId: persons.C.id, reason: 'TEST' })
    const erased = await prisma.lineConversationJob.findMany({ where: { id: { in: [...legacyJobs, ...runtimeJobs].map(job => job.id) } } })
    expect(erased.every(job => job.errorCode === 'PDPA_ERASURE')).toBe(true)
    await setOwner('SERVER')
    const legacyMsp = createFakeMsp()
    await runLegacy({ msp: legacyMsp })
    await setOwner('CONVERSATION_RUNTIME')
    const runtimeMsp = createFakeMsp()
    const built = buildRuntime({ msp: runtimeMsp })
    expect(await runRuntime(built)).toEqual([])
    expect(legacyMsp.calls).toEqual([])
    expect(runtimeMsp.calls).toEqual([])
    expect(built.providerCalls).toEqual([])
    expect(deliveries).toEqual([])
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
