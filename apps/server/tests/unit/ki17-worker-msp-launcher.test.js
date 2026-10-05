import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MSP_OS_ENV_NAMES, MSP_RUNTIME_ENV_NAMES } from '@/modules/agent/msp-child-environment.mjs'

// @req FR-057 — the worker-side MSP launcher, executed rather than read: the
//   MSP child gets the allowlisted environment only, its exit code becomes the
//   launcher's, and a SIGTERM to the launcher reaches it (#578 review, finding 2).
// @spec ADR-068 D1, ADR-043 D2, ADR-050 D3
// @tested tests/unit/ki17-worker-msp-launcher.test.js
//
// The launcher's `<command> [args...]` override (see the script's header) points
// it at tests/fixtures/fake-msp-child.mjs instead of the pinned MSP server.

const launcher = path.resolve('scripts/ki17-worker-msp-launcher.mjs')
const harness = path.resolve('tests/fixtures/ki17-launcher-signal-harness.mjs')
const fakeChild = path.resolve('tests/fixtures/fake-msp-child.mjs')

// Decoy values only; none may reach MSP. NODE_OPTIONS is left out on purpose:
// it would configure the launcher's own Node before the filter runs.
const DECOY_SECRETS = {
  DATABASE_URL: 'postgresql://decoy:decoy@db.invalid:5432/decoy',
  LINE_CHANNEL_SECRET: 'decoy-line-channel-secret',
  ANTHROPIC_API_KEY: 'decoy-anthropic-key',
  GENESIS_WORKER_QUERY_TOKEN: 'decoy-worker-query-token',
  GENESIS_WORKER_MSP_COMMAND: '/opt/ki17/node/bin/node',
}

const MSP_CONFIGURATION = {
  MSP_DB_PATH: '/var/lib/zuri-ki17/state/msp.sqlite',
  MSP_PIPELINE_PRINCIPALS: '[]',
  GKS_DEFAULT_PORTFOLIO_ID: 'test-portfolio',
}

const osBasics = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => MSP_OS_ENV_NAMES.includes(name.toUpperCase())))

// On Windows libuv copies these into any explicit child environment
// (deps/uv/src/win/process.c, required_vars); none is a credential.
const libuvWindows = process.platform === 'win32' ? ['LOGONSERVER', 'USERDOMAIN', 'USERNAME'] : []
const allowed = new Set([...MSP_RUNTIME_ENV_NAMES, ...MSP_OS_ENV_NAMES, ...libuvWindows])

function run(script, args, env) {
  const child = spawn(process.execPath, [script, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  const waitFor = (marker) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${marker}; stdout=${stdout} stderr=${stderr}`)), 10_000)
    const check = () => {
      if (!stdout.includes(marker)) return
      clearTimeout(timer)
      child.stdout.off('data', check)
      resolve()
    }
    child.stdout.on('data', check)
    check()
  })
  return { child, exited, waitFor }
}

const reportOf = (stdout) => JSON.parse(stdout.trim().split('\n').at(-1))

describe('ki17-worker-msp-launcher, executed', () => {
  it('hands the MSP child the filtered environment only and exits with the child’s code', async () => {
    const env = { ...osBasics(), ...DECOY_SECRETS, ...MSP_CONFIGURATION }
    const names = [...Object.keys(MSP_CONFIGURATION), ...Object.keys(DECOY_SECRETS)]
    const { exited } = run(launcher, [process.execPath, fakeChild, 'report', '7', ...names], env)
    const { code, stdout, stderr } = await exited
    expect(stderr).toBe('')
    expect(code).toBe(7)
    const report = reportOf(stdout)
    for (const name of Object.keys(DECOY_SECRETS)) {
      expect(report.names).not.toContain(name)
      expect(report.values[name]).toBeNull()
    }
    expect(report.values).toMatchObject(MSP_CONFIGURATION)
    // Windows may add its own per-drive entries (=C:); anything else must be allowlisted.
    expect(report.names.filter((name) => !name.startsWith('=') && !allowed.has(name.toUpperCase()))).toEqual([])
  }, 20_000)

  it('reads the HTTP-mode secret file in the launcher and passes the value, not the path', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zuri-launcher-secret-'))
    try {
      const bearerFile = path.join(directory, 'relay-credential')
      writeFileSync(bearerFile, 'mounted-gks-bearer-secret\n', { mode: 0o600 })
      const env = {
        ...osBasics(), ...DECOY_SECRETS, ...MSP_CONFIGURATION,
        MSP_GKS_TRANSPORT: 'http', MSP_GKS_HTTP_URL: 'http://gks-http:8787',
        GKS_MSP_RELAY_CREDENTIAL_FILE: bearerFile,
        GKS_DB_PATH: '/var/lib/zuri-ki17/state/gks.sqlite',
      }
      const names = ['GKS_MSP_RELAY_CREDENTIAL', 'GKS_MSP_RELAY_CREDENTIAL_FILE', 'GKS_MSP_AUTH_REQUIRED', 'GKS_DB_PATH']
      const { code, stdout } = await run(launcher, [process.execPath, fakeChild, 'report', '0', ...names], env).exited
      expect(code).toBe(0)
      expect(reportOf(stdout).values).toEqual({
        GKS_MSP_RELAY_CREDENTIAL: 'mounted-gks-bearer-secret',
        GKS_MSP_RELAY_CREDENTIAL_FILE: null,
        GKS_MSP_AUTH_REQUIRED: '1',
        GKS_DB_PATH: null,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 20_000)

  it('fails closed without starting MSP when the HTTP-mode secret file is missing, naming only the variable', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zuri-launcher-secret-'))
    try {
      const env = {
        ...osBasics(), ...MSP_CONFIGURATION,
        MSP_GKS_TRANSPORT: 'http',
        GKS_MSP_RELAY_CREDENTIAL_FILE: path.join(directory, 'missing'),
      }
      const { code, stdout, stderr } = await run(launcher, [process.execPath, fakeChild, 'report', '0'], env).exited
      expect(code).not.toBe(0)
      expect(stdout).toBe('')
      expect(stderr).toContain('GKS_MSP_RELAY_CREDENTIAL_FILE could not be read')
      expect(stderr).not.toContain(directory)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 20_000)

  it('forwards the SIGTERM handler to the MSP child (in-process signal, every platform)', async () => {
    const { child, exited, waitFor } = run(harness, [process.execPath, fakeChild, 'wait', '42'], { ...osBasics() })
    await waitFor('FAKE_MSP_READY')
    child.stdin.end('TERM\n')
    const { code, stdout } = await exited
    if (process.platform === 'win32') {
      // child.kill('SIGTERM') is TerminateProcess on Windows: the child cannot run
      // a handler, and the launcher maps the signal exit to 143.
      expect(code).toBe(143)
    } else {
      expect(stdout).toContain('FAKE_MSP_SIGTERM')
      expect(code).toBe(42)
    }
  }, 20_000)

  // A signal sent from another process cannot be caught on Windows (Node's
  // kill() there is TerminateProcess), so the launcher's handler never runs and
  // the child would be orphaned by the test itself. The in-process test above
  // covers the handler on Windows; this one covers real OS delivery elsewhere.
  it.skipIf(process.platform === 'win32')('passes an OS-delivered SIGTERM on to the MSP child and exits with its code', async () => {
    const { child, exited, waitFor } = run(launcher, [process.execPath, fakeChild, 'wait', '42'], { ...osBasics() })
    await waitFor('FAKE_MSP_READY')
    child.kill('SIGTERM')
    const { code, stdout } = await exited
    expect(stdout).toContain('FAKE_MSP_SIGTERM')
    expect(code).toBe(42)
  }, 20_000)
})
