import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { isAccountWithinBusinessHours } from '@/modules/line-oa-studio/domain/line-oa-account'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-244 — out-of-hours replies for an account opted into the Conversation Runtime
//   cohort: Core decides at admission (the same `isAccountWithinBusinessHours` call,
//   Asia/Bangkok), snapshots the reply onto the job and hands the runtime an
//   OUT_OF_HOURS turn; the runtime completes it with no Work, credential or model call;
//   Core commits READY and its trace; delivery goes through the Core-coordinated send.
// @req FR-149, FR-171 — the same durable send state and idempotency identities.
// @spec ADR-094 D6 option A; ADR-106 D1-D4; SDD-110
// Parity is measured against the Server path's actual output: every case admits the
// same message at the same instant to a SERVER-cohort account and to a runtime-cohort
// account with identical hours and reply, drives each through its real consumer (the
// Server tick worker; the runtime turn loop over the real Core route handlers) and
// compares what each one delivered. Only the LINE transport is a local fake, and the
// HTTP socket hop is an in-process fetch that still serialises every request/response.
// @tested tests/integration/conversation-runtime-out-of-hours.test.js
const serviceToken = 'synthetic-out-of-hours-core-token-000000001'
const sealKey = '7d'.repeat(32)
const lineUser = 'synthetic-ooh-line-user'
const unverifiedUser = 'synthetic-ooh-unverified-user'
const replyText = 'ขณะนี้ปิดทำการ กรุณาติดต่อใหม่ในเวลาทำการ 09:00–18:00 น.'
const hours = { businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: replyText }

let tenant, business, provider, runtimeAccount, serverAccount, sequence = 0
let clock = new Date()
let wire = []
let runtimeDeliveries = []
let serverDeliveries = []
let openJobs = []

// Instants are pinned to "yesterday" so every deadline the durable rows carry
// (reply token, lease, job TTL) is internally consistent with the injected clock
// while staying in the real past, where no other suite's rows are ever due.
const yesterdayUtc = (() => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
})()
/** `HH:MM:SS` on the Asia/Bangkok wall clock (UTC+7, no DST), as a Date. */
const bangkok = hms => {
  const [h, m, s] = hms.split(':').map(Number)
  return new Date(yesterdayUtc + ((h * 60 + m) * 60 + s) * 1000 - 7 * 3600_000)
}

function inProcessFetch(handlers, faults = {}) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    if (init.body) {
      const envelope = JSON.parse(init.body)
      wire.push({ operation: envelope.operation, payload: envelope.payload })
    }
    // A transient Core outage for one call: the request never reaches Core.
    if (faults[operation] > 0) {
      faults[operation] -= 1
      return new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: false,
        error: { code: 'CORE_OPERATION_UNAVAILABLE', retryable: true } }), { status: 503, headers: { 'content-type': 'application/json' } })
    }
    const request = new Request(target, init)
    return operation === 'health'
      ? handlers.GET(request, { params: { operation } })
      : handlers.POST(request, { params: { operation } })
  }
}

const now = () => new Date(clock.getTime())
const transport = sink => ({
  resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
  replyTransport: { send: async ({ messages }) => { sink.push({ method: 'REPLY', messages }); return { status: 'ACCEPTED_BY_LINE', requestId: `reply-${sink.length}` } } },
  pushTransport: { send: async ({ messages, retryKey }) => { sink.push({ method: 'PUSH', messages, retryKey }); return { status: 'ACCEPTED_BY_LINE', requestId: `push-${sink.length}` } } },
})

function buildRuntime({ faults } = {}) {
  const core = createConversationRuntimeCore({ db: prisma, now,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    credentialResolver: async () => { throw Object.assign(new Error('OUT_OF_HOURS_MUST_NOT_RESOLVE_MODEL_CREDENTIAL'), { status: 500 }) },
    // An in-hours turn in this suite needs no knowledge read; it is never run to a model.
    prepareTurn: async job => ({ question: job.inbound.body, evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }),
    linePorts: () => transport(runtimeDeliveries) })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core), faults) })
  const ports = createCorePorts({ client,
    model: { generate: async () => { throw new Error('OUT_OF_HOURS_MUST_NOT_CALL_MODEL') } } })
  return { core, ports, runtime: claimantId => createConversationRuntime({ ports, claimantId, now }) }
}

async function runServerWorker() {
  let answerCalls = 0
  const result = await runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    workerId: 'server-out-of-hours-parity', now,
    answer: async () => { answerCalls += 1; return 'SERVER_MODEL_ANSWER' },
    ...transport(serverDeliveries) })
  return { result, answerCalls }
}

async function admit(account, { at, text = 'สั่งของได้ไหมคะ', user = lineUser, tag } = {}) {
  const eventId = `synthetic-ooh-${tag}-${++sequence}`
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    correlationId: eventId, now: at, ingressReceivedAt: at,
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: at.getTime(),
      source: { type: 'user', userId: user }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}

const traceOf = jobId => prisma.agentTraceEvent.findMany({ where: { turnId: jobId }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] })
const settledAnswerReady = async jobId => (await traceOf(jobId))
  .filter(event => event.kind === 'ANSWER_READY' && !event.idempotencyKey.includes(':runtime:'))
  .map(event => JSON.parse(event.payloadJson))
const durable = job => ({ status: job.status, answerText: job.answerText, sendMethod: job.sendMethod,
  attempts: job.attempts, errorCode: job.errorCode })

async function makeAccount(code, over = {}) {
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Synthetic ${code} connection`, externalAccountId: `synthetic-${code}-destination`, status: 'ACTIVE' })
  return prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code, displayName: `Synthetic ${code}`, bindingCode: `${code}-binding`,
    status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', ...hours, ...over } })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Out-of-hours runtime fixture', code: 'PF-CR-OOH' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Out-of-hours runtime tenant', code: 'TNT-CR-OOH' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Out-of-hours runtime business', code: 'BUS-CR-OOH' })
  const actor = await prisma.person.create({ data: { code: 'PER-CR-OOH', displayName: 'Synthetic out-of-hours actor' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  // Fixtures: identical hours and reply; only the admitted cohort differs. The opt-in
  // path itself (CONFIGURE_EXECUTION with quiescence) is the vertical slice's.
  serverAccount = await makeAccount('cr-ooh-server')
  runtimeAccount = await makeAccount('cr-ooh-runtime', { runtimeOwner: 'CONVERSATION_RUNTIME' })
  const linkedAt = new Date(yesterdayUtc - 86_400_000)
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  for (const account of [serverAccount, runtimeAccount]) {
    await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
      channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  }
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_OUT_OF_HOURS_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  await prisma.lineOaAccount.update({ where: { id: runtimeAccount.id }, data: hours })
  openJobs = []
  wire = []
  runtimeDeliveries = []
  serverDeliveries = []
})

describe('FR-244 out-of-hours replies in the Conversation Runtime cohort', () => {
  // Declared 09:00–18:00, inclusive at both ends, compared as "HH:MM" on the Bangkok clock.
  const boundaries = [
    ['00:00:00', false], ['08:59:00', false], ['08:59:59', false], ['09:00:00', true], ['09:00:59', true],
    ['12:00:00', true], ['17:59:59', true], ['18:00:00', true], ['18:00:59', true], ['18:01:00', false], ['23:59:59', false],
  ]

  it.each(boundaries)('decides %s Bangkok exactly as the Server path does (inside hours: %s)', async (hms, inside) => {
    const at = bangkok(hms)
    expect(isAccountWithinBusinessHours(hours, at)).toBe(inside)
    clock = new Date(at.getTime() + 1000)
    const { runtime } = buildRuntime()

    const serverJob = await admit(serverAccount, { at, tag: `server-${hms}` })
    const runtimeJob = await admit(runtimeAccount, { at, tag: `runtime-${hms}` })
    expect(serverJob.runtimeOwner).toBe('SERVER')
    expect(runtimeJob.runtimeOwner).toBe('CONVERSATION_RUNTIME')

    if (inside) {
      // Same as today on both sides: an ordinary queued turn, nothing snapshotted.
      expect(durable(serverJob)).toMatchObject({ status: 'QUEUED', answerText: null })
      expect(durable(runtimeJob)).toMatchObject({ status: 'QUEUED', answerText: null })
      return
    }

    // Server cohort: unchanged — READY at admission, never executed.
    expect(serverJob).toMatchObject({ status: 'READY', answerText: replyText, executionId: null, claimantId: null })
    expect((await traceOf(serverJob.id)).map(event => event.kind)).toEqual(['TURN_RECEIVED', 'ANSWER_READY'])
    // Runtime cohort: Core's decision is snapshotted and the job waits for the runtime.
    expect(runtimeJob).toMatchObject({ status: 'QUEUED', answerText: replyText, executionId: null })

    const server = await runServerWorker()
    expect(server.answerCalls).toBe(0)
    const outcome = await runtime(`runtime-ooh-${hms}`).runOne()
    expect(outcome).toMatchObject({ jobId: runtimeJob.id, status: 'RECORDED' })

    // What reached LINE is identical, message for message.
    expect(serverDeliveries).toHaveLength(1)
    expect(runtimeDeliveries).toEqual(serverDeliveries)
    expect(runtimeDeliveries[0]).toEqual({ method: 'REPLY', messages: [{ type: 'text', text: replyText }] })

    // The same durable end state, and the same ANSWER_READY vocabulary.
    const [serverAfter, runtimeAfter] = await Promise.all([serverJob.id, runtimeJob.id]
      .map(id => prisma.lineConversationJob.findUnique({ where: { id } })))
    expect(durable(runtimeAfter)).toEqual(durable(serverAfter))
    expect(durable(runtimeAfter)).toMatchObject({ status: 'RECORDED', answerText: replyText, sendMethod: 'REPLY', attempts: 1 })
    const [serverReady] = await settledAnswerReady(serverJob.id)
    const runtimeReady = await settledAnswerReady(runtimeJob.id)
    expect(runtimeReady).toHaveLength(1)
    expect(Object.keys(runtimeReady[0]).sort()).toEqual(Object.keys(serverReady).sort())
    expect(runtimeReady[0]).toMatchObject({ text: replyText, executionEvidence: 'OUT_OF_HOURS_RULE' })
    expect(serverReady).toMatchObject({ text: replyText, executionEvidence: 'OUT_OF_HOURS_RULE' })
    for (const id of [serverJob.id, runtimeJob.id]) {
      expect((await traceOf(id)).map(event => event.kind)).toContain('OUTBOUND_RECORDED')
    }

    // No model and no Work: the runtime asked Core for neither, and no model trace exists.
    // (A trailing delivery `status` read may follow `send`: see the PR's handoff notes on
    // the send response's `acceptance` shape. It is a read and sends nothing.)
    const operations = wire.map(call => call.operation)
    expect(operations.slice(0, 6)).toEqual(['claim', 'resolve', 'prepare', 'complete', 'trace', 'send'])
    expect(operations.slice(6).every(operation => operation === 'status')).toBe(true)
    expect(operations).not.toContain('credential')
    expect(operations).not.toContain('work-tool')
    expect((await traceOf(runtimeJob.id)).map(event => event.kind))
      .not.toEqual(expect.arrayContaining(['MODEL_STARTED']))
  })

  it('answers a Work command out of hours with the fixed reply, as the Server path does', async () => {
    const at = bangkok('22:15:00')
    clock = new Date(at.getTime() + 1000)
    const { runtime } = buildRuntime()
    const serverJob = await admit(serverAccount, { at, text: '/projects', tag: 'server-work' })
    const runtimeJob = await admit(runtimeAccount, { at, text: '/projects', tag: 'runtime-work' })
    expect(serverJob.status).toBe('READY')
    expect(runtimeJob).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', status: 'QUEUED', answerText: replyText })

    await runServerWorker()
    const outcome = await runtime('runtime-ooh-work').runOne()
    expect(outcome).toMatchObject({ jobId: runtimeJob.id, status: 'RECORDED' })
    expect(runtimeDeliveries).toEqual(serverDeliveries)
    expect(runtimeDeliveries[0].messages).toEqual([{ type: 'text', text: replyText }])
    expect(wire.map(call => call.operation)).not.toContain('work-tool')
    expect(wire.map(call => call.operation)).not.toContain('credential')
  })

  it('sends the admission-time reply even if the account changes it before the runtime runs, as the Server path does', async () => {
    const at = bangkok('06:30:00')
    clock = new Date(at.getTime() + 1000)
    const { runtime } = buildRuntime()
    const serverJob = await admit(serverAccount, { at, tag: 'server-snapshot' })
    const runtimeJob = await admit(runtimeAccount, { at, tag: 'runtime-snapshot' })
    await prisma.lineOaAccount.updateMany({ where: { id: { in: [serverAccount.id, runtimeAccount.id] } },
      data: { outOfHoursReplyText: 'ข้อความใหม่หลังรับเข้า', businessHoursOpen: '00:00', businessHoursClose: '23:59' } })
    try {
      await runServerWorker()
      await runtime('runtime-ooh-snapshot').runOne()
      expect(serverDeliveries[0].messages).toEqual([{ type: 'text', text: replyText }])
      expect(runtimeDeliveries).toEqual(serverDeliveries)
      expect((await prisma.lineConversationJob.findUnique({ where: { id: runtimeJob.id } })).status).toBe('RECORDED')
      expect((await prisma.lineConversationJob.findUnique({ where: { id: serverJob.id } })).status).toBe('RECORDED')
    } finally {
      await prisma.lineOaAccount.update({ where: { id: serverAccount.id }, data: hours })
    }
  })

  it('keeps an out-of-hours message from an unverified identity on the Server path, exactly as today', async () => {
    const at = bangkok('20:00:00')
    const job = await admit(runtimeAccount, { at, user: unverifiedUser, tag: 'runtime-unverified' })
    expect(job).toMatchObject({ runtimeOwner: 'SERVER', status: 'READY', answerText: replyText, executionId: null })
    expect((await traceOf(job.id)).map(event => event.kind)).toEqual(['TURN_RECEIVED', 'ANSWER_READY'])
  })

  it('gives the runtime no other reply, no credential and no Work for an out-of-hours turn', async () => {
    const at = bangkok('19:45:00')
    clock = new Date(at.getTime() + 1000)
    const { ports } = buildRuntime()
    const job = await admit(runtimeAccount, { at, tag: 'runtime-refusals' })
    const claim = await ports.job.claim({ claimantId: 'runtime-ooh-refusals' })
    expect(claim?.jobId).toBe(job.id)
    const authority = await ports.authority.resolve(claim)
    const turn = await ports.context.prepare(claim, authority)
    expect(turn).toEqual({ question: 'สั่งของได้ไหมคะ', evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: null,
      turnKind: 'OUT_OF_HOURS', replyText })

    await expect(ports.model.credential(claim)).rejects.toMatchObject({ code: 'OUT_OF_HOURS_TURN_HAS_NO_MODEL' })
    await expect(ports.workTool.execute(claim, authority, { operation: 'read', operationId: `${job.id}:work-read`, input: {} }))
      .rejects.toMatchObject({ code: 'OUT_OF_HOURS_TURN_HAS_NO_WORK' })
    await expect(ports.job.complete(claim, { text: 'คำตอบที่รันไทม์แต่งเอง', operationId: `${job.id}:turn-answer` }))
      .rejects.toMatchObject({ code: 'OUT_OF_HOURS_REPLY_MISMATCH' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: job.id } }))
      .toMatchObject({ status: 'CLAIMED', answerText: replyText })
    expect(await ports.job.complete(claim, { text: replyText, operationId: `${job.id}:turn-answer` }))
      .toMatchObject({ status: 'READY' })
  })

  it('keeps the reply through a transient prepare failure, then reclaims and sends it exactly once', async () => {
    const at = bangkok('23:10:00')
    clock = new Date(at.getTime() + 1000)
    const faults = { prepare: 1 }
    const { ports, runtime } = buildRuntime({ faults })
    const job = await admit(runtimeAccount, { at, tag: 'runtime-transient-prepare' })

    // Core is briefly unavailable for `prepare`: the runtime cannot yet know the turn
    // kind and asks Core to fail it. Core refuses, so the snapshot survives.
    const first = await runtime('runtime-ooh-transient').runOne()
    expect(first).toEqual({ jobId: job.id, status: 'DEFERRED', code: 'CORE_OPERATION_UNAVAILABLE' })
    expect(faults.prepare).toBe(0)
    expect(wire.map(call => call.operation)).toEqual(['claim', 'resolve', 'prepare', 'fail'])
    const held = await prisma.lineConversationJob.findUnique({ where: { id: job.id } })
    expect(held).toMatchObject({ status: 'CLAIMED', answerText: replyText, errorCode: null })
    expect((await traceOf(job.id)).map(event => event.kind)).not.toContain('EXECUTION_FAILED')

    // Core refuses a direct `fail` on the out-of-hours turn too, whatever cause is stated.
    const stale = { jobId: job.id, executionId: held.executionId, claimantId: held.claimantId, version: held.version,
      tenantId: held.tenantId, businessId: held.businessId, accountId: held.accountId,
      leaseExpiresAt: held.leaseExpiresAt.toISOString(), deadlineAt: held.expiresAt.toISOString(), correlationId: held.correlationId }
    for (const code of ['CORE_OPERATION_TIMEOUT', 'CONVERSATION_JOB_AUTHORITY_REVOKED']) {
      await expect(ports.job.fail(stale, { code, outcome: 'FAILED' })).rejects.toMatchObject({ code: 'OUT_OF_HOURS_FAILURE_DEFERRED' })
    }
    expect(await prisma.lineConversationJob.findUnique({ where: { id: job.id } }))
      .toMatchObject({ status: 'CLAIMED', answerText: replyText })

    // The lease runs out; the next iteration reclaims and delivers once.
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(clock.getTime() - 1) } })
    expect(await runtime('runtime-ooh-transient-reclaim').runOne()).toMatchObject({ jobId: job.id, status: 'RECORDED' })
    expect(runtimeDeliveries).toEqual([{ method: 'REPLY', messages: [{ type: 'text', text: replyText }] }])
    expect(durable(await prisma.lineConversationJob.findUnique({ where: { id: job.id } })))
      .toMatchObject({ status: 'RECORDED', answerText: replyText, attempts: 1 })
    expect(await settledAnswerReady(job.id)).toHaveLength(1)
    expect(await runtime('runtime-ooh-transient-idle').runOne()).toEqual({ status: 'IDLE' })
  })

  it('completes and sends exactly once when a runtime dies after claiming and another reclaims the job', async () => {
    const at = bangkok('21:00:00')
    clock = new Date(at.getTime() + 1000)
    const { ports, runtime } = buildRuntime()
    const job = await admit(runtimeAccount, { at, tag: 'runtime-reclaim' })

    // Runtime A claims and prepares, then dies before completing.
    const first = await ports.job.claim({ claimantId: 'runtime-ooh-dies' })
    expect(first.jobId).toBe(job.id)
    await ports.context.prepare(first, await ports.authority.resolve(first))

    // Its lease runs out; runtime B reclaims under a new execution id and finishes.
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(clock.getTime() - 1) } })
    const outcome = await runtime('runtime-ooh-reclaims').runOne()
    expect(outcome).toMatchObject({ jobId: job.id, status: 'RECORDED' })
    const done = await prisma.lineConversationJob.findUnique({ where: { id: job.id } })
    expect(done.executionId).not.toBe(first.executionId)
    expect(durable(done)).toMatchObject({ status: 'RECORDED', answerText: replyText, attempts: 1 })

    // Runtime A comes back: its stale claim can neither complete nor send.
    await expect(ports.job.complete(first, { text: replyText, operationId: `${job.id}:turn-answer` }))
      .rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
    await expect(ports.delivery.send(first)).rejects.toMatchObject({ code: 'CONVERSATION_JOB_LEASE_CONFLICT' })
    expect(runtimeDeliveries).toEqual([{ method: 'REPLY', messages: [{ type: 'text', text: replyText }] }])
    expect(await settledAnswerReady(job.id)).toHaveLength(1)
    expect(await runtime('runtime-ooh-after').runOne()).toEqual({ status: 'IDLE' })
  })

  it('reconciles a lost completion response and a lost send response without a second commit or send', async () => {
    const at = bangkok('05:00:00')
    clock = new Date(at.getTime() + 1000)
    const { ports, runtime } = buildRuntime()
    const job = await admit(runtimeAccount, { at, tag: 'runtime-lost-responses' })
    const claim = await ports.job.claim({ claimantId: 'runtime-ooh-lost' })
    await ports.context.prepare(claim, await ports.authority.resolve(claim))

    // Completion commits and the response is "lost". A retry with the same identity is
    // refused rather than committed twice; the stable operation status says READY.
    const committed = await ports.job.complete(claim, { text: replyText, operationId: `${job.id}:turn-answer` })
    expect(committed).toMatchObject({ status: 'READY' })
    await expect(ports.job.complete(claim, { text: replyText, operationId: `${job.id}:turn-answer` }))
      .rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
    expect(await ports.job.status(claim, `${job.id}:turn-answer`))
      .toMatchObject({ status: 'READY', operationId: `${job.id}:turn-answer` })
    expect(await settledAnswerReady(job.id)).toHaveLength(1)

    // The runtime dies before sending; the READY job is offered back as a delivery claim.
    const outcome = await runtime('runtime-ooh-delivers').runOne()
    expect(outcome).toMatchObject({ jobId: job.id, status: 'RECORDED' })
    // A retried send after a lost response observes the durable state and sends nothing.
    expect(await ports.delivery.send(claim)).toMatchObject({ status: 'RECORDED' })
    expect(runtimeDeliveries).toEqual([{ method: 'REPLY', messages: [{ type: 'text', text: replyText }] }])
    const done = await prisma.lineConversationJob.findUnique({ where: { id: job.id } })
    expect(durable(done)).toMatchObject({ status: 'RECORDED', attempts: 1, sendMethod: 'REPLY' })
    expect(await runtime('runtime-ooh-idle').runOne()).toEqual({ status: 'IDLE' })
  })
})
