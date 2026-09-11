import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMspChildEnvironment, createMspStdioTransport, createMspTransportFromEnvironment, MSP_OS_ENV_NAMES, MSP_RUNTIME_ENV_NAMES } from '@/modules/agent/msp-stdio-transport'

// @req FR-057 — the zuri-ai → MSP transport: MSP's own NDJSON JSON-RPC framing
// over a spawned process, one process per call, tool errors surfaced verbatim,
// and a child environment drawn from an allowlist, never from the server's.
// @spec ADR-068 D1, ADR-043 D2, ADR-050 D3
// @tested tests/unit/msp-stdio-transport.test.js

const echoServer = path.resolve('tests/fixtures/ndjson-echo-server.mjs')

describe('createMspStdioTransport', () => {
  it('speaks initialize → tools/call and returns the structuredContent of the tool', async () => {
    const transport = createMspStdioTransport({ command: process.execPath, args: [echoServer] })
    const result = await transport('msp_knowledge_evidence_export', { scope: { portfolioId: 'p' }, since_cursor: 3 })
    expect(result).toEqual({ echoed: 'msp_knowledge_evidence_export', args: { scope: { portfolioId: 'p' }, since_cursor: 3 } })
  })

  it('surfaces a tool-level error with the tool’s own text, so a fail-closed MSP reason is readable', async () => {
    const transport = createMspStdioTransport({ command: process.execPath, args: [echoServer] })
    await expect(transport('fail', {})).rejects.toMatchObject({ code: 'MSP_TOOL_ERROR', status: 503, message: expect.stringContaining('gks_provider_unconfigured') })
  })

  it('fails closed on a process that exits without answering', async () => {
    const transport = createMspStdioTransport({ command: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 5_000 })
    await expect(transport('anything', {})).rejects.toMatchObject({ code: 'MSP_TRANSPORT_UNAVAILABLE', message: expect.stringContaining('exited with code 3') })
  })

  it('is built from deployment configuration only when ZURI_MSP_COMMAND is set', () => {
    expect(createMspTransportFromEnvironment({})).toBeNull()
    expect(createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: '   ' })).toBeNull()
    expect(typeof createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: 'node', ZURI_MSP_ARGS: '["server.mjs"]' })).toBe('function')
    expect(() => createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: 'node', ZURI_MSP_ARGS: 'not-json' })).toThrow(/JSON array/)
    expect(() => createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: 'node', ZURI_MSP_ARGS: '[1]' })).toThrow(/JSON array/)
  })
})

// Decoy values only. The names are the ones the web container really holds;
// none of them may reach MSP, because MSP hands its environment on to GKS.
const DECOY_SECRETS = {
  DATABASE_URL: 'postgresql://decoy:decoy@db.invalid:5432/decoy',
  DATABASE_POSTGRES_URL: 'postgresql://decoy:decoy@db.invalid:6543/decoy',
  POSTGRES_PASSWORD: 'decoy-postgres-password',
  LINE_CHANNEL_SECRET: 'decoy-line-channel-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'decoy-line-access-token',
  ANTHROPIC_API_KEY: 'decoy-anthropic-key',
  OPENROUTER_API_KEY: 'decoy-openrouter-key',
  ZURI_LINE_SEAL_KEY: 'decoy-seal-key',
  ZURI_SESSION_SECRET: 'decoy-session-secret',
  ZURI_LINE_BINDING_HASH_PEPPER: 'decoy-pepper',
  ZURI_MSP_THREAD_SERVICE_KEY: 'decoy-thread-service-key-0123456789abcdef',
  GENESIS_WORKER_QUERY_TOKEN: 'decoy-worker-query-token',
  NODE_OPTIONS: '--require ./decoy-preload.cjs',
}

// What MSP (and, through MSP, GKS) reads — test values, all of them.
const MSP_CONFIGURATION = {
  MSP_DB_PATH: '/var/lib/zuri-ki17/state/msp.sqlite',
  MSP_GKS_COMMAND: '/opt/ki17/node/bin/node',
  MSP_GKS_ARGS: '["/opt/ki17/gks/apps/gks-server/bin/gks-server.mjs"]',
  MSP_GKS_CWD: '/opt/ki17/gks',
  MSP_PIPELINE_PRINCIPALS: '[]',
  MSP_GKS_PIPELINE_CREDENTIAL: 'test-relay-credential',
  MSP_PIPELINE_WORKER_URL: 'http://127.0.0.1:8790',
  MSP_PIPELINE_WORKER_TOKEN: 'test-worker-token',
  OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  GKS_DB_PATH: '/var/lib/zuri-ki17/state/gks.sqlite',
  GKS_PIPELINE_RELAY_CREDENTIAL: 'test-relay-credential',
  GKS_DEFAULT_PORTFOLIO_ID: 'test-portfolio',
  GKS_AUTOMERGE_FLOOR: '0.9',
}

// This transport's own knobs: they configure the spawn and MSP never reads them.
const TRANSPORT_CONFIGURATION = {
  ZURI_MSP_COMMAND: process.execPath,
  ZURI_MSP_ARGS: JSON.stringify([echoServer]),
  ZURI_MSP_TIMEOUT_MS: '10000',
  ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
}

// The real OS basics of the machine running the test, so the spawned child can
// start on Windows and Linux alike. None of them is a secret.
const osBasics = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => MSP_OS_ENV_NAMES.includes(name.toUpperCase())))

const serverShapedEnvironment = () => ({ ...osBasics(), ...DECOY_SECRETS, ...MSP_CONFIGURATION, ...TRANSPORT_CONFIGURATION })

describe('the MSP child environment', () => {
  it('keeps MSP configuration and OS basics and drops every server secret and transport knob', () => {
    const child = buildMspChildEnvironment(serverShapedEnvironment())
    for (const name of Object.keys(DECOY_SECRETS)) expect(child).not.toHaveProperty(name)
    for (const name of Object.keys(TRANSPORT_CONFIGURATION)) expect(child).not.toHaveProperty(name)
    expect(child).toMatchObject(MSP_CONFIGURATION)
    expect(child).toMatchObject(osBasics())
    expect(Object.keys(child).sort()).toEqual([...Object.keys(osBasics()), ...Object.keys(MSP_CONFIGURATION)].sort())
  })

  it('matches names without case, as Windows does, and keeps their spelling', () => {
    const child = buildMspChildEnvironment({ Path: 'C:\Windows', SystemRoot: 'C:\Windows', windir: 'C:\Windows', database_url: 'decoy' })
    expect(child).toEqual({ Path: 'C:\Windows', SystemRoot: 'C:\Windows', windir: 'C:\Windows' })
  })

  it('names nothing but MSP runtime variables and OS basics', () => {
    for (const name of MSP_RUNTIME_ENV_NAMES) expect(name).toMatch(/^(MSP_|GKS_|OLLAMA_BASE_URL$)/)
    expect([...MSP_RUNTIME_ENV_NAMES, ...MSP_OS_ENV_NAMES].some((name) => name.startsWith('ZURI_'))).toBe(false)
    expect(MSP_OS_ENV_NAMES).not.toContain('NODE_OPTIONS')
  })

  it('reaches the spawned child from deployment configuration without a single decoy secret', async () => {
    const transport = createMspTransportFromEnvironment(serverShapedEnvironment())
    const report = await transport('environment', { names: Object.keys(MSP_CONFIGURATION) })
    for (const name of [...Object.keys(DECOY_SECRETS), ...Object.keys(TRANSPORT_CONFIGURATION)]) expect(report.names).not.toContain(name)
    expect(report.values).toEqual(MSP_CONFIGURATION)
  })

  it('filters an environment passed to the transport directly, and defaults to the filtered process environment', async () => {
    const explicit = createMspStdioTransport({ command: process.execPath, args: [echoServer], env: serverShapedEnvironment() })
    const report = await explicit('environment', { names: ['MSP_DB_PATH'] })
    for (const name of Object.keys(DECOY_SECRETS)) expect(report.names).not.toContain(name)
    expect(report.values).toEqual({ MSP_DB_PATH: MSP_CONFIGURATION.MSP_DB_PATH })

    // On Windows, libuv copies its required variables from the parent into any
    // explicit environment (deps/uv/src/win/process.c, required_vars). The three
    // below are the ones not already allowlisted; none of them is a credential.
    const libuvWindows = process.platform === 'win32' ? ['LOGONSERVER', 'USERDOMAIN', 'USERNAME'] : []
    const allowed = new Set([...MSP_RUNTIME_ENV_NAMES, ...MSP_OS_ENV_NAMES, ...libuvWindows])
    const defaulted = await createMspStdioTransport({ command: process.execPath, args: [echoServer] })('environment', {})
    // Windows may also add its own per-drive entries (=C:); anything else must be allowlisted.
    expect(defaulted.names.filter((name) => !name.startsWith('=') && !allowed.has(name.toUpperCase()))).toEqual([])
  })
})

