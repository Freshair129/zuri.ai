import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResidencyClient } from '../../src/conversation/residency-client.js';
import { ConversationError } from '../../src/conversation/contract.js';

// @req FR-244 — the residency client: same auth/origin validation as the
//   conversation client, one boolean out, no LINE identity ever sent or read.
// @spec ADR-061, ADR-094 D6 option A

describe('residency client', () => {
  it('rejects a non-HTTPS, non-loopback origin and a malformed device key before any call', () => {
    assert.throws(() => createResidencyClient({ baseUrl: 'http://zuri.example', deviceKey: 'edgk_x' }), /HTTPS_CLOUD_ORIGIN_REQUIRED/);
    assert.throws(() => createResidencyClient({ baseUrl: 'https://zuri.example', deviceKey: 'not-a-device-key' }), /DEVICE_KEY_REQUIRED/);
    assert.doesNotThrow(() => createResidencyClient({ baseUrl: 'http://127.0.0.1:3000', deviceKey: 'edgk_x' }));
  });

  it('posts an empty body to the residency route with the bearer credential, and returns its boolean', async () => {
    let seenUrl = ''; let seenAuth = ''; let seenBody = '';
    const client = createResidencyClient({
      baseUrl: 'https://zuri.example', deviceKey: 'edgk_test',
      fetchFn: async (url, init) => {
        seenUrl = String(url); seenAuth = String((init?.headers as Record<string, string>)?.Authorization); seenBody = String(init?.body);
        return Response.json({ shouldBeWarm: true });
      },
    });
    assert.equal(await client.shouldBeWarm(), true);
    assert.equal(seenUrl, 'https://zuri.example/api/edge/model-residency');
    assert.equal(seenAuth, 'Bearer edgk_test');
    assert.equal(seenBody, '{}');
  });

  it('rejects a non-boolean or missing shouldBeWarm as an invalid contract', async () => {
    const client = createResidencyClient({
      baseUrl: 'https://zuri.example', deviceKey: 'edgk_test',
      fetchFn: async () => Response.json({ shouldBeWarm: 'yes' }),
    });
    await assert.rejects(() => client.shouldBeWarm(), /INVALID_CONVERSATION_CONTRACT/);
  });

  it('turns an HTTP failure and a network failure into ConversationError, never a raw body', async () => {
    const failed = createResidencyClient({
      baseUrl: 'https://zuri.example', deviceKey: 'edgk_test',
      fetchFn: async () => new Response('internal detail leak', { status: 503 }),
    });
    await assert.rejects(() => failed.shouldBeWarm(), (error: unknown) => {
      assert.ok(error instanceof ConversationError);
      assert.equal(error.message, 'CONVERSATION_HTTP_FAILED');
      assert.equal(error.status, 503);
      return true;
    });

    const down = createResidencyClient({
      baseUrl: 'https://zuri.example', deviceKey: 'edgk_test',
      fetchFn: async () => { throw new Error('ECONNREFUSED'); },
    });
    await assert.rejects(() => down.shouldBeWarm(), /CONVERSATION_NETWORK_FAILED/);
  });
});
