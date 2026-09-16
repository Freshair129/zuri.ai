// @req FR-110 — isolated real processes for the four-tier acceptance fixture.
// @spec ADR-073
// @tested tests/acceptance/genesisrag17-e2e.test.js
import { fork } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMspStdioTransport } from '@/modules/agent/msp-stdio-transport'

/**
 * The Node that runs MSP, GKS and the GenesisBlock worker — which is not always the
 * Node running this suite.
 *
 * Natively on one machine they are the same process family and `process.execPath` was
 * right. Inside the ADR-075 Phase 3 images (gate G-3) they are deliberately different:
 * Tier 1 — this test runner, the zuri-ai code it imports and the Prisma client — runs
 * on the Node 22 the `runner` image ships, while MSP, GKS and the worker run on the
 * pinned 24.18.x at /opt/ki17/node/bin/node (the worker's `engines` is `>=24.18`, and
 * Prisma 5.22 does not list Node 24, which is why the split exists at all). Spawning
 * the children with `process.execPath` there would silently run them on Node 22 and
 * certify a runtime the deployment does not ship.
 *
 * KI17_NODE names that executable. Unset — every native run so far — this is
 * `process.execPath` and nothing changes. Set to something that does not exist it
 * throws, because the one outcome worth preventing is a run that quietly falls back.
 */
export function ki17NodeExecutable(env = process.env) {
  const configured = env.KI17_NODE
  if (!configured) return process.execPath
  if (!path.isAbsolute(configured) || !existsSync(configured)) {
    throw new Error(`KI17_NODE must name an existing absolute Node executable for the MSP/GKS/worker children; got ${JSON.stringify(configured)}`)
  }
  return configured
}

export function isolatedEnvironment(dir, scope) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(POSTGRES_|DATABASE_POSTGRES_URL$|DATABASE_URL$|MSP_DB_PATH$|GKS_DB_PATH$|MSP_PIPELINE_|MSP_GKS_|GKS_PIPELINE_)/.test(key)) delete env[key]
  return {
    ...env,
    MSP_DB_PATH: path.join(dir, 'msp.sqlite'),
    GKS_DB_PATH: path.join(dir, 'gks.sqlite'),
    // MSP spawns GKS with this command; both are ki17 children, never Tier 1.
    // KI17_NODE itself is inherited through the `...env` spread above.
    MSP_GKS_COMMAND: ki17NodeExecutable(env),
    MSP_GKS_ARGS: JSON.stringify([path.join(env.KI17_GKS_ROOT, 'apps/gks-server/bin/gks-server.mjs')]),
    MSP_GKS_CWD: env.KI17_GKS_ROOT,
    MSP_GKS_PIPELINE_CREDENTIAL: 'ki17-test-relay',
    GKS_PIPELINE_RELAY_CREDENTIAL: 'ki17-test-relay',
    MSP_PIPELINE_PRINCIPALS: JSON.stringify([
      { credential: 'ki17-test-source', principalId: 'ki17-source', role: 'source', scope },
      { credential: 'ki17-test-worker', principalId: 'ki17-worker', role: 'worker', scope },
    ]),
    MSP_PIPELINE_WORKER_TOKEN: 'ki17-test-query',
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
  }
}

export function mspTransport(env) {
  return createMspStdioTransport({ command: ki17NodeExecutable(env), args: [path.join(env.KI17_MSP_ROOT, 'apps/msp-server/bin/msp-server.mjs')], cwd: env.KI17_MSP_ROOT, env, timeoutMs: 120000 })
}

export function runSourceUntilCrash(env, input, crashAt) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve('tests/acceptance/source-process.cjs'), [], {
      env: { ...env, NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, KI17_SOURCE_OPTIONS: JSON.stringify({ input, crashAt }) },
      // Tier 1, not a ki17 child: this process imports zuri-ai's own modules and the
      // Prisma client, so it belongs on the test runner's Node, never on KI17_NODE.
      execPath: process.execPath, execArgv: [], silent: true,
    })
    let stderr = ''
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Source crash test timed out')) }, 60000)
    child.stdout.resume()
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 87) resolve()
      else reject(new Error(`Source exited ${code} instead of reaching ${crashAt}: ${stderr}`))
    })
  })
}

export async function startWorkerProcess(env, options) {
  // The Tier 4 worker and the MSP caller it opens are ki17 children: they load the
  // GenesisBlock native addon and the worker's `engines` is `>=24.18`. Forking them on
  // KI17_NODE also makes `process.execPath` inside worker-process.mjs the right Node.
  const child = fork(path.resolve('tests/acceptance/worker-process.mjs'), [], { env: { ...env, KI17_WORKER_OPTIONS: JSON.stringify(options) }, execPath: ki17NodeExecutable(env), execArgv: [], silent: true })
  let stderr = '', nextId = 1
  const pending = new Map()
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
  child.stdout.resume()
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Worker startup timed out')) }, 30000)
    child.on('message', (message) => {
      if (message.ready) { clearTimeout(timeout); resolve(message) }
      const request = pending.get(message.id)
      if (request) {
        clearTimeout(request.timeout); pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error))
        else request.resolve(message.result)
      }
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const error = new Error(`Worker exited ${code}: ${stderr}`)
      reject(error)
      for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error) }
      pending.clear()
    })
  })
  const listening = await ready
  const call = (command) => new Promise((resolve, reject) => {
    const id = nextId++
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Worker ${command} timed out: ${stderr}`)) }, 150000)
    pending.set(id, { resolve, reject, timeout })
    child.send({ id, command })
  })
  return {
    url: listening.url ?? `http://127.0.0.1:${listening.port}`,
    call,
    async close() {
      if (child.exitCode !== null) return
      const exited = new Promise((resolve) => child.once('exit', resolve))
      try { await call('close') } catch { child.kill() }
      await exited
    },
    async crash() {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill(); await exited
    },
  }
}

export function temporaryPipeline() {
  const dir = mkdtempSync(path.join(tmpdir(), 'genesisrag17-acceptance-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
}
