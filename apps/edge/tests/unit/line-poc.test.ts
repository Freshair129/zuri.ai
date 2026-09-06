import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LinePocClient } from '../../src/line-poc/client.js';
import { cardViewModelToFlex } from '../../src/line-poc/flex.js';
import { buildInformationRequestCard } from '../../src/cards/builders/information-request.js';

// @tested SDD-013 — the bounded local LINE POC transport.

const GROUP_ID = 'C0123456789abcdef0123456789abcdef';

describe('local LINE POC transport', () => {
  it('verifies the configured alias without exposing its raw target', async () => {
    const client = new LinePocClient({ transportOwner: 'LEGACY_EDGE',
      channelAccessToken: 'test-token',
      groupAliases: { leadership: GROUP_ID },
      fetchFn: async () => new Response(JSON.stringify({ userId: 'U0123456789abcdef0123456789abcdef', basicId: '@zuri', displayName: 'Zuri' })),
    });
    const result = await client.verifyGroupAlias('leadership');
    assert.strictEqual(result.groupAlias, 'leadership');
    assert.strictEqual(result.bot.displayName, 'Zuri');
    assert.ok(!JSON.stringify(result).includes(GROUP_ID));
  });

  it('sends one bounded Flex bubble and reports provider acceptance only', async () => {
    let payload = '';
    const client = new LinePocClient({ transportOwner: 'LEGACY_EDGE',
      channelAccessToken: 'test-token',
      groupAliases: { leadership: GROUP_ID },
      fetchFn: async (_url, init) => {
        payload = String(init?.body || '');
        return new Response('', { status: 200, headers: { 'x-line-request-id': 'req_test' } });
      },
    });
    const receipt = await client.pushFlex('leadership', 'Zuri test', cardViewModelToFlex(buildInformationRequestCard([])));
    assert.strictEqual(receipt.status, 'ACCEPTED_BY_LINE');
    assert.strictEqual(receipt.requestId, 'req_test');
    assert.ok(payload.includes('information-request') === false, 'Flex payload must contain rendered copy only');
    assert.ok(payload.includes(GROUP_ID));
  });

  it('rejects a raw ID supplied in place of an alias binding', async () => {
    const client = new LinePocClient({ transportOwner: 'LEGACY_EDGE', channelAccessToken: 'test-token', groupAliases: { leadership: 'not-a-group' } });
    await assert.rejects(() => client.verifyGroupAlias('leadership'), /absent or invalid/i);
  });

  it('replies to a direct-message reply token without accepting a user ID', async () => {
    let url = '';
    let payload = '';
    const client = new LinePocClient({ transportOwner: 'LEGACY_EDGE',
      channelAccessToken: 'test-token',
      groupAliases: {},
      fetchFn: async (requestUrl, init) => {
        url = String(requestUrl);
        payload = String(init?.body || '');
        return new Response('', { status: 200, headers: { 'x-line-request-id': 'req_reply' } });
      },
    });

    const receipt = await client.replyText('reply-token-only', 'ซูริรับข้อความแล้วค่ะ');

    assert.strictEqual(receipt.status, 'ACCEPTED_BY_LINE');
    assert.strictEqual(receipt.requestId, 'req_reply');
    assert.match(url, /\/v2\/bot\/message\/reply$/);
    assert.deepStrictEqual(JSON.parse(payload), {
      replyToken: 'reply-token-only',
      messages: [{ type: 'text', text: 'ซูริรับข้อความแล้วค่ะ' }],
    });
  });
});
