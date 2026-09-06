import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { archiveLineWebhookPayload, verifyLineSignature, weeklyArchivePath } from '../../src/history/archive.js';
import { createAdminSessions, hashAdminKey } from '../../src/history/admin-auth.js';
import { createLineWebhookServer } from '../../src/history/webhook-server.js';
import { approve, hashUserId, requestAccess } from '../../src/identity/registry.js';

// @tested SDD-012 — the signed archive and DM routing.

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-history-test-'));
const groupId = 'C0123456789abcdef0123456789abcdef';
const hashKey = 'history-test-key';
const now = new Date('2026-08-11T03:00:00.000Z');

after(() => fs.rmSync(root, { recursive: true, force: true }));

function options() {
  return { root, groupAliases: { leadership: groupId }, allowedGroupAliases: ['leadership'], hashKey, retentionDays: 30, receivedAt: now };
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), message);
}

const GRAPH_TEST_KEY = 'zadm_test_operator_key_for_graph_route';

describe('LINE local weekly archive', () => {
  it('accepts only a correct raw-body signature', () => {
    const body = Buffer.from('{"events":[]}');
    const signature = crypto.createHmac('sha256', 'channel-secret').update(body).digest('base64');
    assert.strictEqual(verifyLineSignature(body, signature, 'channel-secret'), true);
    assert.strictEqual(verifyLineSignature(body, 'wrong', 'channel-secret'), false);
  });

  it('archives one permitted text message as UTF-8 JSONL and hashes identifiers', () => {
    const result = archiveLineWebhookPayload({ events: [{ webhookEventId: 'evt_1', timestamp: now.getTime(), type: 'message', source: { type: 'group', groupId, userId: 'U0123456789abcdef0123456789abcdef' }, message: { id: 'msg_1', type: 'text', text: 'นัดประชุมวันศุกร์' } }] }, options());
    assert.strictEqual(result.archived, 1);
    const record = JSON.parse(fs.readFileSync(result.files[0], 'utf8').trim());
    assert.strictEqual(record.groupAlias, 'leadership');
    assert.strictEqual(record.text, 'นัดประชุมวันศุกร์');
    assert.ok(record.senderHash.startsWith('hmac-sha256:'));
    assert.ok(!JSON.stringify(record).includes(groupId));
  });

  it('deduplicates a replay and ignores a non-permitted group', () => {
    const replay = { webhookEventId: 'evt_1', timestamp: now.getTime(), type: 'message', source: { groupId, userId: 'U0123456789abcdef0123456789abcdef' }, message: { id: 'msg_1', type: 'text', text: 'นัดประชุมวันศุกร์' } };
    assert.strictEqual(archiveLineWebhookPayload({ events: [replay] }, options()).duplicate, 1);
    const ignored = archiveLineWebhookPayload({ events: [{ ...replay, webhookEventId: 'evt_other', source: { groupId: 'C11111111111111111111111111111111' } }] }, options());
    assert.strictEqual(ignored.ignored, 1);
  });

  it('uses ISO-week filenames and prunes only expired archive files', () => {
    assert.match(weeklyArchivePath(root, 'leadership', now), /2026-W33\.jsonl$/);
    const oldFile = path.join(root, 'leadership', '2026-W01.jsonl');
    fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, '{}\n');
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
    const result = archiveLineWebhookPayload({ events: [] }, options());
    assert.ok(result.pruned.includes(oldFile));
    assert.strictEqual(fs.existsSync(oldFile), false);
  });

  it('rejects an unsigned HTTP webhook before parsing or writing', async () => {
    const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
      port: 0,
      channelSecret: 'channel-secret',
      historyRoot: root,
      historyHashKey: hashKey,
      retentionDays: 30,
      groupAliases: { leadership: groupId },
      allowedGroupAliases: ['leadership'],
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/webhook/line`, { method: 'POST', body: '{not-json}' });
      assert.strictEqual(response.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves /api/graph only by proxy, never by opening a GenesisBlock store (T15 Wave-3)', async () => {
    // The invariant this guards is "the agent process never opens a GenesisBlock store", not "the
    // route does not exist". The engine takes an exclusive lock on a store directory even when
    // opened readOnly, so a second opener here would either fail or serve a stale run — which is
    // why the route delegates to the RAG service instead. Pointing it at a closed port proves the
    // delegation: if this handler were reading the store itself it could not care that :9 is dead.
    const previous = process.env.GENESIS_RAG_API_URL;
    process.env.GENESIS_RAG_API_URL = 'http://127.0.0.1:9';
    const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
      port: 0,
      channelSecret: 'channel-secret',
      historyRoot: root,
      historyHashKey: hashKey,
      retentionDays: 30,
      groupAliases: { leadership: groupId },
      allowedGroupAliases: ['leadership'],
      // The viewer reads out the customer's catalogue and pricing, so the route sits behind the
      // operator key like the rest of the console. The test now presents one.
      admin: { keyHash: hashAdminKey(GRAPH_TEST_KEY), sessions: createAdminSessions() },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;

      const unauthenticated = await fetch(`${base}/api/graph`);
      assert.strictEqual(unauthenticated.status, 401, 'the catalogue is not readable without the key');

      const graph = await fetch(`${base}/api/graph`, { headers: { Authorization: `Bearer ${GRAPH_TEST_KEY}` } });
      assert.strictEqual(graph.status, 503, 'an unreachable RAG service must surface as 503');
      const body = (await graph.json()) as Record<string, unknown>;
      assert.strictEqual(body.error, 'RAG_SERVICE_UNAVAILABLE');
      // Answering in the viewer's own shape keeps an outage looking like an empty graph rather
      // than a console stack trace.
      assert.deepStrictEqual(body.nodes, []);
      assert.deepStrictEqual(body.edges, []);
      assert.ok(typeof body.hint === 'string' && body.hint.length > 0, 'must say how to fix it');
      assert.ok(!('service' in body), 'must not fall through to the generic status body');

      // Never implemented, and nothing should start answering it by accident.
      const legacy = await fetch(`${base}/api/graph-data`);
      assert.strictEqual(legacy.status, 404, '/api/graph-data should 404');

      const status = await fetch(`${base}/`);
      const statusBody = (await status.json()) as Record<string, unknown>;
      assert.strictEqual(status.status, 200);
      assert.ok(!('graphApi' in statusBody), 'status body must not advertise a graphApi endpoint');
    } finally {
      if (previous === undefined) delete process.env.GENESIS_RAG_API_URL;
      else process.env.GENESIS_RAG_API_URL = previous;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  // Was 'without archiving its user context'. BR-010 reversed that deliberately: a conversation
  // recorded on one side only cannot show what the OA said, and the same argument that justifies
  // keeping group text justifies keeping this. What the record still refuses to hold is the raw
  // LINE id — the sender is a keyed hash, and the directory is derived from it.
  it('replies once to a signed direct message and archives both halves under a hash', async () => {
    const replies: Array<{ replyToken: string; text: string }> = [];
    const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
      port: 0,
      channelSecret: 'channel-secret',
      historyRoot: root,
      historyHashKey: hashKey,
      retentionDays: 30,
      groupAliases: { leadership: groupId },
      allowedGroupAliases: ['leadership'],
      directMessages: {
        // An unregistered caller is the default case: nothing is known about this user id yet.
        enabled: true,
        identity: { root: path.join(root, 'identity'), hashKey },
        replyText: async (replyToken, text) => { replies.push({ replyToken, text }); },
        answer: () => 'ไม่ควรถูกเรียก เพราะผู้ใช้รายนี้ยังไม่ได้รับอนุมัติ',
        getDisplayName: async () => 'ผู้ทดสอบ',
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const payload = JSON.stringify({
        events: [{
          webhookEventId: 'evt_dm_1',
          type: 'message',
          replyToken: 'reply-token-only',
          source: { type: 'user', userId: 'U0123456789abcdef0123456789abcdef' },
          message: { type: 'text', id: 'msg_dm_1', text: 'ช่วยดูยอดขายให้หน่อย' },
        }],
      });
      const signature = crypto.createHmac('sha256', 'channel-secret').update(payload).digest('base64');
      const request = () => fetch(`http://127.0.0.1:${address.port}/webhook/line`, {
        method: 'POST',
        headers: { 'x-line-signature': signature, 'content-type': 'application/json' },
        body: payload,
      });

      const first = await request();
      assert.strictEqual(first.status, 200);
      // LINE transport is acknowledged immediately; reply counters belong to the
      // asynchronous processing result, not the HTTP envelope.
      const firstBody = await first.json();
      const firstCorrelation = firstBody.correlationId;
      assert.match(firstCorrelation, /^cli-[0-9a-f-]{36}$/);
      assert.deepStrictEqual(firstBody, { status: 'ok', correlationId: firstCorrelation, archived: 1 });
      await waitFor(() => replies.length === 1, 'the asynchronous direct-message reply should complete');
      assert.strictEqual(replies.length, 1);
      assert.strictEqual(replies[0].replyToken, 'reply-token-only');
      // An unknown caller is told only that a request was raised — never anything about the ask.
      assert.match(replies[0].text, /ยังไม่มีสิทธิ์ตอบ/);
      assert.ok(!/ยอดขาย/.test(replies[0].text));
      assert.strictEqual(fs.existsSync(path.join(root, 'dm-poc')), false);

      // Filed under `_dm/<hash>/`, and the raw id appears nowhere in the tree.
      const dmRoot = path.join(root, '_dm');
      assert.ok(fs.existsSync(dmRoot), 'the direct message should be archived');
      const conversations = fs.readdirSync(dmRoot);
      assert.strictEqual(conversations.length, 1);
      assert.match(conversations[0], /^[a-f0-9]{16}$/);
      const weeks = fs.readdirSync(path.join(dmRoot, conversations[0]));
      const contents = weeks
        .map((w) => fs.readFileSync(path.join(dmRoot, conversations[0], w), 'utf8'))
        .join('');
      assert.ok(
        !contents.includes('U0123456789abcdef0123456789abcdef'),
        'a raw LINE id must never reach the archive'
      );
      assert.ok(contents.includes('\"scope\": \"dm\"') || contents.includes('"scope":"dm"'));

      const replay = await request();
      assert.strictEqual(replay.status, 200);
      const replayBody = await replay.json();
      const replayCorrelation = replayBody.correlationId;
      // a redelivery is a different delivery and gets its own id, so a duplicate
      // reply can still be traced back to the exact request that suppressed it
      assert.match(replayCorrelation, /^cli-[0-9a-f-]{36}$/);
      assert.notStrictEqual(replayCorrelation, firstCorrelation);
      // The replay is deduplicated by webhookEventId, so it archives nothing a second time.
      assert.deepStrictEqual(replayBody, { status: 'ok', correlationId: replayCorrelation, archived: 0 });
      await waitFor(() => replies.length === 1, 'the replay must not create another reply');
      assert.strictEqual(replies.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('lets the stack own answer policy while LINE transport replies once across restart', async () => {
    const stackCalls: unknown[][] = [];
    const replies: Array<{ replyToken: string; text: string }> = [];
    const payload = JSON.stringify({
      destination: 'U-smartgift-destination',
      events: [{
        webhookEventId: 'evt_stack_answer_1',
        type: 'message', replyToken: 'stack-reply-token',
        source: { type: 'user', userId: 'Ustack-answer' },
        message: { type: 'text', id: 'msg_stack_answer_1', text: 'USB-001 ราคาเท่าไร' },
      }],
    });
    const signature = crypto.createHmac('sha256', 'channel-secret').update(payload).digest('base64');
    const runOnce = async () => {
      const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
        port: 0, channelSecret: 'channel-secret', historyRoot: root, historyHashKey: hashKey,
        retentionDays: 30, groupAliases: { leadership: groupId }, allowedGroupAliases: ['leadership'],
        stack: {
          replyEnabled: true,
          forward: async (events, destination) => {
            stackCalls.push([events, destination]);
            return { handled: 1, results: [{ ok: true, eventId: 'evt_stack_answer_1', skipReply: false, response: { kind: 'ANSWER', text: 'ราคา 120 บาท ขั้นต่ำ 100 ชิ้น' } }] };
          },
          replyText: async (replyToken, text) => { replies.push({ replyToken, text }); },
        },
        directMessages: {
          enabled: true, identity: { root: path.join(root, 'identity-stack'), hashKey },
          replyText: async () => { throw new Error('legacy reply must not run'); },
          answer: async () => { throw new Error('legacy answer must not run'); },
        },
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        return await fetch(`http://127.0.0.1:${address.port}/webhook/line`, {
          method: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body: payload,
        });
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    };

    const first = await runOnce();
    assert.strictEqual(first.status, 200);
    assert.strictEqual(replies.length, 1);
    assert.deepStrictEqual(replies[0], { replyToken: 'stack-reply-token', text: 'ราคา 120 บาท ขั้นต่ำ 100 ชิ้น' });
    assert.strictEqual(stackCalls.length, 1);
    assert.strictEqual(stackCalls[0][1], 'U-smartgift-destination');

    const replayAfterRestart = await runOnce();
    assert.strictEqual(replayAfterRestart.status, 200);
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(stackCalls.length, 1);
  });

  it('replies once to a direct message across a restart, not just within one process (G10)', async () => {
    /*
     * Before this fix, the direct-message path deduplicated with an in-memory Set created fresh
     * inside `createLineWebhookServer` — it forgot everything the moment the process did. LINE's
     * retry window can outlast a restart in a way it cannot outlast a single request, so a replay
     * arriving after a restart used to risk a second reply. This test recreates that exact
     * boundary: two independent server instances, same on-disk root, same event.
     */
    const identityRoot = path.join(root, 'identity-dm-restart');
    const userId = 'Udm-restart-0000000000000000000';
    requestAccess(userId, 'ทดสอบ', { root: identityRoot, hashKey });
    approve(hashUserId(userId, hashKey), 'sales', 'sales@smartgift.co.th', 'test', { root: identityRoot, hashKey });

    const replies: string[] = [];
    const payload = JSON.stringify({
      events: [{
        webhookEventId: 'evt-dm-restart-1',
        type: 'message', replyToken: 'dm-restart-token',
        source: { type: 'user', userId },
        message: { type: 'text', id: 'msg-dm-restart-1', text: 'TJS23-2 100 ชุด' },
      }],
    });
    const signature = crypto.createHmac('sha256', 'channel-secret').update(payload).digest('base64');

    const runOnce = async () => {
      const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
        port: 0, channelSecret: 'channel-secret', historyRoot: root, historyHashKey: hashKey,
        retentionDays: 30, groupAliases: { leadership: groupId }, allowedGroupAliases: ['leadership'],
        directMessages: {
          enabled: true,
          identity: { root: identityRoot, hashKey },
          replyText: async (_token, text) => { replies.push(text); },
          answer: () => 'คำตอบ',
        },
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        return await fetch(`http://127.0.0.1:${address.port}/webhook/line`, {
          method: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body: payload,
        });
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    };

    const first = await runOnce();
    assert.strictEqual(first.status, 200);
    await waitFor(() => replies.length === 1, 'the asynchronous direct-message reply should complete');
    assert.deepStrictEqual(replies, ['คำตอบ']);

    // A brand-new server instance — nothing carried over in memory — pointed at the same root.
    const replayAfterRestart = await runOnce();
    assert.strictEqual(replayAfterRestart.status, 200);
    // The reply is fire-and-forget now, so give the background pipeline a moment to (wrongly)
    // produce a second reply if the durable dedupe failed to catch the redelivery.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(replies.length, 1, 'the customer must not receive the answer twice');
  });

  it('does not spend a LINE reply token when the signed envelope lacks destination', async () => {
    const replies: string[] = [];
    let stackCalls = 0;
    const payload = JSON.stringify({
      events: [{
        webhookEventId: 'evt-no-destination', type: 'message', replyToken: 'must-not-be-used',
        source: { type: 'user', userId: 'Uno-destination' },
        message: { type: 'text', id: 'msg-no-destination', text: 'มีสินค้าไหม' },
      }],
    });
    const signature = crypto.createHmac('sha256', 'channel-secret').update(payload).digest('base64');
    const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
      port: 0, channelSecret: 'channel-secret', historyRoot: root, historyHashKey: hashKey,
      retentionDays: 30, groupAliases: { leadership: groupId }, allowedGroupAliases: ['leadership'],
      stack: {
        replyEnabled: true,
        forward: async () => { stackCalls++; return { handled: 0, results: [] }; },
        replyText: async (_replyToken, text) => { replies.push(text); },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/webhook/line`, {
        method: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body: payload,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(stackCalls, 0);
      assert.deepStrictEqual(replies, []);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not spend a LINE reply token when the stack rejects the binding', async () => {
    const replies: string[] = [];
    const payload = JSON.stringify({
      destination: 'U-wrong-destination',
      events: [{
        webhookEventId: 'evt-binding-rejected', type: 'message', replyToken: 'must-not-be-used',
        source: { type: 'user', userId: 'Ubinding-rejected' },
        message: { type: 'text', id: 'msg-binding-rejected', text: 'มีสินค้าไหม' },
      }],
    });
    const signature = crypto.createHmac('sha256', 'channel-secret').update(payload).digest('base64');
    const server = createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
      port: 0, channelSecret: 'channel-secret', historyRoot: root, historyHashKey: hashKey,
      retentionDays: 30, groupAliases: { leadership: groupId }, allowedGroupAliases: ['leadership'],
      stack: {
        replyEnabled: true,
        forward: async () => { throw new Error('ZURI_STACK_BINDING_UNAUTHORIZED'); },
        replyText: async (_replyToken, text) => { replies.push(text); },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/webhook/line`, {
        method: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body: payload,
      });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(replies, []);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('fails closed before listening when the durable reply store is corrupt', () => {
    const corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-reply-dedupe-corrupt-'));
    try {
      fs.writeFileSync(path.join(corruptRoot, '.reply-dedupe.json'), '{not-json', 'utf8');
      assert.throws(() => createLineWebhookServer({
      transportOwner: 'LEGACY_EDGE',
        port: 0,
        channelSecret: 'channel-secret',
        historyRoot: corruptRoot,
        historyHashKey: hashKey,
        retentionDays: 30,
        groupAliases: { leadership: groupId },
        allowedGroupAliases: ['leadership'],
      }), /ZURI_REPLY_DEDUPE_STORE_CORRUPT/);
    } finally {
      fs.rmSync(corruptRoot, { recursive: true, force: true });
    }
  });
});
