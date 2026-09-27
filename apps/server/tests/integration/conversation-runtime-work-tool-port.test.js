import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { handleLineProjectWorkCommand, lineWorkReadText, LINE_WORK_DUPLICATE_TEXT, searchLineProjectWork } from '@/modules/agent/line-project-work-tools'
import { isValidWorkToolResult } from '@/modules/line-oa-studio/domain/work-tool-receipt'
import { updateItem } from '@/modules/project-manager/application/work-service'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { validateWorkToolRequest } from '../../../../services/conversation-runtime/src/contracts.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-149, FR-150 — the extracted runtime's WorkToolPort against the real Core provider.
// @spec ADR-106 D2-D4, SDD-110 — WorkTool `read`, `propose`, `confirm-execute`, `status`:
// Core revalidates authority, canonical Project Manager writers own the mutation, and the
// durable receipt replays across retries. Nothing on either side of the port is mocked:
// runtime ports (core-ports.js) → runtime client (core-client.js, consumer-side response
// validation) → Core route handler → Core façade → line-project-work-tools → Prisma (the
// disposable per-run SQLite database). Only the LINE transport is a local fake, and only in
// the full-turn case. The HTTP socket hop is replaced by an in-process fetch that still
// serialises every request and response; the socket path itself is covered by
// conversation-runtime-vertical-slice.test.js.
// Two engines: the default config runs this file on the per-run SQLite database;
// `npm run test:postgres` (vitest.postgres.config.js) runs the SAME file on a
// disposable embedded PostgreSQL 17, the production engine, where the confirm
// transaction really races (SQLite's single writer serialises it).
// @tested tests/integration/conversation-runtime-work-tool-port.test.js
const serviceToken = 'synthetic-work-tool-port-core-token-000001'
const sealKey = '5c'.repeat(32)
const lineUser = 'synthetic-wtp-line-user'
const schema = JSON.parse(readFileSync(new URL(
  '../../../../services/conversation-runtime/contracts/v1/operation.schema.json', import.meta.url), 'utf8'))

// tests/global-setup-postgres.js provides 'postgresql'; tests/global-setup.js provides nothing.
const engine = inject('testDatabaseEngine') ?? 'sqlite'
let tenant, business, account, workstream, project, actor, ownerViewer
let wire = []
let deliveries = []
let openJobs = []

function inProcessFetch(handlers) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const request = new Request(target, init)
    const operation = target.pathname.split('/').pop()
    if (init.body) {
      const envelope = JSON.parse(init.body)
      wire.push({ operation: envelope.operation, payload: envelope.payload, idempotencyKey: envelope.idempotencyKey })
    }
    return operation === 'health'
      ? handlers.GET(request, { params: { operation } })
      : handlers.POST(request, { params: { operation } })
  }
}

function build({ coreOptions = {} } = {}) {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    // A Work turn never needs a model credential; asking for one is a routing defect.
    credentialResolver: async () => { throw Object.assign(new Error('WORK_TURN_MUST_NOT_RESOLVE_MODEL_CREDENTIAL'), { status: 500 }) },
    linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-wtp-reply' } } },
      pushTransport: { send: async ({ messages }) => { deliveries.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-wtp-push' } } } }),
    ...coreOptions })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core)) })
  const ports = createCorePorts({ client,
    model: { generate: async () => { throw new Error('WORK_TURN_MUST_NOT_CALL_MODEL') } } })
  return { core, client, ports }
}

async function admit(eventId, text) {
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current,
    env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, correlationId: eventId, now: new Date(),
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
      source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
  expect(job).toMatchObject({ executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME', status: 'QUEUED' })
  return jobId
}

const LEGACY_ORACLE_ROLLBACK = Symbol('legacy-oracle-rollback')

/**
 * The legacy Server handler's own reply for this job, on the current database state:
 * `handleLineProjectWorkCommand` runs for real inside one transaction that is then
 * rolled back, so nothing it writes (proposal, receipt, WorkItem, code counter)
 * survives and the runtime path afterwards starts from the identical state. The
 * handler opens its own transactions; they run inside the outer one here.
 */
async function legacyReply(jobId, now) {
  let reply
  try {
    await prisma.$transaction(async tx => {
      const db = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (work => work(target)) : target[key] })
      const job = await tx.lineConversationJob.findUnique({ where: { id: jobId }, include: { inbound: true } })
      reply = await handleLineProjectWorkCommand(job, { db, now })
      throw LEGACY_ORACLE_ROLLBACK
    }, { timeout: 30_000 })
  } catch (error) {
    if (error !== LEGACY_ORACLE_ROLLBACK) throw error
  }
  expect(reply?.text, 'the legacy handler must answer every Work command').toEqual(expect.any(String))
  return reply
}

/** Claim through the runtime's own port, then resolve authority and prepare the turn through Core. */
async function claimTurn(ports, jobId, claimantId) {
  const claim = await ports.job.claim({ claimantId })
  expect(claim?.jobId, 'another runtime-cohort job was queued ahead of this test').toBe(jobId)
  const authority = await ports.authority.resolve(claim)
  const turn = await ports.context.prepare(claim, authority)
  return { claim, authority, turn }
}

const workToolCalls = () => wire.filter(call => call.operation === 'work-tool')
  .map(call => `${call.payload.operation} ${call.payload.operationId}`)

/** Propose a create_work change through the port and release the proposal job. */
async function proposeWork(ports, eventId, title) {
  const proposalJobId = await admit(eventId, `/work-create ${workstream.id} ${title}`)
  const { claim, authority, turn } = await claimTurn(ports, proposalJobId, `runtime-${eventId}`)
  const proposed = await ports.workTool.execute(claim, authority,
    validateWorkToolRequest({ ...turn.workCommand, operationId: `${proposalJobId}:work-proposal` }))
  expect(proposed.result.receipt).toEqual({ proposalId: proposalJobId, status: 'AWAITING_CONFIRMATION' })
  await prisma.lineConversationJob.update({ where: { id: proposalJobId },
    data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_PROPOSED', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  return proposalJobId
}

/** Admit and claim a new job carrying the human confirmation text for `proposalId`. */
async function confirmationTurn(ports, eventId, proposalId) {
  const jobId = await admit(eventId, `ยืนยันงาน ${proposalId}`)
  const turn = await claimTurn(ports, jobId, `runtime-${eventId}`)
  expect(turn.turn.workCommand).toEqual({ operation: 'confirm-execute', input: { proposalId } })
  return { jobId, ...turn, request: validateWorkToolRequest({ ...turn.turn.workCommand, operationId: proposalId }) }
}

/** Everything one confirmation may leave behind, read straight from the database. */
async function confirmationState(proposalId, title) {
  const items = await prisma.workItem.findMany({ where: { workstreamId: workstream.id, title } })
  return {
    items: items.length,
    // The canonical Project Manager writer's audit row for the created WorkItem.
    workAudits: items.length ? await prisma.auditEvent.count({ where: { entityType: 'WORK_ITEM', action: 'CREATED', entityId: { in: items.map(item => item.id) } } }) : 0,
    // The unique confirmation receipt (acquired before the write) and the execution result.
    receipts: await prisma.auditEvent.count({ where: { id: `line-work-executed:${proposalId}` } }),
    results: await prisma.auditEvent.count({ where: { id: `line-work-result:${proposalId}` } }),
    agentActions: await prisma.auditEvent.count({ where: { entityType: 'AGENT_ACTION', entityId: proposalId } }),
  }
}

/**
 * The Core database handle with hooks that run INSIDE confirmLineWork's
 * transaction: `afterReceiptLookup` right after it reads the (absent) confirmation
 * receipt, `afterResultWrite` right after it writes the execution result — after
 * the canonical write and before its re-check of authority. Nothing else about
 * the handle changes, so the transaction, its isolation level and its rollback
 * are the real ones.
 */
function withConfirmHooks({ afterReceiptLookup = null, afterResultWrite = null }) {
  const hooked = { findUnique: [afterReceiptLookup, 'line-work-executed:'], create: [afterResultWrite, 'line-work-result:'] }
  const wrapTx = tx => new Proxy(tx, { get(target, key) {
    const value = Reflect.get(target, key)
    if (key !== 'auditEvent') return value
    return new Proxy(value, { get(delegate, method) {
      const fn = Reflect.get(delegate, method)
      const [hook, prefix] = hooked[method] ?? []
      if (!hook) return typeof fn === 'function' ? fn.bind(delegate) : fn
      return async args => {
        const row = await fn.call(delegate, args)
        const id = String(args?.where?.id ?? args?.data?.id ?? '')
        if (id.startsWith(prefix)) await hook(target, row)
        return row
      }
    } })
  } })
  return new Proxy(prisma, { get(target, key) {
    const value = Reflect.get(target, key)
    if (key !== '$transaction') return typeof value === 'function' ? value.bind(target) : value
    return (work, options) => typeof work === 'function'
      ? target.$transaction(tx => work(wrapTx(tx)), options)
      : target.$transaction(work, options)
  } })
}

/** Hold each caller until `parties` have arrived, or until `timeoutMs` passes. */
function barrier(parties, timeoutMs = 5000) {
  let arrived = 0
  let open
  const gate = new Promise(resolve => { open = resolve })
  return async () => {
    arrived += 1
    if (arrived >= parties) open()
    await Promise.race([gate, new Promise(resolve => setTimeout(resolve, timeoutMs))])
  }
}

beforeAll(async () => {
  // The run is on the engine it claims: a PostgreSQL run that silently fell back
  // to SQLite would prove nothing about PostgreSQL.
  if (engine === 'postgresql') {
    const [{ version }] = await prisma.$queryRawUnsafe('SELECT version() AS version')
    expect(version).toMatch(/^PostgreSQL 17\./)
  } else {
    const [{ version }] = await prisma.$queryRawUnsafe('SELECT sqlite_version() AS version')
    expect(version).toMatch(/^3\./)
  }
  const portfolio = await createPortfolio({ name: 'WorkToolPort fixture', code: 'PF-CR-WTP' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'WorkToolPort tenant', code: 'TNT-CR-WTP' })
  business = await createBusiness({ tenantId: tenant.id, name: 'WorkToolPort business', code: 'BUS-CR-WTP' })
  actor = await prisma.person.create({ data: { code: 'PER-CR-WTP', displayName: 'Synthetic WorkToolPort actor' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  ownerViewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
    visibleDomains: ['projects', 'people', 'platform', 'line-oa'] })
  const workspace = await createWorkspace({ name: 'WorkToolPort workspace', code: 'WS-CR-WTP', scopeType: 'BUSINESS', businessId: business.id })
  project = await createProject({ workspaceId: workspace.id, name: 'WorkToolPort project', code: 'PRJ-CR-WTP' }, { viewer: ownerViewer })
  workstream = await createWorkstream({ projectId: project.id, name: 'WorkToolPort stream', code: 'WST-CR-WTP', executionMode: 'SOFTWARE_SPRINT' }, { viewer: ownerViewer })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: 'Synthetic WorkToolPort LINE connection', externalAccountId: 'synthetic-wtp-destination', status: 'ACTIVE' })
  // Fixture: the account is created already opted into the runtime cohort. The
  // opt-in path itself (CONFIGURE_EXECUTION with quiescence) is covered by the
  // vertical-slice suite; this suite is about the WorkTool port behind it.
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-wtp-account', displayName: 'Synthetic WorkToolPort OA',
    bindingCode: 'cr-wtp-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner: 'CONVERSATION_RUNTIME' } })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
})

afterEach(async () => {
  // Leave nothing claimable for the next case or the next suite in this run.
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  wire = []
  deliveries = []
})

describe(`Conversation Runtime WorkToolPort against the real Core provider (${engine})`, () => {
  it('read: returns the canonical Project Manager listing and has no receipt to replay', async () => {
    const { ports } = build()
    const jobId = await admit('synthetic-wtp-read-projects', '/projects')
    const { claim, authority, turn } = await claimTurn(ports, jobId, 'runtime-wtp-read')
    expect(turn.workCommand).toEqual({ operation: 'read', input: { kind: 'projects', query: '' } })
    const request = validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-read` })

    expect(await ports.workTool.status(claim, request.operationId))
      .toEqual({ status: 'NOT_FOUND', operationId: `${jobId}:work-read` })
    const result = await ports.workTool.execute(claim, authority, request)
    expect(Object.keys(result).sort()).toEqual(['result', 'status'])
    expect(result.status).toBe('COMPLETED')
    expect(Object.keys(result.result).sort()).toEqual(['receipt', 'text'])
    // Byte-for-byte the legacy Server reply, with the item and workstream ids that /work-create needs.
    expect(result.result.text).toBe((await legacyReply(jobId)).text)
    expect(result.result.text).toBe(`PRJ-CR-WTP: WorkToolPort project — ${project.status}\n${project.id}\nWorkToolPort stream: ${workstream.id}`)
    expect(Object.keys(result.result.receipt).sort()).toEqual(['observedAt', 'source'])
    expect(result.result.receipt.source).toBe('PROJECT_MANAGER')
    expect(Number.isFinite(Date.parse(result.result.receipt.observedAt))).toBe(true)
    // A read writes nothing, so a reclaimed runtime re-reads rather than replaying.
    expect(await ports.workTool.status(claim, request.operationId))
      .toEqual({ status: 'NOT_FOUND', operationId: `${jobId}:work-read` })
    expect(workToolCalls()).toEqual([`status ${jobId}:work-read`, `read ${jobId}:work-read`, `status ${jobId}:work-read`])
  })

  it('propose then confirm-execute: one canonical WorkItem, durable receipts replay, duplicates never re-execute', async () => {
    const { ports } = build()
    const before = await prisma.workItem.count({ where: { workstreamId: workstream.id } })

    const proposalJobId = await admit('synthetic-wtp-propose', `/work-create ${workstream.id} WorkToolPort receipt task`)
    const proposal = await claimTurn(ports, proposalJobId, 'runtime-wtp-propose')
    expect(proposal.turn.workCommand).toEqual({ operation: 'propose',
      input: { action: 'create_work', targetId: workstream.id, args: { title: 'WorkToolPort receipt task' } } })
    const proposeRequest = validateWorkToolRequest({ ...proposal.turn.workCommand, operationId: `${proposalJobId}:work-proposal` })
    expect(await ports.workTool.status(proposal.claim, proposeRequest.operationId))
      .toEqual({ status: 'NOT_FOUND', operationId: `${proposalJobId}:work-proposal` })

    const proposed = await ports.workTool.execute(proposal.claim, proposal.authority, proposeRequest)
    expect(Object.keys(proposed).sort()).toEqual(['result', 'status'])
    expect(proposed.status).toBe('COMPLETED')
    expect(proposed.result.receipt).toEqual({ proposalId: proposalJobId, status: 'AWAITING_CONFIRMATION' })
    expect(proposed.result.text).toContain('WorkToolPort stream')
    expect(proposed.result.text).toContain(`ยืนยันงาน ${proposalJobId}`)
    // A proposal is not a mutation.
    expect(await prisma.workItem.count({ where: { workstreamId: workstream.id } })).toBe(before)
    expect(await prisma.auditEvent.findUnique({ where: { id: proposalJobId } })).toMatchObject({ entityType: 'LINE_WORK_PROPOSAL' })

    // After a lost response or a reclaim, the status probe replays the same receipt,
    // and a repeated execute returns the same proposal instead of a second one.
    const replayed = await ports.workTool.status(proposal.claim, proposeRequest.operationId)
    expect(replayed).toEqual({ status: 'COMPLETED', result: { text: expect.stringContaining(`ยืนยันงาน ${proposalJobId}`),
      receipt: { proposalId: proposalJobId, status: 'AWAITING_CONFIRMATION' } } })
    const repeated = await ports.workTool.execute(proposal.claim, proposal.authority, proposeRequest)
    expect(repeated.result.receipt).toEqual(proposed.result.receipt)
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_WORK_PROPOSAL', id: proposalJobId } })).toBe(1)
    await prisma.lineConversationJob.update({ where: { id: proposalJobId },
      data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_PROPOSED', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })

    const confirmJobId = await admit('synthetic-wtp-confirm', `ยืนยันงาน ${proposalJobId}`)
    const confirmation = await claimTurn(ports, confirmJobId, 'runtime-wtp-confirm')
    expect(confirmation.turn.workCommand).toEqual({ operation: 'confirm-execute', input: { proposalId: proposalJobId } })
    // The mutation identity is the proposal id, not the confirming job or execution.
    const confirmRequest = validateWorkToolRequest({ ...confirmation.turn.workCommand, operationId: proposalJobId })
    expect(await ports.workTool.status(confirmation.claim, proposalJobId))
      .toEqual({ status: 'NOT_FOUND', proposalId: proposalJobId, receipt: { status: 'AWAITING_CONFIRMATION' } })

    const executed = await ports.workTool.execute(confirmation.claim, confirmation.authority, confirmRequest)
    expect(executed.status).toBe('COMPLETED')
    const item = await prisma.workItem.findFirst({ where: { workstreamId: workstream.id, title: 'WorkToolPort receipt task' } })
    expect(item).not.toBeNull()
    expect(executed.result).toEqual({ text: `บันทึกงาน ${item.code} แล้ว สถานะ ${item.status}`,
      receipt: { proposalId: proposalJobId, action: 'create_work', itemId: item.id, code: item.code, status: item.status, version: item.version } })
    expect(await prisma.workItem.count({ where: { workstreamId: workstream.id } })).toBe(before + 1)

    const receiptRow = await prisma.auditEvent.findUnique({ where: { id: `line-work-result:${proposalJobId}` } })
    expect(JSON.parse(receiptRow.payloadJson)).toEqual(executed.result.receipt)
    expect(await ports.workTool.status(confirmation.claim, proposalJobId)).toEqual({ status: 'COMPLETED',
      result: { text: 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ', receipt: executed.result.receipt } })
    const duplicate = await ports.workTool.execute(confirmation.claim, confirmation.authority, confirmRequest)
    expect(duplicate).toEqual({ status: 'COMPLETED', result: { text: 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ',
      receipt: { ...executed.result.receipt, duplicate: true } } })
    expect(await prisma.workItem.count({ where: { workstreamId: workstream.id } })).toBe(before + 1)

    expect(workToolCalls()).toEqual([
      `status ${proposalJobId}:work-proposal`, `propose ${proposalJobId}:work-proposal`,
      `status ${proposalJobId}:work-proposal`, `propose ${proposalJobId}:work-proposal`,
      `status ${proposalJobId}`, `confirm-execute ${proposalJobId}`, `status ${proposalJobId}`, `confirm-execute ${proposalJobId}`,
    ])
  })

  it('fences stale, forged and expired claims before any Work side effect', async () => {
    const { ports } = build()
    const jobId = await admit('synthetic-wtp-fence', `/work-create ${workstream.id} WorkToolPort fenced task`)
    const { claim, authority, turn } = await claimTurn(ports, jobId, 'runtime-wtp-fence')
    const request = validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-proposal` })
    const rejectedWith = async (candidate, code) => {
      await expect(ports.workTool.execute(candidate, authority, request)).rejects.toMatchObject({ code, retryable: false })
      await expect(ports.workTool.status(candidate, request.operationId)).rejects.toMatchObject({ code })
    }

    // Renewal bumps the claim version; the pre-renewal claim is stale from then on.
    const renewed = await ports.job.renew(claim)
    expect(renewed.version).toBe(claim.version + 1)
    await rejectedWith(claim, 'CONVERSATION_JOB_AUTHORITY_REVOKED')
    const current = { ...claim, version: renewed.version, leaseExpiresAt: renewed.leaseExpiresAt }
    await rejectedWith({ ...current, tenantId: 'forged-tenant' }, 'CONVERSATION_JOB_AUTHORITY_REVOKED')
    await rejectedWith({ ...current, executionId: 'forged-execution' }, 'CONVERSATION_JOB_AUTHORITY_REVOKED')
    await rejectedWith({ ...current, claimantId: 'forged-claimant' }, 'CONVERSATION_JOB_AUTHORITY_REVOKED')

    await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
      tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: lineUser } },
    data: { status: 'REVOKED', revokedAt: new Date() } })
    try {
      await expect(ports.workTool.execute(current, authority, request)).rejects.toMatchObject({ code: 'CONVERSATION_IDENTITY_REVOKED' })
    } finally {
      await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
        tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: lineUser } },
      data: { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() } })
    }

    await prisma.lineConversationJob.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
    await rejectedWith(current, 'CONVERSATION_JOB_AUTHORITY_REVOKED')

    // None of the refused calls reached the Project Manager writers.
    expect(await prisma.auditEvent.findUnique({ where: { id: jobId } })).toBeNull()
    expect(await prisma.workItem.findFirst({ where: { title: 'WorkToolPort fenced task' } })).toBeNull()
  })

  const nothingWritten = { items: 0, workAudits: 0, receipts: 0, results: 0, agentActions: 0 }
  const writtenOnce = { items: 1, workAudits: 1, receipts: 1, results: 1, agentActions: 2 }
  const replayText = 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ'
  const release = jobId => prisma.lineConversationJob.update({ where: { id: jobId },
    data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })

  it('confirm-execute: fences stale, forged and expired claims before the write and leaves the proposal confirmable', async () => {
    const { ports } = build()
    const title = 'WorkToolPort fenced confirmation'
    const proposalId = await proposeWork(ports, 'synthetic-wtp-cfence-propose', title)
    const confirm = await confirmationTurn(ports, 'synthetic-wtp-cfence-confirm', proposalId)
    const rejectedWith = async (candidate, code) => {
      await expect(ports.workTool.execute(candidate, confirm.authority, confirm.request)).rejects.toMatchObject({ code, retryable: false })
      await expect(ports.workTool.status(candidate, proposalId)).rejects.toMatchObject({ code })
    }

    // Renewal bumps the claim version; the pre-renewal claim is stale from then on.
    const renewed = await ports.job.renew(confirm.claim)
    await rejectedWith(confirm.claim, 'CONVERSATION_JOB_AUTHORITY_REVOKED')
    const current = { ...confirm.claim, version: renewed.version, leaseExpiresAt: renewed.leaseExpiresAt }
    for (const forged of [{ tenantId: 'forged-tenant' }, { businessId: 'forged-business' }, { accountId: 'forged-account' },
      { executionId: 'forged-execution' }, { claimantId: 'forged-claimant' }, { version: renewed.version + 1 },
      // The proposal's own (released) job cannot be borrowed to confirm it.
      { jobId: proposalId }]) await rejectedWith({ ...current, ...forged }, 'CONVERSATION_JOB_AUTHORITY_REVOKED')

    const lease = (await prisma.lineConversationJob.findUnique({ where: { id: confirm.jobId } })).leaseExpiresAt
    await prisma.lineConversationJob.update({ where: { id: confirm.jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })
    await rejectedWith(current, 'CONVERSATION_JOB_AUTHORITY_REVOKED')
    expect(await confirmationState(proposalId, title)).toEqual(nothingWritten)
    expect(await prisma.auditEvent.findUnique({ where: { id: proposalId } })).toMatchObject({ entityType: 'LINE_WORK_PROPOSAL' })

    // None of the refusals consumed the proposal: the current claim confirms it, once.
    await prisma.lineConversationJob.update({ where: { id: confirm.jobId }, data: { leaseExpiresAt: lease } })
    expect(await ports.workTool.status(current, proposalId))
      .toEqual({ status: 'NOT_FOUND', proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } })
    const executed = await ports.workTool.execute(current, confirm.authority, confirm.request)
    expect(executed.result.receipt).toMatchObject({ proposalId, action: 'create_work' })
    expect(await confirmationState(proposalId, title)).toEqual(writtenOnce)
  })

  it('confirm-execute: re-checks authority after the canonical write and rolls the write back when it no longer holds', async () => {
    const title = 'WorkToolPort rechecked confirmation'
    const proposalId = await proposeWork(build().ports, 'synthetic-wtp-recheck-propose', title)

    // 1. The lease runs out while the canonical writer works: after the write, the
    // clock Core reads is past the lease (and, with the default five-minute lease,
    // past the proposal too), so the re-check's own authority read refuses. The
    // whole transaction rolls back.
    let late = null
    const slow = build({ coreOptions: { now: () => late ?? new Date(),
      db: withConfirmHooks({ afterResultWrite: async tx => {
        const job = await tx.lineConversationJob.findUnique({ where: { id: expired.jobId } })
        late = new Date(job.leaseExpiresAt.getTime() + 1)
      } }) } })
    const expired = await confirmationTurn(slow.ports, 'synthetic-wtp-recheck-lease', proposalId)
    // The canonical writer refuses with WORK_SCOPE_DENIED; because the claim itself no
    // longer holds, Core answers the fence error rather than a Work refusal reply (W1).
    await expect(slow.ports.workTool.execute(expired.claim, expired.authority, expired.request))
      .rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
    expect(late).not.toBeNull()
    late = null
    expect(await confirmationState(proposalId, title)).toEqual(nothingWritten)
    expect(await slow.ports.workTool.status(expired.claim, proposalId))
      .toEqual({ status: 'NOT_FOUND', proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } })
    await release(expired.jobId)

    // 1b. Only the lease runs out, and only after the re-check has read its clock:
    // the proposal is still valid and the re-check's authority read passed, so the
    // final lease guard at the end of confirmLineWork is the only thing that stops
    // the commit. confirmLineWork reads Core's clock twice after the result write:
    // once for the re-check, once for that final guard.
    let leaseEnd = null
    let armed = false
    let clockReadsAfterWrite = 0
    const finalGuard = build({ coreOptions: {
      now: () => {
        if (!armed) return new Date()
        clockReadsAfterWrite += 1
        return clockReadsAfterWrite === 1 ? new Date(leaseEnd.getTime() - 1) : new Date(leaseEnd.getTime())
      },
      db: withConfirmHooks({ afterResultWrite: async () => { armed = true } }) } })
    const leaseOnly = await confirmationTurn(finalGuard.ports, 'synthetic-wtp-recheck-final-lease', proposalId)
    // A short lease that ends well before the proposal and the job expire.
    leaseEnd = new Date(Date.now() + 30_000)
    await prisma.lineConversationJob.update({ where: { id: leaseOnly.jobId }, data: { leaseExpiresAt: leaseEnd } })
    const proposalExpiresAt = Date.parse(JSON.parse((await prisma.auditEvent.findUnique({ where: { id: proposalId } })).payloadJson).expiresAt)
    expect(leaseEnd.getTime()).toBeLessThan(proposalExpiresAt)
    expect((await prisma.lineConversationJob.findUnique({ where: { id: leaseOnly.jobId } })).expiresAt.getTime()).toBeGreaterThan(leaseEnd.getTime())
    await expect(finalGuard.ports.workTool.execute(leaseOnly.claim, leaseOnly.authority, leaseOnly.request))
      .rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' })
    // Two reads inside confirmLineWork (re-check, final guard), then Core's own fence re-check.
    expect(clockReadsAfterWrite).toBeGreaterThanOrEqual(2)
    armed = false
    expect(await confirmationState(proposalId, title)).toEqual(nothingWritten)
    await release(leaseOnly.jobId)

    // 2. The job is reclaimed by another runtime between the first authority check
    // and the end of the write. The re-check sees a stale claim and rolls back:
    // the unique receipt, the WorkItem, its audit row and the reclaim itself.
    let fired = 0
    const reclaiming = build({ coreOptions: { db: withConfirmHooks({ afterResultWrite: async tx => {
      fired += 1
      await tx.lineConversationJob.update({ where: { id: reclaimed.jobId },
        data: { executionId: 'synthetic-wtp-other-execution', claimantId: 'synthetic-wtp-other-runtime', version: { increment: 1 } } })
    } }) } })
    const reclaimed = await confirmationTurn(reclaiming.ports, 'synthetic-wtp-recheck-reclaim', proposalId)
    await expect(reclaiming.ports.workTool.execute(reclaimed.claim, reclaimed.authority, reclaimed.request))
      .rejects.toMatchObject({ code: 'WORK_CLAIM_STALE' })
    expect(fired).toBe(1)
    expect(await confirmationState(proposalId, title)).toEqual(nothingWritten)
    expect(await prisma.lineConversationJob.findUnique({ where: { id: reclaimed.jobId } })).toMatchObject({ status: 'CLAIMED',
      version: reclaimed.claim.version, executionId: reclaimed.claim.executionId, claimantId: reclaimed.claim.claimantId })

    // 3. With authority intact the same claim confirms, exactly once.
    const executed = await build().ports.workTool.execute(reclaimed.claim, reclaimed.authority, reclaimed.request)
    expect(executed.result.receipt).toMatchObject({ proposalId, action: 'create_work' })
    expect(await confirmationState(proposalId, title)).toEqual(writtenOnce)
  })

  it('confirm-execute: concurrent confirms of one proposal write one WorkItem, one receipt and one audit row; a later confirm job replays', async () => {
    // On PostgreSQL every confirm transaction is held after it has read that no
    // receipt exists until all four have read it, so all four race to write: only
    // the unique receipt key can stop the losers. SQLite's single writer lock
    // serialises the transactions, so there the later ones read the winner's
    // receipt and replay; a barrier would only deadlock against that lock.
    const racing = engine === 'postgresql'
    const { ports } = build(racing ? { coreOptions: { db: withConfirmHooks({ afterReceiptLookup: barrier(4) }) } } : {})
    const title = 'WorkToolPort concurrent confirmation'
    const proposalId = await proposeWork(ports, 'synthetic-wtp-race-propose', title)
    // Two confirmation messages, each claimed by its own runtime, each sent twice
    // (a retry racing its own first attempt): four confirms in flight at once.
    const first = await confirmationTurn(ports, 'synthetic-wtp-race-confirm-a', proposalId)
    const second = await confirmationTurn(ports, 'synthetic-wtp-race-confirm-b', proposalId)
    const settled = await Promise.allSettled([first, second, first, second]
      .map(turn => ports.workTool.execute(turn.claim, turn.authority, turn.request)))
    const outcomes = settled.map(o => o.status === 'fulfilled'
      ? (o.value.result.receipt.duplicate ? 'replayed' : 'executed') : `refused ${o.reason?.code} retryable=${o.reason?.retryable}`)
    const fulfilled = settled.filter(o => o.status === 'fulfilled').map(o => o.value)
    const executed = fulfilled.filter(value => !value.result.receipt.duplicate)
    expect(executed, JSON.stringify(outcomes)).toHaveLength(1)
    const receipt = executed[0].result.receipt
    expect(receipt).toMatchObject({ proposalId, action: 'create_work' })
    for (const value of fulfilled) expect(value.result.receipt).toEqual(value === executed[0] ? receipt : { ...receipt, duplicate: true })
    // A loser that raced the winner's commit is refused as retryable (the runtime
    // then probes status and replays) and never writes.
    for (const outcome of settled.filter(o => o.status === 'rejected')) expect(outcome.reason, JSON.stringify(outcomes)).toMatchObject({ retryable: true })
    if (racing) expect(outcomes.filter(outcome => outcome.startsWith('refused')), JSON.stringify(outcomes)).toHaveLength(3)
    expect(await confirmationState(proposalId, title)).toEqual(writtenOnce)
    // Receipt replay is scoped to the job that executed it (W1): the executing job's
    // status replays; the other job finds no receipt of its own and re-runs
    // confirm-execute, which answers as a duplicate without writing.
    const executor = [first, second, first, second][settled.findIndex(o => o.status === 'fulfilled' && o.value === executed[0])]
    const other = executor === first ? second : first
    expect(await ports.workTool.status(executor.claim, proposalId)).toEqual({ status: 'COMPLETED', result: { text: replayText, receipt } })
    expect(await ports.workTool.status(other.claim, proposalId)).toEqual({ status: 'NOT_FOUND', operationId: proposalId })

    // A second confirmation arriving later, as a new job, gets no replay of another
    // job's receipt and re-runs confirm-execute: one WorkItem still.
    await release(first.jobId)
    await release(second.jobId)
    const later = await confirmationTurn(ports, 'synthetic-wtp-race-confirm-later', proposalId)
    expect(await ports.workTool.status(later.claim, proposalId)).toEqual({ status: 'NOT_FOUND', operationId: proposalId })
    expect(await ports.workTool.execute(later.claim, later.authority, later.request))
      .toEqual({ status: 'COMPLETED', result: { text: LINE_WORK_DUPLICATE_TEXT, receipt: { ...receipt, duplicate: true } } })
    expect(await confirmationState(proposalId, title)).toEqual(writtenOnce)
  })

  // @req FR-150 — Core checks its own WorkTool response with the exact v1 receipt
  // rules the runtime client applies, from one source mirrored byte for byte.
  it('Core and the runtime check Work receipts with one source: the mirror is byte-identical', () => {
    const read = url => readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
    expect(read(new URL('../../../../services/conversation-runtime/src/work-tool-receipt.js', import.meta.url)),
      'copy apps/server/src/modules/line-oa-studio/domain/work-tool-receipt.js over the Runtime mirror')
      .toBe(read(new URL('../../src/modules/line-oa-studio/domain/work-tool-receipt.js', import.meta.url)))
  })

  it('Core refuses to send a Work receipt outside the exact v1 shape, where it used to pass anything of 12 keys', async () => {
    // A drifted Work reader: its receipt still has two keys, well inside the old
    // 12-key bound, but names another source.
    const { ports } = build({ coreOptions: { workSearch: async (...args) => ({ ...(await searchLineProjectWork(...args)), source: 'SOMEWHERE_ELSE' }) } })
    const jobId = await admit('synthetic-wtp-receipt-drift', '/projects')
    const { claim, authority, turn } = await claimTurn(ports, jobId, 'runtime-wtp-receipt-drift')
    const request = validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-read` })
    await expect(ports.workTool.execute(claim, authority, request)).rejects.toMatchObject({ code: 'CONTRACT_RESPONSE_INVALID', retryable: true })
    // The shared rules, directly: each operation has exactly one receipt shape.
    const confirm = { claim: { jobId }, operation: 'confirm-execute', operationId: jobId, input: { proposalId: jobId } }
    const executed = { proposalId: jobId, action: 'create_work', itemId: 'item-1', code: 'W-1', status: 'TODO', version: 1 }
    const completed = receipt => ({ status: 'COMPLETED', result: { text: 'ok', receipt } })
    expect(isValidWorkToolResult(confirm, completed(executed))).toBe(true)
    expect(isValidWorkToolResult(confirm, completed({ ...executed, duplicate: true }))).toBe(true)
    expect(isValidWorkToolResult(confirm, completed({ ...executed, extra: 1 }))).toBe(false)
    expect(isValidWorkToolResult(confirm, completed({ ...executed, action: 'delete_work' }))).toBe(false)
    expect(isValidWorkToolResult(confirm, completed({ ...executed, proposalId: 'another-proposal' }))).toBe(false)
    expect(isValidWorkToolResult({ ...confirm, operation: 'status' }, completed({ ...executed, duplicate: true }))).toBe(false)
    expect(isValidWorkToolResult({ ...confirm, operation: 'propose' }, completed({ proposalId: jobId, status: 'AWAITING_CONFIRMATION' }))).toBe(true)
    expect(isValidWorkToolResult({ ...confirm, operation: 'propose' }, completed({ proposalId: 'x', status: 'AWAITING_CONFIRMATION' }))).toBe(false)
    expect(isValidWorkToolResult({ ...confirm, operation: 'read' }, { status: 'NOT_FOUND', operationId: jobId })).toBe(false)
    expect(isValidWorkToolResult(confirm, { status: 'REJECTED', code: 'WORK_SCOPE_DENIED', result: { text: 'no' } })).toBe(false)
  })

  it('refuses an arbitrary tool operation on the runtime side before anything reaches Core', async () => {
    const { ports } = build()
    const claim = { jobId: 'job-never-sent', executionId: 'execution', claimantId: 'claimant', version: 1,
      tenantId: 'tenant', businessId: 'business', accountId: 'account' }
    await expect(ports.workTool.execute(claim, { version: 1 }, { operation: 'shell', operationId: 'op', input: { cmd: 'id' } }))
      .rejects.toMatchObject({ code: 'WORK_TOOL_OPERATION_INVALID' })
    expect(wire).toEqual([])
  })

  it('agrees with Core and the published v1 schema on which WorkTool requests are valid', async () => {
    const { core } = build()
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validateEnvelope = ajv.compile(schema)
    const uuid = '6f1c1a52-6a55-4b8e-9d7c-2f1b8e3c9a10'
    const claim = { jobId: 'synthetic-wtp-parity-job', executionId: 'execution', claimantId: 'claimant', version: 1,
      tenantId: 'tenant', businessId: 'business', accountId: 'account' }
    const cases = [
      ['read, empty input', 'read', {}, true],
      ['read, projects with query', 'read', { kind: 'projects', query: 'launch' }, true],
      ['read, unknown kind', 'read', { kind: 'tasks' }, false],
      ['read, non-string query', 'read', { query: 7 }, false],
      ['read, query over 120 chars', 'read', { query: 'x'.repeat(121) }, false],
      ['read, unknown field', 'read', { shell: 'id' }, false],
      ['propose, create', 'propose', { action: 'create_work', targetId: uuid, args: { title: 'Task' } }, true],
      ['propose, update', 'propose', { action: 'update_work', targetId: uuid, args: { status: 'DONE' } }, true],
      ['propose, unknown action', 'propose', { action: 'delete_work', targetId: uuid, args: {} }, false],
      ['propose, non-uuid target', 'propose', { action: 'create_work', targetId: 'not-a-uuid', args: { title: 'Task' } }, false],
      ['propose, array args', 'propose', { action: 'create_work', targetId: uuid, args: [] }, false],
      ['propose, missing args', 'propose', { action: 'create_work', targetId: uuid }, false],
      ['propose, extra field', 'propose', { action: 'create_work', targetId: uuid, args: {}, actor: 'forged' }, false],
      ['confirm-execute', 'confirm-execute', { proposalId: uuid }, true],
      ['confirm-execute, non-uuid', 'confirm-execute', { proposalId: 'synthetic-job' }, false],
      ['confirm-execute, extra field', 'confirm-execute', { proposalId: uuid, force: true }, false],
      ['confirm-execute, missing proposal', 'confirm-execute', {}, false],
      ['status, empty input', 'status', {}, true],
      ['status, proposal', 'status', { proposalId: uuid }, true],
      ['status, non-uuid proposal', 'status', { proposalId: 'synthetic-job' }, false],
      ['unknown operation', 'shell', {}, false],
    ]
    const verdicts = []
    for (const [label, operation, input, expected] of cases) {
      let runtime = true
      try { validateWorkToolRequest({ operation, operationId: 'synthetic-wtp-parity-op', input }) } catch { runtime = false }
      const envelope = { contractVersion: 'conversation-runtime.v1', operation: 'work-tool',
        correlationId: 'synthetic-wtp-parity', idempotencyKey: 'synthetic-wtp-parity-op',
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        payload: { claim, operation, operationId: 'synthetic-wtp-parity-op', input } }
      const published = validateEnvelope(envelope)
      const response = await core.handle(new Request('http://core.invalid/api/internal/conversation-runtime/v1/work-tool', {
        method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(envelope) }), { operation: 'work-tool' })
      const body = await response.json()
      // A request Core accepts reaches the claim check, which refuses this unknown job;
      // a request Core rejects stops at contract validation with a 400.
      const provider = response.status !== 400
      if (provider) expect(body.error.code, label).toBe('CONVERSATION_JOB_AUTHORITY_REVOKED')
      else expect(body.error.code, label).toMatch(/^WORK_TOOL_(REQUEST|INPUT)_INVALID$/)
      verdicts.push({ label, runtime, provider, published })
    }
    expect(verdicts).toEqual(cases.map(([label, , , expected]) => ({ label, runtime: expected, provider: expected, published: expected })))
  })

  it('drives a full runtime turn for a Work read through the same ports, with no model call', async () => {
    const { ports } = build()
    const jobId = await admit('synthetic-wtp-turn-read', '/projects WorkToolPort')
    const runtime = createConversationRuntime({ ports, claimantId: 'runtime-wtp-turn' })
    const outcome = await runtime.runOne()
    expect(outcome).toMatchObject({ jobId })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    expect(job, JSON.stringify({ outcome, wire: wire.map(call => call.operation) })).toMatchObject({ status: 'RECORDED' })
    expect(job.answerText).toBe(`PRJ-CR-WTP: WorkToolPort project — ${project.status}\n${project.id}\nWorkToolPort stream: ${workstream.id}`)
    expect(deliveries).toHaveLength(1)
    expect(JSON.stringify(deliveries[0])).toContain('PRJ-CR-WTP')
    expect(workToolCalls()).toEqual([`status ${jobId}:work-read`, `read ${jobId}:work-read`])
    expect(wire.map(call => call.operation)).not.toContain('credential')
  })

  // @req FR-150 — the legacy worker refuses a Work command whose budget is spent
  // before any Work call (REPLY_DEADLINE_MISSED); Core does the same, against the
  // deadline settle uses. The reply deadline is moved into the past only after the
  // claim, as a slow turn would find it.
  const spendBudget = jobId => prisma.lineConversationJob.update({ where: { id: jobId },
    data: { replyExpiresAt: new Date(Date.now() - 1_000), allowDelayedPush: false } })

  it('refuses a Work call once the turn budget is spent: REPLY_DEADLINE_MISSED, final, before any Work write', async () => {
    const { ports } = build()
    const jobId = await admit('synthetic-wtp-budget-propose', `/work-create ${workstream.id} Budget spent`)
    const { claim, authority, turn } = await claimTurn(ports, jobId, 'runtime-wtp-budget')
    const request = validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-proposal` })
    await spendBudget(jobId)
    await expect(ports.workTool.execute(claim, authority, request))
      .rejects.toMatchObject({ code: 'REPLY_DEADLINE_MISSED', retryable: false })
    // Nothing reached Work: no proposal, and `status` (recorded receipts only) still answers.
    expect(await prisma.auditEvent.findUnique({ where: { id: jobId } })).toBeNull()
    expect(await ports.workTool.status(claim, request.operationId)).toEqual({ status: 'NOT_FOUND', operationId: request.operationId })
    expect(await prisma.workItem.count({ where: { workstreamId: workstream.id, title: 'Budget spent' } })).toBe(0)
  })

  it('a full turn whose budget is spent before the Work call fails with the legacy code and sends nothing', async () => {
    const { ports } = build()
    const jobId = await admit('synthetic-wtp-budget-turn', '/projects WorkToolPort')
    let spent = false
    const slowPorts = { ...ports, workTool: { ...ports.workTool, status: async (...args) => {
      if (!spent) { spent = true; await spendBudget(jobId) }
      return ports.workTool.status(...args)
    } } }
    const outcome = await createConversationRuntime({ ports: slowPorts, claimantId: 'runtime-wtp-budget-turn' }).runOne()
    expect(outcome).toMatchObject({ jobId, status: 'FAILED', code: 'REPLY_DEADLINE_MISSED' })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId } }))
      .toMatchObject({ status: 'FAILED', errorCode: 'REPLY_DEADLINE_MISSED', answerText: null })
    expect(workToolCalls()).toEqual([`status ${jobId}:work-read`, `read ${jobId}:work-read`, `status ${jobId}:work-read`])
    expect(deliveries).toEqual([])
  })
})


// @req FR-026, FR-149 — answer and error parity with the legacy Server Work handler.
// Every case drives the same signed inbound text through both paths on the same
// database state: the legacy `handleLineProjectWorkCommand` (its writes rolled back,
// see `legacyReply`) and a full runtime turn (`runOne`) over the real Core provider.
// The reply the runtime commits and delivers must equal the legacy reply byte for
// byte. Core and the legacy handler share one clock here, so proposal expiry
// timestamps are comparable.
describe('Conversation Runtime Work replies match the legacy Server handler byte for byte', () => {
  const clock = { at: new Date() }
  const uuid = '6f1c1a52-6a55-4b8e-9d7c-2f1b8e3c9a10'
  let parityProjects = []

  function paritySetup(coreOptions = {}) {
    const built = build({ coreOptions: { now: () => clock.at, ...coreOptions } })
    const claimThroughPort = built.ports.job.claim
    const legacy = new Map()
    // Compute the legacy reply for the job the runtime just claimed, before the
    // runtime takes any other step; the legacy handler requires a CLAIMED job.
    built.ports.job.claim = async args => {
      clock.at = new Date()
      const claim = await claimThroughPort(args)
      if (claim) legacy.set(claim.jobId, await legacyReply(claim.jobId, () => clock.at))
      return claim
    }
    return { ...built, legacy }
  }

  async function bothPaths(eventId, text, setup = paritySetup()) {
    const jobId = await admit(eventId, text)
    const deliveredBefore = deliveries.length
    const wireBefore = wire.length
    const outcome = await createConversationRuntime({ ports: setup.ports, claimantId: `runtime-${eventId}` }).runOne()
    const job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
    const calls = wire.slice(wireBefore).filter(call => call.operation === 'work-tool').map(call => call.payload.operation)
    return { jobId, outcome, job, legacy: setup.legacy.get(jobId), delivered: deliveries.length - deliveredBefore, calls }
  }

  function expectSameReply(run) {
    expect(run.job, JSON.stringify({ outcome: run.outcome, legacy: run.legacy })).toMatchObject({ status: 'RECORDED' })
    // The Server worker commits `zCompletion.shape.text.parse(reply.text)`, a trim;
    // none of these replies has surrounding whitespace, so it is the text itself.
    expect(run.legacy.text.trim()).toBe(run.legacy.text)
    expect(run.job.answerText).toBe(run.legacy.text)
    expect(run.delivered).toBe(1)
  }

  afterEach(async () => {
    if (parityProjects.length) {
      await prisma.project.updateMany({ where: { id: { in: parityProjects } }, data: { deletedAt: new Date() } })
      parityProjects = []
    }
  })

  it('reads: item ids, workstream ids, the empty answer and the truncation note', async () => {
    for (const [eventId, text] of [
      ['parity-read-projects', '/projects'],
      ['parity-read-projects-query', '/projects WorkToolPort'],
      ['parity-read-work', '/work'],
      ['parity-read-none', '/projects nothing-matches-this-query'],
    ]) {
      const run = await bothPaths(eventId, text)
      expectSameReply(run)
      expect(run.calls).toEqual(['status', 'read'])
    }
    const workspace = await prisma.workspace.findFirst({ where: { code: 'WS-CR-WTP' } })
    for (let index = 0; index < 11; index += 1) {
      const created = await createProject({ workspaceId: workspace.id, name: `Parity truncation ${index}`,
        code: `PRJ-CR-WTP-T${String(index).padStart(2, '0')}` }, { viewer: ownerViewer })
      parityProjects.push(created.id)
    }
    const truncated = await bothPaths('parity-read-truncated', '/projects Parity truncation')
    expectSameReply(truncated)
    expect(truncated.job.answerText).toContain('\nมีรายการเพิ่มเติม โปรดระบุคำค้น')
    expect(truncated.job.answerText).toContain(parityProjects[10])
  })

  it('propose, confirm-execute and a second confirmation: the same headers, receipts and duplicate answer', async () => {
    const create = await bothPaths('parity-propose-create', `/work-create ${workstream.id} Parity created task`)
    expectSameReply(create)
    expect(create.job.answerText.split('\n')[0]).toBe('รอยืนยัน สร้างงาน')
    expect(create.calls).toEqual(['status', 'propose'])

    const confirm = await bothPaths('parity-confirm-create', `ยืนยันงาน ${create.jobId}`)
    expectSameReply(confirm)
    const item = await prisma.workItem.findFirst({ where: { workstreamId: workstream.id, title: 'Parity created task' } })
    expect(confirm.job.answerText).toBe(`บันทึกงาน ${item.code} แล้ว สถานะ ${item.status}`)
    expect(confirm.calls).toEqual(['status', 'confirm-execute'])

    // A second confirming message is another job: Core does not replay the first
    // job's receipt to it; confirm-execute answers it exactly as the Server path does.
    const again = await bothPaths('parity-confirm-again', `ยืนยันงาน ${create.jobId}`)
    expectSameReply(again)
    expect(again.job.answerText).toBe('คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ')
    expect(again.calls).toEqual(['status', 'confirm-execute'])
    expect(await prisma.workItem.count({ where: { workstreamId: workstream.id, title: 'Parity created task' } })).toBe(1)

    const update = await bothPaths('parity-propose-update', `/work-update ${item.id} {"status":"DONE"}`)
    expectSameReply(update)
    expect(update.job.answerText.split('\n')[0]).toBe('รอยืนยัน แก้ไขงาน')
  })

  it('Work refusals: expired confirmation, version conflict, scope denied and a confirmation Core cannot match', async () => {
    const expiring = await bothPaths('parity-propose-expiring', `/work-create ${workstream.id} Parity expiring task`)
    const proposal = await prisma.auditEvent.findUnique({ where: { id: expiring.jobId } })
    await prisma.auditEvent.update({ where: { id: expiring.jobId }, data: { payloadJson: JSON.stringify({
      ...JSON.parse(proposal.payloadJson), expiresAt: new Date(Date.now() - 1000).toISOString() }) } })
    const expired = await bothPaths('parity-confirm-expired', `ยืนยันงาน ${expiring.jobId}`)
    expectSameReply(expired)
    expect(expired.legacy.errorCode).toBe('WORK_CONFIRMATION_EXPIRED')

    const target = await prisma.workItem.findFirst({ where: { workstreamId: workstream.id, title: 'Parity created task' } })
    const updating = await bothPaths('parity-propose-conflict', `/work-update ${target.id} {"title":"Parity renamed task"}`)
    await updateItem(target.id, { status: 'IN_PROGRESS' }, { viewer: ownerViewer })
    const conflict = await bothPaths('parity-confirm-conflict', `ยืนยันงาน ${updating.jobId}`)
    expectSameReply(conflict)
    expect(conflict.legacy.errorCode).toBe('WORK_VERSION_CONFLICT')

    const unknown = await bothPaths('parity-confirm-unknown', `ยืนยันงาน ${uuid}`)
    expectSameReply(unknown)
    expect(unknown.legacy.errorCode).toBe('WORK_ACTION_UNAVAILABLE')
    // Extra spaces pass the syntax but not the exact-confirmation check.
    const spaced = await bothPaths('parity-confirm-spaced', `ยืนยันงาน   ${updating.jobId}`)
    expectSameReply(spaced)
    expect(spaced.calls).toEqual(['status', 'confirm-execute'])

    await prisma.membership.updateMany({ where: { personId: actor.id, businessId: business.id }, data: { role: 'MEMBER' } })
    try {
      const denied = await bothPaths('parity-propose-denied', `/work-create ${workstream.id} Parity denied task`)
      expectSameReply(denied)
      expect(denied.legacy.errorCode).toBe('WORK_ACTION_UNAVAILABLE')
      expect(await prisma.auditEvent.findUnique({ where: { id: denied.jobId } })).toBeNull()
    } finally {
      await prisma.membership.updateMany({ where: { personId: actor.id, businessId: business.id }, data: { role: 'OWNER' } })
    }
    expect(await prisma.workItem.findFirst({ where: { title: { in: ['Parity renamed task', 'Parity expiring task', 'Parity denied task'] } } })).toBeNull()
  })

  it('malformed legacy /work syntax is runtime-owned and answered with the legacy usage or refusal text', async () => {
    const cases = [
      ['/work-create', 'WORK_COMMAND_USAGE'],
      ['/work-update', 'WORK_COMMAND_USAGE'],
      ['/work-create only-one-token', 'WORK_COMMAND_USAGE'],
      ['ยืนยันงาน', 'WORK_COMMAND_USAGE'],
      [`ยืนยันงาน\t${uuid}`, 'WORK_COMMAND_USAGE'],
      ['/work-create not-a-uuid Some task', 'WORK_ACTION_UNAVAILABLE'],
      [`/work-create ${workstream.id} ${'x'.repeat(241)}`, 'WORK_ACTION_UNAVAILABLE'],
      [`/work-update ${uuid} not-json`, 'WORK_ACTION_UNAVAILABLE'],
      [`/work-update ${uuid} {"status":"NOT_A_STATUS"}`, 'WORK_ACTION_UNAVAILABLE'],
      [`/work ${'q'.repeat(121)}`, 'WORK_ACTION_UNAVAILABLE'],
      ['ยืนยันงาน not-a-uuid', 'WORK_ACTION_UNAVAILABLE'],
      [`ยืนยันงาน ${uuid} extra`, 'WORK_ACTION_UNAVAILABLE'],
    ]
    for (const [index, [text, code]] of cases.entries()) {
      // admit() also asserts the job was admitted to the CONVERSATION_RUNTIME cohort.
      const run = await bothPaths(`parity-malformed-${index}`, text)
      expectSameReply(run)
      expect(run.legacy.errorCode ?? 'WORK_COMMAND_USAGE', text).toBe(code)
      // The reply is derived from the text alone; no Work call runs on either side.
      expect(run.calls, text).toEqual([])
      expect(await prisma.auditEvent.findUnique({ where: { id: run.jobId } })).toBeNull()
    }
  })

  it('keeps the legacy 5,000-character bound: an over-long Work answer fails without a reply, as on the Server path', async () => {
    const workspace = await prisma.workspace.findFirst({ where: { code: 'WS-CR-WTP' } })
    const long = await createProject({ workspaceId: workspace.id, name: `Parity overflow ${'y'.repeat(5000)}`,
      code: 'PRJ-CR-WTP-OVERFLOW' }, { viewer: ownerViewer })
    parityProjects.push(long.id)
    const run = await bothPaths('parity-read-overflow', '/projects Parity overflow')
    // The legacy worker's `zCompletion` text bound rejects this reply and fails the job.
    expect(run.legacy.text.trim().length).toBeGreaterThan(5000)
    expect(run.outcome).toEqual({ jobId: run.jobId, status: 'FAILED', code: 'WORK_TOOL_TEXT_TOO_LONG' })
    expect(run.job.answerText).toBeNull()
    expect(run.delivered).toBe(0)
    // Final, not retried: one read, then the status probe that found nothing recorded.
    expect(run.calls).toEqual(['status', 'read', 'status'])
  })

  it('returns refusals as typed REJECTED outcomes, fences them, and keeps availability failures retryable', async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    ajv.addSchema(schema)
    const validateResult = ajv.compile({ $ref: `${schema.$id}#/$defs/workToolResult` })

    // A Project Manager refusal (a workstream that does not exist) is final: a typed
    // REJECTED outcome with the legacy handler's own reply for the same job.
    const setup = paritySetup()
    const jobId = await admit('parity-port-missing-target', `/work-create ${uuid} Parity port task`)
    const { claim, authority, turn } = await claimTurn(setup.ports, jobId, 'runtime-parity-port')
    const request = validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-proposal` })
    const rejected = await setup.ports.workTool.execute(claim, authority, request)
    expect(rejected).toEqual({ status: 'REJECTED', code: 'WORK_ACTION_UNAVAILABLE', result: { text: setup.legacy.get(jobId).text } })
    expect(validateResult(rejected), JSON.stringify(validateResult.errors)).toBe(true)
    expect(await setup.ports.workTool.status(claim, request.operationId)).toEqual({ status: 'NOT_FOUND', operationId: request.operationId })
    expect(await prisma.auditEvent.findUnique({ where: { id: jobId } })).toBeNull()
    await prisma.lineConversationJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_REJECTED' } })
    for (const response of [
      { status: 'COMPLETED', result: { text: 'x', receipt: {} } },
      { status: 'NOT_FOUND', operationId: 'op' },
    ]) expect(validateResult(response)).toBe(true)
    for (const response of [
      { status: 'REJECTED', code: 'WORK_SCOPE_DENIED', result: { text: 'x' } },
      { status: 'REJECTED', code: 'WORK_ACTION_UNAVAILABLE', result: { text: 'x' }, retryable: false },
    ]) expect(validateResult(response)).toBe(false)

    // A refusal from a claim that stopped being this runtime's is fenced, never answered.
    const fencedSetup = paritySetup({ workPropose: async () => {
      await prisma.lineConversationJob.update({ where: { id: fencedJobId }, data: { leaseExpiresAt: new Date(clock.at.getTime() - 1) } })
      throw Object.assign(new Error('WORK_SCOPE_DENIED'), { code: 'WORK_SCOPE_DENIED' })
    } })
    const fencedJobId = await admit('parity-port-fenced', `/work-create ${workstream.id} Parity fenced task`)
    const fenced = await claimTurn(fencedSetup.ports, fencedJobId, 'runtime-parity-fenced')
    const fencedRequest = validateWorkToolRequest({ ...fenced.turn.workCommand, operationId: `${fencedJobId}:work-proposal` })
    await expect(fencedSetup.ports.workTool.execute(fenced.claim, fenced.authority, fencedRequest))
      .rejects.toMatchObject({ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED', retryable: false })
    expect(await prisma.auditEvent.findUnique({ where: { id: fencedJobId } })).toBeNull()
    // Its expired lease would make it the next claim; take it out of the queue.
    await prisma.lineConversationJob.update({ where: { id: fencedJobId }, data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_FENCED' } })

    // A database or transport failure is not a refusal: it stays a retryable error.
    const outageSetup = paritySetup({ workSearch: async () => { throw Object.assign(new Error('database unreachable'), { code: 'P1001' }) } })
    const outageJobId = await admit('parity-port-outage', '/projects')
    const outage = await claimTurn(outageSetup.ports, outageJobId, 'runtime-parity-outage')
    const outageRequest = validateWorkToolRequest({ ...outage.turn.workCommand, operationId: `${outageJobId}:work-read` })
    await expect(outageSetup.ports.workTool.execute(outage.claim, outage.authority, outageRequest))
      .rejects.toMatchObject({ code: 'P1001', retryable: true })
  })
  it('classifies Work writer failures: request refusals are REJECTED, the rest stay retryable (UNKNOWN, no reply)', async () => {
    const failures = []
    const setup = paritySetup({ workPropose: async () => { throw failures.shift() } })
    const jobId = await admit('parity-port-classify', `/work-create ${workstream.id} Parity classify task`)
    const { claim, authority, turn } = await claimTurn(setup.ports, jobId, 'runtime-parity-classify')
    const request = validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-proposal` })
    const unavailable = { status: 'REJECTED', code: 'WORK_ACTION_UNAVAILABLE',
      result: { text: 'ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ' } }
    for (const refusal of [
      new z.ZodError([]),
      new Error('Work item not found'),
      new Error('Workstream not found'),
      Object.assign(new Error('Work item not found'), { status: 404 }),
      Object.assign(new Error('WORK_TARGET_NOT_FOUND'), { code: 'WORK_TARGET_NOT_FOUND' }),
    ]) {
      failures.push(refusal)
      expect(await setup.ports.workTool.execute(claim, authority, request), String(refusal.message)).toEqual(unavailable)
    }
    // Not refusals of the request: they stay retryable, so a turn that keeps
    // failing ends WORK_TOOL_OUTCOME_UNKNOWN with no reply (see the PR notes).
    for (const [failure, code] of [
      [Object.assign(new Error('unique constraint'), { code: 'P2002' }), 'P2002'],
      [Object.assign(new Error('serialization failure'), { code: 'P2034' }), 'P2034'],
      [Object.assign(new Error('WORK_RECEIPT_UNAVAILABLE'), { code: 'WORK_RECEIPT_UNAVAILABLE' }), 'WORK_RECEIPT_UNAVAILABLE'],
      [Object.assign(new Error('WORK_CLAIM_STALE'), { code: 'WORK_CLAIM_STALE' }), 'WORK_CLAIM_STALE'],
      [new Error('Container must belong to the same workstream'), 'CORE_OPERATION_UNAVAILABLE'],
    ]) {
      failures.push(failure)
      await expect(setup.ports.workTool.execute(claim, authority, request)).rejects.toMatchObject({ code, retryable: true })
    }
  })

  it('executes only the Work command the user typed: a runtime cannot propose, read or confirm anything else', async () => {
    const setup = paritySetup()
    const jobId = await admit('parity-port-forged', `/work-create ${workstream.id} Parity typed task`)
    const { claim, authority, turn } = await claimTurn(setup.ports, jobId, 'runtime-parity-forged')
    expect(turn.workCommand).toEqual({ operation: 'propose',
      input: { action: 'create_work', targetId: workstream.id, args: { title: 'Parity typed task' } } })
    const other = await prisma.workItem.findFirst({ where: { workstreamId: workstream.id, deletedAt: null } })
    const forgeries = [
      ['other args', 'propose', `${jobId}:work-proposal`, { action: 'create_work', targetId: workstream.id, args: { title: 'Never typed' } }],
      ['other target', 'propose', `${jobId}:work-proposal`, { action: 'update_work', targetId: other.id, args: { status: 'DONE' } }],
      ['other operation', 'read', `${jobId}:work-read`, { kind: 'projects', query: '' }],
      ['a confirmation never typed', 'confirm-execute', uuid, { proposalId: uuid }],
    ]
    for (const [label, operation, operationId, input] of forgeries) {
      const forged = validateWorkToolRequest({ operation, operationId, input })
      await expect(setup.ports.workTool.execute(claim, authority, forged), label)
        .rejects.toMatchObject({ code: 'WORK_COMMAND_MISMATCH', retryable: false })
    }
    // Nothing was proposed or changed by the refused requests.
    expect(await prisma.auditEvent.findUnique({ where: { id: jobId } })).toBeNull()
    expect(await prisma.workItem.findUnique({ where: { id: other.id } })).toMatchObject({ status: other.status, version: other.version })
    // The typed command itself still runs, with the typed arguments; key order does not matter.
    const typed = await setup.ports.workTool.execute(claim, authority, validateWorkToolRequest({ operation: 'propose',
      operationId: `${jobId}:work-proposal`, input: { args: { title: 'Parity typed task' }, targetId: workstream.id, action: 'create_work' } }))
    expect(typed.result.text).toBe(setup.legacy.get(jobId).text)
    expect(JSON.parse((await prisma.auditEvent.findUnique({ where: { id: jobId } })).payloadJson).args).toEqual({ title: 'Parity typed task' })
    await prisma.lineConversationJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', errorCode: 'TEST_WORK_TOOL_PORT_FORGED' } })

    // Over the full turn the same forgery ends FAILED with no reply and no Work write.
    const forgedPorts = { ...setup.ports, context: { prepare: async (...args) => {
      const prepared = await setup.ports.context.prepare(...args)
      return { ...prepared, workCommand: { ...prepared.workCommand, input: { ...prepared.workCommand.input, args: { title: 'Never typed' } } } }
    } } }
    const forgedJobId = await admit('parity-turn-forged', `/work-create ${workstream.id} Parity typed turn task`)
    const outcome = await createConversationRuntime({ ports: forgedPorts, claimantId: 'runtime-parity-forged-turn' }).runOne()
    expect(outcome).toEqual({ jobId: forgedJobId, status: 'FAILED', code: 'WORK_COMMAND_MISMATCH' })
    expect(await prisma.auditEvent.findUnique({ where: { id: forgedJobId } })).toBeNull()
    expect((await prisma.lineConversationJob.findUnique({ where: { id: forgedJobId } })).answerText).toBeNull()
  })

  it("status discloses nothing about another Tenant's or Business's proposal or receipt", async () => {
    const setup = paritySetup()
    const jobId = await admit('parity-status-scope', `ยืนยันงาน ${uuid}`)
    const { claim } = await claimTurn(setup.ports, jobId, 'runtime-parity-status-scope')
    const portfolio = await createPortfolio({ name: 'WorkToolPort other portfolio', code: 'PF-CR-WTP-OTHER' })
    const otherTenant = await createTenant({ portfolioId: portfolio.id, name: 'WorkToolPort other tenant', code: 'TNT-CR-WTP-OTHER' })
    const otherTenantBusiness = await createBusiness({ tenantId: otherTenant.id, name: 'WorkToolPort other tenant business', code: 'BUS-CR-WTP-OTHER-T' })
    const otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'WorkToolPort other business', code: 'BUS-CR-WTP-OTHER-B' })
    const proposalIn = async scope => {
      const id = randomUUID()
      await prisma.auditEvent.create({ data: { id, entityType: 'LINE_WORK_PROPOSAL', entityId: workstream.id, action: 'PROPOSED',
        actorType: 'AGENT', actorId: actor.id, tenantId: scope.tenantId, businessId: scope.businessId, requestId: id, payloadJson: '{}' } })
      return id
    }
    const nonexistent = randomUUID()
    expect(await setup.ports.workTool.status(claim, nonexistent)).toEqual({ status: 'NOT_FOUND', operationId: nonexistent })
    const sameAsNonexistent = async id => expect(await setup.ports.workTool.status(claim, id)).toEqual({ status: 'NOT_FOUND', operationId: id })
    // Control: a proposal in this job's own Tenant and Business is reported as awaiting.
    const own = await proposalIn({ tenantId: tenant.id, businessId: business.id })
    expect(await setup.ports.workTool.status(claim, own)).toEqual({ status: 'NOT_FOUND', proposalId: own, receipt: { status: 'AWAITING_CONFIRMATION' } })
    await sameAsNonexistent(await proposalIn({ tenantId: otherTenant.id, businessId: otherTenantBusiness.id }))
    await sameAsNonexistent(await proposalIn({ tenantId: tenant.id, businessId: otherBusiness.id }))
    // A receipt recorded outside this scope is never replayed, even one naming this job as its executor.
    for (const scope of [{ tenantId: otherTenant.id, businessId: otherTenantBusiness.id }, { tenantId: tenant.id, businessId: otherBusiness.id }]) {
      const proposalId = await proposalIn(scope)
      await prisma.auditEvent.create({ data: { id: `line-work-result:${proposalId}`, entityType: 'AGENT_ACTION', entityId: proposalId,
        action: 'EXECUTED', actorType: 'AGENT', actorId: actor.id, ...scope, requestId: jobId,
        payloadJson: JSON.stringify({ proposalId, code: 'SECRET-OTHER-SCOPE' }) } })
      await sameAsNonexistent(proposalId)
    }
  })

  it('checks the 5,000-character bound on the committed (trimmed) text: padding is not a 500', async () => {
    const padding = ' '.repeat(200)
    const search = { source: 'PROJECT_MANAGER', observedAt: new Date().toISOString(), truncated: false, limit: 10,
      items: [{ id: 'padded-item', code: `${padding}PAD`, title: 'x'.repeat(4900), status: 'PLANNED' }] }
    const setup = paritySetup({ workSearch: async () => search })
    const jobId = await admit('parity-port-padded', '/work')
    const { claim, authority, turn } = await claimTurn(setup.ports, jobId, 'runtime-parity-padded')
    const raw = lineWorkReadText(search)
    expect(raw.length).toBeGreaterThan(5000)
    expect(raw.trim().length).toBeLessThanOrEqual(5000)
    const result = await setup.ports.workTool.execute(claim, authority, validateWorkToolRequest({ ...turn.workCommand, operationId: `${jobId}:work-read` }))
    expect(result).toMatchObject({ status: 'COMPLETED', result: { text: raw.trim() } })
  })
})
