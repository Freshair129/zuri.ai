import type { ConversationClient } from './client.js';
import { ConversationError, type ConversationAnswer, type ConversationJob, type FailureCode } from './contract.js';

// @spec FR-150 — one claimed job at a time, and completion uncertainty never becomes a second
//   execution or a failure write. A lease that expires before completion was ever attempted is
//   NOT completion uncertainty — nothing was sent to the server either way — so reporting that via
//   fail() is a truthful report, not a second write (item 4 of the FR-150 defect fix).

export interface ConversationWorkerDeps {
  client: ConversationClient;
  answer(job: ConversationJob): Promise<ConversationAnswer>;
  now?: () => number;
}

/**
 * Reports a lease that expired before `complete()` (or `fail()`) was ever attempted.
 *
 * Nothing was sent to the server in either case this is called from, so a failure write here is
 * not a double-write against an uncertain completion — it is the first and only write, and it lets
 * the server stop requeueing an attempt this device has already abandoned instead of silently
 * burning GPU on a repeat until the job's own TTL.
 */
async function reportLeaseExpired(
  deps: ConversationWorkerDeps,
  job: ConversationJob
): Promise<{ outcome: string; jobId?: string }> {
  try {
    await deps.client.fail(job, 'EXECUTION_FAILED');
  } catch (error) {
    // 409 means the server already treats the claim as stale (docs/SERVER-LINE-OPTIONAL-EDGE.md) —
    // not an error condition here. Every other error must still propagate.
    if (!(error instanceof ConversationError && error.status === 409)) throw error;
  }
  return { outcome: 'lease_expired', jobId: job.id };
}

/** One job at a time. Completion uncertainty never becomes a second execution or a failure write. */
export async function runConversationOnce(
  deps: ConversationWorkerDeps
): Promise<{ outcome: string; jobId?: string; source?: 'model' | 'rules'; reason?: string }> {
  const job = await deps.client.claim();
  if (!job) return { outcome: 'idle' };
  const expired = () => Date.parse(job.leaseExpiresAt) <= (deps.now || Date.now)();
  if (expired()) return reportLeaseExpired(deps, job);
  let answer: ConversationAnswer;
  try {
    answer = await deps.answer(job);
    if (typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 5000) {
      throw new ConversationError('INVALID_ANSWER');
    }
  } catch (error) {
    if (expired()) return reportLeaseExpired(deps, job);
    const code: FailureCode = error instanceof ConversationError && error.code === 'LOCAL_POLICY_UNAVAILABLE'
      ? 'LOCAL_POLICY_UNAVAILABLE' : 'EXECUTION_FAILED';
    await deps.client.fail(job, code);
    return { outcome: 'failed', jobId: job.id };
  }
  // The answer was computed but never sent to the server if the lease expired here — same
  // "nothing was sent" reasoning as reportLeaseExpired's own comment, so failing it is correct.
  if (expired()) return reportLeaseExpired(deps, job);
  await deps.client.complete(job, answer.text);
  return { outcome: 'completed', jobId: job.id, source: answer.source, ...(answer.reason ? { reason: answer.reason } : {}) };
}

export async function runConversationLoop(deps: ConversationWorkerDeps & {
  signal: AbortSignal; pollMs?: number;
  onEvent?: (event: { outcome: string; jobId?: string; source?: 'model' | 'rules'; reason?: string }) => void;
}): Promise<void> {
  let failures = 0;
  while (!deps.signal.aborted) {
    try { const event = await runConversationOnce(deps); deps.onEvent?.(event); failures = 0; }
    catch (error) {
      if (error instanceof ConversationError && [401, 403, 404].includes(error.status)) throw error;
      if (error instanceof ConversationError && error.code === 'INVALID_CONVERSATION_CONTRACT') throw error;
      failures++;
      deps.onEvent?.({ outcome: error instanceof ConversationError && error.status === 409 ? 'stale_lease' : 'retrying' });
    }
    const wait = Math.min(30000, (deps.pollMs || 5000) * 2 ** Math.min(failures, 3));
    if (deps.signal.aborted) break;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); deps.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, wait);
      deps.signal.addEventListener('abort', finish, { once: true });
    });
  }
}
