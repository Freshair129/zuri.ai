// @req FR-110 — actual Tier4 process lifetime, not an in-memory restart mock.
// @spec ADR-073
// @tested tests/acceptance/genesisrag17-e2e.test.js
import { createRequire } from 'node:module'
import path from 'node:path'

const options = JSON.parse(process.env.KI17_WORKER_OPTIONS)
const nativeRequire = createRequire(path.join(process.env.KI17_GENESIS_ROOT, 'package.json'))
const { GenesisRag17Worker } = nativeRequire(path.join(process.env.KI17_GENESIS_ROOT, 'genesisrag17-worker/src/worker.mjs'))
const { createMspStdioCaller } = nativeRequire(path.join(process.env.KI17_GENESIS_ROOT, 'genesisrag17-worker/src/msp-stdio.mjs'))
const realCall = createMspStdioCaller({ command: process.execPath, args: [path.join(process.env.KI17_MSP_ROOT, 'apps/msp-server/bin/msp-server.mjs')], cwd: process.env.KI17_MSP_ROOT, env: process.env })
let dropped = false
const mspCall = async (name, input) => {
  if (!dropped && name === options.dropBeforeTool) {
    dropped = true
    throw new Error('KI17_SIMULATED_UNDELIVERED_REQUEST')
  }
  const result = await realCall(name, input)
  if (!dropped && name === options.dropReplyTool) {
    dropped = true
    throw new Error('KI17_SIMULATED_LOST_REPLY')
  }
  return result
}
mspCall.close = () => realCall.close?.()
const worker = GenesisRag17Worker.create({ ...options, mspCall, port: 0,
  faultInjector: (point, details = {}) => {
    if (point === options.crashAt && (!options.crashPhase || details.phase === options.crashPhase)) process.exit(86)
  },
})
// Inject negative readback results before the worker hashes and persists its
// actual candidate receipt, so the test reaches the quality gate instead of
// correctly failing an unrelated transport-integrity check.
if (options.corruptReceipt) {
  const makeReceipt = worker.makeReceipt.bind(worker)
  worker.makeReceipt = (...args) => {
    const receipt = makeReceipt(...args)
    if (options.corruptReceipt === 'index') receipt.laneManifest.vector = { status: 'unsupported', reason: 'KI17_FAULT_INDEX_NOT_READY', objects: 0 }
    if (options.corruptReceipt === 'provenance') receipt.laneManifest.provenance = { status: 'unsupported', reason: 'KI17_FAULT_PROVENANCE_MISSING', objects: 0 }
    if (options.corruptReceipt === 'security') receipt.benchmark.crossTenantLeaks = 1
    return receipt
  }
}
const listening = await worker.listen()
process.send({ ready: true, ...listening })
process.on('message', async ({ id, command }) => {
  try {
    if (command === 'runOnce') process.send({ id, result: await worker.runOnce() })
    else if (command === 'start') { worker.start(); process.send({ id, result: { started: true } }) }
    else if (command === 'stop') { await worker.stop(); process.send({ id, result: { stopped: true } }) }
    else if (command === 'close') { await worker.close(); process.send({ id, result: { closed: true } }); process.exit(0) }
    else throw new Error('UNKNOWN_ACCEPTANCE_WORKER_COMMAND')
  } catch (error) {
    process.send({ id, error: error.message })
  }
})
