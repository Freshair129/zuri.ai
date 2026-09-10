import { erasePrincipal } from '@/modules/identity/erase-principal'
import { conversationEnvelope } from '../../../edge/src/conversation/contract.ts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import { mintEdgeDeviceCredential, resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import {
  admitLineConversation, claimEdgeConversation, completeEdgeConversation,
  runLineConversationWorker, LINE_JOB_LEASE_MS, acknowledgeUnknownLineJob,
} from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'

// @req FR-149, FR-150 — real durable admission, scoped compute leases and fenced delivery recovery.
// @spec ADR-061, FR-148, SEC-001
// @tested tests/integration/server-line-jobs.test.js

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'a7'.repeat(32) }
const start = new Date('2026-09-06T13:00:00.000Z')
const later = (ms) => new Date(start.getTime() + ms)
let tenant, businessA, businessB, provider, deviceA, deviceA2, deviceB, sequence = 0
const event = (id, over = {}) => ({
  type: 'message', webhookEventId: `event-${id}`, replyToken: `token-${id}`,
  source: { type: 'user', userId: `user-${id}` },
  message: { type: 'text', id: `message-${id}`, text: `question ${id}` }, ...over,
})

async function account(over = {}) {
  const id = ++sequence
  const target = over.businessId || businessA.id
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: target, providerId: provider.id,
    name: `Job connection ${id}`, externalAccountId: `job-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: target, integrationConnectionId: connection.id,
    code: `job-account-${id}`, displayName: `Job OA ${id}`, bindingCode: `job-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', ...over,
  } })
}
const admit = (oa, incoming, over = {}) => admitLineConversation({ account: oa, event: incoming, correlationId: 'corr-server-jobs', now: start, env, ...over })
const row = (id) => prisma.lineConversationJob.findUnique({ where: { id } })
const worker = (over = {}) => ({
  db: prisma, env, now: () => start, workerId: 'test-server',
  answer: vi.fn(async () => ({ text: 'answer from the server' })),
  resolveAccount: vi.fn(async id => prisma.lineOaAccount.findUnique({ where: { id } })),
  replyTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'accepted-request' })) },
  pushTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'accepted-push' })) },
  ...over,
})

/** Inject one storage failure while retaining the actual SQLite transaction. */
function failingTransaction(model, operation, shouldFail, code) {
  return new Proxy(prisma, { get(target, key) {
    if (key !== '$transaction') return target[key]
    return (work) => target.$transaction(tx => work(new Proxy(tx, { get(client, name) {
      if (name !== model) return client[name]
      return new Proxy(client[name], { get(delegate, method) {
        if (method !== operation) return delegate[method]
        return (args) => {
          if (shouldFail(args)) throw new Error(code)
          return delegate[method](args)
        }
      } })
    } })))
  } })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Server LINE jobs', code: 'PF-SERVER-LINE-JOBS' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Server LINE tenant', code: 'TNT-SERVER-LINE-JOBS' })
  businessA = await createBusiness({ tenantId: tenant.id, name: 'Job business A', code: 'BUS-SERVER-LINE-A' })
  businessB = await createBusiness({ tenantId: tenant.id, name: 'Job business B', code: 'BUS-SERVER-LINE-B' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const owner = makeViewer({ visibleBusinessIds: [businessA.id, businessB.id], ownedBusinessIds: [businessA.id, businessB.id], visibleDomains: ['platform', 'line-oa'] })
  const mint = async (businessId, deviceId) => {
    const { key } = await mintEdgeDeviceCredential({ businessId, deviceId, label: deviceId, viewer: owner })
    return resolveEdgeDeviceContext({ headers: { get: name => name.toLowerCase() === 'authorization' ? `Bearer ${key}` : null } })
  }
  deviceA = await mint(businessA.id, 'device-job-a')
  deviceA2 = await mint(businessA.id, 'device-job-a2')
  deviceB = await mint(businessB.id, 'device-job-b')
})

afterEach(async () => {
  // Only this suite's queue rows: workers in later tests must not claim abandoned fixtures.
  await prisma.lineConversationJob.deleteMany({ where: { tenantId: tenant.id } })
})

describe('server LINE admission', () => {
  it('deduplicates redelivery and changed event IDs without a second inbound or job', async () => {
    const oa = await account()
    const incoming = event('duplicate')
    const first = await admit(oa, incoming)
    const duplicate = await admit(oa, incoming)
    const changedEnvelope = await admit(oa, { ...incoming, webhookEventId: 'redelivery-new-event' })
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ jobId: first.jobId, inboundMessageId: first.inboundMessageId, created: false })
    expect(changedEnvelope).toMatchObject({ jobId: first.jobId, created: false })
    expect(await prisma.lineConversationJob.count({ where: { accountId: oa.id } })).toBe(1)
    const inbound = await prisma.message.findUnique({ where: { id: first.inboundMessageId } })
    expect(await prisma.message.count({ where: { conversationId: inbound.conversationId } })).toBe(1)
    expect((await row(first.jobId)).sealedReplyToken).not.toContain(incoming.replyToken)
  })

  it('rolls back first-contact identity and CRM if durable queue insertion fails', async () => {
    const oa = await account()
    const incoming = event('admit-rollback')
    const db = failingTransaction('lineConversationJob', 'create', () => true, 'QUEUE_WRITE_FAILED')
    await expect(admit(oa, incoming, { db })).rejects.toThrow('QUEUE_WRITE_FAILED')
    expect(await prisma.externalIdentity.count({ where: { tenantId: tenant.id, providerSubject: incoming.source.userId } })).toBe(0)
    expect(await prisma.conversation.count({ where: { tenantId: tenant.id, channelAccountId: oa.bindingCode } })).toBe(0)
    expect(await prisma.lineConversationJob.count({ where: { accountId: oa.id } })).toBe(0)
  })

  it('keeps the same LINE user, event and message independent across two OA accounts', async () => {
    const oaA = await account()
    const oaB = await account({ businessId: businessB.id })
    const incoming = event('two-accounts')
    const a = await admit(oaA, incoming)
    const b = await admit(oaB, incoming)
    expect(a.jobId).not.toBe(b.jobId)
    expect(a.inboundMessageId).not.toBe(b.inboundMessageId)
    const [jobA, jobB] = await Promise.all([row(a.jobId), row(b.jobId)])
    expect(jobA).toMatchObject({ tenantId: tenant.id, businessId: businessA.id, channelAccountId: oaA.bindingCode })
    expect(jobB).toMatchObject({ tenantId: tenant.id, businessId: businessB.id, channelAccountId: oaB.bindingCode })
  })

  it('archives an unmentioned group message without admitting a reply job', async () => {
    const oa = await account()
    const incoming = event('group', { source: { type: 'group', groupId: 'group-job', userId: 'group-job-user' } })
    const result = await admit(oa, incoming)
    expect(result).toMatchObject({ skipped: true })
    expect(result.inboundMessageId).toBeTruthy()
    expect(await prisma.lineConversationJob.count({ where: { accountId: oa.id } })).toBe(0)
  })
})

describe('optional Edge compute lease', () => {
  it('leases only the credential business and exposes a minimized payload without transport or user secrets', async () => {
    const oaB = await account({ executionMode: 'EDGE', businessId: businessB.id })
    const oaA = await account({ executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY' })
    const b = await admit(oaB, event('edge-b'))
    const a = await admit(oaA, event('edge-a'))
    const claimed = await claimEdgeConversation({ deviceContext: deviceA, now: start })
    // Actual durable Server producer -> actual Edge runtime validator, no constructed envelope.
    expect(conversationEnvelope.safeParse(claimed).success).toBe(true)
    expect(conversationEnvelope.safeParse({ ...claimed, job: { ...claimed.job, replyToken: 'synthetic-forbidden' } }).success).toBe(false)
    expect(conversationEnvelope.safeParse({ ...claimed, contractVersion: 'unsupported' }).success).toBe(false)
    expect(claimed).toMatchObject({ contractVersion: '1', job: { id: a.jobId, question: 'question edge-a', policy: { modelAccess: 'LOCAL_ONLY', retainHistory: false } } })
    expect(Object.keys(claimed.job).sort()).toEqual(['conversationKey', 'id', 'leaseExpiresAt', 'policy', 'question', 'version'])
    const serialized = JSON.stringify(claimed)
    for (const secret of ['token-edge-a', 'user-edge-a', oaA.bindingCode, 'sealedReplyToken', 'recipientId', 'sourceUserId', 'channelAccessToken']) expect(serialized).not.toContain(secret)
    expect((await row(b.jobId)).status).toBe('QUEUED')
    const completion = { version: claimed.job.version, text: 'local answer' }
    await expect(completeEdgeConversation(a.jobId, { ...completion, businessId: businessB.id, deviceContext: deviceB }, { deviceContext: deviceA, now: start })).rejects.toThrow()
    expect((await row(a.jobId)).status).toBe('CLAIMED')
    await expect(completeEdgeConversation(a.jobId, completion, { deviceContext: deviceB, now: start })).rejects.toMatchObject({ status: 404 })
    await expect(completeEdgeConversation(a.jobId, completion, { deviceContext: deviceA2, now: start })).rejects.toMatchObject({ status: 409 })
    await expect(completeEdgeConversation(a.jobId, { ...completion, version: completion.version - 1 }, { deviceContext: deviceA, now: start })).rejects.toMatchObject({ status: 409 })
    expect((await completeEdgeConversation(a.jobId, completion, { deviceContext: deviceA, now: start })).status).toBe('READY')
    await expect(completeEdgeConversation(a.jobId, completion, { deviceContext: deviceA, now: start })).rejects.toMatchObject({ status: 409 })
  })

  it('releases an expired lease and fences the stale device completion', async () => {
    const oa = await account({ executionMode: 'EDGE' })
    const admitted = await admit(oa, event('edge-expiry'))
    const first = await claimEdgeConversation({ deviceContext: deviceA, now: start })
    const afterLease = later(LINE_JOB_LEASE_MS + 1)
    const second = await claimEdgeConversation({ deviceContext: deviceA2, now: afterLease })
    expect(second.job.id).toBe(admitted.jobId)
    expect(second.job.version).toBeGreaterThan(first.job.version)
    await expect(completeEdgeConversation(admitted.jobId, { version: first.job.version, text: 'stale answer' }, { deviceContext: deviceA, now: afterLease })).rejects.toMatchObject({ status: 409 })
  })
})

describe('server transport and acceptance recovery', () => {
  it('generates once, replies once, and records inbound + accepted outbound without an Edge', async () => {
    const oa = await account()
    const admitted = await admit(oa, event('server-answer'))
    const options = worker()
    expect(await runLineConversationWorker(options)).toMatchObject({ id: admitted.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(options.answer).toHaveBeenCalledTimes(1)
    expect(options.replyTransport.send).toHaveBeenCalledWith(expect.objectContaining({ replyToken: 'token-server-answer', messages: [{ type: 'text', text: 'answer from the server' }] }))
    expect(options.pushTransport.send).not.toHaveBeenCalled()
    const job = await row(admitted.jobId)
    expect(job).toMatchObject({ status: 'RECORDED', attempts: 1, sealedReplyToken: null, providerRequestId: 'accepted-request' })
    const inbound = await prisma.message.findUnique({ where: { id: admitted.inboundMessageId } })
    const messages = await prisma.message.findMany({ where: { conversationId: inbound.conversationId } })
    expect(messages.map(message => message.direction).sort()).toEqual(['INBOUND', 'OUTBOUND'])
    expect(await runLineConversationWorker(options)).toEqual({ status: 'IDLE' })
    expect(options.answer).toHaveBeenCalledTimes(1)
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
  })

  it('never retries an ambiguous Reply or silently falls back to Push', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('reply-unknown'))
    const options = worker({ replyTransport: { send: vi.fn(async () => { throw new Error('connection ended after upload') }) } })
    expect(await runLineConversationWorker(options)).toMatchObject({ status: 'UNKNOWN' })
    expect(await runLineConversationWorker({ ...options, now: () => later(60_000) })).toMatchObject({ status: 'IDLE' })
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
    expect(options.pushTransport.send).not.toHaveBeenCalled()
    expect(options.answer).toHaveBeenCalledTimes(1)
    expect((await row(admitted.jobId)).sealedReplyToken).toBeNull()
    expect(await prisma.message.count({ where: { externalMessageId: `reply:${admitted.inboundMessageId}` } })).toBe(0)
  })

  it('falls back a definitively dead Reply token to delayed Push without recomputing the answer', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('reply-dead-token-push'))
    const options = worker({ replyTransport: { send: vi.fn(async () => ({ status: 'PERMANENT_FAILURE', code: 'LINE_HTTP_400', requestId: 'reply-400-request' })) } })
    expect(await runLineConversationWorker(options)).toMatchObject({ id: admitted.jobId, status: 'READY' })
    const first = await row(admitted.jobId)
    expect(first).toMatchObject({ status: 'READY', sendMethod: 'PUSH', attempts: 1, errorCode: 'LINE_HTTP_400' })
    expect(first.sealedReplyToken).toBeNull()
    expect(await runLineConversationWorker({ ...options, now: () => later(60_000) })).toMatchObject({ id: admitted.jobId, status: 'RECORDED' })
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
    expect(options.pushTransport.send).toHaveBeenCalledTimes(1)
    expect(options.answer).toHaveBeenCalledTimes(1)
    expect((await row(admitted.jobId)).sealedReplyToken).toBeNull()
  })

  it('keeps a dead Reply token terminal when the account does not allow delayed Push', async () => {
    const oa = await account()
    const admitted = await admit(oa, event('reply-dead-token-no-push'))
    const options = worker({ replyTransport: { send: vi.fn(async () => ({ status: 'PERMANENT_FAILURE', code: 'LINE_HTTP_400', requestId: 'reply-400-request' })) } })
    expect(await runLineConversationWorker(options)).toMatchObject({ id: admitted.jobId, status: 'FAILED' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'LINE_HTTP_400', sendMethod: 'REPLY' })
    expect(options.pushTransport.send).not.toHaveBeenCalled()
  })

  it.each(['LINE_HTTP_401', 'LINE_HTTP_403', 'LINE_HTTP_404'])('never switches method for a credential/config error (%s)', async (code) => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event(`reply-credential-${code}`))
    const options = worker({ replyTransport: { send: vi.fn(async () => ({ status: 'PERMANENT_FAILURE', code, requestId: 'credential-request' })) } })
    expect(await runLineConversationWorker(options)).toMatchObject({ id: admitted.jobId, status: 'FAILED' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'FAILED', errorCode: code, sendMethod: 'REPLY' })
    expect(options.pushTransport.send).not.toHaveBeenCalled()
  })

  it('never switches method for an ambiguous 5xx Reply outcome', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('reply-ambiguous-503'))
    const options = worker({ replyTransport: { send: vi.fn(async () => ({ status: 'UNKNOWN', code: 'LINE_HTTP_503' })) } })
    expect(await runLineConversationWorker(options)).toMatchObject({ id: admitted.jobId, status: 'UNKNOWN' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'UNKNOWN', errorCode: 'LINE_HTTP_503', sendMethod: 'REPLY' })
    expect(options.pushTransport.send).not.toHaveBeenCalled()
    expect(await runLineConversationWorker({ ...options, now: () => later(60_000) })).toMatchObject({ status: 'IDLE' })
    expect(options.pushTransport.send).not.toHaveBeenCalled()
  })

  it('does not loop a Push that itself comes back with a dead-token-shaped failure', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('push-dead-code-no-loop'))
    const options = worker({ now: () => later(60_000), pushTransport: { send: vi.fn(async () => ({ status: 'PERMANENT_FAILURE', code: 'LINE_HTTP_400', requestId: 'push-400-request' })) } })
    expect(await runLineConversationWorker(options)).toMatchObject({ id: admitted.jobId, status: 'FAILED' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'LINE_HTTP_400', sendMethod: 'PUSH' })
    expect(options.replyTransport.send).not.toHaveBeenCalled()
  })

  it('retries delayed Push with its original UUID and without re-running the model', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('push-retry'))
    const push = vi.fn().mockResolvedValueOnce({ status: 'RETRYABLE_FAILURE', code: 'LINE_RATE_LIMIT' })
      .mockResolvedValueOnce({ status: 'ACCEPTED_BY_LINE', requestId: 'push-retry-accepted' })
    const options = worker({ now: () => later(60_000), pushTransport: { send: push } })
    expect(await runLineConversationWorker(options)).toMatchObject({ status: 'READY' })
    const first = await row(admitted.jobId)
    expect(first).toMatchObject({ sendMethod: 'PUSH', attempts: 1 })
    expect(await runLineConversationWorker({ ...options, now: () => later(62_000) })).toMatchObject({ status: 'RECORDED' })
    expect(push).toHaveBeenCalledTimes(2)
    expect(push.mock.calls[0][0].retryKey).toBe(first.retryKey)
    expect(push.mock.calls[1][0].retryKey).toBe(first.retryKey)
    expect(first.retryKey).toMatch(/^[a-f0-9-]{36}$/)
    expect((await row(admitted.jobId)).firstSendAt).toEqual(first.firstSendAt)
    expect(options.answer).toHaveBeenCalledTimes(1)
    expect(options.replyTransport.send).not.toHaveBeenCalled()
  })

  it('repairs an accepted send after CRM persistence fails without calling LINE again', async () => {
    const oa = await account()
    const admitted = await admit(oa, event('acceptance-repair'))
    let failOnce = true
    const db = failingTransaction('message', 'create', args => {
      if (args.data.direction !== 'OUTBOUND' || !failOnce) return false
      failOnce = false
      return true
    }, 'OUTBOUND_WRITE_FAILED')
    const options = worker({ db })
    await expect(runLineConversationWorker(options)).rejects.toThrow('OUTBOUND_WRITE_FAILED')
    expect((await row(admitted.jobId)).status).toBe('ACCEPTED')
    expect(await prisma.message.count({ where: { externalMessageId: `reply:${admitted.inboundMessageId}` } })).toBe(0)
    expect(await runLineConversationWorker({ ...options, db: prisma })).toMatchObject({ status: 'RECORDED' })
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
    expect(options.answer).toHaveBeenCalledTimes(1)
    expect(await prisma.message.count({ where: { externalMessageId: `reply:${admitted.inboundMessageId}` } })).toBe(1)
  })

  it('fences an ownership epoch change between computing the answer and claiming send', async () => {
    const oa = await account()
    const admitted = await admit(oa, event('ownership-fence'))
    const options = worker({ resolveAccount: vi.fn(async id => prisma.lineOaAccount.update({ where: { id }, data: { transportEpoch: { increment: 1 }, serverEnabled: false } })) })
    expect(await runLineConversationWorker(options)).toMatchObject({ status: 'FENCED' })
    expect(options.replyTransport.send).not.toHaveBeenCalled()
    expect(options.pushTransport.send).not.toHaveBeenCalled()
    expect((await row(admitted.jobId)).attempts).toBe(0)
    expect(await runLineConversationWorker(options)).toMatchObject({ status: 'CANCELLED' })
    expect((await row(admitted.jobId)).sealedReplyToken).toBeNull()
  })

  it('blocks admission and Edge completion after account ownership changes', async () => {
    const oa = await account({ executionMode: 'EDGE' })
    const admitted = await admit(oa, event('ownership-admission'))
    const lease = await claimEdgeConversation({ deviceContext: deviceA, now: start })
    await prisma.lineOaAccount.update({ where: { id: oa.id }, data: { transportEpoch: { increment: 1 } } })
    await expect(admit(oa, event('new-after-epoch'))).rejects.toMatchObject({ status: 409 })
    await expect(completeEdgeConversation(admitted.jobId, { version: lease.job.version, text: 'old owner answer' }, { deviceContext: deviceA, now: start })).rejects.toMatchObject({ status: 409 })
  })
})


describe('operational closure and restart recovery', () => {
  it('isolates a pre-send credential failure so another business still sends in the same tick', async () => {
    // The property under test — one revoked OA cannot starve the shared queue — is unchanged. What
    // moved is how strongly it holds: this said "on the next tick" until 2026-09-10, because a tick
    // sent exactly one job and the poisoned one consumed it. Now the batch steps over the failure
    // and the healthy business is served without waiting for another round.
    const brokenAccount = await account()
    const healthyAccount = await account({ businessId: businessB.id })
    const broken = await admit(brokenAccount, event('poison-credential'))
    const healthy = await admit(healthyAccount, event('healthy-after-poison'))
    const options = worker({ resolveAccount: vi.fn(async id => {
      if (id === brokenAccount.id) throw new Error('sensitive revoked credential')
      return prisma.lineOaAccount.findUnique({ where: { id } })
    }) })
    expect(await runLineConversationWorker(options)).toMatchObject({ id: healthy.jobId, status: 'RECORDED', sent: 2 })
    expect(await row(broken.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'LINE_ACCOUNT_UNAVAILABLE', attempts: 0 })
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
    expect(await runLineConversationWorker(options)).toEqual({ status: 'IDLE' })
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(await row(broken.jobId))).not.toContain('sensitive revoked credential')
  })

  it('keeps an attempted Push UNKNOWN if its credential is revoked before reconciliation', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('push-revoked-credential'))
    const options = worker({ now: () => later(60_000), pushTransport: { send: vi.fn(async () => ({ status: 'RETRYABLE_FAILURE' })) } })
    await runLineConversationWorker(options)
    expect(await row(admitted.jobId)).toMatchObject({ status: 'READY', attempts: 1 })
    await runLineConversationWorker({ ...options, now: () => later(62_000), resolveAccount: async () => { throw new Error('revoked') } })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'UNKNOWN', errorCode: 'LINE_ACCOUNT_UNAVAILABLE', attempts: 1 })
    expect(options.pushTransport.send).toHaveBeenCalledTimes(1)
    expect(await prisma.message.count({ where: { externalMessageId: `reply:${admitted.inboundMessageId}` } })).toBe(0)
  })

  it('blocks ownership handoff while a READY Push has an unconfirmed previous attempt', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('push-handoff-fence'))
    const options = worker({ now: () => later(60_000), pushTransport: { send: vi.fn(async () => ({ status: 'RETRYABLE_FAILURE' })) } })
    await runLineConversationWorker(options)
    const pending = await row(admitted.jobId)
    expect(pending).toMatchObject({ status: 'READY', sendMethod: 'PUSH', attempts: 1 })
    expect(pending.firstSendAt).not.toBeNull()
    const current = await prisma.lineOaAccount.findUnique({ where: { id: oa.id } })
    const publisher = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: ['line-oa'] })
    for (const change of [
      { action: 'DISABLE_SERVER' },
      { action: 'SWITCH_TRANSPORT_MODE', transportMode: 'EDGE' },
      { action: 'PAUSE' },
    ]) {
      await expect(applyLineOaAccountAction(oa.id, { ...change, version: current.version }, { viewer: publisher })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_DELIVERY_RECONCILIATION_REQUIRED' })
    }
    expect(await prisma.lineOaAccount.findUnique({ where: { id: oa.id } })).toMatchObject({ version: current.version, transportEpoch: current.transportEpoch, serverEnabled: true, transportMode: 'CLOUD' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'READY', attempts: 1, retryKey: pending.retryKey })
    expect(options.pushTransport.send).toHaveBeenCalledTimes(1)
  })

  it('allows only the scoped publisher to acknowledge UNKNOWN without sending or fabricating CRM output', async () => {
    const oa = await account()
    const admitted = await admit(oa, event('ack-unknown'))
    const options = worker({ replyTransport: { send: vi.fn(async () => ({ status: 'UNKNOWN' })) } })
    await runLineConversationWorker(options)
    const unknown = await row(admitted.jobId)
    const payload = { version: unknown.version, acknowledgePossibleDelivery: true }
    const member = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [], visibleDomains: ['line-oa'] })
    const foreignPublisher = makeViewer({ visibleBusinessIds: [businessA.id, businessB.id], ownedBusinessIds: [], visibleDomains: ['line-oa'], rolesByBusinessId: { [businessB.id]: [ROLE_LINE_OA_PUBLISHER] } })
    const publisher = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [], visibleDomains: ['line-oa'], rolesByBusinessId: { [businessA.id]: [ROLE_LINE_OA_PUBLISHER] } })
    for (const viewer of [member, foreignPublisher]) {
      await expect(acknowledgeUnknownLineJob(unknown.id, payload, { viewer })).rejects.toMatchObject({ status: 404 })
    }
    await expect(acknowledgeUnknownLineJob(unknown.id, { ...payload, version: unknown.version - 1 }, { viewer: publisher })).rejects.toMatchObject({ status: 409 })
    expect(await acknowledgeUnknownLineJob(unknown.id, payload, { viewer: publisher })).toEqual({ id: unknown.id, status: 'CANCELLED', delivery: 'UNKNOWN' })
    await runLineConversationWorker(options)
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
    expect(options.pushTransport.send).not.toHaveBeenCalled()
    expect(await prisma.message.count({ where: { externalMessageId: `reply:${admitted.inboundMessageId}` } })).toBe(0)
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: unknown.id, action: 'UNKNOWN_ACKNOWLEDGED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ businessId: businessA.id, possibleDelivery: true })
    expect((await row(unknown.id)).errorCode).toBe('OPERATOR_ACKNOWLEDGED_UNKNOWN')
  })

  it('stops a Push after its retry window and keeps the outcome UNKNOWN', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('push-expired-window'))
    const options = worker({ now: () => later(60_000), pushTransport: { send: vi.fn(async () => ({ status: 'RETRYABLE_FAILURE' })) } })
    await runLineConversationWorker(options)
    expect(await runLineConversationWorker({ ...options, now: () => later(60_000 + 23 * 60 * 60_000) })).toMatchObject({ status: 'STOPPED' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'UNKNOWN', errorCode: 'PUSH_RETRY_WINDOW_EXPIRED', attempts: 1 })
    expect(options.pushTransport.send).toHaveBeenCalledTimes(1)
  })

  it('recovers an expired SENDING Reply as UNKNOWN without another external attempt', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('reply-sending-crash'))
    await prisma.lineConversationJob.update({ where: { id: admitted.jobId }, data: {
      status: 'SENDING', answerText: 'already prepared', sendMethod: 'REPLY', attempts: 1,
      firstSendAt: start, claimantId: 'crashed-worker', leaseExpiresAt: later(30_000),
    } })
    const options = worker({ now: () => later(31_000) })
    expect(await runLineConversationWorker(options)).toMatchObject({ status: 'IDLE' })
    expect(await row(admitted.jobId)).toMatchObject({ status: 'UNKNOWN', errorCode: 'REPLY_OUTCOME_UNKNOWN', sealedReplyToken: null })
    expect(options.answer).not.toHaveBeenCalled()
    expect(options.replyTransport.send).not.toHaveBeenCalled()
    expect(options.pushTransport.send).not.toHaveBeenCalled()
  })

  it('recovers an expired SENDING Push using its saved retry key even after execution TTL', async () => {
    const oa = await account({ allowDelayedPush: true })
    const admitted = await admit(oa, event('push-sending-crash'))
    const saved = await prisma.lineConversationJob.update({ where: { id: admitted.jobId }, data: {
      status: 'SENDING', answerText: 'saved answer', sendMethod: 'PUSH', attempts: 1,
      firstSendAt: start, claimantId: 'crashed-worker', leaseExpiresAt: later(30_000),
    } })
    const options = worker({ now: () => later(31 * 60_000) })
    expect(await runLineConversationWorker(options)).toMatchObject({ status: 'RECORDED' })
    expect(options.pushTransport.send).toHaveBeenCalledWith(expect.objectContaining({ retryKey: saved.retryKey, messages: [{ type: 'text', text: 'saved answer' }] }))
    expect(options.answer).not.toHaveBeenCalled()
    expect(options.replyTransport.send).not.toHaveBeenCalled()
    expect((await row(admitted.jobId)).attempts).toBe(2)
  })
  it('principal erasure cancels copied job content and prevents subsequent sends', async () => {
    const oa = await account()
    const admitted = await admit(oa, event('erasure-job'))
    const inbound = await prisma.message.findUnique({ where: { id: admitted.inboundMessageId }, include: { conversation: { include: { customer: true } } } })
    await prisma.lineConversationJob.update({ where: { id: admitted.jobId }, data: { status: 'READY', answerText: 'private answer' } })
    await erasePrincipal({ tenantId: tenant.id, personId: inbound.conversation.customer.personId, reason: 'TEST_ERASURE' })
    const erased = await row(admitted.jobId)
    expect(erased).toMatchObject({ status: 'CANCELLED', answerText: null, recipientId: '[erased]', sourceUserId: '[erased]', sealedReplyToken: null, errorCode: 'PDPA_ERASURE' })
    const options = worker()
    await runLineConversationWorker(options)
    expect(options.replyTransport.send).not.toHaveBeenCalled()
    expect(options.pushTransport.send).not.toHaveBeenCalled()
  })

})

describe('one tick serves more than one customer', () => {

  // Until 2026-09-10 a tick claimed exactly one job, ran the model call inside itself, and
  // returned. Two people who wrote at the same moment were therefore answered strictly in series:
  // the second waited out the first's entire answer, up to the ticker's 240 s request timeout. The
  // durable side was never the limit — ADR-061 D6 has required compare-and-set versions and bounded
  // leases from the start, and `claimExecution` already read twenty candidates.
  it('answers concurrently — the second customer no longer waits out the first', async () => {
    const oa = await account()
    // Sequentially, not Promise.all: the concurrency under test is the worker's, and six
    // simultaneous admission transactions against the suite's single SQLite file only buys a
    // busy-timeout on a slow runner — which is exactly how this failed on CI once.
    const admitted = []
    for (const id of ['fan-a', 'fan-b', 'fan-c']) admitted.push(await admit(oa, event(id)))
    let started = 0
    let openGate
    const gate = new Promise(resolve => { openGate = resolve })
    // Each answer refuses to finish until all three have begun. Under the old serial tick the first
    // answer could never be released, because nothing else was able to start while it was awaited —
    // so this test fails (loudly, not by hanging) the moment execution stops overlapping.
    const allStarted = Promise.race([gate, new Promise((_, reject) => {
      setTimeout(() => reject(new Error('EXECUTION_DID_NOT_OVERLAP')), 5_000).unref?.()
    })])
    const options = worker({ answer: vi.fn(async () => {
      started += 1
      if (started === 3) openGate()
      await allStarted
      return { text: 'answer from the server' }
    }) })
    const result = await runLineConversationWorker(options)
    expect(started).toBe(3)
    expect(options.answer).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ executed: 3, sent: 3 })
    // All three were answered and delivered inside the one tick, not one per tick.
    expect(options.replyTransport.send).toHaveBeenCalledTimes(3)
    for (const job of admitted) expect(await row(job.jobId)).toMatchObject({ status: 'RECORDED', attempts: 1 })
  })

  it('honours the configured ceilings rather than draining whatever the backlog happens to be', async () => {
    // Every answer is a metered model call, so a tick that walks into a backlog must cost a bounded
    // amount. Six waiting, two allowed: exactly two answered, and — because only those two became
    // READY — exactly two sent.
    const oa = await account()
    const ids = ['cap-a', 'cap-b', 'cap-c', 'cap-d', 'cap-e', 'cap-f']
    for (const id of ids) await admit(oa, event(id))
    const options = worker({ executionConcurrency: 2, sendBatch: 2 })
    expect(await runLineConversationWorker(options)).toMatchObject({ executed: 2, sent: 2 })
    expect(options.answer).toHaveBeenCalledTimes(2)
    expect(await prisma.lineConversationJob.count({ where: { accountId: oa.id, status: 'QUEUED' } })).toBe(4)
  })

  it('rejects a nonsense override instead of letting a typo set the concurrency', async () => {
    // These are deployment environment variables, i.e. operator input, and `Number('')` is 0.
    const oa = await account()
    await admit(oa, event('override-guard'))
    const options = worker({ env: { ...env, ZURI_LINE_WORKER_EXECUTION_CONCURRENCY: '', ZURI_LINE_WORKER_SEND_BATCH: 'lots' } })
    expect(await runLineConversationWorker(options)).toMatchObject({ executed: 1, sent: 1 })
  })

  it('still reports an empty queue as exactly IDLE, because that is what the ticker backs off on', async () => {
    expect(await runLineConversationWorker(worker())).toEqual({ status: 'IDLE' })
  })

  it('does not abandon the rest of the batch when the first answer fails', async () => {
    // The old tick returned the moment an answer threw, so a model outage while customer A was
    // being served left customer B untouched until the next tick — and the tick after that, if A
    // was still first in line. Now the failure is settled onto its own job and the batch continues.
    const oa = await account()
    const first = await admit(oa, event('mixed-a'))
    const second = await admit(oa, event('mixed-b'))
    const options = worker({ answer: vi.fn(async job => {
      if (job.inbound.body.includes('mixed-a')) throw new Error('MODEL_UNAVAILABLE')
      return { text: 'answer from the server' }
    }) })
    const result = await runLineConversationWorker(options)
    expect(options.answer).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ executed: 2, sent: 1 })
    expect(await row(first.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'EXECUTION_FAILED' })
    expect(await row(second.jobId)).toMatchObject({ status: 'RECORDED' })
    expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
  })
})
