import { ConversationError, type ConversationJob } from './contract.js';

// @spec ZAI:FR-150 — the server's relative budget only decreases, even across wall-clock changes.
// @tested tests/unit/conversation-deadline.test.ts
const clocks = new WeakMap<ConversationJob, { until: number; now: () => number }>();

export function bindConversationBudget(job: ConversationJob, startedAt: number, now = () => performance.now()): void {
  if ('deadline' in job) {
    // Charging the FULL request round trip overestimates transit safely. Never reset at parsing.
    clocks.set(job, { until: startedAt + job.deadline.remainingBudgetMs, now });
  }
}

export function remainingConversationBudget(job: ConversationJob): number | null {
  if (!('deadline' in job)) return null;
  const clock = clocks.get(job);
  // A v2 job may not bypass the trusted claim client's monotonic clock by being reconstructed.
  if (!clock) throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
  return Math.max(0, Math.floor(clock.until - clock.now()));
}

export async function withinConversationBudget<T>(job: ConversationJob, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const budget = remainingConversationBudget(job);
  // Leave two seconds to return the answer to Server, in addition to its LINE-send reserve.
  const remaining = budget === null ? null : budget - 2000;
  if (remaining !== null && remaining <= 0) throw new ConversationError('REPLY_DEADLINE_MISSED');
  const controller = new AbortController();
  if (remaining === null) return work(controller.signal);
  let timer: ReturnType<typeof setTimeout>;
  try {
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ConversationError('REPLY_DEADLINE_MISSED'));
          controller.abort();
        }, remaining);
      });
    return await Promise.race([work(controller.signal), expired]);
  } finally { clearTimeout(timer!); }
}
