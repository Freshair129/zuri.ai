// @req FR-267 — native sockets and an isolated trusted-CA child, not mocked fetch.
// @spec ADR-099 D10, ADR-100 D7
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { createMockPrivateRuntime } from '../scripts/mock-private-runtime.mjs'
import { createModelPort } from '../src/model-port.js'

const exec = promisify(execFile)
const certificate = fileURLToPath(new URL('./fixtures/prp-tls/TEST-ONLY-cert.pem', import.meta.url))
const cert = await readFile(certificate)
const key = await readFile(new URL('./fixtures/prp-tls/TEST-ONLY-key.pem', import.meta.url))
const probe = fileURLToPath(new URL('../scripts/probe-private-runtime.mjs', import.meta.url))
async function listen(server, host = '127.0.0.1') {
  await new Promise(resolve => server.listen(0, host, resolve))
  return `https://${host}:${server.address().port}`
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }

test('real HTTPS PRP request path validates alias/auth and completes through the production Runtime adapter', async () => {
  const { server, state } = createMockPrivateRuntime({ cert, key })
  const baseUrl = await listen(server)
  const dir = await mkdtemp(`${tmpdir()}/zuri-prp-`)
  const keyFile = `${dir}/test-key`
  await writeFile(keyFile, 'synthetic-business-a-key', { mode: 0o600 })
  try {
    const { stdout, stderr } = await exec(process.execPath, [probe], { timeout: 15_000, windowsHide: true,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate, ZURI_PRIVATE_RUNTIME_BASE_URL: baseUrl,
        ZURI_PRIVATE_RUNTIME_PROBE_MODEL: 'local-alias', ZURI_PRIVATE_RUNTIME_PROBE_KEY_FILE: keyFile,
        ZURI_PRIVATE_RUNTIME_PROBE_DENIED_MODEL: 'business-b-alias' } })
    assert.equal(JSON.parse(stdout).status, 'PASS')
    assert.equal(JSON.parse(stdout).unauthorizedAlias, 'PASS')
    assert.equal(stderr, '')
    assert.deepEqual(state, { models: 1, completions: 1, rejected: 1 })
    assert.doesNotMatch(stdout, /synthetic-business-a-key|private synthetic reasoning/)
  } finally { await close(server); await rm(dir, { recursive: true, force: true }) }
})

test('default TLS rejects an untrusted certificate and dispatches no authenticated HTTP request', async () => {
  const { server, state } = createMockPrivateRuntime({ cert, key })
  const baseUrl = await listen(server)
  try {
    await assert.rejects(createModelPort({ privateRuntimeBaseUrl: baseUrl }).generate({
      question: 'q', evidence: { records: [] }, credential: { provider: 'prp', model: 'local-alias', apiKey: 'synthetic-business-a-key', baseUrl },
      deadlineAt: new Date(Date.now() + 2000).toISOString(),
    }), /MODEL_PROVIDER_NETWORK_ERROR/)
    assert.deepEqual(state, { models: 0, completions: 0, rejected: 0 })
  } finally { await close(server) }
})

test('trusting a CA does not admit a certificate for the wrong IP', async () => {
  const { server, state } = createMockPrivateRuntime({ cert, key })
  const baseUrl = await listen(server, '127.0.0.2')
  const dir = await mkdtemp(`${tmpdir()}/zuri-prp-`)
  await writeFile(`${dir}/key`, 'synthetic-business-a-key')
  try {
    await assert.rejects(exec(process.execPath, [probe], { timeout: 15_000, windowsHide: true,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate, ZURI_PRIVATE_RUNTIME_BASE_URL: baseUrl,
        ZURI_PRIVATE_RUNTIME_PROBE_MODEL: 'local-alias', ZURI_PRIVATE_RUNTIME_PROBE_KEY_FILE: `${dir}/key` } }), error => {
      assert.match(error.stderr, /PROBE_TRANSPORT_FAILED/)
      return true
    })
    assert.deepEqual(state, { models: 0, completions: 0, rejected: 0 })
  } finally { await close(server); await rm(dir, { recursive: true, force: true }) }
})

test('a trusted TLS origin cannot redirect a credential to a second origin', async () => {
  let trapped = 0
  const trap = createServer((req, res) => { trapped++; res.end('{}') })
  await listen(trap)
  const { server } = createMockPrivateRuntime({ cert, key, redirectUrl: `http://127.0.0.1:${trap.address().port}/stolen` })
  const baseUrl = await listen(server)
  const dir = await mkdtemp(`${tmpdir()}/zuri-prp-`)
  await writeFile(`${dir}/key`, 'synthetic-business-a-key')
  try {
    await assert.rejects(exec(process.execPath, [probe], { timeout: 15_000, windowsHide: true,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate, ZURI_PRIVATE_RUNTIME_BASE_URL: baseUrl,
        ZURI_PRIVATE_RUNTIME_PROBE_MODEL: 'local-alias', ZURI_PRIVATE_RUNTIME_PROBE_KEY_FILE: `${dir}/key` } }), error => {
      assert.match(error.stderr, /PROBE_TRANSPORT_FAILED/)
      assert.doesNotMatch(error.stderr, /synthetic-business-a-key/)
      return true
    })
    assert.equal(trapped, 0)
  } finally { await close(server); await close(trap); await rm(dir, { recursive: true, force: true }) }
})
