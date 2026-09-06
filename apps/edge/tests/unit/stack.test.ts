import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZuriStackClient, zuriStackFromEnv } from '../../src/stack/stack-client.js';

// @tested SDD-017 — the binding-only forward and report client.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'fr052-binding-request-v1.json'), 'utf8'));

describe('Zuri stack transport (FR-050 / FR-052)', () => {
  it('sends the binding bearer and signed destination without client scope or reply tokens', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = new ZuriStackClient({
      baseUrl: 'https://zuri.example',
      bindingId: fixture.bindingId,
      bindingBearer: 'binding-bearer-secret-long-enough',
      fetchFn: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ handled: 1, results: [] }), { status: 200 });
      },
    });
    const inputEvent = { ...fixture.events[0], replyToken: 'must-stay-in-line-transport' };
    const result = await client.forwardLineEvents([inputEvent], fixture.destination);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      new Headers(calls[0].init?.headers).get('authorization'),
      'Bearer binding-bearer-secret-long-enough'
    );
    const requestBody = JSON.parse(String(calls[0].init?.body));
    assert.deepStrictEqual(requestBody, fixture);
    assert.ok(!('tenantId' in requestBody));
    assert.ok(!('businessId' in requestBody));
    assert.ok(!JSON.stringify(requestBody).includes('replyToken'));
    assert.ok(!JSON.stringify(result).includes('binding-bearer-secret-long-enough'));
  });

  it('does not echo an upstream error body or binding bearer', async () => {
    const client = new ZuriStackClient({
      baseUrl: 'https://zuri.example', bindingId: fixture.bindingId,
      bindingBearer: 'binding-bearer-secret-long-enough',
      fetchFn: async () => new Response('raw sensitive row binding-bearer-secret-long-enough', { status: 500 }),
    });
    await assert.rejects(
      () => client.forwardLineEvents([], fixture.destination),
      (error: Error) => !error.message.includes('raw sensitive') && !error.message.includes('binding-bearer-secret-long-enough')
    );
  });

  it('classifies binding authorization rejection without exposing the upstream body', async () => {
    const client = new ZuriStackClient({
      baseUrl: 'https://zuri.example', bindingId: fixture.bindingId,
      bindingBearer: 'binding-bearer-secret-long-enough',
      fetchFn: async () => new Response('secret policy detail', { status: 401 }),
    });
    await assert.rejects(
      () => client.forwardLineEvents([], fixture.destination),
      (error: Error) => error.message === 'ZURI_STACK_BINDING_UNAUTHORIZED'
    );
  });

  it('sends the correlation id as a header, leaving the FR-052 body untouched', async () => {
    // NFR-017. The body is a fixed contract the stack validates strictly, and
    // correlation is transport metadata rather than something the binding
    // authorizes — so it rides in a header and the body stays byte-identical.
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = new ZuriStackClient({
      baseUrl: 'https://zuri.example',
      bindingId: fixture.bindingId,
      bindingBearer: 'binding-bearer-secret-long-enough',
      fetchFn: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ handled: 1, results: [], correlationId: 'cli-abcdefgh' }), { status: 200 });
      },
    });
    const result = await client.forwardLineEvents(fixture.events, fixture.destination, 'cli-abcdefgh');

    assert.strictEqual(new Headers(calls[0].init?.headers).get('x-correlation-id'), 'cli-abcdefgh');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init?.body)), fixture);
    assert.strictEqual(result.correlationId, 'cli-abcdefgh');
  });

  it('omits the header entirely when there is no correlation id to send', async () => {
    // an empty header would be a value the stack has to decide about; sending none
    // lets it mint its own and report GENERATED, which is the honest signal
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = new ZuriStackClient({
      baseUrl: 'https://zuri.example',
      bindingId: fixture.bindingId,
      bindingBearer: 'binding-bearer-secret-long-enough',
      fetchFn: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ handled: 0, results: [] }), { status: 200 });
      },
    });
    await client.forwardLineEvents(fixture.events, fixture.destination);
    assert.strictEqual(new Headers(calls[0].init?.headers).has('x-correlation-id'), false);
  });

  it('keeps the id the stack reports, which is what appears in its records', async () => {
    // the stack replaces a malformed id with its own; ours would then point at
    // nothing on the other side, so its answer wins
    const client = new ZuriStackClient({
      baseUrl: 'https://zuri.example',
      bindingId: fixture.bindingId,
      bindingBearer: 'binding-bearer-secret-long-enough',
      fetchFn: async () => new Response(
        JSON.stringify({ handled: 1, results: [], correlationId: 'stack-minted-0001' }),
        { status: 200 }
      ),
    });
    const result = await client.forwardLineEvents(fixture.events, fixture.destination, 'cli-abcdefgh');
    assert.strictEqual(result.correlationId, 'stack-minted-0001');
  });

  it('fails closed when reply mode uses legacy scope or misses binding configuration', () => {
    assert.throws(() => zuriStackFromEnv({
      ZURI_STACK_REPLY_ENABLED: 'true', ZURI_STACK_URL: 'https://zuri.example',
      ZURI_TENANT_ID: 'tenant-1', ZURI_STACK_TOKEN: 'legacy-token',
    }), /ZURI_STACK_LEGACY_SCOPE_FORBIDDEN/);
    assert.throws(() => zuriStackFromEnv({
      ZURI_STACK_REPLY_ENABLED: 'true', ZURI_STACK_URL: 'https://zuri.example',
    }), /ZURI_STACK_BINDING_CONFIGURATION_MISSING/);
    assert.strictEqual(zuriStackFromEnv({ ZURI_STACK_URL: 'https://zuri.example' }), null);
  });

  it('creates reply mode only from the binding-only environment', () => {
    const stack = zuriStackFromEnv({
      ZURI_STACK_REPLY_ENABLED: 'true',
      ZURI_STACK_URL: 'https://zuri.example',
      ZURI_STACK_BINDING_ID: fixture.bindingId,
      ZURI_STACK_BINDING_BEARER: 'binding-bearer-secret-long-enough',
    });
    assert.strictEqual(stack?.replyEnabled, true);
  });

  it('accepts the binding bearer from a secret file, per SEC-005', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'zuri-stack-secret-'));
    const file = path.join(dir, 'bearer');
    fs.writeFileSync(file, 'binding-bearer-secret-long-enough\n');
    try {
      const stack = zuriStackFromEnv({
        ZURI_STACK_REPLY_ENABLED: 'true',
        ZURI_STACK_URL: 'https://zuri.example',
        ZURI_STACK_BINDING_ID: fixture.bindingId,
        ZURI_STACK_BINDING_BEARER_FILE: file,
      });
      assert.strictEqual(stack?.replyEnabled, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
