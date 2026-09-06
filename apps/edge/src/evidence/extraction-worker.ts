/**
 * The loop: claim one job, read it, report the result. Repeat.
 *
 * Concurrency is one, and that is a decision rather than a placeholder. The device holds
 * a single local model that serialises anyway, and a ten-minute lease means a second job
 * claimed while the first is still in the daemon's queue is a job whose lease can expire
 * while the device is technically working on it — the cloud would requeue it and a second
 * device (or this one, later) would redo the work. One at a time keeps "claimed" and
 * "being worked on" the same statement.
 *
 * Three rules hold everywhere in this file:
 *   - a claimed job always leaves with a verdict — completed, or failed with a reason.
 *     Dropping one leaves it CLAIMED until the lease expires, which delays the human
 *     waiting on it by ten minutes and tells them nothing;
 *   - a 401 stops the loop. Missing, malformed, unknown and revoked keys are one status
 *     with no way to tell them apart, so retrying is noise directed at a stranger;
 *   - the device credential never reaches a log line or an event. Everything logged here
 *     is a job id, a status, or a scrubbed reason.
 */

import { ExtractionAuthError, ExtractionClient } from './extraction-client.js';
import type { LocalExtractor } from './extraction-extractor.js';
import { computeBackoffMs, scrubSecrets } from './extraction-contract.js';

export type ExtractionEvent =
  | { type: 'idle' }
  | { type: 'claimed'; jobId: string; evidenceId: string; mime?: string }
  | { type: 'completed'; jobId: string; model: string; fieldCount: number }
  | { type: 'failed'; jobId: string; reason: string }
  | { type: 'unreported'; jobId: string; reason: string }
  | { type: 'retrying'; attempt: number; delayMs: number; reason: string }
  | { type: 'stopping'; reason: 'signal' | 'credential' };

export interface ExtractionWorkerDeps {
  client: ExtractionClient;
  extract: LocalExtractor;
  /** Delay between claim attempts while the queue is empty. */
  pollMs: number;
  /** Injectable so the loop is testable without real time passing. */
  sleep?: (ms: number) => Promise<void>;
  /** Checked between jobs only — never mid-job, which is what makes the lease promise hold. */
  shouldStop?: () => boolean;
  onEvent?: (event: ExtractionEvent) => void;
}

export type OnceOutcome = 'idle' | 'completed' | 'failed';

export interface OnceResult {
  outcome: OnceOutcome;
  jobId?: string;
  /** Present on `failed`: what the cloud was told, already scrubbed. */
  reason?: string;
}

/**
 * Claim at most one job and see it through.
 *
 * The whole body after a successful claim is inside one try: from that point the device
 * holds a lease, and any throw — download, model, parse, anything — has to become a
 * `fail` call rather than an exception that escapes. The only errors allowed out of here
 * are the ones raised *before* a job was claimed, plus a credential failure, which the
 * caller must not swallow.
 */
export async function runExtractionOnce(deps: ExtractionWorkerDeps): Promise<OnceResult> {
  const { client, extract, onEvent } = deps;

  const job = await client.claim();
  if (!job) {
    onEvent?.({ type: 'idle' });
    return { outcome: 'idle' };
  }

  onEvent?.({ type: 'claimed', jobId: job.id, evidenceId: job.evidenceId, mime: job.evidence?.mime });

  let reason: string;
  try {
    const { bytes, mime } = await client.downloadEvidence(job.id);
    // The served Content-Type wins over the job's announced MIME: the bytes are what the
    // model has to read, and a disagreement between the two is the cloud's to reconcile.
    const { candidate, model } = await extract({ bytes, mime, job });
    await client.complete(job.id, candidate, model);
    onEvent?.({ type: 'completed', jobId: job.id, model, fieldCount: candidate.fields.length });
    return { outcome: 'completed', jobId: job.id };
  } catch (error) {
    // A credential failure here is not this job's fault and must not be recorded as one:
    // reporting `fail` would need the same dead credential, and would burn one of the
    // job's three attempts for a reason that has nothing to do with the document.
    if (error instanceof ExtractionAuthError) throw error;
    reason = describe(error);
  }

  try {
    await client.fail(job.id, reason);
    onEvent?.({ type: 'failed', jobId: job.id, reason });
    return { outcome: 'failed', jobId: job.id, reason };
  } catch (error) {
    if (error instanceof ExtractionAuthError) throw error;
    /*
     * The verdict could not be delivered. The job stays CLAIMED until its lease expires
     * and the cloud requeues it, which is the correct outcome — but it is silent on the
     * cloud side, so it is said loudly here. Not rethrown: the loop's next claim is a
     * better recovery than unwinding, and the backoff for the underlying fault will be
     * applied by whichever call fails next.
     */
    onEvent?.({ type: 'unreported', jobId: job.id, reason: describe(error) });
    return { outcome: 'failed', jobId: job.id, reason };
  }
}

export interface LoopSummary {
  completed: number;
  failed: number;
  /** Why the loop returned. `credential` means a 401 was seen and the operator must act. */
  stoppedBy: 'signal' | 'credential';
}

/**
 * Run until `shouldStop()` says otherwise, or the credential is refused.
 *
 * `shouldStop` is read at the top of each pass and nowhere else, so a SIGINT that arrives
 * while a job is being read lets that job finish and be reported before the loop returns.
 */
export async function runExtractionLoop(deps: ExtractionWorkerDeps): Promise<LoopSummary> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const shouldStop = deps.shouldStop ?? (() => false);
  const summary: LoopSummary = { completed: 0, failed: 0, stoppedBy: 'signal' };
  let consecutiveFailures = 0;

  while (!shouldStop()) {
    try {
      const result = await runExtractionOnce(deps);
      consecutiveFailures = 0;
      if (result.outcome === 'completed') summary.completed += 1;
      if (result.outcome === 'failed') summary.failed += 1;
      if (result.outcome === 'idle') {
        // An empty queue is not a fault: poll politely at the configured interval rather
        // than backing off, or a healthy idle cloud would see the device drift away.
        if (!shouldStop()) await sleep(deps.pollMs);
      }
    } catch (error) {
      if (error instanceof ExtractionAuthError) {
        deps.onEvent?.({ type: 'stopping', reason: 'credential' });
        summary.stoppedBy = 'credential';
        return summary;
      }
      /*
       * Everything that is not a credential failure is paced the same way, including a
       * non-retryable 4xx on the claim. Such a request will not start working because it
       * was repeated — but a permanent misconfiguration must not become a hot loop against
       * the cloud either, and the operator sees the reason on every `retrying` event.
       */
      consecutiveFailures += 1;
      const delayMs = computeBackoffMs(consecutiveFailures);
      deps.onEvent?.({ type: 'retrying', attempt: consecutiveFailures, delayMs, reason: describe(error) });
      if (!shouldStop()) await sleep(delayMs);
    }
  }

  deps.onEvent?.({ type: 'stopping', reason: 'signal' });
  return summary;
}

function describe(error: unknown): string {
  if (error instanceof Error) return scrubSecrets(error.message);
  return 'unknown error';
}
