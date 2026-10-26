import { randomUUID } from 'node:crypto'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'
import { afterEach, describe, expect, inject, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  createIntegrationConnection,
  LINE_OA_PROVIDER_CODE,
  registerIntegrationProvider,
} from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { citationReference, withdrawKnowledgeSource } from '@/modules/knowledge/knowledge-corpus-service'

const resolveCitationMock = vi.hoisted(() => vi.fn())
vi.mock('@/modules/knowledge/knowledge-corpus-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveKnowledgeCitation: (...args) => resolveCitationMock(...args) }
})

// @req FR-235 — a selected GKS citation is ordered with source withdrawal through the LINE SENDING claim.
// @spec ADR-072 D10 and Acceptance — a withdrawal committed before the claim denies delivery; a claim first is not recalled.
// @tested tests/postgres/knowledge-line-withdrawal-races.test.js

const databaseUrl = inject('testDatabaseUrl')
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl || '')) {
  throw new Error('KNOWLEDGE_LINE_WITHDRAWAL_RACE_REQUIRES_INJECTED_POSTGRES')
}

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'a7'.repeat(32) }
const MAX_WAIT_MS = 6000

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function withinDeadline(promise, label, timeoutMs = MAX_WAIT_MS) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`KNOWLEDGE_LINE_RACE_TIMEOUT: ${label}`)), timeoutMs)
    })])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForPgBlock(observer, waitingPid, blockerPid) {
  const deadline = performance.now() + MAX_WAIT_MS
  while (performance.now() < deadline) {
    const rows = await observer.$queryRawUnsafe(
      'SELECT wait_event_type, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid = $1',
      waitingPid,
    )
    const activity = rows[0]
    if (activity?.wait_event_type === 'Lock' && activity.blockers.map(Number).includes(Number(blockerPid))) return
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw new Error(`KNOWLEDGE_LINE_RACE_LOCK_NOT_OBSERVED: ${waitingPid} blocked by ${blockerPid}`)
}

function instrumentDb(client, hooks = {}) {
  function instrumentTransaction(tx) {
    return new Proxy(tx, {
      get(target, key) {
        if (key === '$queryRawUnsafe') return async (sql, ...params) => {
          if (typeof sql === 'string' && sql.includes('FOR SHARE OF s')) {
            const [{ pid }] = await target.$queryRawUnsafe('SELECT pg_backend_pid() AS pid')
            hooks.deliveryPid?.resolve(Number(pid))
          }
          return target.$queryRawUnsafe(sql, ...params)
        }
        if (key === 'knowledgeSource') {
          const delegate = target.knowledgeSource
          return new Proxy(delegate, {
            get(model, operation) {
              if (operation !== 'updateMany') {
                const value = Reflect.get(model, operation, model)
                return typeof value === 'function' ? value.bind(model) : value
              }
              return async args => {
                if (args?.data?.revokedAt) {
                  const [{ pid }] = await target.$queryRawUnsafe('SELECT pg_backend_pid() AS pid')
                  hooks.withdrawPid?.resolve(Number(pid))
                  const result = await model.updateMany(args)
                  if (result.count === 1 && hooks.afterSourceUpdate) {
                    hooks.afterSourceUpdate.resolve(Number(pid))
                    await hooks.releaseAfterSourceUpdate.promise
                  }
                  return result
                }
                return model.updateMany(args)
              }
            },
          })
        }
        if (key === 'lineConversationJob') {
          const delegate = target.lineConversationJob
          return new Proxy(delegate, {
            get(model, operation) {
              if (operation !== 'updateMany') {
                const value = Reflect.get(model, operation, model)
                return typeof value === 'function' ? value.bind(model) : value
              }
              return async args => {
                if (args?.data?.status === 'SENDING' && hooks.beforeSending) {
                  hooks.beforeSending.resolve()
                  await hooks.releaseBeforeSending.promise
                }
                return model.updateMany(args)
              }
            },
          })
        }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  return new Proxy(client, {
    get(target, key) {
      if (key === '$transaction') return (callback, options) =>
        target.$transaction(tx => callback(instrumentTransaction(tx)), options)
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function independentClients() {
  const clients = [0, 1].map(() => new PostgresPrismaClient({ datasources: { db: { url: databaseUrl } } }))
  await Promise.all(clients.map(client => client.$connect()))
  return clients
}

async function fixture(label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
  const portfolio = await createPortfolio({ name: `${label} ${suffix}`, code: `PF-KLWR-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `${label} tenant ${suffix}`, code: `TN-KLWR-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `${label} business ${suffix}`, code: `BU-KLWR-${suffix}` })
  const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({
    tenantId: tenant.id,
    businessId: business.id,
    providerId: provider.id,
    name: `LINE race ${suffix}`,
    externalAccountId: `line-race-${suffix}`,
    status: 'ACTIVE',
  })
  const account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id,
    businessId: business.id,
    integrationConnectionId: connection.id,
    code: `line-race-${suffix}`,
    displayName: `LINE race ${suffix}`,
    bindingCode: `line-race-binding-${suffix}`,
    transportMode: 'CLOUD',
    serverEnabled: true,
    status: 'CONNECTED',
    executionMode: 'SERVER',
    runtimeOwner: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED',
    knowledgeGrounding: 'GKS_CORPUS',
    allowDelayedPush: true,
  } })
  const scope = {
    portfolioId: portfolio.id,
    tenantId: tenant.id,
    businessId: business.id,
    workspaceId: '',
    agentId: `knowledge-line-race-${suffix}`,
    visibility: 'private',
  }
  const corpus = await prisma.knowledgeCorpus.create({ data: {
    corpusKey: `knowledge:line-race:${suffix}`,
    portfolioId: portfolio.id,
    tenantId: tenant.id,
    businessId: business.id,
    projectId: null,
    workspaceId: '',
    scopeJson: JSON.stringify(scope),
    policyJson: '{}',
    status: 'ACTIVE',
    generation: 0,
  } })
  const source = await prisma.knowledgeSource.create({ data: {
    corpusId: corpus.id,
    sourceKey: `line-race:${suffix}`,
    kind: 'TEXT',
    title: `LINE race source ${suffix}`,
  } })
  const citationId = citationReference({
    corpusId: corpus.id,
    corpusGeneration: 1,
    sourceId: source.id,
    ingestionId: `ingestion-${suffix}`,
    chunkId: `chunk-${suffix}`,
  })
  const citation = {
    citationId,
    corpusId: corpus.id,
    corpusGeneration: 1,
    sourceId: source.id,
    sourceVersion: 'v1',
    ingestionId: `ingestion-${suffix}`,
    snapshotId: `snapshot-${suffix}`,
    generation: 2,
    rawArtifactId: `raw-${suffix}`,
    parsedArtifactId: `parsed-${suffix}`,
    chunkId: `chunk-${suffix}`,
    contentHash: 'a'.repeat(64),
    title: `LINE race source ${suffix}`,
    fileAssetId: null,
    text: 'synthetic source evidence',
    startOffset: 0,
    endOffset: 25,
  }
  const now = new Date()
  const admitted = await admitLineConversation({
    account,
    event: {
      type: 'message',
      webhookEventId: `line-race-event-${suffix}`,
      replyToken: `line-race-token-${suffix}`,
      source: { type: 'user', userId: `line-race-user-${suffix}` },
      message: { type: 'text', id: `line-race-message-${suffix}`, text: 'Explain the published source' },
    },
    correlationId: `line-race-correlation-${suffix}`,
    now,
    env,
    db: prisma,
  })
  const answer = vi.fn(async (_execution, { trace }) => {
    await trace.recordEvidence({ queryId: 'source_explanation', params: {} }, {
      records: [{ kind: 'CORPUS_CHUNK', citationId, text: citation.text }],
    }, {
      mode: 'GKS_CORPUS', source: 'GKS_CORPUS', reason: null,
      retrievalRefs: [{ citationId, sourceId: source.id, snapshotId: citation.snapshotId, generation: citation.generation,
        corpusGeneration: citation.corpusGeneration, manifestHash: 'b'.repeat(64) }], budgetMs: 1,
    })
    await trace.recordContextReceipt({
      receiptId: `ctxrcpt_${randomUUID()}`,
      refs: { msp: [], citations: [citationId], records: [] },
      hash: 'c'.repeat(64),
      budget: { max: 1600, used: citation.text.length, trimmed: 0 },
      dropped: [],
    })
    return { text: 'answer grounded in the selected source' }
  })
  return { suffix, tenant, business, viewer, account, corpus, source, citation, admitted, answer }
}

function workerOptions(testFixture, db, { replyTransport } = {}) {
  return {
    db,
    env,
    now: () => new Date(),
    workerId: `knowledge-line-race-${testFixture.suffix}`,
    answer: testFixture.answer,
    resolveAccount: accountId => prisma.lineOaAccount.findUnique({ where: { id: accountId } }),
    replyTransport: replyTransport || { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-accepted' })) },
    pushTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'synthetic-push' })) },
  }
}

async function withdraw(testFixture, db) {
  return withdrawKnowledgeSource(testFixture.source.id, { expectedVersion: testFixture.source.version }, {
    db,
    viewer: testFixture.viewer,
    env,
  })
}

describe('LINE source-withdrawal ordering on PostgreSQL', () => {
  afterEach(() => resolveCitationMock.mockReset())

  it('denies the GKS send when the actual withdrawal update owns the source row first', async () => {
    const testFixture = await fixture('withdraw-first')
    const clients = await independentClients()
    const withdrawPid = deferred()
    const afterSourceUpdate = deferred()
    const releaseAfterSourceUpdate = deferred()
    const deliveryPid = deferred()
    let withdrawalTask
    let workerTask
    try {
      const withdrawalDb = instrumentDb(clients[1], {
        withdrawPid,
        afterSourceUpdate,
        releaseAfterSourceUpdate,
      })
      withdrawalTask = Promise.allSettled([withdraw(testFixture, withdrawalDb)])
      const blockerPid = await withinDeadline(afterSourceUpdate.promise, 'withdrawal row update')

      resolveCitationMock.mockResolvedValue(testFixture.citation)
      const sendDb = instrumentDb(clients[0], { deliveryPid })
      const options = workerOptions(testFixture, sendDb)
      workerTask = Promise.allSettled([runLineConversationWorker(options)])
      const waitingPid = await withinDeadline(deliveryPid.promise, 'delivery source lock')
      expect(waitingPid).not.toBe(blockerPid)
      await waitForPgBlock(prisma, waitingPid, blockerPid)

      releaseAfterSourceUpdate.resolve()
      const [withdrawalOutcome] = await withinDeadline(withdrawalTask, 'withdrawal commit')
      expect(withdrawalOutcome.status).toBe('fulfilled')
      expect(withdrawalOutcome.value.status).toBe('WITHDRAWN')
      const [workerOutcome] = await withinDeadline(workerTask, 'withdrawal-first worker')
      expect(workerOutcome.status).toBe('fulfilled')
      expect(workerOutcome.value).toMatchObject({ id: testFixture.admitted.jobId, status: 'CANCELLED' })
      expect(await prisma.lineConversationJob.findUnique({ where: { id: testFixture.admitted.jobId } }))
        .toMatchObject({ status: 'CANCELLED', answerText: null, errorCode: 'LINE_GKS_AUTHORITY_REVOKED' })
      expect(resolveCitationMock).not.toHaveBeenCalled()
      expect(options.replyTransport.send).not.toHaveBeenCalled()
      expect(options.pushTransport.send).not.toHaveBeenCalled()
    } finally {
      releaseAfterSourceUpdate.resolve()
      if (withdrawalTask) await withdrawalTask
      if (workerTask) await workerTask
      await Promise.all(clients.map(client => client.$disconnect()))
    }
  }, 9500)

  it('keeps an already claimed send attempt when withdrawal waits behind the source lock', async () => {
    const testFixture = await fixture('send-first')
    const clients = await independentClients()
    const deliveryPid = deferred()
    const beforeSending = deferred()
    const releaseBeforeSending = deferred()
    const withdrawPid = deferred()
    const providerStarted = deferred()
    const releaseProvider = deferred()
    let withdrawalTask
    let workerTask
    try {
      resolveCitationMock.mockResolvedValue(testFixture.citation)
      const sendDb = instrumentDb(clients[0], { deliveryPid, beforeSending, releaseBeforeSending })
      const replyTransport = { send: vi.fn(async () => {
        providerStarted.resolve()
        await releaseProvider.promise
        return { status: 'UNKNOWN', code: 'LINE_REQUEST_UNCONFIRMED' }
      }) }
      const options = workerOptions(testFixture, sendDb, { replyTransport })
      workerTask = Promise.allSettled([runLineConversationWorker(options)])
      const waitingSenderPid = await withinDeadline(deliveryPid.promise, 'sender source lock')
      await withinDeadline(beforeSending.promise, 'SENDING claim boundary')

      const withdrawalDb = instrumentDb(clients[1], { withdrawPid })
      withdrawalTask = Promise.allSettled([withdraw(testFixture, withdrawalDb)])
      const waitingWithdrawPid = await withinDeadline(withdrawPid.promise, 'withdraw source update')
      expect(waitingWithdrawPid).not.toBe(waitingSenderPid)
      await waitForPgBlock(prisma, waitingWithdrawPid, waitingSenderPid)

      releaseBeforeSending.resolve()
      await withinDeadline(providerStarted.promise, 'claimed provider attempt')
      expect(await prisma.lineConversationJob.findUnique({ where: { id: testFixture.admitted.jobId } }))
        .toMatchObject({ status: 'SENDING', attempts: 1 })
      const [withdrawalOutcome] = await withinDeadline(withdrawalTask, 'withdraw after send claim')
      expect(withdrawalOutcome.status).toBe('fulfilled')
      expect(withdrawalOutcome.value.status).toBe('WITHDRAWN')
      expect((await prisma.knowledgeSource.findUnique({ where: { id: testFixture.source.id } })).revokedAt).toBeInstanceOf(Date)
      expect(options.replyTransport.send).toHaveBeenCalledTimes(1)
      expect(await prisma.lineConversationJob.findUnique({ where: { id: testFixture.admitted.jobId } }))
        .toMatchObject({ status: 'SENDING', attempts: 1 })

      releaseProvider.resolve()
      const [workerOutcome] = await withinDeadline(workerTask, 'claimed send outcome')
      expect(workerOutcome.status).toBe('fulfilled')
      expect(workerOutcome.value).toMatchObject({ id: testFixture.admitted.jobId, status: 'UNKNOWN' })
      expect(await prisma.lineConversationJob.findUnique({ where: { id: testFixture.admitted.jobId } }))
        .toMatchObject({ status: 'UNKNOWN', attempts: 1 })
      expect(testFixture.answer).toHaveBeenCalledTimes(1)
    } finally {
      releaseBeforeSending.resolve()
      releaseProvider.resolve()
      if (withdrawalTask) await withdrawalTask
      if (workerTask) await workerTask
      await Promise.all(clients.map(client => client.$disconnect()))
    }
  }, 9500)
})
