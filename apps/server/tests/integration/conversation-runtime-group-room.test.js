import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, completeRuntimeConversationJob, runLineConversationWorker, runtimeAudienceBound,
  sendRuntimeConversationJob } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { withLineCatalogCommand, lineCatalogViewer } from '@/modules/agent/line-catalog-command'
import { confirmLineWork, handleLineProjectWorkCommand } from '@/modules/agent/line-project-work-tools'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { validateOperationPayload } from '../../../../services/conversation-runtime/src/contracts.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-150, FR-171 — LINE group and room turns in the Conversation Runtime cohort.
// @spec ADR-106 D2-D4, SDD-110 — Core stays the authority on audience, speaker identity and reply
// target; the runtime carries none of them and cannot name a recipient.
//
// Every parity case runs the same signed message twice: once on an account left in the SERVER
// cohort, through the legacy worker (`runLineConversationWorker` with the route's own answer
// composition) or the legacy Work handler, and once on an opted-in account, through the runtime's
// own ports → runtime client → Core route handler → Core façade → the disposable SQLite database.
// Only the knowledge reader, the model and the LINE transport are local fakes, and the same fakes
// serve both paths. The socket hop is an in-process fetch that still serialises every request.
// @tested tests/integration/conversation-runtime-group-room.test.js
const serviceToken = 'synthetic-group-room-core-token-00000001'
const sealKey = '6d'.repeat(32)
const speakerA = 'Usynthetic-grp-speaker-a'
const speakerB = 'Usynthetic-grp-speaker-b'
const unverifiedSpeaker = 'Usynthetic-grp-speaker-u'
const AUDIENCES = ['GROUP', 'ROOM']
const OPEN = ['QUEUED', 'CLAIMED', 'READY']
const evidence = { records: [{ product_code: 'A1', name: 'สินค้าทดสอบ', sell_price: 12 }] }
const modelText = 'สินค้าทดสอบ ราคา 12 บาทค่ะ'
const WORK_REFUSAL = 'ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ'
const schema = JSON.parse(readFileSync(new URL(
  '../../../../services/conversation-runtime/contracts/v1/operation.schema.json', import.meta.url), 'utf8'))

let tenant, runtimeAccount, serverAccount
let wire = [], deliveries = [], knowledgeCalls = [], modelCalls = [], openJobs = []
let sequence = 0

const threadFor = audience => `${audience === 'GROUP' ? 'C' : 'R'}synthetic-grp-thread-${++sequence}`
function eventFor({ audience, thread, speaker, text }) {
  const eventId = `synthetic-grp-event-${++sequence}`
  const source = audience === 'GROUP' ? { type: 'group', groupId: thread, userId: speaker }
    : audience === 'ROOM' ? { type: 'room', roomId: thread, userId: speaker } : { type: 'user', userId: speaker }
  return { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
    source, message: { type: 'text', id: `synthetic-message-${eventId}`, text } }
}

const jobRow = id => prisma.lineConversationJob.findUnique({ where: { id },
  include: { account: true, inbound: { include: { conversation: true } } } })

async function admit(account, event, env = {}) {
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const result = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...env },
    correlationId: event.webhookEventId, now: new Date(), event })
  if (result.jobId) openJobs.push(result.jobId)
  return result
}

/** Put this job ahead of anything an earlier suite left queued, so each executor takes it first. */
async function first(jobId, offsetMs = 0) {
  await prisma.lineConversationJob.update({ where: { id: jobId }, data: { createdAt: new Date(Date.UTC(2000, 0, 1) + offsetMs) } })
}

const knowledge = label => ({ query: async input => { knowledgeCalls.push({ label, input }); return evidence } })
const transports = label => ({
  replyTransport: { send: async ({ replyToken, messages }) => {
    deliveries.push({ label, method: 'REPLY', replyToken, messages })
    return { status: 'ACCEPTED_BY_LINE', requestId: `synthetic-${label}-reply` } } },
  pushTransport: { send: async ({ to, messages }) => {
    deliveries.push({ label, method: 'PUSH', to, messages })
    return { status: 'ACCEPTED_BY_LINE', requestId: `synthetic-${label}-push` } } },
})
const resolveAccount = async id => prisma.lineOaAccount.findUnique({ where: { id } })

function inProcessFetch(handlers) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const request = new Request(target, init)
    const operation = target.pathname.split('/').pop()
    if (init.body) {
      const envelope = JSON.parse(init.body)
      wire.push({ operation: envelope.operation, payload: envelope.payload })
    }
    return operation === 'health'
      ? handlers.GET(request, { params: { operation } })
      : handlers.POST(request, { params: { operation } })
  }
}

function buildRuntime() {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey, ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' },
    businessPorts: { businessKnowledge: knowledge('runtime') },
    credentialResolver: async () => ({ provider: 'openai', model: 'test-model', apiKey: 'synthetic-group-room-key' }),
    linePorts: () => ({ resolveAccount, ...transports('runtime') }) })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core)) })
  const ports = createCorePorts({ client,
    model: { generate: async input => { modelCalls.push({ label: 'runtime', input }); return modelText } } })
  return { core, ports }
}

// The legacy answer exactly as `app/api/line-oa/worker/route.js` composes it.
const legacyAnswer = withLineCatalogCommand(createServerLineAnswer({ env: { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' },
  runtimeFactory: async () => ({ businessKnowledge: knowledge('legacy'),
    resolveModel: async () => ({ provider: 'openai', model: 'test-model',
      generate: async input => {
        modelCalls.push({ label: 'legacy', input })
        return { provider: 'openai', model: 'test-model', status: 'ok', text: modelText }
      } }) }) }), { db: prisma })

async function runLegacy(jobId) {
  await first(jobId)
  for (let tick = 0; tick < 6; tick += 1) {
    await runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, workerId: `legacy-grp-${tick}`,
      answer: legacyAnswer, resolveAccount, ...transports('legacy'), executionConcurrency: 1, sendBatch: 1 })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    if (!OPEN.includes(job.status) && !['SENDING', 'ACCEPTED'].includes(job.status)) return job
  }
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}

async function runRuntime(ports, jobId) {
  await first(jobId)
  const outcome = await createConversationRuntime({ ports, claimantId: `runtime-grp-${sequence}` }).runOne()
  expect(outcome?.jobId, JSON.stringify(outcome)).toBe(jobId)
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}

async function claimTurn(ports, jobId) {
  await first(jobId)
  const claim = await ports.job.claim({ claimantId: `runtime-grp-claim-${sequence}` })
  expect(claim?.jobId, 'another runtime-cohort job was queued ahead of this test').toBe(jobId)
  const authority = await ports.authority.resolve(claim)
  return { claim, authority }
}

const identityKey = (account, subject) => ({ tenantId_channel_channelAccountId_providerSubject: {
  tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: subject } })
async function setIdentity(account, subject, active) {
  await prisma.channelIdentity.update({ where: identityKey(account, subject), data: active
    ? { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() }
    : { status: 'REVOKED', revokedAt: new Date() } })
}

const withoutTrace = ({ trace, ...rest }) => rest
const modelInput = input => ({ question: input.question, evidence: input.evidence, contextPacket: input.contextPacket ?? null })
const deliveryShape = (delivery, event) => ({ ...delivery, label: undefined,
  ...(delivery.replyToken ? { replyToken: delivery.replyToken === event.replyToken ? 'EVENT_REPLY_TOKEN' : delivery.replyToken } : {}) })

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Group/room runtime fixture', code: 'PF-CR-GRP' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Group/room runtime tenant', code: 'TNT-CR-GRP' })
  const business = await createBusiness({ tenantId: tenant.id, name: 'Group/room runtime business', code: 'BUS-CR-GRP' })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const account = async (suffix, runtimeOwner) => {
    const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
      name: `Synthetic group/room ${suffix} connection`, externalAccountId: `synthetic-grp-${suffix}-destination`, status: 'ACTIVE' })
    return prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
      integrationConnectionId: connection.id, code: `cr-grp-${suffix}`, displayName: `Synthetic group/room ${suffix} OA`,
      bindingCode: `cr-grp-${suffix}-binding`, status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
      allowDelayedPush: true, runtimeOwner, memoryPolicy: 'OFF' } })
  }
  // Two accounts on one Business: the legacy cohort (default SERVER) and an opted-in one.
  serverAccount = await account('server', 'SERVER')
  runtimeAccount = await account('runtime', 'CONVERSATION_RUNTIME')
  const linkedAt = new Date()
  for (const [index, subject] of [speakerA, speakerB].entries()) {
    const person = await prisma.person.create({ data: { code: `PER-CR-GRP-${index}`, displayName: `Synthetic group speaker ${index}` } })
    await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: person.id, provider: 'LINE',
      providerSubject: subject, verifiedAt: linkedAt, linkedAt } })
    for (const target of [serverAccount, runtimeAccount]) {
      await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: person.id, channel: 'LINE',
        channelAccountId: target.bindingCode, providerSubject: subject, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
    }
  }
})

afterEach(async () => {
  for (const subject of [speakerA, speakerB]) {
    for (const target of [serverAccount, runtimeAccount]) await setIdentity(target, subject, true)
  }
  // Leave nothing claimable for the next case or the next suite in this run.
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: OPEN } },
    data: { status: 'CANCELLED', errorCode: 'TEST_GROUP_ROOM_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  wire = []
  deliveries = []
  knowledgeCalls = []
  modelCalls = []
})

describe('Conversation Runtime group and room audiences', () => {
  it.each(AUDIENCES)('%s: admission replies to the same messages, keys the thread and pins the speaker, in both cohorts', async audience => {
    const thread = threadFor(audience)
    // Rule 1 — only a message that names Zuri gets a reply job; the rest is archived.
    for (const account of [serverAccount, runtimeAccount]) {
      const quiet = await admit(account, eventFor({ audience, thread, speaker: speakerA, text: 'สวัสดีทุกคน' }))
      expect(quiet).toMatchObject({ skipped: true })
      expect(quiet.jobId).toBeUndefined()
      expect(await prisma.lineConversationJob.findFirst({ where: { inboundMessageId: quiet.inboundMessageId } })).toBeNull()
    }

    const pair = {}
    for (const [cohort, account] of [['SERVER', serverAccount], ['CONVERSATION_RUNTIME', runtimeAccount]]) {
      const event = eventFor({ audience, thread, speaker: speakerB, text: 'Zuri มีสินค้าอะไรบ้าง' })
      const { jobId } = await admit(account, event)
      pair[cohort] = await jobRow(jobId)
    }
    const shape = job => ({ audienceKind: job.audienceKind, recipientId: job.recipientId, sourceUserId: job.sourceUserId,
      executionMode: job.executionMode, status: job.status, memorySyncOptIn: job.memorySyncOptIn, allowDelayedPush: job.allowDelayedPush,
      sealed: Boolean(job.sealedReplyToken), replyWindowMs: job.replyExpiresAt.getTime() > Date.now(),
      threadRecord: job.inbound.conversation.externalThreadId, sessionOpen: Boolean(job.sessionId) })
    // Rules 3 and 4 — the thread is the CRM Conversation and the reply target; the speaker is recorded separately.
    expect(shape(pair.CONVERSATION_RUNTIME)).toEqual(shape(pair.SERVER))
    expect(shape(pair.SERVER)).toMatchObject({ audienceKind: audience, recipientId: thread, sourceUserId: speakerB, threadRecord: thread })
    expect(pair.SERVER.runtimeOwner).toBe('SERVER')
    expect(pair.CONVERSATION_RUNTIME.runtimeOwner).toBe('CONVERSATION_RUNTIME')
    // One Conversation per thread: the quiet message and speaker B's share it.
    const messages = await prisma.message.count({ where: { conversationId: pair.CONVERSATION_RUNTIME.inbound.conversationId } })
    expect(messages).toBe(2)

    // Rule 2 — the identity checked is the speaker's, not the thread's. Since the owner
    // ruling of 2026-09-27 an unverified speaker joins the runtime cohort too, as a job
    // with no person (conversation-runtime-unverified.test.js covers what it may do).
    const unverified = await admit(runtimeAccount, eventFor({ audience, thread, speaker: unverifiedSpeaker, text: 'ซูริ ช่วยด้วย' }))
    const unverifiedJob = await prisma.lineConversationJob.findUnique({ where: { id: unverified.jobId } })
    expect(unverifiedJob)
      .toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', audienceKind: audience, recipientId: thread, sourceUserId: unverifiedSpeaker })
    expect(await prisma.agentTraceEvent.count({ where: { turnId: unverifiedJob.id, kind: 'CHANNEL_IDENTITY_ADMITTED' } })).toBe(1)

    // A verified speaker's memory-sync turn joins the cohort too (W12); the group's
    // thread memory is proved in conversation-runtime-memory-group-gks.test.js.
    await prisma.lineOaAccount.update({ where: { id: runtimeAccount.id }, data: { memoryPolicy: 'ON' } })
    const memory = await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: 'ซูริ จำได้ไหม' }),
      { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: memory.jobId } }))
      .toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true, audienceKind: audience, recipientId: thread })
    await prisma.lineOaAccount.update({ where: { id: runtimeAccount.id }, data: { memoryPolicy: 'OFF' } })
    // Existing SERVER-only sub-cases apply to groups unchanged.
    const malformed = await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: '/work-create ซูริ' }))
    const malformedJob = await jobRow(malformed.jobId)
    expect(malformedJob.runtimeOwner).toBe('SERVER')
    // …and the legacy handler, which still owns it, answers with its usage text.
    expect(await handleLineProjectWorkCommand(malformedJob, { db: prisma })).toEqual({
      text: 'ใช้ /projects ค้นโครงการ, /work ค้นงาน, /work-create รหัสเวิร์กสตรีม ชื่องาน, /work-update รหัสงาน {"status":"DONE"}' })
  })

  it.each(AUDIENCES)('%s: resolve authenticates the speaker and prepare scopes the turn exactly as the legacy answer does', async audience => {
    const { ports } = buildRuntime()
    const thread = threadFor(audience)
    const text = 'ซูริ สินค้าทดสอบ ราคาเท่าไร'
    const { jobId } = await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerB, text }))
    const { claim, authority } = await claimTurn(ports, jobId)
    const speakerIdentity = await prisma.channelIdentity.findUnique({ where: identityKey(runtimeAccount, speakerB) })
    expect(authority).toEqual({ authorized: true, version: claim.version, scope: { tenantId: tenant.id,
      businessId: runtimeAccount.businessId, accountId: runtimeAccount.id, identityId: speakerIdentity.id,
      identityVersion: speakerIdentity.version } })
    const turn = await ports.context.prepare(claim, authority)
    // The question is this message alone: no group history, no thread memory, no slices.
    expect(turn).toEqual({ question: text, evidence, slices: [], authorized: true, audienceKind: audience,
      threadId: null, maxBudgetChars: 0, workCommand: null })

    // The legacy answer has no audience-dependent input on a non-memory turn: the same text
    // from the same speaker as a GROUP/ROOM job and as a DIRECT job reads and asks the same.
    const serverGroup = await jobRow((await admit(serverAccount, eventFor({ audience, thread, speaker: speakerB, text }))).jobId)
    const serverDirect = await jobRow((await admit(serverAccount, eventFor({ audience: 'DIRECT', speaker: speakerB, text }))).jobId)
    expect(await legacyAnswer(serverGroup, {})).toBe(modelText)
    expect(await legacyAnswer(serverDirect, {})).toBe(modelText)
    const legacyReads = knowledgeCalls.filter(call => call.label === 'legacy').map(call => call.input)
    expect(legacyReads).toHaveLength(2)
    expect(legacyReads[0]).toEqual(legacyReads[1])
    const legacyAsks = modelCalls.filter(call => call.label === 'legacy').map(call => withoutTrace(call.input))
    expect(legacyAsks[0]).toEqual(legacyAsks[1])
    expect(legacyAsks[0]).toEqual({ question: text, evidence, contextPacket: null })
    // …and Core's prepare reads the knowledge base with exactly the legacy query.
    expect(knowledgeCalls.filter(call => call.label === 'runtime').map(call => call.input)).toEqual([legacyReads[0]])
    // A `#sku` catalogue command is never honoured in a group or room; it is an ordinary question.
    expect(await lineCatalogViewer(serverGroup, { db: prisma })).toBeNull()
  })

  it.each(AUDIENCES)('%s: a full runtime turn matches the legacy SERVER worker — answer, reply token, CRM record', async audience => {
    const { ports } = buildRuntime()
    const thread = threadFor(audience)
    const text = 'ซูริ สินค้าทดสอบ ราคาเท่าไร'
    const serverEvent = eventFor({ audience, thread, speaker: speakerA, text })
    const runtimeEvent = eventFor({ audience, thread, speaker: speakerA, text })
    const serverJobId = (await admit(serverAccount, serverEvent)).jobId
    const runtimeJobId = (await admit(runtimeAccount, runtimeEvent)).jobId

    const legacy = await runLegacy(serverJobId)
    const runtime = await runRuntime(ports, runtimeJobId)

    for (const job of [legacy, runtime]) {
      expect(job).toMatchObject({ status: 'RECORDED', answerText: modelText, audienceKind: audience, recipientId: thread })
    }
    const legacyDelivery = deliveries.filter(delivery => delivery.label === 'legacy')
    const runtimeDelivery = deliveries.filter(delivery => delivery.label === 'runtime')
    expect(legacyDelivery).toHaveLength(1)
    expect(runtimeDelivery.map(delivery => deliveryShape(delivery, runtimeEvent)))
      .toEqual(legacyDelivery.map(delivery => deliveryShape(delivery, serverEvent)))
    expect(deliveryShape(runtimeDelivery[0], runtimeEvent)).toMatchObject({ method: 'REPLY', replyToken: 'EVENT_REPLY_TOKEN',
      messages: [{ type: 'text', text: modelText }] })
    expect(knowledgeCalls.filter(call => call.label === 'runtime').map(call => call.input))
      .toEqual(knowledgeCalls.filter(call => call.label === 'legacy').map(call => call.input))
    expect(modelCalls.filter(call => call.label === 'runtime').map(call => modelInput(call.input)))
      .toEqual(modelCalls.filter(call => call.label === 'legacy').map(call => modelInput(call.input)))
    // Both outbound replies are recorded in their own group/room Conversation.
    for (const job of [legacy, runtime]) {
      const row = await jobRow(job.id)
      const outbound = await prisma.message.findMany({ where: { conversationId: row.inbound.conversationId, direction: 'OUTBOUND' } })
      expect(outbound.map(message => message.body)).toEqual([modelText])
      expect(row.inbound.conversation.externalThreadId).toBe(thread)
    }
  })

  it.each(AUDIENCES)('%s: a delayed Push goes to the group or room id in both cohorts, never to the speaker', async audience => {
    const { ports } = buildRuntime()
    const thread = threadFor(audience)
    const text = 'ซูริ สินค้าทดสอบ ราคาเท่าไร'
    const serverJobId = (await admit(serverAccount, eventFor({ audience, thread, speaker: speakerA, text }))).jobId
    const runtimeJobId = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text }))).jobId
    // The reply token has lapsed; both accounts allow a delayed Push.
    await prisma.lineConversationJob.updateMany({ where: { id: { in: [serverJobId, runtimeJobId] } },
      data: { replyExpiresAt: new Date(Date.now() - 1000) } })

    const legacy = await runLegacy(serverJobId)
    const runtime = await runRuntime(ports, runtimeJobId)
    expect(legacy).toMatchObject({ status: 'RECORDED', sendMethod: 'PUSH' })
    expect(runtime).toMatchObject({ status: 'RECORDED', sendMethod: 'PUSH' })
    const pushed = label => deliveries.filter(delivery => delivery.label === label).map(({ label: _label, ...rest }) => rest)
    expect(pushed('runtime')).toEqual(pushed('legacy'))
    expect(pushed('runtime')).toEqual([{ method: 'PUSH', to: thread, messages: [{ type: 'text', text: modelText }] }])
  })

  it.each(AUDIENCES)('%s: Work commands are refused with the legacy handler\'s own reply and reach no Work reader or writer', async audience => {
    const { ports } = buildRuntime()
    const target = randomUUID()
    const cases = [
      ['/projects ซูริ', 'work-read'],
      [`/work-create ${target} ซูริ ทำรายงาน`, 'work-proposal'],
      [`/work-update ${target} {"title":"ซูริ"}`, 'work-proposal'],
    ]
    const auditsBefore = await prisma.auditEvent.count({ where: { entityType: { in: ['LINE_WORK_PROPOSAL', 'AGENT_ACTION'] } } })
    const itemsBefore = await prisma.workItem.count()
    for (const [text, operation] of cases) {
      const thread = threadFor(audience)
      const serverJob = await jobRow((await admit(serverAccount, eventFor({ audience, thread, speaker: speakerA, text }))).jobId)
      const runtimeJobId = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text }))).jobId
      expect(serverJob.runtimeOwner).toBe('SERVER')
      expect((await jobRow(runtimeJobId)).runtimeOwner).toBe('CONVERSATION_RUNTIME')

      const legacy = await handleLineProjectWorkCommand(serverJob, { db: prisma })
      expect(legacy, text).toEqual({ text: WORK_REFUSAL, errorCode: 'WORK_ACTION_UNAVAILABLE' })
      wire = []
      const runtime = await runRuntime(ports, runtimeJobId)
      expect(runtime, text).toMatchObject({ status: 'RECORDED', answerText: legacy.text })
      expect(deliveries.at(-1)).toMatchObject({ label: 'runtime', method: 'REPLY', messages: [{ type: 'text', text: legacy.text }] })
      // The status probe finds nothing and the one execute is refused by Core as a final
      // REJECTED outcome carrying the legacy text: no Work reader or writer is reached.
      expect(wire.filter(call => call.operation === 'work-tool').map(call => `${call.payload.operation} ${call.payload.operationId}`))
        .toEqual([`status ${runtimeJobId}:${operation}`, `${operation === 'work-read' ? 'read' : 'propose'} ${runtimeJobId}:${operation}`])
      expect(wire.map(call => call.operation)).not.toContain('credential')
    }
    // Confirmation cannot be named in a group (it carries no mention), but Core refuses a
    // confirm-execute there all the same, before the proposal is even looked up.
    const probeId = (await admit(runtimeAccount, eventFor({ audience, thread: threadFor(audience), speaker: speakerA, text: '/work ซูริ' }))).jobId
    const { claim, authority } = await claimTurn(ports, probeId)
    const proposalId = randomUUID()
    expect(await ports.workTool.execute(claim, authority, { operation: 'confirm-execute', operationId: proposalId, input: { proposalId } }))
      .toEqual({ status: 'REJECTED', code: 'WORK_ACTION_UNAVAILABLE', result: { text: WORK_REFUSAL } })
    const legacyProbe = await jobRow((await admit(serverAccount, eventFor({ audience, thread: threadFor(audience), speaker: speakerA, text: '/work ซูริ' }))).jobId)
    await expect(confirmLineWork(legacyProbe.id, proposalId, { db: prisma })).rejects.toMatchObject({ code: 'WORK_SCOPE_DENIED' })

    expect(await prisma.auditEvent.count({ where: { entityType: { in: ['LINE_WORK_PROPOSAL', 'AGENT_ACTION'] } } })).toBe(auditsBefore)
    expect(await prisma.workItem.count()).toBe(itemsBefore)
  })

  it.each(AUDIENCES)('%s: a runtime cannot redirect the reply to another audience', async audience => {
    const { core, ports } = buildRuntime()
    const thread = threadFor(audience)
    const jobId = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: 'ซูริ สินค้าทดสอบ' }))).jobId
    const otherId = (await admit(runtimeAccount, eventFor({ audience, thread: threadFor(audience), speaker: speakerA, text: 'ซูริ อีกห้อง' }))).jobId
    const { claim } = await claimTurn(ports, jobId)
    const ref = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
      tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }

    // 1. The send contract has no recipient. Naming one is refused by the runtime's own
    //    validator, the published v1 schema and Core, before anything is sent.
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validateEnvelope = ajv.compile(schema)
    for (const field of [{ to: speakerA }, { recipientId: speakerA }, { audienceKind: 'DIRECT' }]) {
      const payload = { claim: ref, operationId: `${jobId}:${claim.executionId}:delivery`, ...field }
      expect(() => validateOperationPayload('send', payload)).toThrow(expect.objectContaining({ code: 'CONTRACT_PAYLOAD_FIELD_INVALID' }))
      const envelope = { contractVersion: 'conversation-runtime.v1', operation: 'send', correlationId: 'synthetic-grp-redirect',
        idempotencyKey: `synthetic-grp-redirect-${Object.keys(field)[0]}`, deadlineAt: new Date(Date.now() + 30_000).toISOString(), payload }
      expect(validateEnvelope(envelope)).toBe(false)
      const response = await core.handle(new Request('http://core.invalid/api/internal/conversation-runtime/v1/send', {
        method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(envelope) }), { operation: 'send' })
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('CONTRACT_PAYLOAD_INVALID')
    }

    // 2. A claim cannot be pointed at another thread's job.
    await expect(ports.delivery.send({ ...claim, jobId: otherId })).rejects.toMatchObject({ code: 'CONVERSATION_JOB_LEASE_CONFLICT' })
    await expect(ports.authority.resolve({ ...claim, jobId: otherId })).rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })

    // 3. Core binds the target to the thread record at every protected transition. A job whose
    //    target no longer matches it — turned into a DM to the speaker, moved to another thread,
    //    or relabelled DIRECT — is refused while claimed and cancelled, unsent, once READY.
    const original = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    const tampers = [{ recipientId: speakerA }, { recipientId: `${thread}-other` }, { audienceKind: 'DIRECT', recipientId: speakerA }]
    for (const tamper of tampers) {
      await prisma.lineConversationJob.update({ where: { id: jobId }, data: tamper })
      await expect(ports.authority.resolve(claim), JSON.stringify(tamper)).rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
      await expect(ports.job.complete(claim, { text: modelText, operationId: `${jobId}:turn-answer` })).rejects
        .toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
      await prisma.lineConversationJob.update({ where: { id: jobId },
        data: { recipientId: original.recipientId, audienceKind: original.audienceKind } })
    }
    expect(await ports.job.complete(claim, { text: modelText, operationId: `${jobId}:turn-answer` }))
      .toMatchObject({ id: jobId, status: 'READY' })
    await prisma.lineConversationJob.update({ where: { id: jobId }, data: { recipientId: speakerA } })
    expect(await ports.delivery.send(claim)).toMatchObject({ id: jobId, status: 'CANCELLED' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
      .toMatchObject({ status: 'CANCELLED', errorCode: 'CONVERSATION_JOB_AUTHORITY_REVOKED', answerText: null })
    expect(deliveries).toEqual([])
  })

  // Each layer below is exercised by a tamper that only that layer can see: the state is
  // changed after every earlier check has passed and before the layer under test runs.
  it.each(AUDIENCES)('%s: layer 1 — claim refuses a queued job whose target left its thread', async audience => {
    const { ports } = buildRuntime()
    const thread = threadFor(audience)
    const jobId = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: 'ซูริ สินค้าทดสอบ' }))).jobId
    await first(jobId)
    // Admitted and eligible; the target is then pointed at the speaker before any claim.
    await prisma.lineConversationJob.update({ where: { id: jobId }, data: { recipientId: speakerA } })
    const claim = await ports.job.claim({ claimantId: `runtime-grp-layer1-${sequence}` })
    expect(claim?.jobId).not.toBe(jobId)
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
      .toMatchObject({ status: 'QUEUED', claimantId: null, executionId: null })
    expect(deliveries).toEqual([])
  })

  it.each(AUDIENCES)('%s: layer 2 — settle refuses a completion whose target changed after claim', async audience => {
    const { ports } = buildRuntime()
    const thread = threadFor(audience)
    const jobId = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: 'ซูริ สินค้าทดสอบ' }))).jobId
    const { claim } = await claimTurn(ports, jobId)
    // Between claim and settle. The Core façade's own check is bypassed on purpose by
    // calling the settle writer directly, so only settle's binding can refuse it.
    await prisma.lineConversationJob.update({ where: { id: jobId }, data: { recipientId: speakerA } })
    await expect(completeRuntimeConversationJob(claim, { text: modelText, operationId: `${jobId}:turn-answer` }, { db: prisma }))
      .rejects.toMatchObject({ status: 409, message: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
      .toMatchObject({ status: 'CLAIMED', answerText: null })
  })

  it.each(AUDIENCES)('%s: layer 3 — the send compare-and-set refuses an audience or target changed after the pre-send read', async audience => {
    const { ports } = buildRuntime()
    const tampers = [
      // Audience relabelled; the recipient is unchanged, so only the binding check can see it.
      ['audience', async (job) => prisma.lineConversationJob.update({ where: { id: job.id }, data: { audienceKind: 'DIRECT' } })],
      // Target and thread record moved together: still bound, but no longer the target the
      // pre-send read will address, so only the recipient compare can see it.
      ['recipient', async (job) => {
        const moved = `${job.recipientId}-moved`
        await prisma.conversation.update({ where: { id: job.inbound.conversationId }, data: { externalThreadId: moved } })
        await prisma.lineConversationJob.update({ where: { id: job.id }, data: { recipientId: moved } })
      }],
    ]
    for (const [label, tamper] of tampers) {
      const thread = threadFor(audience)
      const jobId = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: 'ซูริ สินค้าทดสอบ' }))).jobId
      const { claim } = await claimTurn(ports, jobId)
      expect(await ports.job.complete(claim, { text: modelText, operationId: `${jobId}:turn-answer` })).toMatchObject({ status: 'READY' })
      const admitted = await jobRow(jobId)
      // `resolveAccount` runs after the sender's pre-send read and before its compare-and-set.
      const result = await sendRuntimeConversationJob(claim, { db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
        resolveAccount: async id => { await tamper(admitted); return resolveAccount(id) }, ...transports('runtime') })
      expect(result, label).toEqual({ status: 'CONTENDED', id: jobId })
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }), label)
        .toMatchObject({ status: 'READY', attempts: 0, firstSendAt: null })
      expect(deliveries, label).toEqual([])
    }
  })

  it.each([['GROUP', 'groupId'], ['ROOM', 'roomId']])('%s event without its %s stays on SERVER and is answered there as before', async (audience, field) => {
    const pair = {}
    for (const [cohort, account] of [['SERVER', serverAccount], ['CONVERSATION_RUNTIME', runtimeAccount]]) {
      const event = eventFor({ audience, thread: threadFor(audience), speaker: speakerA, text: 'ซูริ สินค้าทดสอบ ราคาเท่าไร' })
      delete event.source[field]
      pair[cohort] = await jobRow((await admit(account, event)).jobId)
    }
    const shape = job => ({ runtimeOwner: job.runtimeOwner, audienceKind: job.audienceKind, recipientId: job.recipientId,
      sourceUserId: job.sourceUserId, status: job.status, thread: job.inbound.conversation.externalThreadId })
    // Legacy falls back to the speaker as the thread; the opted-in account keeps it with that consumer.
    expect(shape(pair.CONVERSATION_RUNTIME)).toEqual(shape(pair.SERVER))
    expect(shape(pair.SERVER)).toEqual({ runtimeOwner: 'SERVER', audienceKind: audience, recipientId: speakerA,
      sourceUserId: speakerA, status: 'QUEUED', thread: speakerA })
    // It is answered by the legacy worker, not left to expire.
    const answered = await runLegacy(pair.CONVERSATION_RUNTIME.id)
    expect(answered).toMatchObject({ status: 'RECORDED', answerText: modelText })
    expect(deliveries.filter(delivery => delivery.label === 'legacy')).toHaveLength(1)
  })

  it('binds DIRECT, GROUP and ROOM targets to the thread record and nothing else', () => {
    const conversation = thread => ({ externalThreadId: thread, channelAccountId: 'binding' })
    const job = (audienceKind, recipientId, sourceUserId, thread = recipientId) => ({ audienceKind, recipientId, sourceUserId,
      channelAccountId: 'binding', inbound: { conversation: conversation(thread) } })
    expect(runtimeAudienceBound(job('DIRECT', 'Uspeaker', 'Uspeaker'))).toBe(true)
    expect(runtimeAudienceBound(job('GROUP', 'Cgroup', 'Uspeaker'))).toBe(true)
    expect(runtimeAudienceBound(job('ROOM', 'Rroom', 'Uspeaker'))).toBe(true)
    // A group reply addressed to the speaker, or a DIRECT reply to someone else.
    expect(runtimeAudienceBound(job('GROUP', 'Uspeaker', 'Uspeaker'))).toBe(false)
    expect(runtimeAudienceBound(job('DIRECT', 'Cgroup', 'Uspeaker'))).toBe(false)
    // A target that is not the Conversation's thread, or a Conversation on another account.
    expect(runtimeAudienceBound(job('GROUP', 'Cother', 'Uspeaker', 'Cgroup'))).toBe(false)
    expect(runtimeAudienceBound(job('DIRECT', 'Uspeaker', 'Uspeaker', 'Cgroup'))).toBe(false)
    expect(runtimeAudienceBound({ ...job('GROUP', 'Cgroup', 'Uspeaker'), channelAccountId: 'other' })).toBe(false)
    // Unknown audiences, erased rows, and a job with no thread record.
    expect(runtimeAudienceBound(job('BROADCAST', 'Cgroup', 'Uspeaker'))).toBe(false)
    expect(runtimeAudienceBound(job('GROUP', '[erased]', '[erased]'))).toBe(false)
    expect(runtimeAudienceBound({ ...job('GROUP', 'Cgroup', 'Uspeaker'), inbound: null })).toBe(false)
    expect(runtimeAudienceBound(null)).toBe(false)
  })

  it.each(AUDIENCES)('%s: consent and erasure are checked per speaker, and thread erasure matches the legacy tombstone', async audience => {
    const { ports } = buildRuntime()
    const thread = threadFor(audience)
    // Speaker A writes first, so A's Customer owns the thread's Conversation.
    const aJob = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerA, text: 'ซูริ สินค้าทดสอบ' }))).jobId
    const bJob = (await admit(runtimeAccount, eventFor({ audience, thread, speaker: speakerB, text: 'ซูริ ราคาเท่าไร' }))).jobId
    await first(bJob, 0)
    await first(aJob, 1)

    // A revoked speaker's turn is not claimed; the other speaker in the same thread is answered.
    await setIdentity(runtimeAccount, speakerB, false)
    const outcome = await createConversationRuntime({ ports, claimantId: 'runtime-grp-consent' }).runOne()
    expect(outcome).toMatchObject({ jobId: aJob, status: 'RECORDED' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: bJob } }))
      .toMatchObject({ status: 'QUEUED', runtimeOwner: 'CONVERSATION_RUNTIME' })
    expect(deliveries.map(delivery => delivery.label)).toEqual(['runtime'])

    // A revocation while the speaker's turn is in flight fences completion; nothing is sent.
    await setIdentity(runtimeAccount, speakerB, true)
    const { claim } = await claimTurn(ports, bJob)
    await setIdentity(runtimeAccount, speakerB, false)
    await expect(ports.job.complete(claim, { text: modelText, operationId: `${bJob}:turn-answer` })).rejects
      .toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: bJob } })).toMatchObject({ status: 'CLAIMED', answerText: null })
    await setIdentity(runtimeAccount, speakerB, true)

    // Erasing the thread's Conversation (the legacy erasure writer) tombstones every speaker's
    // job in it identically in both cohorts, and fences the runtime claim still in flight.
    const erasedThread = threadFor(audience)
    const jobs = {}
    for (const [cohort, account] of [['SERVER', serverAccount], ['CONVERSATION_RUNTIME', runtimeAccount]]) {
      for (const speaker of [speakerA, speakerB]) {
        jobs[`${cohort}:${speaker}`] = (await admit(account, eventFor({ audience, thread: erasedThread, speaker, text: 'ซูริ ขอข้อมูล' }))).jobId
      }
    }
    const inFlight = jobs[`CONVERSATION_RUNTIME:${speakerB}`]
    await first(jobs[`CONVERSATION_RUNTIME:${speakerA}`], 5)
    const { claim: erasedClaim } = await claimTurn(ports, inFlight)
    const conversationIds = [...new Set(await Promise.all(Object.values(jobs).map(async id => (await jobRow(id)).inbound.conversationId)))]
    expect(conversationIds).toHaveLength(2)
    await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds }))

    const tombstone = job => ({ status: job.status, errorCode: job.errorCode, recipientId: job.recipientId,
      sourceUserId: job.sourceUserId, answerText: job.answerText, sealedReplyToken: job.sealedReplyToken, claimantId: job.claimantId })
    for (const speaker of [speakerA, speakerB]) {
      const server = await prisma.lineConversationJob.findUnique({ where: { id: jobs[`SERVER:${speaker}`] } })
      const runtime = await prisma.lineConversationJob.findUnique({ where: { id: jobs[`CONVERSATION_RUNTIME:${speaker}`] } })
      expect(tombstone(runtime)).toEqual(tombstone(server))
      expect(tombstone(runtime)).toEqual({ status: 'CANCELLED', errorCode: 'PDPA_ERASURE', recipientId: '[erased]',
        sourceUserId: '[erased]', answerText: null, sealedReplyToken: null, claimantId: null })
    }
    await expect(ports.job.complete(erasedClaim, { text: modelText, operationId: `${inFlight}:turn-answer` })).rejects
      .toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
    expect(await ports.delivery.send(erasedClaim)).toMatchObject({ id: inFlight, status: 'CANCELLED' })
    const next = await ports.job.claim({ claimantId: 'runtime-grp-after-erasure' })
    expect(next === null || !Object.values(jobs).includes(next.jobId)).toBe(true)
    expect(deliveries.map(delivery => delivery.label)).toEqual(['runtime'])
  })
})
