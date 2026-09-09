// @req FR-110 — isolated real processes for the four-tier acceptance fixture.
// @spec ADR-073
// @tested tests/acceptance/genesisrag17-e2e.test.js
import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMspStdioTransport } from '@/modules/agent/msp-stdio-transport'

export function isolatedEnvironment(dir, scope) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(POSTGRES_|DATABASE_POSTGRES_URL$|DATABASE_URL$|MSP_DB_PATH$|GKS_DB_PATH$|MSP_PIPELINE_|MSP_GKS_|GKS_PIPELINE_)/.test(key)) delete env[key]
  return {
    ...env,
    MSP_DB_PATH: path.join(dir, 'msp.sqlite'),
    GKS_DB_PATH: path.join(dir, 'gks.sqlite'),
    MSP_GKS_COMMAND: process.execPath,
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
  return createMspStdioTransport({ command: process.execPath, args: [path.join(env.KI17_MSP_ROOT, 'apps/msp-server/bin/msp-server.mjs')], cwd: env.KI17_MSP_ROOT, env, timeoutMs: 120000 })
}

export function runSourceUntilCrash(env, input, crashAt) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve('tests/acceptance/source-process.cjs'), [], {
      env: { ...env, NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, KI17_SOURCE_OPTIONS: JSON.stringify({ input, crashAt }) },
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
  const child = fork(path.resolve('tests/acceptance/worker-process.mjs'), [], { env: { ...env, KI17_WORKER_OPTIONS: JSON.stringify(options) }, execPath: process.execPath, execArgv: [], silent: true })
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
