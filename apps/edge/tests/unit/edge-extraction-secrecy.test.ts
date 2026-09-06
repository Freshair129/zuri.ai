import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createExtractionClient } from '../../src/evidence/extraction-client.js';
import { runExtractionLoop, runExtractionOnce } from '../../src/evidence/extraction-worker.js';
import { normaliseCandidate, scrubSecrets } from '../../src/evidence/extraction-contract.js';

/**
 * The device credential must not appear in a thrown message, a log line, an event, a
 * returned value, or anything written to disk.
 *
 * This is worth a file of its own because the failure is silent and permanent. A key that
 * reaches a log once has to be revoked, and nobody learns that from the log — the operator
 * finds out when someone else's Business data moves. The cloud's own runbook says the same
 * thing in the other direction: if a poller ever prints a key, treat it as exposed.
 *
 * `edgk_` is the substring hunted for throughout, because that is the prefix the cloud
 * mints (its FR-144), and a device key is the only thing in this runtime that carries it.
 */

const KEY = 'edgk_SUPERSECRETzz-9_aA';
const BASE = 'https://cloud.example.test';
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Everything the process would have said on stderr, captured.
 *
 * stderr only, deliberately: `logDiagnostic` is the runtime's one log sink and writes
 * there, while stdout belongs to the test runner's own reporter — swallowing that would
 * make this test quietly eat the report it is part of.
 */
function captureDiagnostics<T>(run: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const realErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return run()
    .then((result) => ({ result, output: chunks.join('') }))
    .finally(() => {
      process.stderr.write = realErr;
    });
}

describe('the device credential never leaves the process', () => {
  it('is absent from an error thrown by a failing call', async () => {
    // fetch is given a cause that echoes the whole request back, which is exactly how a
    // real `TypeError: fetch failed` can carry the Authorization header in its cause.
    const fetchFn = (async () => {
      throw new Error(`connect ECONNREFUSED while sending Authorization: Bearer ${KEY}`);
    }) as unknown as typeof fetch;
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });

    const error = await client.claim().then(() => null, (e: unknown) => e as Error);

    assert.ok(error);
    assert.ok(!error.message.includes('edgk_'), error.message);
    assert.ok(!error.message.includes('SUPERSECRET'), error.message);
    assert.ok(!String(error.stack).includes('SUPERSECRET'), 'the stack must not carry it either');
  });

  it('is absent from the whole log of a run that claims, fails and retries', async () => {
    const { logDiagnostic } = await import('../../src/safety/redact.js');
    const responses: Array<() => Response> = [
      () => new Response(JSON.stringify({ job: { id: 'j1', evidenceId: 'e1', evidence: { mime: 'image/jpeg' } } }), { status: 200 }),
      () => new Response(Buffer.from('jpegbytes'), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      () => new Response('{}', { status: 500 }), // complete fails
      () => new Response(JSON.stringify({ job: { id: 'j1' } }), { status: 200 }), // fail accepted
      () => new Response(null, { status: 204 }), // then idle
    ];
    let index = 0;
    const fetchFn = (async () => (responses[Math.min(index++, responses.length - 1)]())) as unknown as typeof fetch;

    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    let stop = false;

    const { output } = await captureDiagnostics(async () =>
      runExtractionLoop({
        client,
        extract: async () => ({
          candidate: normaliseCandidate({ documentType: 'RECEIPT', fields: [{ field: 'totalAmount', value: 1 }] }),
          model: 'qwen3-vl:8b',
        }),
        pollMs: 1,
        sleep: async () => {
          stop = true;
        },
        shouldStop: () => stop,
        // The real CLI logger, not a stub: a test that proved a stub was quiet would prove
        // nothing about what an operator actually sees.
        onEvent: (event) => logDiagnostic(`extraction ${event.type}`, { ...event }),
      })
    );

    assert.ok(output.length > 0, 'the run must actually have logged something');
    assert.ok(!output.includes('edgk_'), output);
    assert.ok(!output.includes('SUPERSECRET'), output);
  });

  it('is absent from the JSON result a caller could print or persist', async () => {
    const fetchFn = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    const result = await runExtractionOnce({ client, extract: async () => { throw new Error('unused'); }, pollMs: 1 });
    assert.ok(!JSON.stringify(result).includes('edgk_'));
  });

  it('is absent from a serialised client, which a crash dump would walk', () => {
    // The key lives in a closure, not on the returned object, so `util.inspect` of the
    // client during a crash has nothing to print.
    const fetchFn = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = createExtractionClient({ baseUrl: BASE, deviceKey: KEY, fetchFn });
    assert.ok(!JSON.stringify(client).includes('edgk_'));
    assert.ok(!Object.values(client).map(String).join('').includes('SUPERSECRET'));
  });
});

describe('the source itself never prints the credential', () => {
  /**
   * A grep, not a behaviour test, because the risk is a future edit: someone adds one
   * `console.log(deviceKey)` while debugging and it survives review. The behaviour tests
   * above only cover the paths they exercise; this covers the file.
   */
  const files = [
    'src/evidence/extraction-client.ts',
    'src/evidence/extraction-worker.ts',
    'src/evidence/extraction-extractor.ts',
    'src/evidence/extraction-contract.ts',
    'src/cli/extraction.ts',
  ];

  for (const file of files) {
    it(`${file} never puts the key into a log, a template string, or an error`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const offenders = text
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        // The one legitimate use is the Authorization header; everything else that names
        // the key next to a logger or an interpolation is the bug this guards against.
        .filter(([, line]) => /deviceKey|edgeDeviceKey/.test(line))
        .filter(([, line]) => /console\.|logDiagnostic|process\.std|new Error\(`|throw new Error\(`/.test(line));
      assert.deepStrictEqual(
        offenders.map(([n, line]) => `${n}: ${line.trim()}`),
        [],
        `${file} names the device key on a line that logs or interpolates it`
      );
    });
  }

  it('scrubSecrets is applied at every boundary that builds a message from an unknown error', () => {
    // Belt on the braces: even if a future edit lets a key into a string, the scrubber is
    // the last thing every reason and message passes through.
    assert.strictEqual(scrubSecrets(`x ${KEY} y`), 'x [REDACTED] y');
  });
});
