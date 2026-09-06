import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExtractionAuthError,
  ExtractionClient,
  ExtractionHttpError,
  ExtractionNetworkError,
} from '../../src/evidence/extraction-client.js';
import {
  ExtractionEvent,
  runExtractionLoop,
  runExtractionOnce,
} from '../../src/evidence/extraction-worker.js';
import { ExtractionUnsupportedError } from '../../src/evidence/extraction-extractor.js';
import { ExtractionJob, normaliseCandidate } from '../../src/evidence/extraction-contract.js';

const job = (over: Partial<ExtractionJob> = {}): ExtractionJob => ({
  id: 'j1',
  businessId: 'b1',
  evidenceId: 'e1',
  status: 'CLAIMED',
  attempts: 1,
  version: 2,
  createdAt: '2026-09-04T03:11:02.000Z',
  evidence: { mime: 'image/jpeg', byteSize: 4, documentType: 'RECEIPT' },
  ...over,
});

interface Recorded {
  completed: Array<{ jobId: string; model: string }>;
  failed: Array<{ jobId: string; reason: string }>;
}

/** A client whose four calls are each a queue of behaviours the test spells out. */
function fakeClient(
  script: {
    claims?: Array<ExtractionJob | null | Error>;
    evidence?: Array<{ bytes: Buffer; mime: string } | Error>;
    complete?: Array<'ok' | Error>;
    fail?: Array<'ok' | Error>;
  },
  recorded: Recorded
): ExtractionClient {
  const claims = [...(script.claims ?? [])];
  const evidence = [...(script.evidence ?? [])];
  const complete = [...(script.complete ?? [])];
  const fails = [...(script.fail ?? [])];
  const next = <T>(queue: T[], fallback: T): T => (queue.length ? (queue.shift() as T) : fallback);

  return {
    async claim() {
      const value = next<ExtractionJob | null | Error>(claims, null);
      if (value instanceof Error) throw value;
      return value;
    },
    async downloadEvidence() {
      const value = next<{ bytes: Buffer; mime: string } | Error>(evidence, {
        bytes: Buffer.from('jpeg'),
        mime: 'image/jpeg',
      });
      if (value instanceof Error) throw value;
      return value;
    },
    async complete(jobId, _candidate, model) {
      const value = next<'ok' | Error>(complete, 'ok');
      if (value instanceof Error) throw value;
      recorded.completed.push({ jobId, model });
      return null;
    },
    async fail(jobId, reason) {
      const value = next<'ok' | Error>(fails, 'ok');
      if (value instanceof Error) throw value;
      recorded.failed.push({ jobId, reason });
      return null;
    },
  };
}

const okExtract = async () => ({
  candidate: normaliseCandidate({ documentType: 'RECEIPT', fields: [{ field: 'totalAmount', value: 100 }] }),
  model: 'qwen3-vl:8b',
});

const blank = (): Recorded => ({ completed: [], failed: [] });

describe('runExtractionOnce', () => {
  it('claims, reads and completes one job', async () => {
    const recorded = blank();
    const result = await runExtractionOnce({
      client: fakeClient({ claims: [job()] }, recorded),
      extract: okExtract,
      pollMs: 1,
    });

    assert.strictEqual(result.outcome, 'completed');
    assert.deepStrictEqual(recorded.completed, [{ jobId: 'j1', model: 'qwen3-vl:8b' }]);
    assert.deepStrictEqual(recorded.failed, []);
  });

  it('reports idle on an empty queue without touching any other call', async () => {
    const recorded = blank();
    const events: ExtractionEvent[] = [];
    const result = await runExtractionOnce({
      client: fakeClient({ claims: [null] }, recorded),
      extract: async () => {
        throw new Error('the extractor must not run when nothing was claimed');
      },
      pollMs: 1,
      onEvent: (event) => events.push(event),
    });

    assert.strictEqual(result.outcome, 'idle');
    assert.deepStrictEqual(events, [{ type: 'idle' }]);
  });

  it('fails the job — rather than dropping it — when extraction throws', async () => {
    // A dropped job sits CLAIMED for the full ten-minute lease and tells the human waiting
    // in the console nothing. A failed one carries a reason and requeues below three attempts.
    const recorded = blank();
    const result = await runExtractionOnce({
      client: fakeClient({ claims: [job()] }, recorded),
      extract: async () => {
        throw new ExtractionUnsupportedError('อุปกรณ์นี้ยังอ่านไฟล์ PDF ไม่ได้ (no rasteriser on this device)');
      },
      pollMs: 1,
    });

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(recorded.failed.length, 1);
    assert.match(recorded.failed[0].reason, /PDF/);
    assert.deepStrictEqual(recorded.completed, []);
  });

  it('fails the job when the evidence download fails', async () => {
    const recorded = blank();
    const result = await runExtractionOnce({
      client: fakeClient(
        { claims: [job()], evidence: [new ExtractionHttpError('evidence download failed with status 404', 404, false)] },
        recorded
      ),
      extract: okExtract,
      pollMs: 1,
    });

    assert.strictEqual(result.outcome, 'failed');
    assert.match(recorded.failed[0].reason, /404/);
  });

  it('fails the job when the cloud rejects the candidate', async () => {
    const recorded = blank();
    const result = await runExtractionOnce({
      client: fakeClient(
        { claims: [job()], complete: [new ExtractionHttpError('complete failed with status 400', 400, false)] },
        recorded
      ),
      extract: okExtract,
      pollMs: 1,
    });

    // The cloud has already failed the job on its side; reporting it keeps the two agreed,
    // and the second call is harmless because complete/fail are idempotent per version.
    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(recorded.failed.length, 1);
  });

  it('never records a credential failure as the job\'s fault', async () => {
    // Posting `fail` would need the same dead key and would burn one of the job's three
    // attempts for a reason that has nothing to do with the document.
    const recorded = blank();
    const error = await runExtractionOnce({
      client: fakeClient({ claims: [job()], evidence: [new ExtractionAuthError()] }, recorded),
      extract: okExtract,
      pollMs: 1,
    }).then(() => null, (e) => e);

    assert.ok(error instanceof ExtractionAuthError);
    assert.deepStrictEqual(recorded.failed, []);
  });

  it('says so loudly when the verdict itself could not be delivered', async () => {
    const recorded = blank();
    const events: ExtractionEvent[] = [];
    const result = await runExtractionOnce({
      client: fakeClient(
        {
          claims: [job()],
          evidence: [new ExtractionNetworkError('evidence download could not reach the cloud')],
          fail: [new ExtractionNetworkError('fail could not reach the cloud')],
        },
        recorded
      ),
      extract: okExtract,
      pollMs: 1,
      onEvent: (event) => events.push(event),
    });

    assert.strictEqual(result.outcome, 'failed');
    // The job stays CLAIMED until its lease expires. That is the correct outcome, but it is
    // invisible on the cloud side, so the device has to be the one that says it.
    assert.ok(events.some((event) => event.type === 'unreported'));
  });
});

describe('runExtractionLoop', () => {
  it('backs off exponentially on repeated 5xx, and resets after a success', async () => {
    const recorded = blank();
    const slept: number[] = [];
    // The loop reads `shouldStop` more than once per pass (top, and again before sleeping),
    // so counting passes with it would be counting the wrong thing. Sleeps are the events
    // this test is about, so they are what ends it.
    let stop = false;

    await runExtractionLoop({
      client: fakeClient(
        {
          claims: [
            new ExtractionHttpError('claim failed with status 503', 503, true),
            new ExtractionHttpError('claim failed with status 503', 503, true),
            new ExtractionHttpError('claim failed with status 500', 500, true),
            job(),
            new ExtractionNetworkError('claim could not reach the cloud'),
          ],
        },
        recorded
      ),
      extract: okExtract,
      pollMs: 5000,
      sleep: async (ms) => {
        slept.push(ms);
        if (slept.length >= 4) stop = true;
      },
      shouldStop: () => stop,
    });

    // 1s, 2s, 4s while failing; then a completed job resets the counter, so the next
    // failure starts back at 1s rather than continuing to 8s.
    assert.deepStrictEqual(slept, [1000, 2000, 4000, 1000]);
    assert.strictEqual(recorded.completed.length, 1);
  });

  it('polls at the plain interval when the queue is empty, rather than backing off', async () => {
    // An idle cloud is healthy. Backing off from it would make a device drift further and
    // further from work that is about to arrive.
    const slept: number[] = [];
    let stop = false;
    await runExtractionLoop({
      client: fakeClient({ claims: [null, null, null] }, blank()),
      extract: okExtract,
      pollMs: 5000,
      sleep: async (ms) => {
        slept.push(ms);
        if (slept.length >= 3) stop = true;
      },
      shouldStop: () => stop,
    });
    assert.deepStrictEqual(slept, [5000, 5000, 5000]);
  });

  it('stops on 401 instead of retrying a credential nobody can fix from here', async () => {
    const events: ExtractionEvent[] = [];
    const slept: number[] = [];
    const summary = await runExtractionLoop({
      client: fakeClient({ claims: [new ExtractionAuthError()] }, blank()),
      extract: okExtract,
      pollMs: 5000,
      sleep: async (ms) => {
        slept.push(ms);
      },
      onEvent: (event) => events.push(event),
    });

    assert.strictEqual(summary.stoppedBy, 'credential');
    assert.deepStrictEqual(slept, [], 'a rejected credential must not be slept on and retried');
    assert.ok(events.some((event) => event.type === 'stopping' && event.reason === 'credential'));
  });

  it('finishes the job in hand when the stop flag is raised mid-job', async () => {
    // The lease promise: a signal arriving while a document is being read must not abandon
    // the job. `shouldStop` is only read between passes, so this one is completed first.
    const recorded = blank();
    let stopping = false;
    const summary = await runExtractionLoop({
      client: fakeClient({ claims: [job(), job({ id: 'j2' })] }, recorded),
      extract: async () => {
        stopping = true; // as if SIGINT landed while the model was reading
        return okExtract();
      },
      pollMs: 1,
      sleep: async () => {},
      shouldStop: () => stopping,
    });

    assert.strictEqual(summary.stoppedBy, 'signal');
    assert.deepStrictEqual(recorded.completed, [{ jobId: 'j1', model: 'qwen3-vl:8b' }]);
    assert.strictEqual(summary.completed, 1);
  });

  it('does not claim anything at all when told to stop before the first pass', async () => {
    const summary = await runExtractionLoop({
      client: fakeClient({ claims: [new Error('claim must not be called')] }, blank()),
      extract: okExtract,
      pollMs: 1,
      shouldStop: () => true,
    });
    assert.deepStrictEqual(summary, { completed: 0, failed: 0, stoppedBy: 'signal' });
  });
});
