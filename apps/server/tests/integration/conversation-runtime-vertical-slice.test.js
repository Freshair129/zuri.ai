import { createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createServerLineWebhookPost } from '@/app/api/line-oa/accounts/[id]/webhook/route'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { markLineAdmissionIntent, admitCapturedLineEvents, admitLineConversation, claimRuntimeConversationJob,
  completeRuntimeConversationJob, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { confirmLineWork, parseLineProjectWorkCommand } from '@/modules/agent/line-project-work-tools'

// @req FR-149, FR-150, FR-171 — signed durable admission through the real independent runtime and Core owners.
// @spec ADR-106 D1-D4, SDD-108 — separate process, server-derived scope and durable receipts.
// @tested tests/integration/conversation-runtime-vertical-slice.test.js
const channelSecret = 'synthetic-line-channel-secret'
const serviceToken = 'synthetic-conversation-runtime-core-token-0001'
const sealKey = '4b'.repeat(32)
const readBody = async request => {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})
const close = server => new Promise(resolve => server.close(() => resolve()))
const runtimeDirectory = fileURLToPath(new URL('../../../../services/conversation-runtime/', import.meta.url))
const childHasExited = child => child.exitCode !== null || child.signalCode !== null
const freePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await close(server)
  return port
}
function launchRuntime(corePort, runtimePort) {
  const child = spawn(process.execPath, ['src/main.js'], { cwd: runtimeDirectory, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP,
      CONVERSATION_RUNTIME_CORE_URL: `http://127.0.0.1:${corePort}`, CONVERSATION_RUNTIME_TOKEN: serviceToken,
      CONVERSATION_RUNTIME_PORT: String(runtimePort), NODE_ENV: 'test' } })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  return { child, get output() { return output } }
}
async function runtimeReady(port, child) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !childHasExited(child)) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`)
      if (response.status === 200) return 200
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  try { return (await fetch(`http://127.0.0.1:${port}/readyz`)).status } catch { return 0 }
}
async function waitForChildExit(child) {
  if (childHasExited(child)) return
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))])
}

async function wrapCoreRequest(incoming, outgoing, port, core) {
  const body = incoming.method === 'GET' ? undefined : await readBody(incoming)
  let detail = ''
  if (body) {
    const envelope = JSON.parse(body.toString('utf8'))
    if (envelope.operation === 'work-tool') coreRequests.push(`WORK ${envelope.payload.operation} ${envelope.payload.operationId}`)
    if (envelope.operation === 'trace') detail = `${envelope.payload.kind} ${envelope.payload.claim?.jobId} ${envelope.payload.claim?.executionId}`
    if (envelope.operation === 'claim') detail = `claimant=${envelope.payload.claimantId}`
  }
  const headers = {}
  for (const name of ['authorization', 'content-type', 'accept']) if (incoming.headers[name]) headers[name] = incoming.headers[name]
  const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, { method: incoming.method, headers, ...(body ? { body } : {}) })
  const health = incoming.url.endsWith('/health')
  const operation = incoming.url.split('/').pop()
  const handlers = createConversationRuntimeRouteHandlers(core)
  const response = health
    ? await handlers.GET(request, { params: { operation: 'health' } })
    : await handlers.POST(request, { params: { operation } })
  const bodyText = await response.text()
  try {
    const parsed = JSON.parse(bodyText)
    if (response.status >= 400) coreRequests.push(`CORE_RESPONSE ${operation} ${detail} ${response.status} ${parsed.error?.code ?? 'UNKNOWN'}`)
    else if (parsed?.ok === false) coreRequests.push(`CORE_ERROR ${operation} ${parsed.error?.code ?? 'UNKNOWN'}`)
  } catch { if (response.status >= 400) coreRequests.push(`CORE_RESPONSE ${operation} ${response.status} INVALID_JSON`) }
  if (!outgoing.destroyed) {
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    outgoing.end(bodyText)
  }
}

let tenant, business, account, actor, provider, workstream
let runtimeChild, coreServer, modelServer, pendingAdmissions = []
let coreRequests = []
let deliveryCalls = [], modelCalls = []
let token = 'event-not-set'
const requestBody = (eventToken = token, messageText = 'ถามข้อมูลสินค้า') => JSON.stringify({ destination: 'synthetic-line-destination', events: [{
  type: 'message', webhookEventId: eventToken, timestamp: Date.now(), replyToken: `synthetic-reply-${eventToken}`,
  source: { type: 'user', userId: 'synthetic-line-user' },
  message: { id: `synthetic-line-message-${eventToken}`, type: 'text', text: messageText },
}] })

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Conversation Runtime fixture', code: 'PF-CR-VERTICAL' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Conversation Runtime tenant', code: 'TNT-CR-VERTICAL' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Conversation Runtime business', code: 'BUS-CR-VERTICAL' })
  actor = await prisma.person.create({ data: { code: 'PER-CR-VERTICAL', displayName: 'Synthetic LINE actor' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  const workspace = await createWorkspace({ name: 'Conversation Runtime workspace', code: 'WS-CR-VERTICAL', scopeType: 'BUSINESS', businessId: business.id })
  const project = await createProject({ workspaceId: workspace.id, name: 'Conversation Runtime project', code: 'PRJ-CR-VERTICAL' }, { viewer: owner })
  workstream = await createWorkstream({ projectId: project.id, name: 'Conversation Runtime stream', code: 'WST-CR-VERTICAL', executionMode: 'SOFTWARE_SPRINT' }, { viewer: owner })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: 'Synthetic LINE connection', externalAccountId: 'synthetic-line-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-vertical-account', displayName: 'Synthetic LINE OA',
    bindingCode: 'cr-vertical-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    executionMode: 'CONVERSATION_RUNTIME' } })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: 'synthetic-line-user', verifiedAt: linkedAt, linkedAt } })
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: 'synthetic-line-user', status: 'ACTIVE',
    verifiedAt: linkedAt, linkedAt } })
})

afterAll(async () => {
  if (runtimeChild && !childHasExited(runtimeChild)) {
    runtimeChild.kill('SIGTERM')
    await waitForChildExit(runtimeChild)
  }
  if (coreServer?.listening) await close(coreServer)
  if (modelServer?.listening) await close(modelServer)
})

describe('Conversation Runtime durable vertical slice', () => {
  const admitDirect = async eventId => admitLineConversation({ db: prisma,
    account: await prisma.lineOaAccount.findUnique({ where: { id: account.id } }),
    env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, correlationId: eventId, now: new Date(),
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
      source: { type: 'user', userId: 'synthetic-line-user' }, message: { type: 'text', id: `synthetic-message-${eventId}`, text: 'ถามสถานะสินค้า' } },
  })

  it('admits a fake signed webhook once, runs a separate runtime process, and records the accepted fake delivery', async () => {
    const lineEnv = { ZURI_LINE_REPLY_SEAL_KEY: sealKey }
    const runtimeEnv = { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey }
    const preparedContext = 'Core-authorized CRM context for the test turn'
    modelCalls = []
    deliveryCalls = []
    const modelPortServer = createServer(async (request, response) => {
      const body = await readBody(request)
      modelCalls.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(body.toString('utf8')) })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'คำตอบทดสอบจาก provider ที่ควบคุมได้' } }] }))
    })
    modelServer = modelPortServer
    const modelPort = await listen(modelPortServer)
    const core = createConversationRuntimeCore({ db: prisma, env: runtimeEnv,
      prepareTurn: async job => ({ question: job.inbound.body,
        evidence: { records: [{ product: 'synthetic-product', answer: 'มีสินค้าในชุดทดสอบ' }] },
        slices: [{ id: 'crm-context-1', source: 'RECORD', text: preparedContext }], authorized: true,
        audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 2048, workCommand: null }),
      credentialResolver: async () => ({ provider: 'prp', model: 'controlled-model', apiKey: 'synthetic-provider-key',
        baseUrl: `http://127.0.0.1:${modelPort}` }),
      linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
        replyTransport: { send: async ({ messages }) => { deliveryCalls.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-line-acceptance' } } },
        pushTransport: { send: async ({ messages }) => { deliveryCalls.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-line-acceptance' } } } }),
    })
    coreRequests = []
    coreServer = createServer((request, response) => {
      coreRequests.push(`${request.method} ${request.url}`)
      void wrapCoreRequest(request, response, coreServer.address().port, core).catch(cause => {
      coreRequests.push(`HANDLER_ERROR ${cause?.code ?? cause?.name ?? 'ERROR'} ${cause?.message ?? ''}`)
      response.writeHead(500, { 'content-type': 'application/json' }); response.end('{}')
    })
    })
    const corePort = await listen(coreServer)
    const healthPortServer = createServer()
    const runtimePort = await listen(healthPortServer)
    await close(healthPortServer)
    const runtimeDirectory = fileURLToPath(new URL('../../../../services/conversation-runtime/', import.meta.url))
    runtimeChild = spawn(process.execPath, ['src/main.js'], { cwd: runtimeDirectory, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP,
        CONVERSATION_RUNTIME_CORE_URL: `http://127.0.0.1:${corePort}`,
        CONVERSATION_RUNTIME_TOKEN: serviceToken, CONVERSATION_RUNTIME_PORT: String(runtimePort), NODE_ENV: 'test' } })
    let childOutput = ''
    runtimeChild.stdout.on('data', chunk => { childOutput += chunk.toString() })
    runtimeChild.stderr.on('data', chunk => { childOutput += chunk.toString() })
    const readyUntil = Date.now() + 10_000
    while (Date.now() < readyUntil) {
      try { if ((await fetch(`http://127.0.0.1:${runtimePort}/readyz`)).status === 200) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const readyResponse = await fetch(`http://127.0.0.1:${runtimePort}/readyz`)
    expect(readyResponse.status, JSON.stringify({ childOutput, coreRequests })).toBe(200)

    token = 'synthetic-webhook-event-1'
    const webhookRaw = requestBody()
    const webhookPost = createServerLineWebhookPost({ db: prisma,
      ports: () => ({ resolveAccount: async () => ({ ...account, channelSecret, destination: 'synthetic-line-destination', connectionId: account.integrationConnectionId }) }),
      evidenceFactory: createLineOaEvidenceRecorder,
      admitCaptured: args => {
        const task = admitCapturedLineEvents({ ...args, db: prisma, env: lineEnv, delays: [], nudge: () => {} })
        pendingAdmissions.push(task)
        return task
      },
      markAdmissionIntent: args => markLineAdmissionIntent({ ...args, db: prisma }),
    })
    const signedRequest = () => new Request('http://local/api/line-oa/accounts/cr-vertical-account/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', channelSecret).update(Buffer.from(webhookRaw)).digest('base64') },
      body: webhookRaw,
    })
    try {
      const first = await webhookPost(signedRequest(), { params: { id: account.id } })
      expect(first.status).toBe(200)
      await Promise.all(pendingAdmissions)
      const admitted = await prisma.lineConversationJob.findFirst({ where: { accountId: account.id }, include: { inbound: true } })
      expect(admitted).toMatchObject({ executionMode: 'CONVERSATION_RUNTIME', status: 'QUEUED', inbound: { body: 'ถามข้อมูลสินค้า' } })
      const duplicate = await webhookPost(signedRequest(), { params: { id: account.id } })
      expect(duplicate.status).toBe(200)
      await Promise.all(pendingAdmissions)

      const finishedBy = Date.now() + 15_000
      let current
      while (Date.now() < finishedBy) {
        current = await prisma.lineConversationJob.findUnique({ where: { id: admitted.id } })
        if (current?.status === 'RECORDED') break
        if (childHasExited(runtimeChild)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      expect(current?.status, JSON.stringify({ childOutput, coreRequests,
        job: { status: current?.status, errorCode: current?.errorCode, version: current?.version }, modelCallCount: modelCalls.length })).toBe('RECORDED')
      expect(await prisma.lineConversationJob.count({ where: { accountId: account.id } })).toBe(1)
      expect(modelCalls).toHaveLength(1)
      expect(modelCalls[0]).toMatchObject({ path: '/v1/chat/completions', authorization: 'Bearer synthetic-provider-key' })
      expect(modelCalls[0].body.messages[0].content).toContain(preparedContext)
      expect(deliveryCalls).toEqual([[{ type: 'text', text: 'คำตอบทดสอบจาก provider ที่ควบคุมได้' }]])
      const trace = await prisma.agentTraceEvent.findMany({ where: { turnId: admitted.id }, orderBy: { occurredAt: 'asc' } })
      expect(trace.map(row => row.kind)).toEqual(expect.arrayContaining([
        'TURN_RECEIVED', 'EXECUTION_STARTED', 'MODEL_STARTED', 'MODEL_COMPLETED', 'CONTEXT_COMMITTED',
        'ANSWER_READY', 'SEND_STARTED', 'SEND_RESULT', 'OUTBOUND_RECORDED',
      ]))
      const raw = await prisma.rawExternalRecord.findFirst({ where: { connectionId: account.integrationConnectionId, externalId: token } })
      expect(raw?.processingStatus).toBe('ADMITTED')
    } finally {
      if (!childHasExited(runtimeChild)) {
        runtimeChild.kill('SIGTERM')
        await waitForChildExit(runtimeChild)
      }
      runtimeChild = null
    }
  }, 30_000)

  it('survives a runtime crash after canonical Work commit and reconciles its receipt before retry', async () => {
    if (coreServer?.listening) await close(coreServer)
    if (modelServer?.listening) await close(modelServer)
    pendingAdmissions = []
    coreRequests = []
    deliveryCalls = []
    modelCalls = []
    const runtimeEnv = { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey }
    let confirmCalls = 0
    const core = createConversationRuntimeCore({ db: prisma, env: runtimeEnv,
      prepareTurn: async job => ({ question: job.inbound.body, evidence: { records: [] }, slices: [], authorized: true,
        audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: parseLineProjectWorkCommand(job.inbound.body) }),
    credentialResolver: async () => { throw new Error('WORK_TOOL_MUST_NOT_CALL_MODEL') },
    workConfirm: async (...args) => {
      const receipt = await confirmLineWork(...args)
      confirmCalls += 1
      if (confirmCalls === 1) {
        runtimeChild.kill('SIGKILL')
        throw Object.assign(new Error('SYNTHETIC_WORK_PROCESS_CRASH_AFTER_COMMIT'), { code: 'SYNTHETIC_WORK_PROCESS_CRASH_AFTER_COMMIT', status: 503 })
      }
      return receipt
    },
      linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
        replyTransport: { send: async ({ messages }) => { deliveryCalls.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-work-acceptance' } } },
        pushTransport: { send: async ({ messages }) => { deliveryCalls.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-work-acceptance' } } } }),
    })
    coreServer = createServer((request, response) => { void wrapCoreRequest(request, response, coreServer.address().port, core).catch(() => {
      response.writeHead(500, { 'content-type': 'application/json' }); response.end('{}')
    }) })
    const corePort = await listen(coreServer)
    const healthServer = createServer()
    const runtimePort = await listen(healthServer)
    await close(healthServer)
    runtimeChild = spawn(process.execPath, ['src/main.js'], { cwd: runtimeDirectory, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP,
        CONVERSATION_RUNTIME_CORE_URL: `http://127.0.0.1:${corePort}`, CONVERSATION_RUNTIME_TOKEN: serviceToken,
        CONVERSATION_RUNTIME_PORT: String(runtimePort), NODE_ENV: 'test' } })
    let childOutput = ''
    runtimeChild.stdout.on('data', chunk => { childOutput += chunk.toString() })
    runtimeChild.stderr.on('data', chunk => { childOutput += chunk.toString() })
    const readyUntil = Date.now() + 10_000
    while (Date.now() < readyUntil) {
      try { if ((await fetch(`http://127.0.0.1:${runtimePort}/readyz`)).status === 200) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect((await fetch(`http://127.0.0.1:${runtimePort}/readyz`)).status, childOutput).toBe(200)

    const lineEnv = { ZURI_LINE_REPLY_SEAL_KEY: sealKey }
    const webhookPost = createServerLineWebhookPost({ db: prisma,
      ports: () => ({ resolveAccount: async () => ({ ...account, channelSecret, destination: 'synthetic-line-destination', connectionId: account.integrationConnectionId }) }),
      evidenceFactory: createLineOaEvidenceRecorder,
      admitCaptured: args => {
        const task = admitCapturedLineEvents({ ...args, db: prisma, env: lineEnv, delays: [], nudge: () => {} })
        pendingAdmissions.push(task)
        return task
      },
      markAdmissionIntent: args => markLineAdmissionIntent({ ...args, db: prisma }),
    })
    const admit = async (eventToken, text) => {
      const raw = requestBody(eventToken, text)
      const request = new Request('http://local/api/line-oa/accounts/cr-vertical-account/webhook', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', channelSecret).update(Buffer.from(raw)).digest('base64') }, body: raw })
      const response = await webhookPost(request, { params: { id: account.id } })
      expect(response.status).toBe(200)
      await Promise.all(pendingAdmissions)
      return prisma.lineConversationJob.findFirst({ where: { accountId: account.id, eventId: eventToken }, include: { inbound: true } })
    }
    try {
      const before = await prisma.workItem.count()
      const proposalJob = await admit('synthetic-work-proposal-event', `/work-create ${workstream.id} Runtime receipt task`)
      expect(proposalJob).toMatchObject({ executionMode: 'CONVERSATION_RUNTIME', status: 'QUEUED' })
      const proposalUntil = Date.now() + 10_000
      let proposalResult
      while (Date.now() < proposalUntil) {
        proposalResult = await prisma.lineConversationJob.findUnique({ where: { id: proposalJob.id } })
        if (proposalResult?.status === 'RECORDED') break
        if (childHasExited(runtimeChild)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      expect(proposalResult?.status, JSON.stringify({ childOutput, coreRequests,
        job: { status: proposalResult?.status, errorCode: proposalResult?.errorCode } })).toBe('RECORDED')
      expect(proposalResult.answerText).toContain(`ยืนยันงาน ${proposalJob.id}`)
      expect(await prisma.workItem.count()).toBe(before)

      const confirmationJob = await admit('synthetic-work-confirm-event', `ยืนยันงาน ${proposalJob.id}`)
      expect(confirmationJob).toMatchObject({ executionMode: 'CONVERSATION_RUNTIME', status: 'QUEUED' })
    const deliveryCountBeforeCrash = deliveryCalls.length
    const crashedRuntime = runtimeChild
    await waitForChildExit(crashedRuntime)
    expect(childHasExited(crashedRuntime)).toBe(true)
    runtimeChild = null
    expect(await prisma.workItem.count()).toBe(before + 1)
    expect(await prisma.auditEvent.findUnique({ where: { id: `line-work-result:${proposalJob.id}` } })).not.toBeNull()
    const interrupted = await prisma.lineConversationJob.findUnique({ where: { id: confirmationJob.id } })
    expect(interrupted).toMatchObject({ status: 'CLAIMED', executionMode: 'CONVERSATION_RUNTIME' })
    await prisma.lineConversationJob.update({ where: { id: confirmationJob.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1) } })

    const recoveredPort = await freePort()
    const recoveredRuntime = launchRuntime(corePort, recoveredPort)
    runtimeChild = recoveredRuntime.child
    expect(await runtimeReady(recoveredPort, runtimeChild), recoveredRuntime.output).toBe(200)

    const confirmationUntil = Date.now() + 15_000
    let confirmationResult
    while (Date.now() < confirmationUntil) {
      confirmationResult = await prisma.lineConversationJob.findUnique({ where: { id: confirmationJob.id } })
      if (confirmationResult?.status === 'RECORDED') break
      if (childHasExited(runtimeChild)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(confirmationResult?.status, JSON.stringify({ childOutput: recoveredRuntime.output, coreRequests, confirmCalls })).toBe('RECORDED')
    expect(await prisma.workItem.count()).toBe(before + 1)
    expect(confirmCalls).toBe(1)
    expect(await prisma.auditEvent.findUnique({ where: { id: `line-work-result:${proposalJob.id}` } })).not.toBeNull()
    expect(coreRequests).toContain(`WORK confirm-execute ${proposalJob.id}`)
    expect(coreRequests).toContain(`WORK status ${proposalJob.id}`)
    expect(deliveryCalls).toHaveLength(deliveryCountBeforeCrash + 1)
    expect(modelCalls).toEqual([])
    } finally {
      if (runtimeChild.exitCode === null) {
        runtimeChild.kill('SIGTERM')
        await Promise.race([once(runtimeChild, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))])
      }
      runtimeChild = null
    }
  }, 30_000)

  it('reclaims after a process crash before the model side effect and runs the turn once', async () => {
    if (coreServer?.listening) await close(coreServer)
    if (modelServer?.listening) await close(modelServer)
    pendingAdmissions = []
    coreRequests = []
    deliveryCalls = []
    modelCalls = []
    const { jobId } = await admitDirect('synthetic-crash-before-model-event')
    let enterPrepare
    let releasePrepare
    let settlePrepare
    const prepareEntered = new Promise(resolve => { enterPrepare = resolve })
    const prepareGate = new Promise(resolve => { releasePrepare = resolve })
    const prepareSettled = new Promise(resolve => { settlePrepare = resolve })
    let blockFirstPrepare = true
    const modelPortServer = createServer(async (request, response) => {
      const body = await readBody(request)
      modelCalls.push(JSON.parse(body.toString('utf8')))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'คำตอบหลังเริ่ม process ใหม่' } }] }))
    })
    modelServer = modelPortServer
    const modelPort = await listen(modelPortServer)
    const core = createConversationRuntimeCore({ db: prisma,
      env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
      prepareTurn: async () => {
        if (blockFirstPrepare) {
          blockFirstPrepare = false
          enterPrepare()
          await prepareGate
        }
        settlePrepare()
        return { question: 'ถามสถานะสินค้า', evidence: { records: [{ product: 'synthetic-product' }] },
          slices: [{ id: 'crash-context', source: 'RECORD', text: 'Core-authorized synthetic evidence' }],
          authorized: true, audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 2048, workCommand: null }
      },
      credentialResolver: async () => ({ provider: 'prp', model: 'controlled-model', apiKey: 'synthetic-provider-key',
        baseUrl: `http://127.0.0.1:${modelPort}` }),
      linePorts: () => ({ resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
        replyTransport: { send: async ({ messages }) => { deliveryCalls.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-crash-recovery' } } },
        pushTransport: { send: async ({ messages }) => { deliveryCalls.push(messages); return { status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-crash-recovery' } } } }),
    })
    coreServer = createServer((request, response) => {
      coreRequests.push(`${request.method} ${request.url}`)
      void wrapCoreRequest(request, response, coreServer.address().port, core).catch(() => {
        if (!response.destroyed) { response.writeHead(500, { 'content-type': 'application/json' }); response.end('{}') }
      })
    })
    const corePort = await listen(coreServer)
    try {
      let runtimePort = await freePort()
      let launched = launchRuntime(corePort, runtimePort)
      runtimeChild = launched.child
      expect(await runtimeReady(runtimePort, runtimeChild), launched.output).toBe(200)
      const entered = await Promise.race([prepareEntered.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 15_000))])
      expect(entered).toBe(true)
      expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId }, select: { status: true } })).toEqual({ status: 'CLAIMED' })
      expect(await prisma.agentTraceEvent.count({ where: { turnId: jobId, kind: 'MODEL_STARTED' } })).toBe(0)
      expect(modelCalls).toHaveLength(0)

      const crashed = runtimeChild
      crashed.kill('SIGKILL')
      await waitForChildExit(crashed)
      expect(childHasExited(crashed)).toBe(true)
      runtimeChild = null
      releasePrepare()
      await prepareSettled
      expect(modelCalls).toHaveLength(0)
      await prisma.lineConversationJob.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1) } })

      runtimePort = await freePort()
      launched = launchRuntime(corePort, runtimePort)
      runtimeChild = launched.child
      expect(await runtimeReady(runtimePort, runtimeChild), launched.output).toBe(200)
      const deadline = Date.now() + 15_000
      let job
      while (Date.now() < deadline) {
        job = await prisma.lineConversationJob.findUnique({ where: { id: jobId } })
        if (job?.status === 'RECORDED' || childHasExited(runtimeChild)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      expect(job?.status, JSON.stringify({ job, output: launched.output, coreRequests,
        traces: await prisma.agentTraceEvent.findMany({ where: { turnId: jobId }, orderBy: { occurredAt: 'asc' } }) })).toBe('RECORDED')
      expect(modelCalls).toHaveLength(1)
      expect(deliveryCalls).toHaveLength(1)
      expect(await prisma.agentTraceEvent.count({ where: { turnId: jobId, kind: 'MODEL_STARTED' } })).toBe(1)
    } finally {
      releasePrepare()
      if (runtimeChild && !childHasExited(runtimeChild)) {
        runtimeChild.kill('SIGTERM')
        await waitForChildExit(runtimeChild)
      }
      runtimeChild = null
    }
  }, 30_000)

  it('isolates legacy claims, admits one concurrent runtime claimant, reclaims an expired lease, and fences stale completion', async () => {
    const eventId = 'synthetic-claim-fence-event'
    const { jobId } = await admitDirect(eventId)
    const now = new Date()
    const claims = await Promise.all([
      claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-claimant-a', now: () => now }),
      claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-claimant-b', now: () => now }),
    ])
    const [first] = claims.filter(Boolean)
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(first.jobId).toBe(jobId)
    await runLineConversationWorker({ db: prisma, now: () => now, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
      workerId: 'legacy-worker-probe', answer: async () => { throw new Error('LEGACY_MUST_NOT_RUN') },
      resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
      replyTransport: { send: async () => { throw new Error('LEGACY_MUST_NOT_SEND') } },
      pushTransport: { send: async () => { throw new Error('LEGACY_MUST_NOT_SEND') } } })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: jobId }, select: { executionId: true, status: true } }))
      .toMatchObject({ executionId: first.executionId, status: 'CLAIMED' })

    const reclaimedAt = new Date(Date.parse(first.leaseExpiresAt) + 1)
    const reclaimed = await claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-claimant-recovered', now: () => reclaimedAt })
    expect(reclaimed).toMatchObject({ jobId, claimantId: 'runtime-claimant-recovered' })
    expect(reclaimed.executionId).not.toBe(first.executionId)
    await expect(completeRuntimeConversationJob(first, { text: 'stale completion', operationId: `${jobId}:turn-answer` },
      { db: prisma, now: () => reclaimedAt })).rejects.toThrow('CONVERSATION_JOB_LEASE_CONFLICT')

    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { transportEpoch: { increment: 1 } } })
    await expect(completeRuntimeConversationJob(reclaimed, { text: 'after account revoke', operationId: `${jobId}:turn-answer` },
      { db: prisma, now: () => reclaimedAt })).rejects.toThrow('CONVERSATION_JOB_AUTHORITY_REVOKED')
    await prisma.lineConversationJob.updateMany({ where: { id: jobId, status: 'CLAIMED' },
      data: { status: 'CANCELLED', errorCode: 'TEST_FENCE_COMPLETE', version: { increment: 1 } } })
    account = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  })

  it('rejects completion after channel identity revocation', async () => {
    const eventId = 'synthetic-identity-revoke-event'
    const { jobId } = await admitDirect(eventId)
    const claim = await claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-identity-revoke', now: () => new Date() })
    expect(claim?.jobId).toBe(jobId)
    await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
      tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: 'synthetic-line-user',
    } }, data: { status: 'REVOKED', revokedAt: new Date() } })
    await expect(completeRuntimeConversationJob(claim, { text: 'after identity revoke', operationId: `${jobId}:turn-answer` },
      { db: prisma, now: () => new Date() })).rejects.toThrow('CONVERSATION_JOB_AUTHORITY_REVOKED')
    await prisma.lineConversationJob.updateMany({ where: { id: jobId, status: 'CLAIMED' },
      data: { status: 'CANCELLED', errorCode: 'TEST_IDENTITY_REVOKED', version: { increment: 1 } } })
    await prisma.channelIdentity.update({ where: { tenantId_channel_channelAccountId_providerSubject: {
      tenantId: tenant.id, channel: 'LINE', channelAccountId: account.bindingCode, providerSubject: 'synthetic-line-user',
    } }, data: { status: 'ACTIVE', revokedAt: null, verifiedAt: new Date(), linkedAt: new Date() } })
  })

  it('revalidates memory consent and erasure state before completion', async () => {
    const consentEvent = 'synthetic-memory-consent-revoke-event'
    const consentJob = await admitDirect(consentEvent)
    const consentClaim = await claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-consent-revoke', now: () => new Date() })
    expect(consentClaim?.jobId).toBe(consentJob.jobId)
    await prisma.lineConversationJob.update({ where: { id: consentJob.jobId }, data: { memorySyncOptIn: true } })
    await expect(completeRuntimeConversationJob(consentClaim, {
      text: 'after consent changed', operationId: `${consentJob.jobId}:turn-answer`,
    }, { db: prisma, now: () => new Date() })).rejects.toThrow('CONVERSATION_JOB_AUTHORITY_REVOKED')
    await prisma.lineConversationJob.update({ where: { id: consentJob.jobId },
      data: { status: 'CANCELLED', memorySyncOptIn: false, errorCode: 'TEST_CONSENT_FENCE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })

    const erasureEvent = 'synthetic-erasure-revoke-event'
    const erasureJob = await admitDirect(erasureEvent)
    const erasureClaim = await claimRuntimeConversationJob({ db: prisma, claimantId: 'runtime-erasure-revoke', now: () => new Date() })
    expect(erasureClaim?.jobId).toBe(erasureJob.jobId)
    await prisma.lineConversationJob.update({ where: { id: erasureJob.jobId }, data: { errorCode: 'PDPA_ERASURE' } })
    await expect(completeRuntimeConversationJob(erasureClaim, {
      text: 'after erasure', operationId: `${erasureJob.jobId}:turn-answer`,
    }, { db: prisma, now: () => new Date() })).rejects.toThrow('CONVERSATION_JOB_AUTHORITY_REVOKED')
    await prisma.lineConversationJob.update({ where: { id: erasureJob.jobId },
      data: { status: 'CANCELLED', errorCode: 'PDPA_ERASURE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  })

  it('bounds authenticated Core requests and responses and derives claim scope from durable state', async () => {
    const env = { CONVERSATION_RUNTIME_TOKEN: serviceToken }
    const makeRequest = (operation, payload, tokenValue = serviceToken, bodyOverride = null) => {
      const body = bodyOverride ?? JSON.stringify({ contractVersion: 'conversation-runtime.v1', operation,
        correlationId: 'synthetic-core-contract', idempotencyKey: `synthetic:${operation}`,
        deadlineAt: new Date(Date.now() + 30_000).toISOString(), payload })
      return new Request(`http://local/api/internal/conversation-runtime/v1/${operation}`, { method: 'POST',
        headers: { authorization: `Bearer ${tokenValue}`, 'content-type': 'application/json' }, body })
    }
    const core = createConversationRuntimeCore({ db: prisma, env })
    const claim = { jobId: 'synthetic-nonexistent-job', executionId: 'synthetic-execution', claimantId: 'forged-actor',
      version: 1, tenantId: 'forged-tenant', businessId: 'forged-business', accountId: 'forged-account' }
    const unauthorized = await core.handle(makeRequest('status', { claim, operationId: `${claim.jobId}:turn-answer` }, 'wrong-service-token'), { operation: 'status' })
    expect(unauthorized.status).toBe(401)
    const forgedScope = await core.handle(makeRequest('status', { claim, operationId: `${claim.jobId}:turn-answer` }), { operation: 'status' })
    expect(forgedScope.status).toBe(409)
    expect((await forgedScope.json()).error.code).toBe('CONVERSATION_JOB_LEASE_CONFLICT')
    const oversized = await core.handle(makeRequest('claim', {}, serviceToken, 'x'.repeat(70 * 1024)), { operation: 'claim' })
    expect(oversized.status).toBe(413)

    const oversizedResponseCore = createConversationRuntimeCore({ db: prisma, env,
      readStatus: async claimRef => ({ status: 'READY', operationId: `${claimRef.jobId}:turn-answer`, version: 1,
        errorCode: null, executionId: 'synthetic-execution', text: 'x'.repeat(70 * 1024) }) })
    const oversizedResponse = await oversizedResponseCore.handle(
      makeRequest('status', { claim, operationId: `${claim.jobId}:turn-answer` }), { operation: 'status' })
    expect(oversizedResponse.status).toBe(500)
    expect((await oversizedResponse.json()).error.code).toBe('CONTRACT_RESPONSE_INVALID')
  })
})
