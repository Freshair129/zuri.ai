import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'

// @req FR-028, FR-050, FR-052 — the LINE round trip across both runtimes.
// @spec BR-011 — zuri-cli owns signature verification and the Reply API; zuri-ai owns
//   knowledge/provider/answer policy. Neither repository could prove the whole path.
// @spec NFR-017 — one correlation id, minted by the transport, reaching the audit row.
//
// THE CROSS-REPO HARNESS
// ----------------------
// Every hop of the LINE path was implemented and tested, and the path still had no
// proof: zuri-ai's suite stops at its own HTTP boundary and zuri-cli's stops at
// `stack.forward`. A contract can be pinned on both sides and still not meet.
//
// This drives a genuinely HMAC-signed LINE payload into zuri-cli's REAL webhook
// server, lets its REAL stack client build and authorize the request, runs zuri-ai's
// REAL route and turn, and asserts on what zuri-cli would have handed the LINE Reply
// API. Exactly two things are substituted, both real external boundaries:
//
//   1. the LINE Messaging API      -> a spy on `replyText`
//   2. the network between the two -> the stack client's injectable `fetchFn`
//
// Nothing in ZURI's own chain is mocked: identity, customer, conversation, message
// and audit are all really written.
//
// It is OPT-IN. `ZURI_CLI_DIST` must point at a built zuri-cli `dist/`, because that
// repository is not a dependency of this one and CI has no copy of it. No machine
// path is committed. When the variable is absent the suite is skipped by name, so a
// green run never silently implies this ran.
//   Run it with:  ZURI_CLI_DIST=<path-to-zuri-cli>/dist npx vitest run <this file>

const DIST = process.env.ZURI_CLI_DIST
const describeRoundTrip = DIST ? describe : describe.skip

const CHANNEL_SECRET = 'harness-line-channel-secret'
const DESTINATION = 'Uharness-oa'
const BINDING_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const BINDING_BEARER = 'harness-binding-bearer-long-enough-for-the-client'

const load = (relative) =>
  import(pathToFileURL(path.join(DIST, relative)).href)

const RECORD = (businessId) => ({
  knowledge_id: 'sg:sku:RT-1', business_id: businessId, knowledge_type: 'PRODUCT',
  product_code: 'RT-1', name: 'ชุดของขวัญรอบทดสอบ', category: 'GIFTSET', description: null,
  unit: 'ชุด', sell_price: 780, currency: 'THB', moq: 12, colors: [],
  specification: {}, source_ref: 'catalog:roundtrip',
  source_sha256: 'f'.repeat(64), as_of: '2026-08-12T00:00:00.000Z',
  approved_at: '2026-08-14T00:00:00.000Z', is_active: true,
  sensitivity: 'PUBLIC', contract_version: '1.0.0',
})

describeRoundTrip('LINE OA round trip across zuri-cli and zuri-ai (BR-011)', () => {
  let tenant, business, server, baseUrl, historyRoot
  const replies = []
  let modelCalls = 0

  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'RoundTrip Group', code: 'PF-RT' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'RoundTrip Tenant', code: 'TNT-RT' })
    business = await createBusiness({ tenantId: tenant.id, name: 'RoundTrip Business', code: 'BUS-RT' })

    const { createLineWebhookServer } = await load('history/webhook-server.js')
    const { ZuriStackClient } = await load('stack/stack-client.js')

    // --- zuri-ai: the real route, with only its two ports stubbed -------------
    const zuriAi = createLineWebhookPost({
      logger: { info() {}, warn() {}, error() {}, debug() {}, emit() {} },
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async (input) => {
            // the real binding contract: bearer + bindingId + destination
            if (
              input.bindingId !== BINDING_ID ||
              input.destination !== DESTINATION ||
              input.authorization !== `Bearer ${BINDING_BEARER}`
            ) {
              const error = new Error('PHASE1_BINDING_UNAUTHORIZED')
              error.status = 401
              throw error
            }
            return { id: BINDING_ID, tenantId: tenant.id, businessId: business.id }
          },
        },
        businessKnowledge: {
          query: async (scope) => ({
            queryId: 'product_detail', queryVersion: '1.0.0', businessId: scope.businessId,
            sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z',
            records: [RECORD(scope.businessId)],
          }),
        },
        model: {
          provider: 'openai', model: 'harness-model',
          generate: async () => {
            modelCalls += 1
            return {
              provider: 'openai', model: 'harness-model', status: 'ok',
              text: 'RT-1 ราคา 780 บาท ขั้นต่ำ 12 ชุด',
            }
          },
        },
      }),
    })

    // --- zuri-cli: the real stack client, network swapped for a direct call ---
    const client = new ZuriStackClient({
      baseUrl: 'http://zuri-ai.harness',
      bindingId: BINDING_ID,
      bindingBearer: BINDING_BEARER,
      fetchFn: (url, init) => zuriAi(new Request(url, init)),
    })

    // --- zuri-cli: the real webhook server, Reply API swapped for a spy -------
    historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-roundtrip-'))
    server = createLineWebhookServer({
      port: 0,
      channelSecret: CHANNEL_SECRET,
      historyRoot,
      historyHashKey: 'harness-history-hash-key',
      retentionDays: 7,
      groupAliases: {},
      allowedGroupAliases: [],
      stack: {
        replyEnabled: true,
        forward: (events, destination, correlationId) =>
          client.forwardLineEvents(events, destination || '', correlationId),
        replyText: async (replyToken, text) => {
          replies.push({ replyToken, text })
          return { status: 'ACCEPTED_BY_LINE' }
        },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}/webhook/line`
  })

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (historyRoot) fs.rmSync(historyRoot, { recursive: true, force: true })
  })

  /** A LINE delivery, signed the way LINE signs it. */
  const deliver = (events, { secret = CHANNEL_SECRET } = {}) => {
    const body = JSON.stringify({ destination: DESTINATION, events })
    const signature = crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64')
    return fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-line-signature': signature },
      body,
    })
  }

  const textEvent = (userId, text, messageId, webhookEventId, replyToken) => ({
    type: 'message',
    webhookEventId,
    replyToken,
    source: { type: 'user', userId },
    message: { id: messageId, type: 'text', text },
  })

  it('carries a signed LINE message to a grounded reply and back out to LINE', async () => {
    const response = await deliver([
      textEvent('Urt-1', 'RT-1 ราคาเท่าไร', 'MRT-1', 'WEH-RT-1', 'reply-token-rt-1'),
    ])
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.replied).toBe(1)

    // --- the reply LINE would have received -------------------------------
    expect(replies).toHaveLength(1)
    expect(replies[0].replyToken).toBe('reply-token-rt-1')
    // the answer came from zuri-ai's grounded evidence, not a transport fallback
    expect(replies[0].text).toContain('780')
    expect(modelCalls).toBe(1)

    // --- zuri-ai really persisted the turn ---------------------------------
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MRT-1' } })
    expect(message).not.toBeNull()
    const conversation = await prisma.conversation.findUnique({ where: { id: message.conversationId } })
    expect(conversation).toMatchObject({ tenantId: tenant.id, channel: 'LINE', externalThreadId: 'Urt-1' })

    // --- one correlation id, minted by the transport, on the audit row -----
    expect(body.correlationId).toMatch(/^cli-[0-9a-f-]{36}$/)
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'CONVERSATION', entityId: conversation.id, action: 'MESSAGE_INGESTED' },
    })
    expect(JSON.parse(audit.payloadJson).correlationId).toBe(body.correlationId)
  })

  it('rejects a payload signed with the wrong secret, before anything happens', async () => {
    const before = replies.length
    const response = await deliver(
      [textEvent('Urt-2', 'RT-1 ราคาเท่าไร', 'MRT-2', 'WEH-RT-2', 'reply-token-rt-2')],
      { secret: 'not-the-channel-secret' },
    )

    expect(response.status).toBe(401)
    expect(replies.length).toBe(before)
    // no turn ran, so nothing reached zuri-ai's write path
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MRT-2' } })).toBeNull()
  })

  it('replies once when LINE redelivers the same event', async () => {
    const event = textEvent('Urt-3', 'RT-1 ราคาเท่าไร', 'MRT-3', 'WEH-RT-3', 'reply-token-rt-3')
    const modelBefore = modelCalls

    const first = await (await deliver([event])).json()
    const replayResponse = await deliver([event])
    const replay = await replayResponse.json()

    expect(first.replied).toBe(1)
    // the transport's own dedupe suppresses the second before zuri-ai is asked again
    expect(replay.replied).toBe(0)
    expect(replay.replyDuplicate).toBe(1)
    expect(modelCalls).toBe(modelBefore + 1)

    const stored = await prisma.message.findMany({ where: { externalMessageId: 'MRT-3' } })
    expect(stored).toHaveLength(1)
    // a suppressed duplicate is still traceable to the delivery that suppressed it
    expect(replay.correlationId).not.toBe(first.correlationId)
  })

  it('falls back to the transport message rather than silence when the turn fails', async () => {
    // zuri-ai answers only what it can ground; an unanswerable turn must still leave
    // the customer with something, and it must not be a zuri-ai internal error string
    const before = replies.length
    const response = await deliver([
      textEvent('Urt-4', '', 'MRT-4', 'WEH-RT-4', 'reply-token-rt-4'),
    ])
    const body = await response.json()

    expect(response.status).toBe(200)
    // asserted, not guarded by an `if`: silence is the failure this test exists for
    expect(body.replied).toBe(1)
    expect(replies.length).toBe(before + 1)

    const sent = replies.at(-1)
    expect(sent.replyToken).toBe('reply-token-rt-4')
    expect(sent.text.trim()).not.toBe('')
    // and the customer must never be shown a code from either runtime's failure path
    expect(sent.text).not.toMatch(/PHASE1_|ZURI_STACK_|QUESTION_REQUIRED|Error:/)
  })

  it('never lets the reply token cross into zuri-ai', async () => {
    // BR-011's single reply owner, checked on the wire rather than by inspection
    const seen = []
    const { ZuriStackClient } = await load('stack/stack-client.js')
    const client = new ZuriStackClient({
      baseUrl: 'http://zuri-ai.harness',
      bindingId: BINDING_ID,
      bindingBearer: BINDING_BEARER,
      fetchFn: async (url, init) => {
        seen.push(String(init?.body ?? ''))
        return new Response(JSON.stringify({ handled: 0, results: [] }), { status: 200 })
      },
    })
    await client.forwardLineEvents(
      [textEvent('Urt-5', 'hi', 'MRT-5', 'WEH-RT-5', 'reply-token-rt-5')],
      DESTINATION,
      'cli-00000000-0000-4000-8000-000000000000',
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toContain('reply-token-rt-5')
    expect(seen[0]).not.toContain('replyToken')
  })
})
