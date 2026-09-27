import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { createMspThreadMemoryPort } from '@/modules/agent/msp-thread-memory-port'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { sha256 } from '@/modules/agent/execution-trace'
import { memoryReceiptKey } from '@/modules/line-oa-studio/application/runtime-memory-receipts'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-171 — memory-sync opt-in turns from an UNVERIFIED LINE sender run in
//   the Conversation Runtime cohort (owner decision 2026-09-27, W11) with exact legacy
//   parity: no private recall, the question and the reply appended to the MSP thread
//   with PENDING assurance and no person, no injection receipt, no person scope.
// Parity: every case admits the same message from the same unverified sender to one
//   account twice, first while it is SERVER-owned (the legacy tick's job) and then
//   while it is runtime-owned (the runtime's job). The legacy tick runs its real answer
//   port, `createServerLineAnswer` with the real MSP thread-memory port and the default
//   context assembler; the runtime runs over the real Core route handlers, Core's own
//   `prepare` and Core's memory façade with the same port. Each side has a fresh MSP
//   stand-in (API-010 shape: stable threads, source-event deduplication). The MSP
//   calls, their signed claims and the LINE deliveries are compared byte for byte,
//   after mapping the two jobs' own ids (event id, inbound message id) onto each other.
// Core alone decides the PENDING mode, from the job's CHANNEL_IDENTITY_ADMITTED record;
//   the v1 `memory` request carries no field that could select it.
// @spec ADR-106 D2-D4 and its 2026-09-27 amendment; SDD-110
// @tested tests/integration/conversation-runtime-unverified-memory.test.js
const serviceToken = 'synthetic-unverified-memory-core-token-0001'
const mspServiceKey = 'synthetic-msp-unverified-service-key-00001'
const sealKey = '4f'.repeat(32)
const stranger = 'Usynthetic-unverified-memory-stranger'
const pendingCustomer = 'Usynthetic-unverified-memory-pending'
const verifiedCustomer = 'Usynthetic-unverified-memory-verified'
const answerText = 'มีชุดของขวัญพรีเมียมค่ะ'
// A catalogue record, so the provider-failure fallback (`deterministicFallback`) has its fields.
const evidenceFixture = { records: [{ product_code: 'GIFT-W11', name: 'ชุดของขวัญพรีเมียม', sell_price: 590, moq: 10,
  unit: 'ชุด', currency: 'THB', as_of: '2026-09-01T00:00:00.000Z' }] }
const outOfHoursText = 'ขณะนี้ปิดทำการ กรุณาติดต่อใหม่ในเวลาทำการค่ะ'
const memoryEnv = { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' }

let tenant, business, account, sequence = 0
let evidence = evidenceFixture
let providerFails = false
let openJobs = []

// Instants are pinned to "yesterday" so the ticks and claims here see only this
// suite's jobs as due.
const yesterdayUtc = (() => {
  const today = new Date()
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1)
})()
let minute = 9 * 60 + 5
const bangkokMinute = minutes => new Date(yesterdayUtc + minutes * 60_000 - 7 * 3600_000)
let clock = bangkokMinute(minute)
const now = () => new Date(clock.getTime())
const tick = () => { minute += 2; clock = bangkokMinute(minute) }

/** API-010 stand-in, as in the W5 suite: stable threads per route, one earlier exchange, dedup by source event id. */
function createFakeMsp() {
  const calls = []
  const threads = new Map()
  const messages = []
  const injections = []
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
        const exchangeId = next('exchange')
        messages.push({ threadId: thread.threadId, messageId: next('message'), exchangeId, direction: 'INBOUND',
          speakerId: 'earlier-speaker', speakerKind: 'HUMAN', text: 'ข้อความส่วนตัวก่อนหน้า', sessionId: 'session-1' })
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
        direction: input.direction, speakerId: input.speaker_id, text: input.text, sourceEventId: input.source_event_id,
        identityAssurance: input.identity_assurance, personId: input.person_id ?? null, sessionId: input.session_id ?? 'session-1' }
      messages.push(message)
      return { message: { messageId: message.messageId, exchangeId: message.exchangeId, sequence: message.sequence },
        session: { sessionId: message.sessionId }, deduplicated: false }
    }
    if (name === 'msp_thread_context') {
      return { thread: [...threads.values()].find(thread => thread.threadId === input.thread_id), session: { sessionId: 'session-1' },
        participants: [], recentExchanges: [], protectedRecords: [], threadSummaries: [], coverageGap: null }
    }
    if (name === 'msp_thread_injection_record') {
      injections.push(input.state)
      return { recorded: true, state: input.state }
    }
    return {}
  }
  async function transport(name, input) {
    calls.push({ name, input: JSON.parse(JSON.stringify(input)) })
    if (hooks.before) await hooks.before(name, input)
    return handle(name, input)
  }
  return { transport, calls, messages, injections, hooks }
}
const mspPort = msp => createMspThreadMemoryPort({ transport: msp.transport, serviceKey: mspServiceKey, workspaceId: 'w11-workspace' })
const mspNames = msp => msp.calls.map(call => call.name === 'msp_thread_message_append' ? `append ${call.input.direction}`
  : call.name === 'msp_thread_injection_record' ? `injection ${call.input.state}` : call.name.replace('msp_thread_', ''))
const appended = (msp, direction) => msp.messages.filter(message => message.direction === direction && message.sourceEventId)

/** Signed calls without per-call signing material, with one job's own ids mapped onto the other's. */
function comparable(calls, idMap = {}) {
  let text = JSON.stringify(calls.map(({ name, input }) => {
    const { access, ...rest } = input
    const grant = access?.grant ? (({ nonce, expiresAt, payloadHash, ...claims }) => claims)(access.grant) : null
    return { name, input: rest, grant, signed: typeof access?.signature === 'string' }
  }))
  for (const [from, to] of Object.entries(idMap)) text = text.split(from).join(to)
  return JSON.parse(text)
}

const transport = sink => ({
  resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
  replyTransport: { send: async ({ messages }) => { sink.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `reply-${sink.length}` } } },
  pushTransport: { send: async ({ messages }) => { sink.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `push-${sink.length}` } } },
})

/** The model both sides call: the same answer, or the same provider failure. */
function model(inputs) {
  return async input => {
    inputs.push({ question: input.question, evidence: input.evidence, contextPacket: input.contextPacket ?? null })
    if (providerFails) throw Object.assign(new Error('MODEL_PROVIDER_HTTP_ERROR'), { code: 'MODEL_PROVIDER_HTTP_ERROR', status: 502 })
    return answerText
  }
}

async function legacyTick(msp, { sink, inputs, hooks = {} }) {
  const generate = model(inputs)
  const answer = createServerLineAnswer({ threadMemory: mspPort(msp), runtimeFactory: async () => ({
    businessKnowledge: { query: async () => evidence },
    resolveModel: async () => ({ provider: 'synthetic', model: 'synthetic-w11-model', generate: async input => {
      await hooks.beforeModel?.()
      return { provider: 'synthetic', model: 'synthetic-w11-model', status: 'ok', text: await generate(input) }
    } }) }) })
  return runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, workerId: `server-w11-${++sequence}`,
    now, answer, executionConcurrency: 1, ...transport(sink) })
}

function buildRuntime(msp, { sink, inputs, hooks = {} }) {
  const wire = []
  const core = createConversationRuntimeCore({ db: prisma, now,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    businessPorts: async () => ({ businessKnowledge: { query: async () => evidence } }),
    credentialResolver: async () => ({ provider: 'prp', model: 'synthetic-w11-model', apiKey: 'synthetic-provider-key' }),
    threadMemoryFactory: () => mspPort(msp),
    linePorts: () => transport(sink) })
  const handlers = createConversationRuntimeRouteHandlers(core)
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken, fetchFn: async (url, init = {}) => {
    const operation = new URL(url).pathname.split('/').pop()
    if (init.body) wire.push(JSON.parse(init.body))
    return handlers.POST(new Request(url, init), { params: { operation } })
  } })
  const generate = model(inputs)
  const ports = createCorePorts({ client, model: { generate: async input => { await hooks.beforeModel?.(); return generate(input) } } })
  return { core, ports, wire, handlers }
}

async function admit(owner, text, { user = stranger, env = memoryEnv } = {}) {
  await prisma.lineOaAccount.update({ where: { id: account.id }, data: { runtimeOwner: owner } })
  const eventId = `synthetic-w11-${++sequence}`
  const at = now()
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...env },
    correlationId: eventId, now: at, ingressReceivedAt: at,
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: at.getTime(),
      source: { type: 'user', userId: user }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}
const jobRow = id => prisma.lineConversationJob.findUnique({ where: { id } })
const erase = async jobId => {
  const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId }, include: { inbound: true } })
  await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [job.inbound.conversationId] }))
}

/** One message, admitted once per cohort, answered by each cohort's own consumer. */
async function bothPaths(text, { user = stranger, runtimeTurns = 3, legacyHooks, runtimeHooks, mortalAt } = {}) {
  tick()
  const legacyJob = await admit('SERVER', text, { user })
  expect(legacyJob.runtimeOwner).toBe('SERVER')
  const legacyMsp = createFakeMsp()
  const legacy = { sink: [], inputs: [] }
  await legacyTick(legacyMsp, { ...legacy, hooks: legacyHooks?.(legacyJob) })
  // Admitted after the legacy tick, at the same instant: both jobs share the sender's
  // one CRM conversation, and erasure works per conversation.
  const runtimeJob = await admit('CONVERSATION_RUNTIME', text, { user })
  expect(runtimeJob).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true })
  const runtimeMsp = createFakeMsp()
  const runtime = { sink: [], inputs: [] }
  const built = buildRuntime(runtimeMsp, { ...runtime, hooks: runtimeHooks?.(runtimeJob) })
  const outcomes = []
  for (let turn = 0; turn < runtimeTurns; turn += 1) {
    const ports = mortalAt && turn === 0 ? mortal(built.ports, mortalAt) : built.ports
    const outcome = await createConversationRuntime({ ports, claimantId: `runtime-w11-${++sequence}`, now }).runOne()
    outcomes.push(outcome)
    const current = await jobRow(runtimeJob.id)
    if (outcome.status === 'IDLE' || ['RECORDED', 'FAILED', 'UNKNOWN', 'CANCELLED'].includes(current.status)) break
    // A killed or deferred turn is reclaimed after its lease lapses.
    if (current.status === 'CLAIMED') await prisma.lineConversationJob.update({ where: { id: runtimeJob.id }, data: { leaseExpiresAt: new Date(clock.getTime() - 1) } })
  }
  const legacyInbound = (await prisma.lineConversationJob.findUnique({ where: { id: legacyJob.id } })).inboundMessageId
  const runtimeInbound = (await prisma.lineConversationJob.findUnique({ where: { id: runtimeJob.id } })).inboundMessageId
  const idMap = { [legacyJob.eventId]: runtimeJob.eventId, [legacyInbound]: runtimeInbound }
  return { legacyJob: await jobRow(legacyJob.id), runtimeJob: await jobRow(runtimeJob.id), legacyMsp, runtimeMsp, legacy, runtime,
    outcomes, wire: built.wire, idMap }
}

/** Every port throws once `dies` says the process died; nothing after that reaches Core. */
function mortal(ports, dies) {
  let dead = false
  const wrap = (group, name, fn) => async (...args) => {
    if (dead) throw Object.assign(new Error('RUNTIME_KILLED'), { code: 'RUNTIME_KILLED' })
    const result = await fn(...args)
    if (`${group}.${name}` === dies) dead = true
    return result
  }
  return Object.fromEntries(Object.entries(ports).map(([group, methods]) => [group,
    Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, wrap(group, name, fn)]))]))
}

function expectPendingParity(result, { names }) {
  expect(mspNames(result.legacyMsp)).toEqual(names)
  expect(mspNames(result.runtimeMsp)).toEqual(names)
  expect(comparable(result.runtimeMsp.calls)).toEqual(comparable(result.legacyMsp.calls, result.idMap))
  // No private recall, no injection receipt, and the question carries no person.
  for (const msp of [result.legacyMsp, result.runtimeMsp]) {
    expect(msp.calls.map(call => call.name)).not.toContain('msp_thread_context')
    expect(msp.injections).toEqual([])
    for (const message of appended(msp, 'INBOUND')) expect(message).toMatchObject({ identityAssurance: 'PENDING', personId: null })
    expect(msp.calls.every(call => call.input.access?.grant?.writePrivate !== true)).toBe(true)
  }
  // The model on each side received no memory packet.
  expect(result.runtime.inputs.map(input => input.contextPacket)).toEqual(result.legacy.inputs.map(() => null))
  expect(result.legacy.inputs.map(input => input.contextPacket)).toEqual(result.legacy.inputs.map(() => null))
  expect(result.runtime.sink).toEqual(result.legacy.sink)
  if (result.legacy.sink.length) {
    const [legacyText, runtimeText] = [result.legacy.sink[0][0].text, result.runtime.sink[0][0].text]
    expect(Buffer.from(runtimeText, 'utf8').equals(Buffer.from(legacyText, 'utf8'))).toBe(true)
  }
  expect(result.runtimeJob.answerText).toBe(result.legacyJob.answerText)
  expect(result.runtimeJob.status).toBe(result.legacyJob.status)
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Unverified memory runtime fixture', code: 'PF-CR-UMEM' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Unverified memory tenant', code: 'TNT-CR-UMEM' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Unverified memory business', code: 'BUS-CR-UMEM' })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Synthetic W11 connection', externalAccountId: 'synthetic-w11-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: 'cr-w11-account', displayName: 'Synthetic W11 OA', bindingCode: 'cr-w11-binding', status: 'CONNECTED', serverEnabled: true,
    transportMode: 'CLOUD', runtimeOwner: 'CONVERSATION_RUNTIME' } })
  // A customer whose LINE identity is PENDING (a member, so a verified link would open private memory).
  const pending = await prisma.person.create({ data: { code: 'PER-CR-UMEM-PENDING', displayName: 'Synthetic pending customer' } })
  await prisma.membership.create({ data: { personId: pending.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE' } })
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: pending.id, provider: 'LINE', providerSubject: pendingCustomer } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: pending.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: pendingCustomer, status: 'PENDING' } })
  const verified = await prisma.person.create({ data: { code: 'PER-CR-UMEM-VERIFIED', displayName: 'Synthetic verified customer' } })
  await prisma.membership.create({ data: { personId: verified.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE' } })
  const linkedAt = new Date(Date.now() - 86_400_000)
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: verified.id, provider: 'LINE',
    providerSubject: verifiedCustomer, verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: verified.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: verifiedCustomer, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY', 'SENDING'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_W11_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  evidence = evidenceFixture
  providerFails = false
  await prisma.lineOaAccount.update({ where: { id: account.id },
    data: { runtimeOwner: 'CONVERSATION_RUNTIME', businessHoursOpen: null, businessHoursClose: null, outOfHoursReplyText: null } })
  const pendingWhere = { tenantId: tenant.id, providerSubject: pendingCustomer }
  await prisma.channelIdentity.updateMany({ where: pendingWhere, data: { status: 'PENDING', verifiedAt: null, linkedAt: null } })
  await prisma.externalIdentity.updateMany({ where: pendingWhere, data: { verifiedAt: null, linkedAt: null } })
})

async function verifyPendingCustomer() {
  const at = new Date(Date.now() - 1000)
  const where = { tenantId: tenant.id, providerSubject: pendingCustomer }
  await prisma.externalIdentity.updateMany({ where, data: { verifiedAt: at, linkedAt: at } })
  await prisma.channelIdentity.updateMany({ where, data: { status: 'ACTIVE', verifiedAt: at, linkedAt: at } })
}

const PENDING_TURN = ['resolve', 'append INBOUND', 'resolve', 'append OUTBOUND']

describe('unverified memory-sync turns: byte parity with the legacy tick', () => {
  it('memory-enabled DIRECT: the answer, and the question and reply appended PENDING with no person and no recall', async () => {
    const result = await bothPaths('มีชุดของขวัญอะไรบ้างคะ')
    expect(result.outcomes.at(-1)).toMatchObject({ status: 'RECORDED' })
    expectPendingParity(result, { names: PENDING_TURN })
    expect(result.runtime.sink).toEqual([[{ type: 'text', text: answerText }]])
    expect(appended(result.runtimeMsp, 'OUTBOUND').map(message => message.text)).toEqual([answerText])
    // Core, not the runtime, chose the mode; the read receipt records it.
    const receipt = await prisma.agentTraceEvent.findFirst({ where: { turnId: result.runtimeJob.id,
      idempotencyKey: memoryReceiptKey(result.runtimeJob.id, 'read') } })
    expect(JSON.parse(receipt.payloadJson)).toMatchObject({ identityAssurance: 'PENDING', privateMemoryAllowed: false, contextPacketJson: null })
    expect(result.wire.filter(call => call.operation === 'memory').map(call => `${call.payload.operation} ${call.payload.operationId.split(':').pop()}`))
      .toEqual(['read memory-read', 'receipt memory-append', 'append memory-append'])
    // `resolve` named no person.
    expect(result.wire.filter(call => call.operation === 'memory').every(call => Object.keys(call.payload.input).every(key => ['text', 'state'].includes(key))))
      .toBe(true)
  })

  it('no evidence: the fixed reply, appended PENDING, and no model', async () => {
    evidence = { records: [] }
    const result = await bothPaths('มีบริการซ่อมรถไหมคะ')
    expectPendingParity(result, { names: PENDING_TURN })
    expect(result.legacy.inputs).toEqual([])
    expect(result.runtime.inputs).toEqual([])
    expect(result.runtimeJob.status).toBe('RECORDED')
  })

  it('provider failure: the same evidence fallback, appended PENDING', async () => {
    providerFails = true
    const result = await bothPaths('มีชุดของขวัญอะไรบ้างคะ')
    expectPendingParity(result, { names: PENDING_TURN })
    expect(result.runtimeJob.status).toBe('RECORDED')
    expect(result.runtimeJob.answerText).not.toBe(answerText)
    expect(appended(result.runtimeMsp, 'OUTBOUND').map(message => message.text)).toEqual([result.legacyJob.answerText])
  })

  it('out of hours: the same admission-time reply, and no MSP call on either side', async () => {
    await prisma.lineOaAccount.update({ where: { id: account.id },
      data: { businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: outOfHoursText } })
    const saved = minute
    minute = 20 * 60
    const result = await bothPaths('ยังเปิดอยู่ไหมคะ')
    minute = saved
    expectPendingParity(result, { names: [] })
    expect(result.runtime.sink).toEqual([[{ type: 'text', text: outOfHoursText }]])
    expect(result.runtimeJob.status).toBe('RECORDED')
  })

  it('erasure mid-turn: no reply appended, nothing sent, the job erased on both sides', async () => {
    const eraseOnce = job => {
      let done = false
      return { beforeModel: async () => { if (!done) { done = true; await erase(job.id) } } }
    }
    const result = await bothPaths('มีชุดของขวัญอะไรบ้างคะ', { legacyHooks: eraseOnce, runtimeHooks: eraseOnce })
    expect(mspNames(result.legacyMsp)).toEqual(['resolve', 'append INBOUND', 'resolve'])
    expect(mspNames(result.runtimeMsp)).toEqual(mspNames(result.legacyMsp))
    expect(comparable(result.runtimeMsp.calls)).toEqual(comparable(result.legacyMsp.calls, result.idMap))
    for (const msp of [result.legacyMsp, result.runtimeMsp]) expect(appended(msp, 'OUTBOUND')).toEqual([])
    expect(result.legacy.sink).toEqual([])
    expect(result.runtime.sink).toEqual([])
    for (const job of [result.legacyJob, result.runtimeJob]) expect(job).toMatchObject({ status: 'CANCELLED', errorCode: 'PDPA_ERASURE', answerText: null })
  })

  it.each(['memory.read', 'memory.append'])('killed after %s and reclaimed: one question, one reply, one delivery, as legacy', async dies => {
    const result = await bothPaths('มีชุดของขวัญอะไรบ้างคะ', { mortalAt: dies, runtimeTurns: 4 })
    expect(result.outcomes[0]).toMatchObject({ status: expect.stringMatching(/^(UNKNOWN|FAILED)$/) })
    expect(result.outcomes.at(-1)).toMatchObject({ status: 'RECORDED' })
    expectPendingParity(result, { names: PENDING_TURN })
    expect(appended(result.runtimeMsp, 'INBOUND')).toHaveLength(1)
    expect(appended(result.runtimeMsp, 'OUTBOUND')).toHaveLength(1)
    // One model call in all: a reclaim replays the recorded model result.
    expect(result.runtime.inputs).toHaveLength(1)
  })
})

describe('out of hours with memory sync, verified sender', () => {
  // Found while porting W11: the settle-time memory fence asked an out-of-hours
  // memory-sync turn for an MSP append that no path ever makes, so a verified
  // sender's out-of-hours reply was never sent either.
  it('is delivered with the admission-time reply and no MSP call, as on the Server path', async () => {
    await prisma.lineOaAccount.update({ where: { id: account.id },
      data: { businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: outOfHoursText } })
    const saved = minute
    minute = 21 * 60
    const result = await bothPaths('ยังเปิดอยู่ไหมคะ', { user: verifiedCustomer })
    minute = saved
    expect(result.runtime.sink).toEqual([[{ type: 'text', text: outOfHoursText }]])
    expect(result.runtime.sink).toEqual(result.legacy.sink)
    expect(result.runtimeMsp.calls).toEqual([])
    expect(result.runtimeJob.status).toBe('RECORDED')
  })
})

describe('Core alone decides the PENDING mode', () => {
  it('a sender verified mid-turn stays PENDING: no recall, no person, no injection, even on the replayed read', async () => {
    tick()
    const job = await admit('CONVERSATION_RUNTIME', 'จำได้ไหมคะ', { user: pendingCustomer })
    const msp = createFakeMsp()
    const built = buildRuntime(msp, { sink: [], inputs: [] })
    const claim = await built.ports.job.claim({ claimantId: 'runtime-w11-mid-turn' })
    expect(claim.jobId).toBe(job.id)
    const authority = await built.ports.authority.resolve(claim)
    expect(authority.scope).toMatchObject({ identityId: null, identityState: 'UNVERIFIED' })
    await verifyPendingCustomer()
    const turn = await built.ports.context.prepare(claim, authority)
    expect(turn.memorySync).toBe(true)
    const read = await built.ports.memory.read(claim)
    expect(read.result).toEqual({ contextPacket: null, receipt: { contextReceiptId: expect.any(String), policyDecision: 'DENY' } })
    expect((await built.ports.memory.read(claim)).result.contextPacket).toBeNull()
    await expect(built.ports.memory.receipt(claim, 'injection', { state: 'RESOLVED' }))
      .rejects.toMatchObject({ code: 'MEMORY_INJECTION_NOT_APPLICABLE' })
    await built.ports.memory.append(claim, answerText)
    expect(mspNames(msp)).toEqual(PENDING_TURN)
    expect(appended(msp, 'INBOUND')).toEqual([expect.objectContaining({ identityAssurance: 'PENDING', personId: null })])
    expect(msp.injections).toEqual([])
  })

  it('a verified sender\'s memory turn is never PENDING: its recall runs', async () => {
    tick()
    const job = await admit('CONVERSATION_RUNTIME', 'จำได้ไหมคะ', { user: verifiedCustomer })
    const msp = createFakeMsp()
    const built = buildRuntime(msp, { sink: [], inputs: [] })
    const claim = await built.ports.job.claim({ claimantId: 'runtime-w11-verified' })
    expect(claim.jobId).toBe(job.id)
    await built.ports.memory.read(claim)
    expect(mspNames(msp)).toEqual(['resolve', 'append INBOUND', 'resolve', 'context'])
    expect(appended(msp, 'INBOUND')).toEqual([expect.objectContaining({ identityAssurance: 'VERIFIED' })])
  })

  it('the memory request has no field that selects a mode: Core refuses one before any MSP call', async () => {
    tick()
    const job = await admit('CONVERSATION_RUNTIME', 'จำได้ไหมคะ', { user: verifiedCustomer })
    const msp = createFakeMsp()
    const built = buildRuntime(msp, { sink: [], inputs: [] })
    const claim = await built.ports.job.claim({ claimantId: 'runtime-w11-forge-mode' })
    expect(claim.jobId).toBe(job.id)
    const ref = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
      tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }
    const post = payload => built.handlers.POST(new Request('http://core.invalid/api/internal/conversation-runtime/v1/memory', {
      method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 'conversation-runtime.v1', operation: 'memory', correlationId: 'w11-forge',
        idempotencyKey: 'w11-forge', deadlineAt: new Date(Date.now() + 60_000).toISOString(), payload }) }), { params: { operation: 'memory' } })
    for (const payload of [
      { claim: ref, operation: 'read', operationId: `${job.id}:memory-read`, input: { identityState: 'UNVERIFIED' } },
      { claim: ref, operation: 'read', operationId: `${job.id}:memory-read`, input: {}, identityAssurance: 'PENDING' },
      { claim: { ...ref, identityState: 'UNVERIFIED' }, operation: 'read', operationId: `${job.id}:memory-read`, input: {} },
    ]) {
      const response = await post(payload)
      expect(response.status).toBe(400)
    }
    expect(msp.calls).toEqual([])
  })

  it('a stored read is replayed only under the mode it was read in', async () => {
    tick()
    const job = await admit('CONVERSATION_RUNTIME', 'จำได้ไหมคะ', { user: pendingCustomer })
    const msp = createFakeMsp()
    const built = buildRuntime(msp, { sink: [], inputs: [] })
    const claim = await built.ports.job.claim({ claimantId: 'runtime-w11-mode-replay' })
    expect(claim.jobId).toBe(job.id)
    await built.ports.memory.read(claim)
    // Tamper below the contract: remove Core's admission record and verify the sender,
    // so the job now reads as VERIFIED. The PENDING receipt is not replayed for it.
    await prisma.agentTraceEvent.deleteMany({ where: { turnId: job.id, kind: 'CHANNEL_IDENTITY_ADMITTED' } })
    await verifyPendingCustomer()
    const calls = msp.calls.length
    await expect(built.ports.memory.read(claim)).rejects.toMatchObject({ code: 'LINE_MEMORY_SCOPE_MISMATCH' })
    await expect(built.ports.memory.append(claim, answerText)).rejects.toMatchObject({ code: 'LINE_MEMORY_SCOPE_MISMATCH' })
    expect(msp.calls.length).toBe(calls)
    expect(sha256(job.sourceUserId)).toMatch(/^[0-9a-f]{64}$/)
  })
})
