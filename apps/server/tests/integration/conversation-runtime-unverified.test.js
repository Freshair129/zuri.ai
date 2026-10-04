import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { withLineCatalogCommand, lineCatalogCommandReply } from '@/modules/agent/line-catalog-command'
import { searchLineProjectWork } from '@/modules/agent/line-project-work-tools'
import { sha256 } from '@/modules/agent/execution-trace'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { validateWorkToolRequest } from '../../../../services/conversation-runtime/src/contracts.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-150, FR-210, FR-244 — LINE messages from an UNVERIFIED channel identity
//   join the Conversation Runtime cohort (owner ruling 2026-09-27) with exactly what
//   the legacy Server path gives that sender, and nothing more.
// Parity: every case admits the same signed-shape message from the same unverified
//   sender to a SERVER-cohort account and to a runtime-cohort account of one Business,
//   drives each through its real consumer (the Server tick worker with its real answer
//   port, `withLineCatalogCommand(createServerLineAnswer(...))` and the legacy Work
//   handler; the runtime turn loop over the real Core route handlers and Core's own
//   `prepare`), and compares what each one delivered byte for byte. The knowledge
//   reader and the model are the same stand-ins on both sides; the LINE transport is
//   a local fake; the HTTP hop is an in-process fetch that serialises every call.
// Security: Core, not the runtime, holds the sender authority. Whatever the runtime
//   sends, an unverified job gets no person scope, no Work reader or writer, no memory
//   and no `#sku` command, even when the sender is verified mid-turn; a verified job
//   keeps today's verified-identity fences; an unverified job cannot complete or send
//   after erasure, an account or transport change, or a changed sender.
// @spec ADR-106 D2-D4; SDD-110; ADR-084 D4; ADR-094 D6
// @tested tests/integration/conversation-runtime-unverified.test.js
const serviceToken = 'synthetic-unverified-core-token-00000000001'
const sealKey = '6e'.repeat(32)
const stranger = 'Usynthetic-unverified-stranger'
const pendingOwner = 'Usynthetic-unverified-pending-owner'
const verifiedUser = 'Usynthetic-unverified-verified-user'
const otherSpeaker = 'Usynthetic-unverified-other-speaker'
const groupId = 'Csynthetic-unverified-group'
const answerText = 'มีชุดของขวัญพรีเมียมในแคตตาล็อกค่ะ'
const evidenceFixture = { records: [{ product: 'synthetic-unverified-gift-set', answer: 'ชุดของขวัญพรีเมียม' }] }
const outOfHoursText = 'ขณะนี้ปิดทำการ กรุณาติดต่อใหม่ในเวลาทำการค่ะ'

let tenant, business, provider, legacyAccount, runtimeAccount, owner, workstream, sequence = 0
let evidence = evidenceFixture
let openJobs = []

// Instants are pinned to "yesterday" (as the out-of-hours suite does), so the Server
// tick and the runtime claim see only this suite's jobs as due.
const yesterdayUtc = (() => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
})()
let minute = 9 * 60 + 5
/** A fresh in-hours Asia/Bangkok instant per call; `hm` pins a wall-clock time. */
const instant = hm => {
  const minutes = hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : (minute += 1)
  return new Date(yesterdayUtc + minutes * 60_000 - 7 * 3600_000)
}
let clock = instant()
const now = () => new Date(clock.getTime())

const knowledgePorts = () => ({
  businessKnowledge: { query: async () => evidence },
  resolveModel: async () => ({ provider: 'synthetic', model: 'synthetic-unverified-model',
    generate: async () => ({ provider: 'synthetic', model: 'synthetic-unverified-model', status: 'ok', text: answerText }) }),
})

const transport = sink => ({
  resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
  replyTransport: { send: async ({ messages }) => { sink.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `reply-${sink.length}` } } },
  pushTransport: { send: async ({ messages }) => { sink.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: `push-${sink.length}` } } },
})

/** Runtime over the real Core route handlers; `spies` counts every person-scoped reader Core could reach. */
function buildRuntime({ sink = [], coreOptions = {} } = {}) {
  const wire = []
  const spies = { workSearch: 0, catalogCommand: 0, threadMemory: 0, memoryContext: 0, credential: 0, model: 0 }
  const core = createConversationRuntimeCore({ db: prisma, now,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    businessPorts: async () => knowledgePorts(),
    credentialResolver: async () => { spies.credential += 1; return { provider: 'prp', model: 'synthetic-unverified-model', apiKey: 'synthetic-provider-key' } },
    workSearch: (...args) => { spies.workSearch += 1; return searchLineProjectWork(...args) },
    catalogCommand: (...args) => { spies.catalogCommand += 1; return lineCatalogCommandReply(...args) },
    threadMemoryFactory: () => { spies.threadMemory += 1; throw new Error('UNVERIFIED_JOB_MUST_NOT_REACH_MSP') },
    memoryContextAssembler: async () => { spies.memoryContext += 1; throw new Error('UNVERIFIED_JOB_MUST_NOT_ASSEMBLE_MEMORY') },
    linePorts: () => transport(sink), ...coreOptions })
  const handlers = createConversationRuntimeRouteHandlers(core)
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken, fetchFn: async (url, init = {}) => {
    const operation = new URL(url).pathname.split('/').pop()
    if (init.body) wire.push(JSON.parse(init.body).operation)
    return handlers.POST(new Request(url, init), { params: { operation } })
  } })
  const ports = createCorePorts({ client, model: { generate: async () => { spies.model += 1; return answerText } } })
  return { core, ports, wire, spies, runtime: createConversationRuntime({ ports, claimantId: `runtime-unverified-${++sequence}`, now }) }
}

async function admit(account, text, { user = stranger, source = null, env = {}, at = clock } = {}) {
  const eventId = `synthetic-unverified-${++sequence}`
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const result = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...env },
    correlationId: eventId, now: at, ingressReceivedAt: at,
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: at.getTime(),
      source: source ?? { type: 'user', userId: user }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  if (result.jobId) openJobs.push(result.jobId)
  return result
}
const jobRow = id => prisma.lineConversationJob.findUnique({ where: { id }, include: { inbound: true } })
const identityRecord = job => prisma.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
  tenantId: job.tenantId, businessId: job.businessId, idempotencyKey: `${job.id}:identity-admission` } } })

async function legacyTick(sink) {
  return runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, workerId: `server-unverified-${++sequence}`, now,
    answer: withLineCatalogCommand(createServerLineAnswer({ env: {}, runtimeFactory: async () => knowledgePorts() }), { db: prisma, now }),
    executionConcurrency: 1, ...transport(sink) })
}

/** Admit one message to both cohorts and drive each through its own consumer. */
async function bothPaths(text, { source = null, user = stranger, env = {} } = {}) {
  clock = instant()
  const at = clock
  const legacyAdmission = await admit(legacyAccount, text, { source, user, env, at })
  const runtimeAdmission = await admit(runtimeAccount, text, { source, user, env, at })
  const legacyJob = await jobRow(legacyAdmission.jobId)
  const runtimeJob = await jobRow(runtimeAdmission.jobId)
  expect(legacyJob.runtimeOwner).toBe('SERVER')
  expect(runtimeJob.runtimeOwner).toBe('CONVERSATION_RUNTIME')
  // Core recorded, at admission, that this job's sender is unverified.
  expect(JSON.parse((await identityRecord(runtimeJob)).payloadJson))
    .toEqual({ identityAssurance: 'UNVERIFIED', senderSha256: sha256(runtimeJob.sourceUserId), principalId: expect.any(String) })
  clock = new Date(at.getTime() + 1000)
  const legacyDeliveries = []
  await legacyTick(legacyDeliveries)
  const runtimeDeliveries = []
  const built = buildRuntime({ sink: runtimeDeliveries })
  let outcome
  for (let turn = 0; turn < 3; turn += 1) {
    outcome = await built.runtime.runOne()
    if (outcome.status === 'IDLE' || (await jobRow(runtimeJob.id)).status === 'RECORDED') break
  }
  const legacyAfter = await jobRow(legacyJob.id)
  const runtimeAfter = await jobRow(runtimeJob.id)
  return { legacyJob: legacyAfter, runtimeJob: runtimeAfter, legacyDeliveries, runtimeDeliveries, outcome, ...built }
}

function expectByteParity(result) {
  expect(result.legacyJob).toMatchObject({ status: 'RECORDED', errorCode: null })
  expect(result.runtimeJob).toMatchObject({ status: 'RECORDED', errorCode: null })
  expect(result.legacyDeliveries).toHaveLength(1)
  expect(result.runtimeDeliveries).toEqual(result.legacyDeliveries)
  const legacyText = result.legacyDeliveries[0][0].text
  const runtimeText = result.runtimeDeliveries[0][0].text
  expect(Buffer.from(runtimeText, 'utf8').equals(Buffer.from(legacyText, 'utf8'))).toBe(true)
  expect(result.runtimeJob.answerText).toBe(result.legacyJob.answerText)
  // Nothing person-scoped was reached on the runtime side.
  expect(result.spies).toMatchObject({ workSearch: 0, catalogCommand: 0, threadMemory: 0, memoryContext: 0 })
  return legacyText
}

async function claimTurn(ports) {
  const claim = await ports.job.claim({ claimantId: `runtime-unverified-claim-${++sequence}` })
  const authority = await ports.authority.resolve(claim)
  return { claim, authority }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Unverified runtime fixture', code: 'PF-CR-UNV' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Unverified runtime tenant', code: 'TNT-CR-UNV' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Unverified runtime business', code: 'BUS-CR-UNV' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const account = async (code, runtimeOwner) => {
    const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
      name: `Synthetic ${code} connection`, externalAccountId: `synthetic-${code}-destination`, status: 'ACTIVE' })
    return prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
      code, displayName: `Synthetic ${code}`, bindingCode: `${code}-binding`, status: 'CONNECTED', serverEnabled: true,
      transportMode: 'CLOUD', runtimeOwner, memoryPolicy: 'ON' } })
  }
  legacyAccount = await account('cr-unv-legacy', 'SERVER')
  runtimeAccount = await account('cr-unv-runtime', 'CONVERSATION_RUNTIME')
  // A Business OWNER whose LINE identity is still PENDING: everything a verified
  // sender could reach (Work, `#sku`) exists for this person, so a leak is observable.
  owner = await prisma.person.create({ data: { code: 'PER-CR-UNV-OWNER', displayName: 'Synthetic pending owner' } })
  await prisma.membership.create({ data: { personId: owner.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } })
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: owner.id, provider: 'LINE', providerSubject: pendingOwner } })
  for (const lineAccount of [legacyAccount, runtimeAccount]) {
    await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: owner.id, channel: 'LINE',
      channelAccountId: lineAccount.bindingCode, providerSubject: pendingOwner, status: 'PENDING' } })
  }
  const verified = await prisma.person.create({ data: { code: 'PER-CR-UNV-VERIFIED', displayName: 'Synthetic verified sender' } })
  const linkedAt = new Date(Date.now() - 86_400_000)
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: verified.id, provider: 'LINE',
    providerSubject: verifiedUser, verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: verified.id, channel: 'LINE',
    channelAccountId: runtimeAccount.bindingCode, providerSubject: verifiedUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  const ownerViewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['projects', 'platform'] })
  const workspace = await createWorkspace({ name: 'Unverified runtime workspace', code: 'WS-CR-UNV', scopeType: 'BUSINESS', businessId: business.id })
  const project = await createProject({ workspaceId: workspace.id, name: 'Unverified runtime project', code: 'PRJ-CR-UNV' }, { viewer: ownerViewer })
  workstream = await createWorkstream({ projectId: project.id, name: 'Unverified runtime stream', code: 'WST-CR-UNV', executionMode: 'SOFTWARE_SPRINT' }, { viewer: ownerViewer })
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_UNVERIFIED_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  evidence = evidenceFixture
  // Every case starts with the owner's identity PENDING again.
  await prisma.channelIdentity.updateMany({ where: { tenantId: tenant.id, providerSubject: pendingOwner },
    data: { status: 'PENDING', verifiedAt: null, linkedAt: null } })
  await prisma.externalIdentity.updateMany({ where: { tenantId: tenant.id, providerSubject: pendingOwner },
    data: { verifiedAt: null, linkedAt: null } })
})

async function verifyPendingOwner() {
  const at = new Date(clock.getTime() - 1000)
  await prisma.externalIdentity.updateMany({ where: { tenantId: tenant.id, providerSubject: pendingOwner }, data: { verifiedAt: at, linkedAt: at } })
  await prisma.channelIdentity.updateMany({ where: { tenantId: tenant.id, providerSubject: pendingOwner },
    data: { status: 'ACTIVE', verifiedAt: at, linkedAt: at } })
}

describe('unverified sender: the runtime cohort answers byte for byte as the legacy Server path', () => {
  it('an ordinary question with evidence: the same grounded model answer, with the Business credential and no person', async () => {
    const result = await bothPaths('มีชุดของขวัญอะไรบ้างคะ')
    expect(expectByteParity(result)).toBe(answerText)
    expect(result.spies).toMatchObject({ credential: 1, model: 1 })
    expect(result.wire).not.toContain('work-tool')
    expect(result.wire).not.toContain('memory')
    // CRM: both cohorts record the outbound reply against the inbound message they answered.
    for (const job of [result.legacyJob, result.runtimeJob]) {
      const outbound = await prisma.message.findFirst({ where: { conversationId: job.inbound.conversationId, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' } })
      expect(outbound.body).toBe(answerText)
    }
  })

  it('no evidence: the same fixed reply, and no model or credential', async () => {
    evidence = { records: [] }
    const result = await bothPaths('มีบริการซ่อมรถไหมคะ')
    expect(expectByteParity(result)).not.toBe(answerText)
    expect(result.spies).toMatchObject({ credential: 0, model: 0 })
  })

  it('out of hours: the same admission-time reply, and no model, credential or Work', async () => {
    const hours = { businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: outOfHoursText }
    await prisma.lineOaAccount.updateMany({ where: { id: { in: [legacyAccount.id, runtimeAccount.id] } }, data: hours })
    try {
      const saved = minute
      minute = 20 * 60
      const result = await bothPaths('/projects')
      minute = saved
      expect(expectByteParity(result)).toBe(outOfHoursText)
      expect(result.spies).toMatchObject({ credential: 0, model: 0 })
      expect(result.wire).not.toContain('work-tool')
    } finally {
      await prisma.lineOaAccount.updateMany({ where: { id: { in: [legacyAccount.id, runtimeAccount.id] } },
        data: { businessHoursOpen: null, businessHoursClose: null, outOfHoursReplyText: null } })
    }
  })

  it.each([
    ['/projects', 'a read'],
    ['/work ของขวัญ', 'a search'],
    [`/work-create ${'00000000-0000-4000-8000-000000000001'} งานใหม่`, 'a proposal'],
    [`ยืนยันงาน ${'00000000-0000-4000-8000-000000000002'}`, 'a confirmation'],
  ])('%s (%s): the legacy Work refusal, with no Work reader or writer', async text => {
    const result = await bothPaths(text)
    expect(expectByteParity(result)).toBe('ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ')
    expect(result.wire).toContain('work-tool')
    expect(result.spies).toMatchObject({ credential: 0, model: 0 })
  })

  it.each([
    ['/work-update', 'usage text'],
    ['/work-create ไม่ใช่รหัส งานใหม่', 'refusal'],
  ])('malformed %s: the same fixed %s, and no Work call', async text => {
    const result = await bothPaths(text)
    expectByteParity(result)
    expect(result.wire).not.toContain('work-tool')
  })

  it('#sku from an unverified sender, even a Business OWNER: an ordinary question, as on the Server path', async () => {
    const result = await bothPaths('#sku\nรหัส: CRUNV-GIFT-01\nชื่อ: ชุดของขวัญ', { user: pendingOwner })
    expect(expectByteParity(result)).toBe(answerText)
    expect(result.spies).toMatchObject({ catalogCommand: 0, model: 1 })
  })

  it('a group mention from an unverified speaker: the same answer to the group; an unmentioned message gets no job on either path', async () => {
    const source = { type: 'group', groupId, userId: stranger }
    const result = await bothPaths('ซูริ มีชุดของขวัญอะไรบ้าง', { source })
    expect(expectByteParity(result)).toBe(answerText)
    expect(result.runtimeJob).toMatchObject({ audienceKind: 'GROUP', recipientId: groupId, sourceUserId: stranger })
    clock = instant()
    for (const account of [legacyAccount, runtimeAccount]) {
      expect(await admit(account, 'ใครว่างบ้าง', { source })).toMatchObject({ skipped: true })
    }
  })

  it('a memory-enabled deployment: an unverified sender\'s memory turn joins the runtime cohort (W11)', async () => {
    clock = instant()
    const { jobId } = await admit(runtimeAccount, 'จำได้ไหมคะ', { env: { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' } })
    const job = await jobRow(jobId)
    // Core runs it in the PENDING memory mode; byte parity with the legacy tick is
    // conversation-runtime-unverified-memory.test.js.
    expect(job).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: true, status: 'QUEUED' })
    expect(JSON.parse((await identityRecord(job)).payloadJson)).toMatchObject({ identityAssurance: 'UNVERIFIED' })
    // Without the memory flag the same sender joins the runtime cohort too.
    const plain = await jobRow((await admit(runtimeAccount, 'จำได้ไหมคะ')).jobId)
    expect(plain).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', memorySyncOptIn: false })
  })
})

describe('unverified sender: Core hands the runtime no person, Work, memory or catalogue command', () => {
  it('whatever the runtime sends, and even when the sender is verified mid-turn', async () => {
    clock = instant()
    const { ports, core, spies } = buildRuntime()
    const work = await jobRow((await admit(runtimeAccount, '/projects', { user: pendingOwner })).jobId)
    expect(work.runtimeOwner).toBe('CONVERSATION_RUNTIME')
    const { claim, authority } = await claimTurn(ports)
    expect(claim.jobId).toBe(work.id)
    expect(authority.scope).toEqual({ tenantId: tenant.id, businessId: business.id, accountId: runtimeAccount.id,
      identityId: null, identityVersion: null, identityState: 'UNVERIFIED' })
    // The sender links and is verified while the turn runs.
    await verifyPendingOwner()
    const again = await ports.authority.resolve(claim)
    expect(again.scope).toEqual(authority.scope)
    const turn = await ports.context.prepare(claim, again)
    expect(turn.workCommand).toEqual({ operation: 'read', input: { kind: 'projects', query: '' } })
    const refusal = { status: 'REJECTED', code: 'WORK_ACTION_UNAVAILABLE',
      result: { text: 'ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ' } }
    expect(await ports.workTool.execute(claim, again, validateWorkToolRequest({ ...turn.workCommand, operationId: `${work.id}:work-read` })))
      .toEqual(refusal)
    // Any other Work request is refused before a Work call; a status probe finds nothing.
    const ref = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
      tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }
    await expect(core.operate({ operation: 'work-tool', payload: { claim: ref, operation: 'propose', operationId: `${work.id}:work-proposal`,
      input: { action: 'create_work', targetId: workstream.id, args: { title: 'งานที่ไม่ได้พิมพ์' } } } }))
      .rejects.toMatchObject({ code: 'WORK_COMMAND_MISMATCH' })
    expect(await core.operate({ operation: 'work-tool', payload: { claim: ref, operation: 'status', operationId: `${work.id}:work-proposal`, input: {} } }))
      .toEqual({ status: 'NOT_FOUND', operationId: `${work.id}:work-proposal` })
    // A Work command never touches memory, even when its row claims a memory opt-in
    // (W11 moved an unverified sender's memory turns in; W10's blanket refusal is gone).
    await prisma.lineConversationJob.update({ where: { id: work.id }, data: { memorySyncOptIn: true } })
    for (const [operation, operationId, input] of [['read', `${work.id}:memory-read`, {}], ['append', `${work.id}:memory-append`, { text: answerText }],
      ['receipt', `${work.id}:memory-injection`, { state: 'RESOLVED' }], ['receipt', `${work.id}:memory-read`, {}]]) {
      await expect(core.operate({ operation: 'memory', payload: { claim: ref, operation, operationId, input } }))
        .rejects.toMatchObject({ code: 'MEMORY_NOT_APPLICABLE', status: 409 })
    }
    expect((await core.operate({ operation: 'prepare', payload: { claim: ref, authorityVersion: ref.version } })).memorySync).toBeUndefined()
    expect(spies).toMatchObject({ workSearch: 0, threadMemory: 0, memoryContext: 0 })
    await prisma.lineConversationJob.update({ where: { id: work.id }, data: { memorySyncOptIn: false } })

    // `#sku` from the same OWNER, verified before the turn is even claimed: still an ordinary question.
    await prisma.channelIdentity.updateMany({ where: { tenantId: tenant.id, providerSubject: pendingOwner }, data: { status: 'PENDING', verifiedAt: null, linkedAt: null } })
    await prisma.externalIdentity.updateMany({ where: { tenantId: tenant.id, providerSubject: pendingOwner }, data: { verifiedAt: null, linkedAt: null } })
    await prisma.lineConversationJob.update({ where: { id: work.id }, data: { status: 'CANCELLED', errorCode: 'TEST_UNVERIFIED_DONE', version: { increment: 1 } } })
    const sku = await jobRow((await admit(runtimeAccount, '#sku\nรหัส: CRUNV-GIFT-02', { user: pendingOwner })).jobId)
    await verifyPendingOwner()
    const catalog = await claimTurn(ports)
    expect(catalog.claim.jobId).toBe(sku.id)
    expect(catalog.authority.scope.identityState).toBe('UNVERIFIED')
    const catalogTurn = await ports.context.prepare(catalog.claim, catalog.authority)
    expect(catalogTurn.turnKind).toBeUndefined()
    expect(catalogTurn.evidence).toEqual(evidenceFixture)
    expect(spies.catalogCommand).toBe(0)

    // Control: the same OWNER, verified at admission, is a verified job and does reach Work.
    await prisma.lineConversationJob.update({ where: { id: sku.id }, data: { status: 'CANCELLED', errorCode: 'TEST_UNVERIFIED_DONE', version: { increment: 1 } } })
    const verifiedWork = await jobRow((await admit(runtimeAccount, '/projects', { user: pendingOwner })).jobId)
    expect(await identityRecord(verifiedWork)).toBeNull()
    const control = await claimTurn(ports)
    expect(control.authority.scope).toMatchObject({ identityId: expect.any(String), identityVersion: expect.any(Number) })
    expect(control.authority.scope.identityState).toBeUndefined()
    const controlTurn = await ports.context.prepare(control.claim, control.authority)
    const read = await ports.workTool.execute(control.claim, control.authority,
      validateWorkToolRequest({ ...controlTurn.workCommand, operationId: `${verifiedWork.id}:work-read` }))
    expect(read.status).toBe('COMPLETED')
    expect(spies.workSearch).toBe(1)
  })

  it('the runtime cannot write the admission record that would move a job out of the verified fence', async () => {
    clock = instant()
    const { ports, core } = buildRuntime()
    const job = await jobRow((await admit(runtimeAccount, 'มีชุดของขวัญไหม', { user: verifiedUser })).jobId)
    const { claim } = await claimTurn(ports)
    expect(claim.jobId).toBe(job.id)
    const ref = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
      tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }
    await expect(core.operate({ operation: 'trace', payload: { claim: ref, kind: 'CHANNEL_IDENTITY_ADMITTED',
      payload: { identityAssurance: 'UNVERIFIED', senderSha256: sha256(verifiedUser) } } })).rejects.toThrow('TRACE_KIND_NOT_PERMITTED')
    expect(await identityRecord(job)).toBeNull()
  })
})

describe('a verified sender keeps the verified-identity fences', () => {
  it('revocation mid-turn refuses every protected operation and never degrades the job to unverified', async () => {
    clock = instant()
    const sink = []
    const { ports, core } = buildRuntime({ sink })
    const job = await jobRow((await admit(runtimeAccount, 'มีชุดของขวัญไหม', { user: verifiedUser })).jobId)
    expect(job.runtimeOwner).toBe('CONVERSATION_RUNTIME')
    expect(await identityRecord(job)).toBeNull()
    const { claim, authority } = await claimTurn(ports)
    expect(authority.scope.identityState).toBeUndefined()
    const identityWhere = { tenantId_channel_channelAccountId_providerSubject: { tenantId: tenant.id, channel: 'LINE',
      channelAccountId: runtimeAccount.bindingCode, providerSubject: verifiedUser } }
    await prisma.channelIdentity.update({ where: identityWhere, data: { status: 'REVOKED', revokedAt: new Date() } })
    try {
      const ref = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
        tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }
      for (const operation of ['resolve', 'credential']) {
        await expect(core.operate({ operation, payload: { claim: ref } })).rejects.toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED', status: 403 })
      }
      await expect(core.operate({ operation: 'prepare', payload: { claim: ref, authorityVersion: ref.version } }))
        .rejects.toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED' })
      await expect(core.operate({ operation: 'work-tool', payload: { claim: ref, operation: 'status', operationId: `${job.id}:work-read`, input: {} } }))
        .rejects.toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED' })
      await expect(core.operate({ operation: 'renew', payload: { claim: ref } })).rejects.toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED' })
      await expect(core.operate({ operation: 'complete', payload: { claim: ref, text: answerText, operationId: `${job.id}:turn-answer` } }))
        .rejects.toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED' })
      // Core's own settle and send fences refuse it too, below the façade.
      await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status: 'READY', answerText, version: { increment: 1 } } })
      expect(await core.operate({ operation: 'send', payload: { claim: ref, operationId: `${job.id}:${claim.executionId}:delivery` } }))
        .toMatchObject({ id: job.id, status: 'CANCELLED' })
      expect(sink).toEqual([])
    } finally {
      await prisma.channelIdentity.update({ where: identityWhere, data: { status: 'ACTIVE', revokedAt: null } })
    }
  })
})

describe('an unverified job cannot complete or send once its account, transport, sender or erasure state changes', () => {
  /** Admit, claim and resolve an unverified job; `stage` 'READY' also commits the answer. */
  async function unverifiedJob({ stage, source = null } = {}) {
    clock = instant()
    const sink = []
    const built = buildRuntime({ sink })
    const job = await jobRow((await admit(runtimeAccount, 'ซูริ มีชุดของขวัญไหม', { source })).jobId)
    expect(job.runtimeOwner).toBe('CONVERSATION_RUNTIME')
    const { claim } = await claimTurn(built.ports)
    expect(claim.jobId).toBe(job.id)
    const ref = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId, version: claim.version,
      tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }
    if (stage === 'READY') {
      await built.core.operate({ operation: 'prepare', payload: { claim: ref, authorityVersion: ref.version } })
      expect(await built.core.operate({ operation: 'complete', payload: { claim: ref, text: answerText, operationId: `${job.id}:turn-answer` } }))
        .toMatchObject({ status: 'READY' })
    }
    const complete = () => built.core.operate({ operation: 'complete', payload: { claim: ref, text: answerText, operationId: `${job.id}:turn-answer` } })
    const send = () => built.core.operate({ operation: 'send', payload: { claim: ref, operationId: `${job.id}:${claim.executionId}:delivery` } })
    return { job, ref, sink, complete, send, ...built }
  }
  const erase = job => prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [job.inbound.conversationId] }))
  const changes = {
    erasure: async job => erase(job),
    'transport epoch': async () => prisma.lineOaAccount.update({ where: { id: runtimeAccount.id }, data: { transportEpoch: { increment: 1 } } }),
    'account disabled': async () => prisma.lineOaAccount.update({ where: { id: runtimeAccount.id }, data: { serverEnabled: false } }),
    'account owner': async () => prisma.lineOaAccount.update({ where: { id: runtimeAccount.id }, data: { runtimeOwner: 'SERVER' } }),
  }
  const restore = async () => {
    const current = await prisma.lineOaAccount.findUnique({ where: { id: runtimeAccount.id } })
    runtimeAccount = await prisma.lineOaAccount.update({ where: { id: runtimeAccount.id },
      data: { serverEnabled: true, runtimeOwner: 'CONVERSATION_RUNTIME', transportEpoch: current.transportEpoch } })
  }

  it.each(Object.keys(changes))('%s before completion: Core refuses the completion and nothing is sent', async change => {
    const turn = await unverifiedJob()
    try {
      await changes[change](turn.job)
      await expect(turn.complete()).rejects.toMatchObject({ status: 409 })
      const sent = await turn.send().catch(error => ({ status: error.code ?? error.message }))
      expect(['ACCEPTED', 'RECORDED']).not.toContain(sent.status)
      expect(turn.sink).toEqual([])
      expect((await jobRow(turn.job.id)).status).not.toBe('READY')
    } finally { await restore() }
  })

  it.each(Object.keys(changes))('%s after completion: the READY answer is never sent', async change => {
    const turn = await unverifiedJob({ stage: 'READY' })
    try {
      await changes[change](turn.job)
      const outcome = await turn.send().catch(error => ({ status: error.code ?? error.message }))
      expect(['CANCELLED', 'FENCED', 'CONVERSATION_JOB_LEASE_CONFLICT']).toContain(outcome.status)
      expect(turn.sink).toEqual([])
      expect((await jobRow(turn.job.id)).status).not.toMatch(/^(ACCEPTED|RECORDED)$/)
    } finally { await restore() }
  })

  // Review of #597 (Low, B6): Core trusts the admission record only when its turn,
  // kind and payload are its own. A row under the same Core key that is not exactly
  // that record fences the job; it never reads as a valid unverified admission.
  const forgeries = {
    'a forged record under the same key with the wrong kind': job => ({ kind: 'TOOL_RESULT' }),
    'a record moved to another turn': job => ({ turnId: job.otherTurnId }),
    'an emptied record whose sourceUserId is unchanged': job => ({ payloadJson: JSON.stringify({ senderSha256: sha256(job.sourceUserId) }) }),
  }
  it.each(Object.keys(forgeries))('%s: Core refuses resolve, completion and send, and nothing is delivered', async forgery => {
    const other = await unverifiedJob()
    await prisma.lineConversationJob.update({ where: { id: other.job.id }, data: { status: 'CANCELLED', errorCode: 'TEST_UNVERIFIED_DONE', version: { increment: 1 } } })
    for (const stage of [undefined, 'READY']) {
      const turn = await unverifiedJob({ stage })
      const where = { tenantId_businessId_idempotencyKey: { tenantId: tenant.id, businessId: business.id,
        idempotencyKey: `${turn.job.id}:identity-admission` } }
      // The sender id still matches the admitted hash in every case.
      expect(JSON.parse((await prisma.agentTraceEvent.findUnique({ where })).payloadJson).senderSha256).toBe(sha256(turn.job.sourceUserId))
      await prisma.agentTraceEvent.update({ where, data: forgeries[forgery]({ ...turn.job, otherTurnId: other.job.id }) })
      if (stage === 'READY') {
        expect(await turn.send()).toMatchObject({ status: 'CANCELLED' })
      } else {
        await expect(turn.core.operate({ operation: 'resolve', payload: { claim: turn.ref } }))
          .rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED', status: 409 })
        await expect(turn.complete()).rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED', status: 409 })
      }
      expect(turn.sink).toEqual([])
    }
  })

  it('a changed speaker in a group, with the thread still bound, fences completion and send', async () => {
    const source = { type: 'group', groupId, userId: stranger }
    for (const stage of [undefined, 'READY']) {
      const turn = await unverifiedJob({ stage, source })
      expect(turn.job).toMatchObject({ audienceKind: 'GROUP', recipientId: groupId })
      // The row now names another speaker; the audience binding alone still holds.
      await prisma.lineConversationJob.update({ where: { id: turn.job.id }, data: { sourceUserId: otherSpeaker } })
      if (stage === 'READY') expect(await turn.send()).toMatchObject({ status: 'CANCELLED' })
      else await expect(turn.complete()).rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED', status: 409 })
      expect(turn.sink).toEqual([])
    }
  })
})
