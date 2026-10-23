import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { createConversationRuntimeV2RouteHandlers } from '@/app/api/internal/conversation-runtime/v2/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { lineProductFactsDecisionKey, readLineProductFactsDecision, recordLineProductFactsDecision } from '@/modules/line-oa-studio/application/line-product-facts-decision'
import { withLineProductFactsCommand } from '@/modules/agent/line-product-facts-command'
import { createCoreClient, createProductionCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'
import { appendTraceEvent, sha256 } from '@/modules/agent/execution-trace'

// @req FR-291 — Server and v2 Runtime execute a recognized #product command as
//   the same deterministic Core-owned reply; v1 refuses it and no missing or
//   stale decision can reach LINE.
// @spec ADR-106, SDD-110 — private job/execution binding and common send gate.
// @tested tests/integration/conversation-runtime-product-facts.test.js,
//   tests/integration/line-product-facts.test.js
const serviceToken = 'synthetic-product-facts-core-token-000000001'
const sealKey = '6e'.repeat(32)
const requestText = '#product {"sku":"SYNTH-FACT-1","facets":["availability"]}'
const deterministicReply = 'ผลข้อมูลสินค้าสำหรับการทดสอบ'
const BINDING_FIELDS = ['schema', 'jobId', 'executionId', 'requestDigest', 'authorityDigest', 'productRefDigest',
  'stockPolicyVersion', 'stockObservationDigest', 'publicationDigest', 'resultDigest'].sort()

let tenant, business, provider, serverAccount, runtimeAccount, lineUser, sequence = 0
let serverDeliveries = []
let runtimeDeliveries = []
let openJobs = []

function syntheticBinding(job) {
  const digest = value => sha256(value)
  return {
    schema: 'zuri.line-product-facts.binding.v1',
    jobId: job.id,
    executionId: job.executionId,
    requestDigest: digest({ request: requestText }),
    authorityDigest: digest({ job: job.id, execution: job.executionId, account: job.accountId }),
    productRefDigest: digest({ product: 'opaque-product-reference' }),
    stockPolicyVersion: 1,
    stockObservationDigest: digest({ state: 'ATP_POSITIVE' }),
    publicationDigest: null,
    resultDigest: digest({ outcome: 'FIXED_TEST_REPLY' }),
  }
}

const productResolver = async job => ({ text: deterministicReply, binding: syntheticBinding(job) })

function transport(sink) {
  return {
    resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
    replyTransport: { send: async ({ messages }) => {
      sink.push({ method: 'REPLY', messages })
      return { status: 'ACCEPTED_BY_LINE', requestId: `reply-${sink.length}` }
    } },
    pushTransport: { send: async ({ messages, retryKey }) => {
      sink.push({ method: 'PUSH', messages, retryKey })
      return { status: 'ACCEPTED_BY_LINE', requestId: `push-${sink.length}` }
    } },
  }
}

function inProcessFetch(handlers, wire, { beforeOperation } = {}) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    const request = new Request(target, init)
    const envelope = init.body ? JSON.parse(init.body) : null
    let response
    if (envelope) {
      const entry = { path: target.pathname, operation: envelope.operation, request: envelope.payload }
      wire.push(entry)
      await beforeOperation?.(envelope.operation, envelope.payload)
      response = await handlers.POST(request, { params: { operation } })
      entry.response = await response.clone().json()
    } else response = await handlers.GET(request, { params: { operation } })
    return response
  }
}

function buildRuntime({ allowRevalidation = () => true, beforeOperation } = {}) {
  const wire = []
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    productFactsResolver: productResolver,
    productFactsRevalidator: allowRevalidation,
    prepareTurn: async job => ({ question: job.inbound.body, evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }),
    credentialResolver: async () => { throw new Error('PRODUCT_FACTS_MUST_NOT_RESOLVE_CREDENTIAL') },
    linePorts: () => transport(runtimeDeliveries) })
  const client = createProductionCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeV2RouteHandlers(core), wire, { beforeOperation }) })
  const ports = createCorePorts({ client,
    model: { generate: async () => { throw new Error('PRODUCT_FACTS_MUST_NOT_CALL_MODEL') } } })
  return { wire, ports, client, runtime: claimantId => createConversationRuntime({ ports, claimantId }) }
}

async function account(runtimeOwner, suffix) {
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Synthetic product facts ${suffix}`, externalAccountId: `synthetic-product-${suffix}`, status: 'ACTIVE' })
  return prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: `product-facts-${suffix}`, displayName: `Product facts ${suffix}`,
    bindingCode: `product-facts-binding-${suffix}`, status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', runtimeOwner } })
}

async function admit(oa, text = requestText) {
  const eventId = `synthetic-product-facts-${++sequence}`
  const at = new Date()
  const current = await prisma.lineOaAccount.findUnique({ where: { id: oa.id } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    correlationId: eventId, now: at, ingressReceivedAt: at,
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: at.getTime(),
      source: { type: 'user', userId: lineUser },
      message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}

async function expectPrivateDecision(job) {
  const decision = await readLineProductFactsDecision(prisma, job)
  expect(decision.binding).toMatchObject({ jobId: job.id, executionId: job.executionId,
    schema: 'zuri.line-product-facts.binding.v1' })
  expect(Object.keys(decision.binding).sort()).toEqual(BINDING_FIELDS)
  const trace = await prisma.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
    tenantId: job.tenantId, businessId: job.businessId, idempotencyKey: lineProductFactsDecisionKey(job),
  } } })
  expect(trace.kind).toBe('TOOL_RESULT')
  const payload = JSON.parse(trace.payloadJson)
  expect(payload).toMatchObject({ tool: 'LINE_PRODUCT_FACTS', decision: 'COMMAND' })
  expect(JSON.stringify(payload)).not.toContain(deterministicReply)
  expect(JSON.stringify(payload)).not.toContain('ATP_POSITIVE')
  expect(JSON.stringify(payload)).not.toContain('SYNTH-FACT-1')
  return payload
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ code: `PF-PRODUCT-FACTS-${Date.now()}`, name: 'Product facts Runtime fixture' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-PRODUCT-FACTS-${Date.now()}`, name: 'Product facts Runtime tenant' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-PRODUCT-FACTS-${Date.now()}`, name: 'Product facts Runtime business' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  serverAccount = await account('SERVER', 'server')
  runtimeAccount = await account('CONVERSATION_RUNTIME', 'runtime')
  lineUser = `synthetic-product-facts-user-${Date.now()}`
  const actor = await prisma.person.create({ data: { code: `PER-PRODUCT-FACTS-${Date.now()}`, displayName: 'Product facts test sender' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  const linkedAt = new Date(Date.now() - 60_000)
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
  for (const oa of [serverAccount, runtimeAccount]) {
    await prisma.channelIdentity.create({ data: { personId: actor.id, tenantId: tenant.id, channel: 'LINE',
      channelAccountId: oa.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  }
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_PRODUCT_FACTS_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  serverDeliveries = []
  runtimeDeliveries = []
  openJobs = []
})

describe('FR-291 Core/Runtime product-facts integration', () => {
  it('uses the Server command wrapper and v2 Runtime fixed turn with one private job/execution decision', async () => {
    const serverJob = await admit(serverAccount)
    let modelCalls = 0
    const serverAnswer = withLineProductFactsCommand(async () => { modelCalls += 1; return { text: 'model fallback' } },
      { db: prisma, resolve: productResolver })
    const serverResult = await runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
      workerId: `server-product-facts-${++sequence}`, answer: serverAnswer, revalidateProductFacts: async () => true,
      ...transport(serverDeliveries) })
    expect(serverResult).toMatchObject({ id: serverJob.id, status: 'RECORDED' })
    expect(serverDeliveries).toEqual([{ method: 'REPLY', messages: [{ type: 'text', text: deterministicReply }] }])
    expect(modelCalls).toBe(0)
    const serverAfter = await prisma.lineConversationJob.findUnique({ where: { id: serverJob.id } })
    await expectPrivateDecision(serverAfter)

    const runtimeJob = await admit(runtimeAccount)
    const runtime = buildRuntime()
    const outcome = await runtime.runtime(`runtime-product-facts-${++sequence}`).runOne()
    expect(outcome).toMatchObject({ jobId: runtimeJob.id, status: 'RECORDED' })
    expect(runtimeDeliveries).toEqual(serverDeliveries)
    const prepare = runtime.wire.find(call => call.operation === 'prepare')
    expect(prepare.path).toBe('/api/internal/conversation-runtime/v2/prepare')
    expect(prepare.response.data).toMatchObject({ turnKind: 'PRODUCT_FACTS', question: 'PRODUCT_FACTS', replyText: deterministicReply })
    expect(JSON.stringify(prepare.response.data)).not.toContain('SYNTH-FACT-1')
    expect(runtime.wire.map(call => call.operation)).not.toContain('credential')
    expect(runtime.wire.map(call => call.operation)).not.toContain('work-tool')
    expect(runtime.wire.map(call => call.operation)).not.toContain('memory')
    const runtimeAfter = await prisma.lineConversationJob.findUnique({ where: { id: runtimeJob.id } })
    await expectPrivateDecision(runtimeAfter)
    expect(modelCalls).toBe(0)
  })

  it('writes one idempotent content-free AuditEvent bound to the private fact decision', async () => {
    const admitted = await admit(serverAccount)
    const executionId = randomUUID()
    await prisma.lineConversationJob.update({ where: { id: admitted.id }, data: {
      status: 'CLAIMED', executionId, claimantId: `audit-product-facts-${++sequence}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.id } })
    const binding = syntheticBinding(job)
    const auditId = lineProductFactsDecisionKey(job)
    const occurredAt = new Date()
    const record = () => recordLineProductFactsDecision(prisma, job, {
      binding, replyText: deterministicReply, now: occurredAt,
    })

    await record()
    const audit = await prisma.auditEvent.findUnique({ where: { id: auditId } })
    expect(audit).toMatchObject({ id: auditId, entityType: 'LINE_PRODUCT_FACTS_READ', entityId: job.id,
      action: 'RESOLVED', actorType: 'AGENT', actorId: null, tenantId: job.tenantId,
      businessId: job.businessId, requestId: job.id })
    expect(JSON.parse(audit.payloadJson)).toEqual({
      schema: 'zuri.line-product-facts.audit.v1',
      executionId: job.executionId,
      requestDigest: binding.requestDigest,
      authorityDigest: binding.authorityDigest,
      productRefDigest: binding.productRefDigest,
      stockPolicyVersion: binding.stockPolicyVersion,
      stockObservationDigest: binding.stockObservationDigest,
      publicationDigest: binding.publicationDigest,
      resultDigest: binding.resultDigest,
    })
    expect(JSON.stringify(audit)).not.toContain(deterministicReply)
    expect(JSON.stringify(audit)).not.toContain(lineUser)
    expect(JSON.stringify(audit)).not.toContain('SYNTH-FACT-1')
    expect(JSON.stringify(audit)).not.toContain('ATP_POSITIVE')

    await record()
    expect(await prisma.auditEvent.count({ where: { id: auditId } })).toBe(1)
    await expectPrivateDecision(job)
  })

  it('rolls back the private decision when its deterministic AuditEvent key conflicts', async () => {
    const admitted = await admit(serverAccount)
    const executionId = randomUUID()
    await prisma.lineConversationJob.update({ where: { id: admitted.id }, data: {
      status: 'CLAIMED', executionId, claimantId: `audit-conflict-product-facts-${++sequence}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.id } })
    const binding = syntheticBinding(job)
    const auditId = lineProductFactsDecisionKey(job)
    await prisma.auditEvent.create({ data: { id: auditId, entityType: 'LINE_PRODUCT_FACTS_READ', entityId: job.id,
      action: 'CONFLICTING', payloadJson: '{}', actorType: 'AGENT', tenantId: job.tenantId,
      businessId: job.businessId, requestId: job.id } })

    await expect(recordLineProductFactsDecision(prisma, job, { binding, replyText: deterministicReply }))
      .rejects.toMatchObject({ code: 'LINE_PRODUCT_FACTS_AUDIT_CONFLICT' })
    expect(await prisma.agentTraceEvent.count({ where: { turnId: job.id, idempotencyKey: auditId } })).toBe(0)
  })

  it('rejects a same-binding race winner whose private reply digest differs', async () => {
    const admitted = await admit(serverAccount)
    const executionId = randomUUID()
    await prisma.lineConversationJob.update({ where: { id: admitted.id }, data: {
      status: 'CLAIMED', executionId, claimantId: `audit-race-product-facts-${++sequence}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.id } })
    const binding = syntheticBinding(job)
    const key = lineProductFactsDecisionKey(job)
    const differentReply = 'different content for the same binding'
    await appendTraceEvent(prisma, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: job.id,
      executionId: job.executionId, kind: 'TOOL_RESULT', idempotencyKey: key,
      payload: { tool: 'LINE_PRODUCT_FACTS', decision: 'COMMAND', binding, bindingSha256: sha256(binding),
        replySha256: sha256(differentReply) } })
    await prisma.auditEvent.create({ data: { id: key, entityType: 'LINE_PRODUCT_FACTS_READ', entityId: job.id,
      action: 'RESOLVED', actorType: 'AGENT', actorId: null, tenantId: job.tenantId, businessId: job.businessId,
      requestId: job.id, payloadJson: JSON.stringify({ schema: 'zuri.line-product-facts.audit.v1',
        executionId: binding.executionId, requestDigest: binding.requestDigest, authorityDigest: binding.authorityDigest,
        productRefDigest: binding.productRefDigest, stockPolicyVersion: binding.stockPolicyVersion,
        stockObservationDigest: binding.stockObservationDigest, publicationDigest: binding.publicationDigest,
        resultDigest: binding.resultDigest }) } })

    const raceDb = { agentTraceEvent: prisma.agentTraceEvent, auditEvent: prisma.auditEvent,
      $transaction: async () => { throw Object.assign(new Error('unique constraint race'), { code: 'P2002' }) } }
    await expect(recordLineProductFactsDecision(raceDb, job, { binding, replyText: deterministicReply }))
      .rejects.toMatchObject({ code: 'LINE_PRODUCT_FACTS_DECISION_CONFLICT' })
  })

  it.each([requestText, 'ราคา TEST-ONLY-V1 1 EA เท่าไร'])('keeps v1 fail-closed before the resolver or model: %s', async text => {
    const job = await admit(runtimeAccount, text)
    let resolverCalls = 0
    const wire = []
    const core = createConversationRuntimeCore({ db: prisma, env: { CONVERSATION_RUNTIME_TOKEN: serviceToken },
      productFactsResolver: async () => { resolverCalls += 1; return productResolver(job) },
      credentialResolver: async () => { throw new Error('V1_PRODUCT_FACTS_MUST_NOT_RESOLVE_CREDENTIAL') } })
    const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
      fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core), wire) })
    const ports = createCorePorts({ client, model: { generate: async () => { throw new Error('V1_PRODUCT_FACTS_MUST_NOT_CALL_MODEL') } } })
    const claim = await ports.job.claim({ claimantId: `runtime-product-v1-${++sequence}` })
    const authority = await ports.authority.resolve(claim)
    await expect(ports.context.prepare(claim, authority)).rejects.toMatchObject({ code: 'PRODUCT_FACTS_REQUIRES_V2' })
    expect(resolverCalls).toBe(0)
    expect(wire.some(call => call.path === '/api/internal/conversation-runtime/v1/prepare')).toBe(true)
  })

  it('does not let the Runtime forge Core-owned ANSWER_READY evidence for an out-of-hours bypass', async () => {
    const job = await admit(runtimeAccount)
    const runtime = buildRuntime()
    const claim = await runtime.client.call('claim', { claimantId: `runtime-product-forge-${++sequence}` })
    expect(claim).toMatchObject({ jobId: job.id, executionId: expect.any(String) })
    const claimRef = { jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId,
      version: claim.version, tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId }
    await expect(runtime.client.call('trace', { claim: claimRef, kind: 'ANSWER_READY',
      payload: { text: deterministicReply, executionEvidence: 'OUT_OF_HOURS_RULE' } }))
      .rejects.toMatchObject({ code: 'TRACE_KIND_NOT_PERMITTED' })
    expect(await prisma.agentTraceEvent.count({ where: { turnId: job.id, kind: 'ANSWER_READY' } })).toBe(0)
  })

  it('rejects a non-integer stock policy version before persisting the private binding', async () => {
    const admitted = await admit(runtimeAccount)
    const executionId = randomUUID()
    await prisma.lineConversationJob.update({ where: { id: admitted.id }, data: {
      status: 'CLAIMED', executionId, claimantId: `invalid-binding-${++sequence}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.id }, include: { inbound: true } })
    const binding = syntheticBinding(job)
    binding.stockPolicyVersion = '1'
    await expect(recordLineProductFactsDecision(prisma, job, { binding, replyText: deterministicReply }))
      .rejects.toMatchObject({ code: 'LINE_PRODUCT_FACTS_BINDING_INVALID' })
    expect(await prisma.agentTraceEvent.count({ where: { turnId: job.id, idempotencyKey: lineProductFactsDecisionKey(job) } })).toBe(0)
  })

  it('cancels a Runtime product reply when the live authority changes before send', async () => {
    const job = await admit(runtimeAccount)
    let authorized = true
    const revalidated = []
    const runtime = buildRuntime({
      allowRevalidation: async (current, binding, { now }) => {
        revalidated.push({ jobId: current.id, executionId: current.executionId, bindingJobId: binding.jobId,
          status: current.status, nowType: typeof now })
        return authorized
      },
      beforeOperation: async operation => { if (operation === 'send') authorized = false },
    })
    const outcome = await runtime.runtime(`runtime-product-revoked-${++sequence}`).runOne()
    expect(outcome).toMatchObject({ jobId: job.id, status: 'CANCELLED' })
    expect(revalidated).toEqual([{ jobId: job.id, executionId: expect.any(String), bindingJobId: job.id,
      status: 'READY', nowType: 'function' }])
    expect(runtimeDeliveries).toEqual([])
  })

  it('cancels a READY #product job whose durable Core decision is missing', async () => {
    const job = await admit(serverAccount)
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status: 'READY', answerText: 'unbound product reply', version: { increment: 1 } } })
    const deliveries = []
    const result = await runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
      workerId: `server-product-missing-${++sequence}`, answer: async () => { throw new Error('READY_JOB_MUST_NOT_EXECUTE') },
      ...transport(deliveries) })
    expect(result).toMatchObject({ id: job.id, status: 'CANCELLED' })
    expect(deliveries).toEqual([])
    expect(await prisma.lineConversationJob.findUnique({ where: { id: job.id } }))
      .toMatchObject({ status: 'CANCELLED', answerText: null, errorCode: 'LINE_PRODUCT_FACTS_AUTHORITY_REVOKED' })
  })
})
