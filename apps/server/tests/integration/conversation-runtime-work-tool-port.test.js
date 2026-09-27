import { readFileSync } from 'node:fs'
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
let tenant, business, account, workstream, project
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
  const actor = await prisma.person.create({ data: { code: 'PER-CR-WTP', displayName: 'Synthetic WorkToolPort actor' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  const ownerViewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
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
    expect(result.result.text).toBe(`PRJ-CR-WTP: WorkToolPort project — ${project.status}`)
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
    // clock Core reads is past the lease. The whole transaction rolls back.
    let late = null
    const slow = build({ coreOptions: { now: () => late ?? new Date(),
      db: withConfirmHooks({ afterResultWrite: async tx => {
        const job = await tx.lineConversationJob.findUnique({ where: { id: expired.jobId } })
        late = new Date(job.leaseExpiresAt.getTime() + 1)
      } }) } })
    const expired = await confirmationTurn(slow.ports, 'synthetic-wtp-recheck-lease', proposalId)
    await expect(slow.ports.workTool.execute(expired.claim, expired.authority, expired.request))
      .rejects.toMatchObject({ code: 'WORK_SCOPE_DENIED' })
    expect(late).not.toBeNull()
    late = null
    expect(await confirmationState(proposalId, title)).toEqual(nothingWritten)
    expect(await slow.ports.workTool.status(expired.claim, proposalId))
      .toEqual({ status: 'NOT_FOUND', proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } })
    await release(expired.jobId)

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
    for (const turn of [first, second]) expect(await ports.workTool.status(turn.claim, proposalId))
      .toEqual({ status: 'COMPLETED', result: { text: replayText, receipt } })

    // A second confirmation arriving later, as a new job, replays the receipt.
    await release(first.jobId)
    await release(second.jobId)
    const later = await confirmationTurn(ports, 'synthetic-wtp-race-confirm-later', proposalId)
    expect(await ports.workTool.status(later.claim, proposalId)).toEqual({ status: 'COMPLETED', result: { text: replayText, receipt } })
    expect(await ports.workTool.execute(later.claim, later.authority, later.request))
      .toEqual({ status: 'COMPLETED', result: { text: replayText, receipt: { ...receipt, duplicate: true } } })
    expect(await confirmationState(proposalId, title)).toEqual(writtenOnce)
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
    expect(job.answerText).toBe(`PRJ-CR-WTP: WorkToolPort project — ${project.status}`)
    expect(deliveries).toHaveLength(1)
    expect(JSON.stringify(deliveries[0])).toContain('PRJ-CR-WTP')
    expect(workToolCalls()).toEqual([`status ${jobId}:work-read`, `read ${jobId}:work-read`])
    expect(wire.map(call => call.operation)).not.toContain('credential')
  })
})
