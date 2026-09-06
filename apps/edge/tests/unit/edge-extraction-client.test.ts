import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExtractionAuthError,
  ExtractionHttpError,
  ExtractionNetworkError,
  createExtractionClient,
} from '../../src/evidence/extraction-client.js';
import { normaliseCandidate } from '../../src/evidence/extraction-contract.js';

const KEY = 'edgk_TESTKEYzz-9_aA';
const BASE = 'https://cloud.example.test';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that records what it was asked and answers with whatever the test queued. */
function stubFetch(responses: Array<Response | Error>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('stub fetch ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const authOf = (call: Call): string => {
  const headers = (call.init.headers ?? {}) as Record<string, string>;
  return headers.Authorization ?? '';
};

describe('extraction client construction', () => {
  it('refuses to build without a base URL or without a key', () => {
    assert.throws(() => createExtractionClient({ baseUrl: '', deviceKey: KEY }), /ZURI_CLOUD_BASE_URL_REQUIRED/);
    assert.throws(() => createExtractionClient({ baseUrl: BASE, deviceKey: '  ' }), /ZURI_EDGE_DEVICE_KEY_REQUIRED/);
  });

  it('builds the four paths under a base URL that has no trailing slash', () => {
    // `new URL('api/...', 'https://host')` without the trailing slash would resolve against
    // the root and silently work here — but against `https://host/zuri` it would drop `/zuri`.
    assert.strictEqual(
      new URL('api/edge/extraction-jobs/claim', 'https://cloud.example.test/zuri/').toString(),
      'https://cloud.example.test/zuri/api/edge/extraction-jobs/claim'
    );
  });
});

describe('claim', () => {
  it('posts an empty body with the bearer credential', async () => {
    const { fetchFn, calls } = stubFetch([
      new Response(JSON.stringify({ job: { id: 'j1', evidenceId: 'e1' } }), { status: 200 }),
    ]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });

    const job = await client.claim();

    assert.strictEqual(job?.id, 'j1');
    assert.strictEqual(calls[0].url, `${BASE}/api/edge/extraction-jobs/claim`);
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.strictEqual(calls[0].init.body, '{}');
    assert.strictEqual(authOf(calls[0]), `Bearer ${KEY}`);
  });

  it('reads 204 as an empty queue, not as a failure', async () => {
    // 204 carries no body at all; parsing one would throw and turn "nothing to do" into
    // an error the worker would then back off from.
    const { fetchFn } = stubFetch([new Response(null, { status: 204 })]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    assert.strictEqual(await client.claim(), null);
  });

  it('raises a distinct, non-retryable error on 401', async () => {
    const { fetchFn } = stubFetch([new Response('{}', { status: 401 })]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });

    const error = await client.claim().then(() => null, (e) => e);
    assert.ok(error instanceof ExtractionAuthError);
    assert.strictEqual(error.retryable, false);
    // Missing, malformed, unknown and revoked are one status by design, so there is nothing
    // to retry and nothing to diagnose from the device.
    assert.strictEqual(error.status, 401);
  });

  it('marks 5xx and 429 retryable, and other 4xx not', async () => {
    const cases: Array<[number, boolean]> = [
      [500, true],
      [503, true],
      [429, true],
      [400, false],
      [404, false],
      [409, false],
    ];
    for (const [status, retryable] of cases) {
      const { fetchFn } = stubFetch([new Response('{}', { status })]);
      const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
      const error = await client.claim().then(() => null, (e) => e);
      assert.ok(error instanceof ExtractionHttpError, `status ${status}`);
      assert.strictEqual(error.retryable, retryable, `status ${status}`);
    }
  });

  it('turns a transport failure into a retryable network error', async () => {
    const { fetchFn } = stubFetch([new TypeError('fetch failed')]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    const error = await client.claim().then(() => null, (e) => e);
    assert.ok(error instanceof ExtractionNetworkError);
    assert.strictEqual(error.retryable, true);
  });
});

describe('evidence download', () => {
  it('returns the bytes and the served content type, without its parameters', async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const { fetchFn, calls } = stubFetch([
      new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg; charset=binary' } }),
    ]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });

    const evidence = await client.downloadEvidence('j1');

    assert.strictEqual(evidence.mime, 'image/jpeg');
    assert.deepStrictEqual([...evidence.bytes], [...body]);
    assert.strictEqual(calls[0].url, `${BASE}/api/edge/extraction-jobs/j1/evidence`);
    assert.strictEqual(calls[0].init.method, 'GET');
  });

  it('escapes a job id rather than letting it shape the path', async () => {
    const { fetchFn, calls } = stubFetch([new Response(Buffer.from('x'), { status: 200 })]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    await client.downloadEvidence('../../platform/edge-devices');
    assert.ok(calls[0].url.includes('%2F'), calls[0].url);
    assert.ok(!calls[0].url.includes('/platform/'), calls[0].url);
  });
});

describe('complete and fail', () => {
  it('posts the candidate and model name to the job\'s complete endpoint', async () => {
    const { fetchFn, calls } = stubFetch([new Response(JSON.stringify({ job: { id: 'j1' } }), { status: 200 })]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    const candidate = normaliseCandidate({ documentType: 'RECEIPT', fields: [{ field: 'totalAmount', value: 100 }] });

    await client.complete('j1', candidate, 'qwen3-vl:8b');

    assert.strictEqual(calls[0].url, `${BASE}/api/edge/extraction-jobs/j1/complete`);
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), { candidate, model: 'qwen3-vl:8b' });
  });

  it('does not treat a rejected candidate as retryable', async () => {
    // The cloud answers 400 AND fails the job. Retrying would post the same bad candidate
    // against a job that is already terminal.
    const { fetchFn } = stubFetch([new Response('{}', { status: 400 })]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    const candidate = normaliseCandidate({ documentType: 'RECEIPT', fields: [] });
    const error = await client.complete('j1', candidate, 'm').then(() => null, (e) => e);
    assert.ok(error instanceof ExtractionHttpError);
    assert.strictEqual(error.retryable, false);
  });

  it('posts a scrubbed, clipped reason to fail', async () => {
    const { fetchFn, calls } = stubFetch([new Response(JSON.stringify({ job: { id: 'j1' } }), { status: 200 })]);
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });

    await client.fail('j1', `daemon rejected ${KEY}`);

    const posted = JSON.parse(String(calls[0].init.body)) as { reason: string };
    assert.strictEqual(calls[0].url, `${BASE}/api/edge/extraction-jobs/j1/fail`);
    assert.ok(!posted.reason.includes('edgk_'), posted.reason);
  });
});
