import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { updateItem } from '@/modules/project-manager/application/work-service'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { executeEdgeProjectWorkTool } from '@/modules/agent/edge-project-work-tools'
import { validateEdgeMemoryInvocation } from '@/modules/agent/edge-memory-invocation'
import { drainEdgeInvocationTraces } from '@/modules/agent/edge-invocation-trace'
import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { searchLineProjectWork, proposeLineWork, confirmLineWork, handleLineProjectWorkCommand } from '@/modules/agent/line-project-work-tools'

// @req FR-026, FR-072, FR-150 — real isolated SQLite confirms permission, confirmation,
// stale version, channel binding, replay and canonical writer transaction behavior.
// @spec SEC-001, SEC-008, ADR-061
let tenant, business, otherBusiness, account, person, owner, stream, otherStream, membership
const subject = 'U-line-work-owner'
const at = new Date()
async function job(body, over = {}) {
  const sourceUserId = over.sourceUserId ?? subject
  const eventId = randomUUID()
  const inbound = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id,
    channelAccountId: account.bindingCode, lineUserId: sourceUserId, threadId: sourceUserId,
    externalMessageId: eventId, text: body })
  return prisma.lineConversationJob.create({ data: { accountId: account.id, inboundMessageId: inbound.messageId,
    eventId, tenantId: tenant.id, businessId: business.id, channelAccountId: account.bindingCode,
    transportEpoch: account.transportEpoch, executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY',
    status: 'CLAIMED', leaseExpiresAt: new Date(at.getTime() + 600000), executionId: randomUUID(), claimantId: 'edge-work-credential',
    recipientId: sourceUserId, sourceUserId, correlationId: randomUUID(), expiresAt: new Date(at.getTime() + 600000), ...over },
    include: { inbound: { include: { conversation: true } } } })
}
async function proposal(title = 'New LINE work') {
  const request = await job(`/work-create ${stream.id} ${title}`)
  return proposeLineWork(request.id, { action: 'create_work', targetId: stream.id, args: { title } }, { now: at })
}
async function toolJob(body, over = {}, { mode = 'REPLY', deadline = new Date(at.getTime() + 35000) } = {}) {
  const request = await job(body, over)
  await appendTraceEvent(prisma, { scope: { tenantId: tenant.id, businessId: business.id }, turnId: request.id,
    executionId: request.executionId, kind: 'CONTEXT_COMMITTED', idempotencyKey: `${request.id}:execution:${request.executionId}:contract`,
    payload: { contractVersion: '2', executionBudget: { deliveryMode: mode, answerDeadlineAt: deadline.toISOString() } } })
  return request
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'LINE Work', code: 'PF-LINE-WORK' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'LINE Work tenant', code: 'TNT-LINE-WORK' })
  business = await createBusiness({ tenantId: tenant.id, name: 'LINE Work business', code: 'BUS-LINE-WORK' })
  otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other Work business', code: 'BUS-LINE-WORK-OTHER' })
  owner = makeViewer({ visibleBusinessIds: [business.id, otherBusiness.id], ownedBusinessIds: [business.id, otherBusiness.id] })
  const workspace = await createWorkspace({ name: 'LINE Work WS', code: 'WS-LINE-WORK', scopeType: 'BUSINESS', businessId: business.id })
  const project = await createProject({ workspaceId: workspace.id, name: 'LINE Work project', code: 'PRJ-LINE-WORK' }, { viewer: owner })
  stream = await createWorkstream({ projectId: project.id, name: 'LINE Work stream', code: 'WST-LINE-WORK', executionMode: 'SOFTWARE_SPRINT' }, { viewer: owner })
  const otherWorkspace = await createWorkspace({ name: 'Other Work WS', code: 'WS-LINE-WORK-OTHER', scopeType: 'BUSINESS', businessId: otherBusiness.id })
  const otherProject = await createProject({ workspaceId: otherWorkspace.id, name: 'Secret other project', code: 'PRJ-LINE-WORK-OTHER' }, { viewer: owner })
  otherStream = await createWorkstream({ projectId: otherProject.id, name: 'Secret stream', code: 'WST-LINE-WORK-OTHER', executionMode: 'SOFTWARE_SPRINT' }, { viewer: owner })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'LINE Work', externalAccountId: 'line-work-test', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: 'line-work-test', bindingCode: 'line-work-test', displayName: 'LINE Work OA', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY' } })
  person = await prisma.person.create({ data: { code: 'PSN-LINE-WORK', displayName: 'Work owner' } })
  membership = await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  const link = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
  await redeemLinkToken({ tenantId: tenant.id, token: link.token, lineUserId: subject })
  await resolveLineIdentity({ tenantId: tenant.id, lineUserId: subject, channelAccountId: account.bindingCode })
})

describe('LINE Project / Work tools', () => {
  it('does not write before confirmation, retries preview deterministically, commits and replays once', async () => {
    const before = await prisma.workItem.count()
    const proposed = await proposal()
    expect(await prisma.workItem.count()).toBe(before)
    const duplicatePreview = await proposeLineWork(proposed.proposalId, { action: 'create_work', targetId: stream.id, args: { title: 'New LINE work' } }, { now: at })
    expect(duplicatePreview).toEqual(proposed)
    const confirmation = await job(`ยืนยันงาน ${proposed.proposalId}`)
    const result = await confirmLineWork(confirmation.id, proposed.proposalId, { now: at })
    expect(result).toMatchObject({ action: 'create_work', status: 'PLANNED', version: 1 })
    expect(await prisma.workItem.count()).toBe(before + 1)
    const replay = await confirmLineWork(confirmation.id, proposed.proposalId, { now: at })
    expect(replay).toEqual({ ...result, duplicate: true })
    expect(await prisma.workItem.count()).toBe(before + 1)
    expect(await prisma.auditEvent.count({ where: { entityType: 'WORK_ITEM', entityId: result.itemId, action: 'CREATED' } })).toBe(1)
  })

  it('search stays inside OA Business and does not expose other projects', async () => {
    const request = await job('/projects')
    const result = await searchLineProjectWork(request.id, { kind: 'projects' }, { now: at })
    expect(result.items.map(p => p.code)).toEqual(['PRJ-LINE-WORK'])
    expect(result.source).toBe('PROJECT_MANAGER')
    expect(result.observedAt).toBe(at.toISOString())
    expect(result.items.every(item => item.sourceRef === item.id && item.version > 0)).toBe(true)
    await expect(proposeLineWork(request.id, { action: 'create_work', targetId: otherStream.id, args: { title: 'Cross business' } }, { now: at })).rejects.toThrow()
  })

  it('requires actual human confirmation text; model cannot confirm', async () => {
    const proposed = await proposal('Cannot auto-confirm')
    const request = await job('please do it')
    await expect(confirmLineWork(request.id, proposed.proposalId, { now: at })).rejects.toThrow('WORK_CONFIRMATION_REQUIRED')
  })

  it('rejects expired confirmation and stale target after preview', async () => {
    const proposed = await proposal('Expired')
    const request = await job(`ยืนยันงาน ${proposed.proposalId}`)
    await expect(confirmLineWork(request.id, proposed.proposalId, { now: new Date(at.getTime() + 300001) })).rejects.toThrow('WORK_CONFIRMATION_EXPIRED')
    const stale = await proposal('Stale')
    await prisma.workstream.update({ where: { id: stream.id }, data: { version: { increment: 1 } } })
    const staleRequest = await job(`ยืนยันงาน ${stale.proposalId}`)
    await expect(confirmLineWork(staleRequest.id, stale.proposalId, { now: at })).rejects.toThrow('WORK_VERSION_CONFLICT')
    expect(await prisma.auditEvent.findUnique({ where: { id: `line-work-executed:${stale.proposalId}` } })).toBeNull()
  })

  it('rechecks membership at confirmation and rejects unverified identities and groups', async () => {
    const proposed = await proposal('Revoked authority')
    const request = await job(`ยืนยันงาน ${proposed.proposalId}`)
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'REVOKED' } })
    await expect(confirmLineWork(request.id, proposed.proposalId, { now: at })).rejects.toThrow('WORK_SCOPE_DENIED')
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } })
    const stranger = await job('/projects', { sourceUserId: 'U-unlinked-work' })
    await expect(searchLineProjectWork(stranger.id, {}, { now: at })).rejects.toThrow('WORK_IDENTITY_REQUIRED')
    const group = await job('/projects', { audienceKind: 'GROUP' })
    await expect(searchLineProjectWork(group.id, {}, { now: at })).rejects.toThrow('WORK_SCOPE_DENIED')
  })

  it('updates through canonical writer only after confirmation; conflicts do not consume receipt', async () => {
    const proposed = await proposal('Updatable')
    const createConfirm = await job(`ยืนยันงาน ${proposed.proposalId}`)
    const created = await confirmLineWork(createConfirm.id, proposed.proposalId, { now: at })
    const request = await job(`/work-update ${created.itemId} {"status":"DONE"}`)
    const preview = await proposeLineWork(request.id, { action: 'update_work', targetId: created.itemId, args: { status: 'DONE' } }, { now: at })
    expect((await prisma.workItem.findUnique({ where: { id: created.itemId } })).status).toBe('PLANNED')
    const confirm = await job(`ยืนยันงาน ${preview.proposalId}`)
    const result = await confirmLineWork(confirm.id, preview.proposalId, { now: at })
    expect(result.status).toBe('DONE')
    await expect(updateItem(created.itemId, { title: 'Stale' }, { viewer: owner, expectedVersion: 1 })).rejects.toThrow('WORK_VERSION_CONFLICT')
  })

  it('remote Edge tools fence scope/version/lease and never expose an execution tool', async () => {
    const request = await toolJob('/projects')
    const deviceContext = { isEdgeDevice: true, credentialId: request.claimantId, tenantId: tenant.id, businessId: business.id }
    const input = { version: request.version, executionId: request.executionId, toolName: 'search_project_work', args: { kind: 'projects' } }
    const result = await executeEdgeProjectWorkTool(request.id, input, { deviceContext, now: at })
    expect(result.result.items.map(item => item.code)).toEqual(['PRJ-LINE-WORK'])
    await drainEdgeInvocationTraces()
    const rows = await prisma.agentTraceEvent.findMany({ where: { turnId: request.id, kind: { not: 'CONTEXT_COMMITTED' } }, orderBy: { createdAt: 'asc' } })
    expect(rows.map(row => row.kind)).toEqual(['TOOL_INVOKED', 'TOOL_RESULT'])
    const payloads = rows.map(row => JSON.parse(row.payloadJson))
    expect(payloads.map(payload => payload.phase)).toEqual(['STARTED', 'COMPLETED'])
    expect(payloads[0].toolInvocationId).toBe(payloads[1].toolInvocationId)
    expect(payloads.every(payload => Object.keys(payload).sort().join(',') === 'evidenceSource,phase,toolInvocationId,toolName')).toBe(true)
    await expect(executeEdgeProjectWorkTool(request.id, { ...input, version: 99 }, { deviceContext, now: at })).rejects.toMatchObject({ status: 409 })
    await expect(executeEdgeProjectWorkTool(request.id, input, { deviceContext: { ...deviceContext, businessId: otherBusiness.id }, now: at })).rejects.toMatchObject({ status: 409 })
    await expect(executeEdgeProjectWorkTool(request.id, { ...input, toolName: 'confirm_work' }, { deviceContext, now: at })).rejects.toThrow()
    await prisma.lineConversationJob.update({ where: { id: request.id }, data: { leaseExpiresAt: new Date(at.getTime() - 1) } })
    await expect(executeEdgeProjectWorkTool(request.id, input, { deviceContext, now: at })).rejects.toMatchObject({ status: 409 })
    await drainEdgeInvocationTraces()
    expect(await prisma.agentTraceEvent.count({ where: { turnId: request.id } })).toBe(3)
  })

  it('journals tool failures without copying arguments, output, or internal failure messages', async () => {
    const request = await toolJob('private inbound', { sourceUserId: 'U-unlinked-telemetry' })
    await expect(executeEdgeProjectWorkTool(request.id, { version: request.version, executionId: request.executionId,
      toolName: 'search_project_work', args: { kind: 'projects', query: 'private search' } }, {
      deviceContext: { isEdgeDevice: true, credentialId: request.claimantId, tenantId: tenant.id, businessId: business.id }, now: at,
    })).rejects.toThrow()
    await drainEdgeInvocationTraces()
    const rows = await prisma.agentTraceEvent.findMany({ where: { turnId: request.id, kind: { not: 'CONTEXT_COMMITTED' } }, orderBy: { createdAt: 'asc' } })
    expect(rows.map(row => JSON.parse(row.payloadJson).phase)).toEqual(['STARTED', 'FAILED'])
    expect(JSON.stringify(rows)).not.toContain('private')
    expect(JSON.stringify(rows)).not.toContain('WORK_IDENTITY_REQUIRED')
  })

  it('honors the original delayed-push tool budget and rejects missing, expired or wrong-execution contracts', async () => {
    const delayed = await toolJob('/projects', { allowDelayedPush: true, replyExpiresAt: new Date(at.getTime() - 1000) }, { mode: 'DELAYED_PUSH' })
    const call = (request, now = at) => executeEdgeProjectWorkTool(request.id, { version: request.version, executionId: request.executionId,
      toolName: 'search_project_work', args: { kind: 'projects' } }, {
      deviceContext: { isEdgeDevice: true, credentialId: request.claimantId, tenantId: tenant.id, businessId: business.id }, now,
    })
    expect((await call(delayed)).result.items.length).toBeGreaterThan(0)
    await expect(call(delayed, new Date(at.getTime() + 35000))).rejects.toMatchObject({ status: 409 })
    const missing = await job('/projects')
    await expect(call(missing)).rejects.toMatchObject({ status: 409 })
    const expired = await toolJob('/projects', {}, { deadline: at })
    await expect(call(expired)).rejects.toMatchObject({ status: 409 })
    const wrong = await toolJob('/projects')
    const reclaimed = await prisma.lineConversationJob.update({ where: { id: wrong.id }, data: { executionId: randomUUID() } })
    await expect(call(reclaimed)).rejects.toMatchObject({ status: 409 })
    const crossing = await toolJob('/projects')
    let current = at
    const find = prisma.project.findMany.bind(prisma.project)
    const query = vi.spyOn(prisma.project, 'findMany').mockImplementationOnce(async args => {
      const result = await find(args)
      current = new Date(at.getTime() + 35000)
      return result
    })
    try {
      await expect(call(crossing, () => current)).rejects.toMatchObject({ status: 409 })
      expect(query).toHaveBeenCalledTimes(1)
    } finally { query.mockRestore() }
    await drainEdgeInvocationTraces()
  })

  it('journals live model phases idempotently without fabricating a context receipt or retaining memory', async () => {
    const request = await job('private inbound', { memorySyncOptIn: true, replyExpiresAt: new Date(at.getTime() + 40000) })
    const contextHash = 'a'.repeat(64)
    await appendTraceEvent(prisma, { scope: { tenantId: tenant.id, businessId: business.id }, turnId: request.id,
      executionId: request.executionId, kind: 'CONTEXT_COMMITTED', idempotencyKey: `${request.id}:execution:${request.executionId}:contract`,
      payload: { contractVersion: '2', memoryContextHash: contextHash,
        executionBudget: { deliveryMode: 'REPLY', answerDeadlineAt: new Date(at.getTime() + 35000).toISOString() } } })
    const recordInjection = vi.fn(async () => ({}))
    const contextBuilder = async (_job, options) => {
      options.onContextResolved({ port: { recordInjection }, threadId: 'thread', exchangeId: 'exchange',
        slices: [{ id: 'memory', text: 'private memory' }] })
      return { contextHash }
    }
    for (const state of ['RESOLVED', 'SUBMITTED', 'COMPLETED', 'COMPLETED']) {
      await validateEdgeMemoryInvocation(request.id, { version: request.version, executionId: request.executionId,
        contextHash, injection: { id: 'ctxrcpt_test', modelRef: 'openai-compatible:qwen3.5:9b', state, mspRefs: ['memory'] } }, {
        deviceContext: { isEdgeDevice: true, credentialId: request.claimantId, tenantId: tenant.id, businessId: business.id },
        contextBuilder, now: () => at,
      })
      await drainEdgeInvocationTraces()
    }
    const rows = await prisma.agentTraceEvent.findMany({ where: { turnId: request.id, kind: { not: 'CONTEXT_COMMITTED' } }, orderBy: { createdAt: 'asc' } })
    expect(rows.map(row => row.kind)).toEqual(['EVIDENCE_SELECTED', 'EVIDENCE_SELECTED', 'MODEL_COMPLETED'])
    expect(rows.map(row => JSON.parse(row.payloadJson).phase)).toEqual(['CONTEXT_RESOLVED', 'MODEL_SUBMITTED', 'MODEL_COMPLETED'])
    expect(rows.every(row => row.executionId === request.executionId && row.tenantId === tenant.id && row.businessId === business.id)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('private')
    expect(rows.every(row => Object.keys(JSON.parse(row.payloadJson)).sort().join(',') === 'evidenceSource,modelRef,phase,receiptId,snapshotState')).toBe(true)
    await validateEdgeMemoryInvocation(request.id, { version: request.version, executionId: request.executionId,
      contextHash, injection: { id: 'ctxrcpt_unknown', modelRef: 'openai-compatible:qwen3.5:9b', state: 'UNKNOWN', mspRefs: ['memory'] } }, {
      deviceContext: { isEdgeDevice: true, credentialId: request.claimantId, tenantId: tenant.id, businessId: business.id },
      contextBuilder, now: () => at,
    })
    await drainEdgeInvocationTraces()
    const unknown = await prisma.agentTraceEvent.findFirst({ where: { turnId: request.id,
      idempotencyKey: `${request.id}:${request.executionId}:model:ctxrcpt_unknown:UNKNOWN` } })
    expect(unknown.kind).toBe('EVIDENCE_SELECTED')
    expect(JSON.parse(unknown.payloadJson).phase).toBe('MODEL_UNKNOWN')
  })

  it('binds confirmation to actor/identity epoch and rolls back receipt when writer fails', async () => {
    const proposed = await proposal('Identity changed')
    const request = await job('ยืนยันงาน ' + proposed.proposalId)
    await prisma.channelIdentity.updateMany({ where: { tenantId: tenant.id, channelAccountId: account.bindingCode, providerSubject: subject }, data: { version: { increment: 1 } } })
    await expect(confirmLineWork(request.id, proposed.proposalId, { now: at })).rejects.toThrow('WORK_CONFIRMATION_INVALID')
    const rollback = await proposal('Rollback transaction')
    const confirm = await job('ยืนยันงาน ' + rollback.proposalId)
    const before = await prisma.workItem.count()
    // Force the final immutable receipt insert to conflict, after canonical create.
    await prisma.auditEvent.create({ data: { id: 'line-work-result:' + rollback.proposalId, entityType: 'TEST', entityId: rollback.proposalId, action: 'BLOCK_RESULT' } })
    await expect(confirmLineWork(confirm.id, rollback.proposalId, { now: at })).rejects.toThrow()
    expect(await prisma.workItem.count()).toBe(before)
    expect(await prisma.auditEvent.findUnique({ where: { id: 'line-work-executed:' + rollback.proposalId } })).toBeNull()
  })

  it('LINE command handler returns previews, read results, and null for normal model questions', async () => {
    expect(await handleLineProjectWorkCommand(await job('ราคาแก้วเท่าไร'))).toBeNull()
    const response = await handleLineProjectWorkCommand(await job(`/work-create ${stream.id} Thai task`), { now: at })
    expect(response.text).toContain('รอยืนยัน')
    expect(response.toolReceipt.status).toBe('AWAITING_CONFIRMATION')
    const read = await handleLineProjectWorkCommand(await job('/work'), { now: at })
    expect(read.text).toContain('Updatable')
  })

  it.each([
    ['confirmation expiry', 'WORK_CONFIRMATION_EXPIRED'],
    ['membership expiry', 'WORK_SCOPE_DENIED'],
    ['membership revocation', 'WORK_SCOPE_DENIED'],
    ['job reclamation', 'WORK_CLAIM_STALE'],
    ['lease expiry', 'WORK_SCOPE_DENIED'],
  ])('rolls back canonical writes when %s occurs during awaited writer work', async (change, error) => {
    const proposed = await proposal('Fresh authority ' + change)
    const confirmation = await job('ยืนยันงาน ' + proposed.proposalId)
    const before = await prisma.workItem.count()
    let currentTime = at
    let writerRan = false
    const db = { $transaction: (callback, options) => prisma.$transaction(tx => callback(new Proxy(tx, {
      get(target, key) {
        if (key !== 'workItem') return target[key]
        return new Proxy(tx.workItem, { get(model, operation) {
          if (operation !== 'create') return model[operation]
          return async input => {
            const item = await tx.workItem.create(input)
            writerRan = true
            if (change === 'confirmation expiry') currentTime = new Date(at.getTime() + 300001)
            if (change === 'membership expiry') {
              await tx.membership.update({ where: { id: membership.id }, data: { expiresAt: new Date(at.getTime() + 1000) } })
              currentTime = new Date(at.getTime() + 1001)
            }
            if (change === 'membership revocation') await tx.membership.update({ where: { id: membership.id }, data: { status: 'REVOKED' } })
            if (change === 'job reclamation') await tx.lineConversationJob.update({ where: { id: confirmation.id }, data: { version: { increment: 1 }, executionId: randomUUID() } })
            if (change === 'lease expiry') await tx.lineConversationJob.update({ where: { id: confirmation.id }, data: { leaseExpiresAt: at } })
            return item
          }
        } })
      }
    })), options) }
    await expect(confirmLineWork(confirmation.id, proposed.proposalId, { db, now: () => currentTime })).rejects.toThrow(error)
    expect(writerRan).toBe(true)
    expect(await prisma.workItem.count()).toBe(before)
    expect(await prisma.auditEvent.findUnique({ where: { id: 'line-work-executed:' + proposed.proposalId } })).toBeNull()
    expect(await prisma.auditEvent.findUnique({ where: { id: 'line-work-result:' + proposed.proposalId } })).toBeNull()
  })
})


it('routes Edge OA work commands and human confirmation through the durable Server worker', async () => {
  const env = { ZURI_LINE_REPLY_SEAL_KEY: 'a7'.repeat(32) }
  const admit = async text => {
    const id = randomUUID()
    return admitLineConversation({ account, env, now: at, correlationId: randomUUID(),
      event: { type: 'message', webhookEventId: id, replyToken: 'test-reply-' + id,
        source: { type: 'user', userId: subject }, message: { type: 'text', id, text } } })
  }
  const answer = vi.fn(async () => ({ text: 'must not call inference' }))
  const send = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: randomUUID() }))
  const run = () => runLineConversationWorker({ db: prisma, env, now: () => at, workerId: 'p4-line-worker', answer,
    resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }), replyTransport: { send }, pushTransport: { send } })
  const before = await prisma.workItem.count()
  const proposed = await admit('/work-create ' + stream.id + ' Connected LINE task')
  expect((await prisma.lineConversationJob.findUnique({ where: { id: proposed.jobId } })).executionMode).toBe('SERVER')
  await run()
  expect(answer).not.toHaveBeenCalled()
  expect(await prisma.workItem.count()).toBe(before)
  const preview = await prisma.lineConversationJob.findUnique({ where: { id: proposed.jobId } })
  expect(preview.status).toBe('RECORDED')
  expect(preview.answerText).toContain('รอยืนยัน')
  await admit('ยืนยันงาน ' + proposed.jobId)
  await run()
  expect(await prisma.workItem.count()).toBe(before + 1)
  expect(answer).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledTimes(2)
})



it('operational Work search shares the canonical active-workstream population', async () => {
 const request = await job('/work')
 const before = await searchLineProjectWork(request.id, {}, { now: at })
 expect(before.items.length).toBeGreaterThan(0)
 await prisma.workstream.update({ where: { id: stream.id }, data: { status: 'ARCHIVED' } })
 try {
  const after = await searchLineProjectWork(request.id, {}, { now: at })
  expect(after.items).toEqual([])
 } finally {
  await prisma.workstream.update({ where: { id: stream.id }, data: { status: stream.status } })
 }
})
