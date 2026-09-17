import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createMspTransportFromEnvironment } from '../../src/modules/agent/msp-stdio-transport.js'
import { createMspThreadMemoryPort } from '../../src/modules/agent/msp-thread-memory-port.js'

// @req FR-232, FR-234 — opt-in compatibility proof against a real API-011 server.
// @spec ADR-091, SEC-018
// @tested this file
// MSP_REPO_PATH must name an explicitly selected, pinned local checkout. No
// production database or credentials are read. Every call starts a new process.
test('real MemoryOS: signed grants, restarted recall, isolation, receipts, leave and erasure', async () => {
  const repo = process.env.MSP_REPO_PATH
  assert.ok(repo, 'MSP_REPO_PATH is required; absence is NOT a passing acceptance')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-memos-acceptance-'))
  const key = randomBytes(32).toString('hex')
  const env = { ...process.env, ZURI_MSP_COMMAND: process.execPath,
    ZURI_MSP_ARGS: JSON.stringify([path.join(repo, 'apps/msp-server/bin/msp-server.mjs')]),
    ZURI_MSP_CWD: repo, MSP_DB_PATH: path.join(scratch, 'isolated.sqlite'),
    MSP_THREAD_SERVICE_KEY: key, MSP_IDENTITY_HMAC_KEY: randomBytes(32).toString('hex'),
    MSP_GKS_COMMAND: '', MSP_THREAD_SERVICE_KEYRING: '', MSP_THREAD_RETENTION_DAYS: '0' }
  const { buildGksChildEnv } = await import(pathToFileURL(path.join(repo, 'apps/msp-server/src/providers/gks-stdio-provider.mjs')))
  assert.ok(!Object.hasOwn(buildGksChildEnv(env), 'MSP_THREAD_SERVICE_KEY'))
  assert.ok(!Object.hasOwn(buildGksChildEnv(env), 'MSP_IDENTITY_HMAC_KEY'))
  const transport = createMspTransportFromEnvironment(env)
  const port = createMspThreadMemoryPort({ transport, serviceKey: key, workspaceId: 'acceptance-workspace' })
  const route = { threadKind: 'DIRECT', audienceKind: 'DIRECT', tenantId: 'acceptance-tenant', businessId: 'acceptance-business',
    channelType: 'LINE', channelAccountId: 'acceptance-oa', externalRoomRef: 'acceptance-room' }
  const authorization = { authContext: { actor: { principalId: 'acceptance-person' },
    scope: { tenantId: route.tenantId, businessId: route.businessId },
    policy: { version: 'acceptance-v1', decision: 'ALLOW', privateMemoryAllowed: true,
      mspAuthorization: { read: true, writePrivate: false } } } }
  try {
    const resolved = await port.resolveThread(route)
    const threadId = resolved.thread.threadId
    const inbound = await port.appendMessage({ threadId, speakerId: 'acceptance-person', speakerKind: 'HUMAN',
      personId: 'acceptance-person', identityAssurance: 'VERIFIED', direction: 'INBOUND',
      text: 'ชอบของขวัญสีฟ้า', sourceEventId: 'acceptance-event', authorization })
    const context = await port.context({ threadId, requesterId: 'acceptance-person', authorization })
    assert.match(JSON.stringify(context.recentExchanges), /ชอบของขวัญสีฟ้า/)
    const wrongPerson = { authContext: { ...authorization.authContext, actor: { principalId: 'another-person' } } }
    await assert.rejects(port.context({ threadId, authorization: wrongPerson }), /thread_scope_denied/)
    const wrongAgent = createMspThreadMemoryPort({ transport, serviceKey: key, workspaceId: 'acceptance-workspace', agentId: 'other-agent' })
    await assert.rejects(wrongAgent.resolveThread(route), /agent_not_current/)
    const packet = port.buildContextPacket({ authorization, threadContext: context })
    let invocations = 0
    const model = port.withInjectionReceipt({ model: { provider: 'synthetic-test', model: 'no-inference',
      async generate() { invocations++; return { status: 'ok', text: 'acknowledged' } } },
      contextPacket: packet, threadId, exchangeId: inbound.message.exchangeId, authorization, contextReceiptId: 'ctxrcpt_acceptance' })
    assert.equal((await model.generate({})).status, 'ok')
    assert.equal(invocations, 1)
    const delivery = await port.recordDelivery({ route, inboundMessageId: inbound.message.messageId,
      receiptId: 'accepted-outbound', text: 'รับทราบสีฟ้า', providerRef: 'synthetic-line-acceptance', outcome: 'ACCEPTED' })
    assert.equal(delivery.receiptId, 'accepted-outbound')
    assert.equal(delivery.outcome, 'ACCEPTED')
    assert.ok(delivery.messageId)
    const withAssistant = await port.context({ threadId, authorization })
    assert.match(JSON.stringify(withAssistant.recentExchanges), /รับทราบสีฟ้า/)
    await assert.rejects(port.participantLifecycle({ threadId, action: 'leave', speakerId: 'acceptance-person', authorization }), /LIFECYCLE_SCOPE_DENIED/)
    const lifecycleAuthorization = { authContext: { ...authorization.authContext,
      policy: { ...authorization.authContext.policy, mspAuthorization: { read: true, assertParticipants: true, dataSubjectAccess: true } } } }
    await port.participantLifecycle({ threadId, action: 'leave', speakerId: 'acceptance-person', authorization: lifecycleAuthorization })
    await assert.rejects(port.context({ threadId, authorization }), /thread_scope_denied/)
    const erased = await port.erasePrincipal({ threadId, idempotencyKey: 'acceptance-erase', authorization: lifecycleAuthorization })
    assert.ok(erased)
    const replay = await port.erasePrincipal({ threadId, idempotencyKey: 'acceptance-erase', authorization: lifecycleAuthorization })
    assert.equal(replay.erasureReceiptId, erased.erasureReceiptId)
    assert.equal(replay.replay, true)
    assert.deepEqual(replay.tablesAffected, erased.tablesAffected)
    await assert.rejects(port.context({ threadId, authorization }), /thread_scope_denied|agent_not_current/)
    const relinkedRoute = { ...route, externalRoomRef: 'relink-room' }
    const relinked = await port.resolveThread(relinkedRoute)
    await port.appendMessage({ threadId: relinked.thread.threadId, speakerId: 'acceptance-person', speakerKind: 'HUMAN',
      personId: 'acceptance-person', identityAssurance: 'VERIFIED', direction: 'INBOUND',
      text: 'before relink', sourceEventId: 'relink-event', authorization })
    const relinkAuth = { authContext: { ...lifecycleAuthorization.authContext,
      policy: { ...lifecycleAuthorization.authContext.policy,
        mspAuthorization: { ...lifecycleAuthorization.authContext.policy.mspAuthorization, assertRelink: true } } } }
    await port.participantLifecycle({ threadId: relinked.thread.threadId, action: 'close_for_relink', authorization: relinkAuth })
    await assert.rejects(port.context({ threadId: relinked.thread.threadId, authorization }), /thread_scope_denied/)
    console.log('ISOLATED_REAL_PROCESS_PASS: restart recall, scope denial, current agent, API011 receipt, leave, erase replay; model is synthetic, no LINE/GKS query/production activation')
  } finally {
    // The fresh transport child closes in finally; allow Windows to release its
    // DB handle before removing this harness-owned temporary directory.
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
