import { createCoreClient } from './core-client.js'
import { createHealthServer } from './health-server.js'
import { createModelPort } from './model-port.js'
import { createConversationRuntime } from './turn-runtime.js'
import { createWorkerLoop } from './worker-loop.js'

// @req FR-149 — service-owned health, readiness and graceful process lifecycle.
// @spec ADR-106 D5, SDD-108 — standalone Node composition root.
const portNumber = Number(process.env.CONVERSATION_RUNTIME_PORT ?? 3081)
if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error('CONVERSATION_RUNTIME_PORT_INVALID')
let coreReady = false
let shuttingDown = false
const abort = new AbortController()
let worker = null
let workerPromise = null
let core = null
let runtime = null
let healthServer

function createPorts(client, model) {
  const ref = claim => ({ jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId,
    version: claim.version, tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId })
  const call = (operation, payload, idempotencyKey, claim) => {
    if (operation === 'claim' && !coreReady) throw Object.assign(new Error('CORE_RUNTIME_OWNER_MISMATCH'), { code: 'CORE_RUNTIME_OWNER_MISMATCH' })
    return client.call(operation, payload, {
      correlationId: claim?.correlationId,
      idempotencyKey: idempotencyKey ?? `${operation}:${claim?.jobId ?? 'poll'}:${Date.now()}`,
      deadlineAt: claim?.deadlineAt ?? new Date(Date.now() + 10_000).toISOString(), signal: abort.signal,
    })
  }
  return {
    job: {
      claim: ({ claimantId }) => call('claim', { claimantId }, `claim:${claimantId}:${randomNonce()}`),
      renew: claim => call('renew', { claim: ref(claim) }, `renew:${claim.jobId}:${claim.executionId}:${Date.now()}`, claim),
      complete: (claim, result) => call('complete', { claim: ref(claim), ...result }, `complete:${claim.jobId}:${claim.executionId}`, claim),
      fail: (claim, result) => call('fail', { claim: ref(claim), ...result }, `fail:${claim.jobId}:${claim.executionId}`, claim),
      status: (claim, operationId) => call('status', { claim: ref(claim), operationId }, `status:${operationId}`, claim),
    },
    authority: { resolve: claim => call('resolve', { claim: ref(claim) }, `authority:${claim.jobId}:${claim.executionId}`, claim) },
    context: { prepare: (claim, authority) => call('prepare', { claim: ref(claim), authorityVersion: authority.version }, `context:${claim.jobId}:${claim.executionId}`, claim) },
    workTool: {
      execute: (claim, _authority, request) => call('work-tool', { claim: ref(claim), ...request }, request.operationId, claim),
      status: (claim, operationId) => call('work-tool', { claim: ref(claim), operation: 'status', operationId, input: {} }, `work-status:${operationId}`, claim),
    },
    model: {
      credential: claim => call('credential', { claim: ref(claim) }, `credential:${claim.jobId}:${claim.executionId}`, claim),
      generate: input => model.generate(input),
    },
    delivery: {
      send: claim => call('send', { claim: ref(claim), operationId: `${claim.jobId}:${claim.executionId}:delivery` }, `delivery:${claim.jobId}:${claim.executionId}`, claim),
      status: claim => call('status', { claim: ref(claim), operationId: `${claim.jobId}:delivery` }, `delivery-status:${claim.jobId}:${claim.executionId}`, claim),
    },
    trace: {
      append: (claim, event) => call('trace', { claim: ref(claim), ...event }, `trace:${claim.jobId}:${event.payload?.operationId ?? claim.executionId}:${event.kind}`, claim),
      status: (claim, operationId) => call('status', { claim: ref(claim), operationId }, `operation-status:${operationId}`, claim),
    },
  }
}

function randomNonce() { return `${Date.now()}:${Math.random().toString(36).slice(2)}` }

async function start() {
  healthServer = createHealthServer({ isReady: () => coreReady && !shuttingDown })
  await new Promise((resolve, reject) => {
    healthServer.once('error', reject)
    healthServer.listen(portNumber, '0.0.0.0', resolve)
  })
  if (process.env.CONVERSATION_RUNTIME_CORE_URL && process.env.CONVERSATION_RUNTIME_TOKEN?.length >= 32) {
    core = createCoreClient({ baseUrl: process.env.CONVERSATION_RUNTIME_CORE_URL, token: process.env.CONVERSATION_RUNTIME_TOKEN })
    runtime = createConversationRuntime({ ports: createPorts(core, createModelPort()) })
    worker = createWorkerLoop({ runtime, logger: entry => process.stdout.write(`${JSON.stringify(entry)}\n`) })
    workerPromise = worker.run({ signal: abort.signal })
    void monitorCore()
  }
}

async function monitorCore() {
  while (!shuttingDown && !abort.signal.aborted) {
    try {
      const status = await core.health({ signal: abort.signal })
      coreReady = status?.status === 'READY' && status.runtimeOwner === 'CONVERSATION_RUNTIME'
    } catch { coreReady = false }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  coreReady = false
  await worker?.stop()
  abort.abort()
  await workerPromise?.catch(() => {})
  await new Promise(resolve => healthServer?.close(resolve) ?? resolve())
}

process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
start().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'conversation-runtime.start-failed', code: error?.code || 'START_FAILED' })}\n`)
  process.exitCode = 1
})
