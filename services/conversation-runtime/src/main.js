import { createCoreClient } from './core-client.js'
import { createCorePorts } from './core-ports.js'
import { createHealthServer } from './health-server.js'
import { createModelPort } from './model-port.js'
import { createConversationRuntime } from './turn-runtime.js'
import { createWorkerLoop } from './worker-loop.js'

// @req FR-149 — service-owned health, readiness and graceful process lifecycle.
// @spec ADR-106 D5, SDD-110 — standalone Node composition root.
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

async function start() {
  healthServer = createHealthServer({ isReady: () => coreReady && !shuttingDown })
  await new Promise((resolve, reject) => {
    healthServer.once('error', reject)
    healthServer.listen(portNumber, '0.0.0.0', resolve)
  })
  if (process.env.CONVERSATION_RUNTIME_CORE_URL && process.env.CONVERSATION_RUNTIME_TOKEN?.length >= 32) {
    core = createCoreClient({ baseUrl: process.env.CONVERSATION_RUNTIME_CORE_URL, token: process.env.CONVERSATION_RUNTIME_TOKEN })
    runtime = createConversationRuntime({ ports: createCorePorts({ client: core, model: createModelPort(),
      isCoreReady: () => coreReady, signal: abort.signal }) })
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
