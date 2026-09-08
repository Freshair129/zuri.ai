import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, runLineConversationWorker, readLineConversationTrace } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { appendTraceEvent, playbackTrace } from '@/modules/agent/execution-trace'

// @req FR-171 — production composition records exact model input and durable delivery evidence.
// @spec SEC-001, SEC-005, ADR-070
// @tested tests/integration/server-line-trace.test.js

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'b4'.repeat(32) }
const tenants = []
async function fixture() {
  const suffix = randomUUID()
  const portfolio = await createPortfolio({ code: `PF-${suffix}`, name: 'Trace' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TN-${suffix}`, name: 'Trace' })
  tenants.push(tenant.id)
  const business = await createBusiness({ tenantId: tenant.id, code: `BS-${suffix}`, name: 'Trace' })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: 'Trace', externalAccountId: suffix, status: 'ACTIVE' })
  const account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `OA-${suffix}`, displayName: 'Trace', serverEnabled: true, transportMode: 'CLOUD',
    status: 'CONNECTED', modelAccess: 'EXTERNAL_MODEL_ALLOWED', executionMode: 'SERVER',
  } })
  const now = new Date()
  const event = { type: 'message', webhookEventId: suffix, replyToken: 'fixture-reply-secret', timestamp: now.getTime() - 50,
    source: { type: 'user', userId: `user-${suffix}` }, message: { type: 'text', id: `msg-${suffix}`, text: 'AB-1 ราคาเท่าไร' } }
  const admitted = await admitLineConversation({ account, event, correlationId: suffix, now, env })
  const evidence = { records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: now.toISOString() }] }
  const fetchFn = vi.fn(async () => ({ ok: true, headers: new Headers({ 'x-request-id': 'provider-request' }), json: async () => ({
    id: 'response-1', output_text: 'AB-1 ราคา 50 บาท', usage: { input_tokens: 120, output_tokens: 20, total_tokens: 140,
      input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 5 } },
  }) }))
  const model = createModelProviderPort({ provider: 'openai', model: 'fixture', credential: 'fixture-model-secret', fetchFn })
  const answer = createServerLineAnswer({ runtimeFactory: async () => ({ businessKnowledge: { query: async () => evidence }, resolveModel: async () => model }) })
  const reply = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'line-request', messageId: 'line-message' }))
  const worker = { db: prisma, answer, env, now: () => now, workerId: 'trace-instance',
    resolveAccount: id => prisma.lineOaAccount.findUnique({ where: { id } }),
    replyTransport: { send: reply }, pushTransport: { send: vi.fn() } }
  const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['platform', 'line-oa'] })
  return { ...admitted, tenant, business, account, event, worker, fetchFn, reply, owner }
}

afterEach(async () => {
  await prisma.lineConversationJob.deleteMany({ where: { tenantId: { in: tenants } } })
})

describe('SERVER LINE execution trace', () => {
  it('links the real request to context, usage, output and acceptance without inventing recipient delivery', async () => {
    const f = await fixture()
    expect(await runLineConversationWorker(f.worker)).toMatchObject({ status: 'RECORDED' })
    const result = await readLineConversationTrace(f.jobId, { viewer: f.owner })
    const events = result.events
    const payload = kind => events.find(event => event.kind === kind).payload
    expect(payload('CONTEXT_COMMITTED').requestBody).toEqual(JSON.parse(f.fetchFn.mock.calls[0][1].body))
    expect(payload('MODEL_COMPLETED').usage).toMatchObject({ inputTokens: 120, outputTokens: 20, totalTokens: 140 })
    expect(payload('SEND_RESULT')).toMatchObject({ providerOutcome: 'ACCEPTED_BY_LINE', recipientDeliveredAt: null, recipientReadAt: null })
    expect(payload('OUTBOUND_RECORDED').outboundMessageId).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain('fixture-reply-secret')
    expect(JSON.stringify(result)).not.toContain('fixture-model-secret')
    expect(f.reply).toHaveBeenCalledOnce()
    await readLineConversationTrace(f.jobId, { viewer: f.owner })
    expect(f.fetchFn).toHaveBeenCalledOnce()
    expect(f.reply).toHaveBeenCalledOnce()
  })

  it('denies another business and a viewer without ownership before exposing payloads', async () => {
    const f = await fixture()
    const outsider = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    const member = makeViewer({ visibleBusinessIds: [f.business.id], ownedBusinessIds: [], visibleDomains: ['line-oa'] })
    await expect(readLineConversationTrace(f.jobId, { viewer: outsider })).rejects.toMatchObject({ status: 404 })
    await expect(readLineConversationTrace(f.jobId, { viewer: member })).rejects.toMatchObject({ status: 404 })
  })

  it('removes copied context and output in the same erasure transaction', async () => {
    const f = await fixture()
    await runLineConversationWorker(f.worker)
    const message = await prisma.message.findUnique({ where: { id: f.inboundMessageId } })
    await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: f.tenant.id, conversationIds: [message.conversationId] }))
    const result = await readLineConversationTrace(f.jobId, { viewer: f.owner })
    expect(JSON.stringify(result)).not.toContain('ราคา')
    expect(result.playback.status).toBe('REPLAY_INCOMPLETE')
    expect(f.reply).toHaveBeenCalledOnce()
    await expect(appendTraceEvent(prisma, { scope: { tenantId: f.tenant.id, businessId: f.business.id },
      turnId: f.jobId, kind: 'MODEL_COMPLETED', idempotencyKey: randomUUID(), payload: { outputText: 'late private output' } }))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_TURN_REDACTED' })
  })

  it('does not report an empty or unfinished execution as complete playback', () => {
    expect(playbackTrace([]).status).toBe('REPLAY_INCOMPLETE')
    expect(playbackTrace([{ executionId: randomUUID(), kind: 'EXECUTION_STARTED', payload: {} }]).status).toBe('REPLAY_INCOMPLETE')
    expect(playbackTrace([{ kind: 'SEND_STARTED', payload: { sendAttemptId: randomUUID() } }]).reasons).toContain('SEND_OUTCOME_MISSING')
  })

  it('fences a stale accepted answer before erasure can be undone by CRM reconciliation', async () => {
    const f = await fixture()
    const message = await prisma.message.findUnique({ where: { id: f.inboundMessageId } })
    await prisma.lineConversationJob.update({ where: { id: f.jobId }, data: {
      status: 'ACCEPTED', answerText: 'answer before erasure', acceptedAt: new Date(),
    } })
    let erased = false
    const db = new Proxy(prisma, { get(target, key) {
      if (key !== '$transaction') return target[key]
      return work => target.$transaction(tx => work(new Proxy(tx, { get(client, name) {
        if (name !== 'lineConversationJob') return client[name]
        return new Proxy(client[name], { get(delegate, method) {
          if (method !== 'updateMany') return delegate[method]
          return async args => {
            if (!erased && args.where.status === 'ACCEPTED' && args.data.id === f.jobId) {
              erased = true
              await redactLineConversationJobs(tx, { tenantId: f.tenant.id, conversationIds: [message.conversationId] })
            }
            return delegate.updateMany(args)
          }
        } })
      } })))
    } })
    expect(await runLineConversationWorker({ ...f.worker, db })).toMatchObject({ status: 'CANCELLED' })
    expect(erased).toBe(true)
    expect(await prisma.message.count({ where: { conversationId: message.conversationId, direction: 'OUTBOUND' } })).toBe(0)
    expect(f.reply).not.toHaveBeenCalled()
  })

  it('does not call the provider when the context snapshot cannot be persisted', async () => {
    const f = await fixture()
    const db = new Proxy(prisma, { get(target, key) {
      if (key !== '$transaction') return target[key]
      return work => target.$transaction(tx => work(new Proxy(tx, { get(client, name) {
        if (name !== 'agentTraceEvent') return client[name]
        return new Proxy(client[name], { get(delegate, method) {
          if (method !== 'create') return delegate[method]
          return args => {
            if (args.data.kind === 'CONTEXT_COMMITTED') throw new Error('fixture-write-failed')
            return delegate.create(args)
          }
        } })
      } })))
    } })
    await runLineConversationWorker({ ...f.worker, db })
    expect(f.fetchFn).not.toHaveBeenCalled()
    expect(f.reply).not.toHaveBeenCalled()
  })
})
