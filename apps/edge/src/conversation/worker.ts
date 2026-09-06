import type { ConversationClient } from './client.js';
import { ConversationError, type ConversationJob, type FailureCode } from './contract.js';

// @spec FR-150 — one claimed job at a time, and completion uncertainty never becomes a second
//   execution or a failure write.

export interface ConversationWorkerDeps {
  client: ConversationClient;
  answer(job: ConversationJob): Promise<string>;
  now?: () => number;
}

/** One job at a time. Completion uncertainty never becomes a second execution or a failure write. */
export async function runConversationOnce(deps: ConversationWorkerDeps): Promise<{ outcome: string; jobId?: string }> {
  const job = await deps.client.claim();
  if (!job) return { outcome: 'idle' };
  const expired = () => Date.parse(job.leaseExpiresAt) <= (deps.now || Date.now)();
  if (expired()) return { outcome: 'lease_expired', jobId: job.id };
  let text: string;
  try {
    text = await deps.answer(job);
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new ConversationError('INVALID_ANSWER');
  } catch (error) {
    if (expired()) return { outcome: 'lease_expired', jobId: job.id };
    const code: FailureCode = error instanceof ConversationError && error.code === 'LOCAL_POLICY_UNAVAILABLE'
      ? 'LOCAL_POLICY_UNAVAILABLE' : 'EXECUTION_FAILED';
    await deps.client.fail(job, code);
    return { outcome: 'failed', jobId: job.id };
  }
  if (expired()) return { outcome: 'lease_expired', jobId: job.id };
  await deps.client.complete(job, text);
  return { outcome: 'completed', jobId: job.id };
}

export async function runConversationLoop(deps: ConversationWorkerDeps & {
  signal: AbortSignal; pollMs?: number; onEvent?: (event: { outcome: string; jobId?: string }) => void;
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
