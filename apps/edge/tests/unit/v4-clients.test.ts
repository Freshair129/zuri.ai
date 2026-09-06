import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, RagUnavailableError } from '../../src/rag/v4/http-client.js';
import { createEmbedClient } from '../../src/rag/v4/embed-client.js';

const fake = (handler: (url: string, init: RequestInit) => Promise<Response> | Response) => (async (u: string | URL | Request, i?: RequestInit) => handler(String(u), i ?? {})) as typeof fetch;

describe('v4 http-client', () => {
  it('returns parsed JSON on 200', async () => {
    const r = await fetchJson<{ a: number }>('http://x/y', { fetchImpl: fake(() => new Response(JSON.stringify({ a: 1 }), { status: 200 })) });
    assert.deepEqual(r, { a: 1 });
  });
  it('maps non-2xx to RagUnavailableError(http_<status>)', async () => {
    await assert.rejects(fetchJson('http://x', { fetchImpl: fake(() => new Response('', { status: 503 })) }), (e: RagUnavailableError) => e.reason === 'http_503');
  });
  it('propagates a JSON body detail field on non-2xx (gate defect 8)', async () => {
    await assert.rejects(
      fetchJson('http://x', { fetchImpl: fake(() => new Response(JSON.stringify({ error: 'rag_unavailable', detail: 'engine' }), { status: 503 })) }),
      (e: RagUnavailableError) => e.reason === 'engine',
    );
  });
  it('falls back to a JSON body error field when detail is absent (gate defect 8)', async () => {
    await assert.rejects(
      fetchJson('http://x', { fetchImpl: fake(() => new Response(JSON.stringify({ error: 'store_unavailable' }), { status: 503 })) }),
      (e: RagUnavailableError) => e.reason === 'store_unavailable',
    );
  });
  it('503 with no body still maps to http_503, not a JSON-parse error (gate defect 8)', async () => {
    await assert.rejects(
      fetchJson('http://x', { fetchImpl: fake(() => new Response('', { status: 503 })) }),
      (e: RagUnavailableError) => e.reason === 'http_503',
    );
  });
  it('maps connection errors', async () => {
    await assert.rejects(fetchJson('http://x', { fetchImpl: fake(() => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }) }), (e: RagUnavailableError) => e.reason === 'econnrefused');
  });
  it('times out', async () => {
    await assert.rejects(fetchJson('http://x', { timeoutMs: 20, fetchImpl: fake((_u, i) => new Promise((_r, rej) => i.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) ) }), (e: RagUnavailableError) => e.reason === 'timeout');
  });
});

describe('v4 embed-client', () => {
  it('posts texts with kind and returns vectors', async () => {
    let seen: unknown;
    const c = createEmbedClient('http://e', { fetchImpl: fake((u, i) => { seen = { u, body: JSON.parse(String(i.body)) }; return new Response(JSON.stringify({ vectors: [[0.1, 0.2]], model: 'm', revision: 'r' })); }) });
    const v = await c.embed(['a'], 'query');
    assert.deepEqual(v, [[0.1, 0.2]]); assert.deepEqual(seen, { u: 'http://e/embed', body: { texts: ['a'], kind: 'query' } });
  });
  it('health false on failure', async () => {
    const c = createEmbedClient('http://e', { fetchImpl: fake(() => { throw new Error('x'); }) });
    assert.equal((await c.health()).ok, false);
  });
});

describe('v4 http-client production paths (gate defects)', () => {
  it('maps undici-style nested cause.code to econnrefused', async () => {
    await assert.rejects(
      fetchJson('http://x', { fetchImpl: fake(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) }),
      (e: RagUnavailableError) => e.reason === 'econnrefused',
    );
  });
  it('real fetch against a closed port yields econnrefused', async () => {
    await assert.rejects(fetchJson('http://127.0.0.1:65001/nope', { timeoutMs: 2000 }), (e: RagUnavailableError) => e.reason === 'econnrefused');
  });
  it('defaults to POST when a body is supplied', async () => {
    let method = '';
    await fetchJson('http://x', { body: { a: 1 }, fetchImpl: fake((_u, i) => { method = String(i.method); return new Response('{}'); }) });
    assert.equal(method, 'POST');
  });
  it('embed client defaults to a 30 s timeout', async () => {
    let signal: AbortSignal | undefined; let resolve!: () => void;
    const c = createEmbedClient('http://e', { fetchImpl: fake((_u, i) => { signal = i.signal as AbortSignal; return new Promise((r) => { resolve = () => r(new Response(JSON.stringify({ vectors: [[1]] }))); }); }) });
    const p = c.embed(['a'], 'passage');
    await new Promise((r) => setTimeout(r, 3200));
    assert.equal(signal?.aborted, false, 'must not abort at the generic 3 s default');
    resolve(); await p;
  });
});
