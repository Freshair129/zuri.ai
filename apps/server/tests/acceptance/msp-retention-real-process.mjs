import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// @req FR-230 — real API-011 age sweep, fresh-process reads and replay refusal.
// @spec SEC-031, ADR-091 — synthetic keys/data only, never an ambient MSP DB.
// @tested this file
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context) } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && context.parentURL?.includes('/src/modules/agent/')) return next(specifier + '.js', context)
    throw error
  }
} })
const { createMspTransportFromEnvironment, createMspStdioTransport } = await import('../../src/modules/agent/msp-stdio-transport.js')
const { createMspThreadMemoryPort } = await import('../../src/modules/agent/msp-thread-memory-port.js')
const { createMspRetentionPort } = await import('../../src/modules/agent/msp-retention-port.mjs')

test('maintenance transport waits for actual Linux child exit before releasing its fence', async () => {
  assert.equal(process.platform, 'linux', 'This production-signal test requires the explicit Linux artifact')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-exit-'))
  const marker = path.join(scratch, 'exited'), server = path.join(scratch, 'child.mjs')
  fs.writeFileSync(server, `import fs from 'node:fs'; import readline from 'node:readline';
    process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(process.argv[2], 'done'); process.exit(0) }, 150));
    readline.createInterface({ input: process.stdin }).on('line', line => { const q=JSON.parse(line); if(q.id) console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{structuredContent:{ok:true}}})) });`)
  try {
    const transport = createMspStdioTransport({ command: process.execPath, args: [server, marker], awaitChildExit: true })
    assert.deepEqual(await transport('maintenance', {}), { ok: true })
    assert.ok(fs.existsSync(marker), 'The child has actually terminated, not just received a signal')
  } finally { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('maintenance timeout also waits for the child before reporting UNKNOWN', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-timeout-'))
  const marker = path.join(scratch, 'exited'), server = path.join(scratch, 'child.mjs')
  fs.writeFileSync(server, `import fs from 'node:fs'; import readline from 'node:readline';
    process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(process.argv[2], 'done'); process.exit(0) }, 150));
    readline.createInterface({ input: process.stdin }).on('line', line => { const q=JSON.parse(line); if(q.id && q.method==='initialize') console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{}})) });`)
  try {
    const transport = createMspStdioTransport({ command: process.execPath, args: [server, marker], timeoutMs: 300, awaitChildExit: true })
    await assert.rejects(transport('maintenance', {}), /timed out/)
    assert.ok(fs.existsSync(marker))
  } finally { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('maintenance escalates SIGTERM to SIGKILL and confirms the actual PID exited', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-kill-'))
  const server = path.join(scratch, 'child.mjs')
  fs.writeFileSync(server, `import readline from 'node:readline'; process.on('SIGTERM', () => {});
    readline.createInterface({input:process.stdin}).on('line', line => {const q=JSON.parse(line); if(q.id) console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{structuredContent:{pid:process.pid}}}))});`)
  try {
    const transport = createMspStdioTransport({ command: process.execPath, args: [server], awaitChildExit: true })
    const { pid } = await transport('maintenance', {})
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    const absent = createMspStdioTransport({ command: '/definitely-missing-msp-binary', awaitChildExit: true })
    await assert.rejects(absent('maintenance', {}), /ENOENT/)
  } finally { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('real pinned MSP retention process', async t => {
  assert.ok(process.env.MSP_REPO_PATH, 'Explicit MSP artifact required; absence is not PASS')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-retention-'))
  const tenantId = randomUUID(), foreignTenant = randomUUID(), workspaceId = randomUUID(), key = randomBytes(32).toString('hex')
  const env = { PATH: process.env.PATH, HOME: scratch, SYSTEMROOT: process.env.SYSTEMROOT,
    ZURI_MSP_COMMAND: process.env.MSP_NODE_COMMAND || process.execPath,
    ZURI_MSP_ARGS: JSON.stringify([path.join(process.env.MSP_REPO_PATH, 'apps/msp-server/bin/msp-server.mjs')]),
    ZURI_MSP_CWD: process.env.MSP_REPO_PATH, MSP_DB_PATH: path.join(scratch, 'memory.sqlite'),
    MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenantId]: key, [foreignTenant]: key }),
    MSP_IDENTITY_HMAC_KEY: randomBytes(32).toString('hex'), MSP_IDENTITY_HMAC_KEY_VERSION: 'retention-test-v1',
    MSP_THREAD_RETENTION_DAYS: '30', ZURI_MSP_TIMEOUT_MS: '15000' }
  // New child for every call: no process-local state can manufacture recall.
  const transport = createMspTransportFromEnvironment(env, { awaitChildExit: true })
  const port = createMspRetentionPort({ tenantId, workspaceId, serviceKey: key, retentionDays: 30, transport })
  const oldText = 'expired-retention-marker', freshText = 'fresh-retention-marker', foreignText = 'foreign-expired-marker'
  const auth = tenant => ({ authContext: { actor: { principalId: 'retention-person' }, scope: { tenantId: tenant, businessId: null },
    policy: { decision: 'ALLOW', privateMemoryAllowed: true, mspAuthorization: { read: true, writePrivate: true } } } })
  const threadPort = () => createMspThreadMemoryPort({ transport, workspaceId, serviceKey: key })
  const route = tenant => ({ tenantId: tenant, threadKind: 'DIRECT', channelType: 'LINE', channelAccountId: 'retention-oa', externalRoomRef: 'retention-room' })
  const old = new Date(Date.now() - 60 * 86400000).toISOString()
  async function seed(tenant, text, occurredAt) {
    const p = threadPort(), r = await p.resolveThread(route(tenant))
    const appended = await p.appendMessage({ threadId: r.thread.threadId, speakerId: 'retention-person', speakerKind: 'HUMAN', identityAssurance: 'VERIFIED',
      direction: 'INBOUND', text, occurredAt, sourceEventId: randomUUID(), authorization: auth(tenant) })
    await p.recordDelivery({ route: route(tenant), inboundMessageId: appended.message.messageId, text: 'ack', receiptId: randomUUID(), outcome: 'ACCEPTED' })
    return r.thread.threadId
  }
  let localThread, foreignThread
  const read = async (tenant, threadId) => { const p = threadPort(); p.bindTrustedRoute(threadId, { ...route(tenant), audienceKind: 'DIRECT' }); return p.context({ threadId, authorization: auth(tenant), requesterId: 'retention-person' }) }
  try {
    await t.test('seed isolated old/fresh/foreign messages through the real signed interface', async () => {
      localThread = await seed(tenantId, oldText, old); await seed(tenantId, freshText, new Date().toISOString())
      foreignThread = await seed(foreignTenant, foreignText, old)
      assert.ok(JSON.stringify(await read(tenantId, localThread)).includes(oldText))
    })
    await t.test('dry-run reports candidates but preserves their content', async () => {
      const value = await port.tick({ dryRun: true }); assert.equal(value.tablesAffected.threadMessages, 1)
      assert.ok(JSON.stringify(await read(tenantId, localThread)).includes(oldText))
    })
    await t.test('live tick tombstones old content; fresh and foreign content remain', async () => {
      assert.equal((await port.tick()).tablesAffected.threadMessages, 1)
      const recalled = JSON.stringify(await read(tenantId, localThread))
      assert.ok(!recalled.includes(oldText)); assert.ok(recalled.includes(freshText))
      assert.ok(JSON.stringify(await read(foreignTenant, foreignThread)).includes(foreignText))
      assert.equal((await port.tick()).tablesAffected.threadMessages, 0)
    })
    await t.test('unsigned, wrong operator, tampered payload, foreign tenant and nonce replay are refused', async () => {
      const tool = 'msp_thread_retention_tick', input = { dry_run: false }
      const sign = claims => { const grant = { tenantId, workspaceId, agentId: 'retention-worker', principalId: 'retention-worker', policyRevision: 'test-v1', operator: true, nonce: randomUUID(), operation: tool,
        expiresAt: Date.now() + 60000, payloadHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), ...claims }
        return { ...input, access: { grant, signature: createHmac('sha256', key).update(JSON.stringify(grant)).digest('hex') } } }
      await assert.rejects(transport(tool, input))
      await assert.rejects(transport(tool, sign({ operator: false })), /operator/)
      const tampered = sign({}); tampered.dry_run = true; await assert.rejects(transport(tool, tampered), /grant|payload/)
      await assert.rejects(transport(tool, sign({ tenantId: randomUUID() })), /grant_unconfigured/)
      const signed = sign({}); await transport(tool, signed); await assert.rejects(transport(tool, signed), /replay/i)
    })
  } finally { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
