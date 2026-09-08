import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { request as playwrightRequest } from '@playwright/test'
import { isolatedEnvironment, startWorkerProcess, temporaryPipeline } from './harness'

// @req FR-172 — the admission acceptance drives the real Next entrypoint and
// keeps the native/MSP/GKS processes outside the test's in-process mocks.
// @spec ADR-072, ADR-071
// @tested tests/acceptance/knowledge-admission-native.test.js

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '../..')
const auth = createRequire(path.join(serverRoot, 'package.json'))('./tests/e2e/e2e-auth.js')
const { E2E_USERNAME, E2E_PASSWORD, E2E_SESSION_SECRET } = auth

const REQUIRED_NATIVE_ENV = ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']
const TEST_DATABASE_URL = /^file:\.\/\.test-dbs\/(run-[\w-]+\.db)$/

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function requiredNativeEnvironment(env) {
  const missing = REQUIRED_NATIVE_ENV.filter((key) => !env[key])
  if (missing.length) {
    throw new Error(`Knowledge admission native acceptance requires ${missing.join(', ')}; no fake/stub mode is supported`)
  }
}

function disposableDatabaseUrl(env = process.env) {
  const match = String(env.DATABASE_URL || '').replaceAll('\\', '/').match(TEST_DATABASE_URL)
  if (!match) throw new Error('Knowledge admission acceptance requires Vitest DATABASE_URL=file:./.test-dbs/run-*.db')
  const databasePath = path.resolve(serverRoot, 'prisma', '.test-dbs', match[1])
  const databaseRoot = path.resolve(serverRoot, 'prisma', '.test-dbs')
  if (path.dirname(databasePath) !== databaseRoot || !existsSync(databasePath)) {
    throw new Error('Knowledge admission acceptance requires an existing disposable .test-dbs/run-*.db')
  }
  return `file:${databasePath.replaceAll('\\', '/')}`
}

function commandLine(nextBin, port) {
  return [nextBin, 'dev', '-p', String(port)]
}

async function reservePort() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

async function terminateProcess(child) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit').catch(() => [])
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.once('error', () => child.kill())
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([exited, sleep(10000)])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, sleep(5000)])
  }
}

async function waitForHttp(url, child, logs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited ${child.exitCode} while starting: ${logs.join('').slice(-6000)}`)
    try {
      const response = await fetch(`${url}/login`, { redirect: 'manual' })
      if (response.status >= 200 && response.status < 500) return
      lastError = new Error(`Next returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for Next at ${url}: ${lastError?.message || 'unknown error'}\n${logs.join('').slice(-6000)}`)
}

async function launchNext({ env, port }) {
  const nextBin = path.join(serverRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  const logs = []
  const child = spawn(process.execPath, commandLine(nextBin, port), {
    cwd: serverRoot,
    env: { ...env, NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (chunk) => logs.push(chunk.toString('utf8')))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString('utf8')))
  try {
    await waitForHttp(`http://127.0.0.1:${port}`, child, logs)
    // Compile the surface before opening process-local MCP sessions. Next dev
    // can invalidate shared route modules when a different route first loads.
    // These unauthenticated probes must fail before admitting or reading data.
    for (const [method, route] of [
      ['GET', '/api/knowledge/ingestions'],
      ['POST', '/api/knowledge/ingestions'],
      ['GET', '/api/knowledge/ingestions/acceptance-warmup'],
      ['POST', '/api/knowledge/queries'],
      ['GET', '/api/knowledge/citations/acceptance-warmup'],
      ['DELETE', '/api/knowledge/sources/acceptance-warmup'],
      ['POST', '/api/mcp'],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        ...(method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' }),
        signal: AbortSignal.timeout(60000),
      })
      await response.arrayBuffer()
      if (response.status !== 401) throw new Error(`Unauthenticated surface warmup ${method} ${route} returned ${response.status}`)
    }
  } catch (error) {
    await terminateProcess(child)
    throw error
  }
  return {
    child,
    logs,
    async close() { await terminateProcess(child) },
  }
}

function addRuntimeEnvironment(env, scope, port) {
  return {
    ...env,
    DATABASE_URL: disposableDatabaseUrl(),
    ZURI_SESSION_SECRET: E2E_SESSION_SECRET,
    ZURI_SEED_OWNER_PASSWORD: E2E_PASSWORD,
    ZURI_KNOWLEDGE_ENABLED: '1',
    ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }]),
    ZURI_MSP_COMMAND: process.execPath,
    ZURI_MSP_ARGS: JSON.stringify([path.join(env.KI17_MSP_ROOT, 'apps/msp-server/bin/msp-server.mjs')]),
    ZURI_MSP_CWD: env.KI17_MSP_ROOT,
    ZURI_MSP_TIMEOUT_MS: '120000',
    MSP_PIPELINE_WORKER_URL: `http://127.0.0.1:${port}`,
  }
}

/**
 * Start the real native worker and a real Next server over one isolated DB.
 * The native endpoint is hidden from Next until activateNativeWorker(), which
 * lets the test prove that accepted rows survive a server restart while the
 * native process is unavailable.
 */
export async function createKnowledgeAdmissionHarness({
  scope,
  fixture,
  port = 0,
} = {}) {
  if (!scope || !fixture) throw new Error('Knowledge admission harness requires scope and benchmark fixture')
  requiredNativeEnvironment(process.env)
  const temp = temporaryPipeline()
  let native
  let nativeFixture = fixture
  let next
  let api
  let nativeLoopStarted = false
  const blackholeWorkerUrl = 'http://127.0.0.1:1'
  const nativeEnv = addRuntimeEnvironment(isolatedEnvironment(temp.dir, scope), scope, 1)
  try {
    const startNative = async (benchmarkFixture) => startWorkerProcess(nativeEnv, {
      dbPath: path.join(temp.dir, 'genesis-store'),
      scope,
      credential: 'ki17-test-worker',
      workerToken: 'ki17-test-query',
      modelDir: nativeEnv.KI17_MODEL_DIR,
      benchmarkFixture,
    })
    native = await startNative(nativeFixture)
    const resolvedPort = port || await reservePort()
    const env = { ...nativeEnv, MSP_PIPELINE_WORKER_URL: blackholeWorkerUrl }
    next = await launchNext({ env, port: resolvedPort })
    api = await playwrightRequest.newContext({ baseURL: `http://127.0.0.1:${resolvedPort}` })

    async function startNativeLoop() {
      if (nativeLoopStarted) return
      await native.call('start')
      nativeLoopStarted = true
    }

    async function stopNativeLoop() {
      if (!nativeLoopStarted) return
      await native.call('stop')
      nativeLoopStarted = false
    }

    async function restart({ activateNative = false } = {}) {
      await next.close()
      await sleep(250)
      if (activateNative) await startNativeLoop()
      else await stopNativeLoop()
      env.MSP_PIPELINE_WORKER_URL = activateNative ? native.url : blackholeWorkerUrl
      next = await launchNext({ env, port: resolvedPort })
    }

    return {
      baseURL: `http://127.0.0.1:${resolvedPort}`,
      scope,
      tempDir: temp.dir,
      env,
      get native() { return native },
      get diagnostics() {
        return { next: (next?.logs || []).join('').slice(-6000) }
      },
      request: api,
      async activateNativeWorker() {
        await restart({ activateNative: true })
      },
      async deactivateNativeWorker() {
        await stopNativeLoop()
        await restart({ activateNative: false })
      },
      async restartNative({ benchmarkFixture = nativeFixture } = {}) {
        await stopNativeLoop()
        await native?.close()
        nativeFixture = benchmarkFixture
        native = await startNative(nativeFixture)
        nativeLoopStarted = false
        // Every fresh native process must be explicitly started. If Next is
        // still parked on the blackhole URL, its source loop has not resumed,
        // so queued admissions remain durable until the caller activates Next.
        await startNativeLoop()
        if (env.MSP_PIPELINE_WORKER_URL !== blackholeWorkerUrl) env.MSP_PIPELINE_WORKER_URL = native.url
      },
      restart,
      async close() {
        await api?.dispose()
        await next?.close()
        await native?.close()
        temp.cleanup()
      },
    }
  } catch (error) {
    await api?.dispose()
    await next?.close()
    await native?.close()
    temp.cleanup()
    throw error
  }
}

export function seedKnowledgeOwner({ password = E2E_PASSWORD, env = process.env } = {}) {
  const databaseUrl = disposableDatabaseUrl(env)
  execFileSync(process.execPath, ['prisma/seed.js'], {
    cwd: serverRoot,
    env: { ...env, DATABASE_URL: databaseUrl, ZURI_SEED_OWNER_PASSWORD: password },
    stdio: 'inherit',
  })
}

export { E2E_USERNAME, E2E_PASSWORD, E2E_SESSION_SECRET }
