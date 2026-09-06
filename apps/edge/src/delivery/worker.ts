import { Role } from '../identity/registry.js';
import {
  DeliveryIntent,
// @req BR-008 — every outbound reply is reported to Zuri as a delivery receipt, on the reply-turn
// @req BR-010 — a queued delivery is offered to the archive once it has reached the customer.
//   lane and never as a Studio job.
// @spec FR-093 — zuri-ai's receipt contract.

  OutboxOptions,
  claim,
  markDelivered,
  markFailed,
  pendingIntents,
  reclaimStale,
  sweep,
} from './outbox.js';

/**
 * The half of answering that no longer happens inside the webhook request.
 *
 * It claims one queued question at a time, works out the answer, pushes it, and settles the
 * record. Everything that can fail is expected to fail: the answer can throw, the push can be
 * rejected, the process can die holding a claim. Each of those has a landing place, and none of
 * them is silence.
 */

export interface WorkerDeps {
  outbox: OutboxOptions;
  /** Produce the answer. Slow by nature — this is why the queue exists. */
  answer: (question: string, role: Role, conversationKey: string) => Promise<string>;
  /** Deliver it. Separate from `answer` so a delivery failure can be retried without re-answering. */
  push: (recipientId: string, text: string) => Promise<unknown>;
  /**
   * Tell the cloud what the customer actually received (FR-093).
   *
   * Optional, and absent on a device that is not bound to a cloud — which is the state this
   * shipped in, and why BR-008 recorded that the outbound half of every conversation existed only
   * in the local archive. Failure here never fails the delivery: the message has already reached
   * the customer by the time this runs, and turning a bookkeeping error into a retry would send it
   * again.
   */
  reportDelivery?: (receipt: {
    inboundMessageId: string;
    text: string;
    source: 'STACK' | 'TRANSPORT_FALLBACK';
  }) => Promise<unknown>;
  /**
   * Record the delivered answer in the local LINE archive (BR-010).
   *
   * The queue is the other way a message leaves this runtime: `deliverDirectReply` covers the
   * inline reply, and everything that gets acknowledged and answered later leaves through here. An
   * archive that held only the inline half would be missing exactly the slow answers — the ones
   * worth going back to read.
   *
   * Same rule as `reportDelivery`: it runs after the record is terminal, and a failure here never
   * reopens a delivery the customer already has.
   */
  recordOutbound?: (input: {
    recipientId: string;
    text: string;
    inReplyToEventId?: string;
  }) => void;
  /** Diagnostics. Never receives message text — only what happened to which record. */
  onEvent?: (event: WorkerEvent) => void;
}

export interface WorkerEvent {
  type: 'reclaimed' | 'skipped' | 'delivered' | 'failed' | 'quarantined' | 'swept' | 'receipt';
  /** On a `receipt` event: whether the cloud was told, and if not, why not. */
  reported?: boolean;
  idempotencyKey?: string;
  conversationKey?: string;
  attempts?: number;
  reason?: string;
  count?: number;
}

export interface DrainResult {
  reclaimed: number;
  delivered: number;
  failed: number;
  quarantined: number;
  skipped: number;
}

/**
 * One pass over the queue.
 *
 * Stale claims are recovered first, because a record abandoned by a dead process is the one most
 * likely to be forgotten and the cheapest to rescue.
 */
export async function drainOnce(deps: WorkerDeps): Promise<DrainResult> {
  const result: DrainResult = {
    reclaimed: 0,
    delivered: 0,
    failed: 0,
    quarantined: 0,
    skipped: 0,
  };

  for (const intent of reclaimStale(deps.outbox)) {
    result.reclaimed++;
    if (intent.status === 'QUARANTINED') result.quarantined++;
    deps.onEvent?.({
      type: 'reclaimed',
      idempotencyKey: intent.idempotencyKey,
      attempts: intent.attempts,
      reason: intent.lastError,
    });
  }

  for (const queued of pendingIntents(deps.outbox)) {
    const taken = claim(deps.outbox, queued.idempotencyKey, queued.revision);
    if (!taken.claimed) {
      /*
       * Not an error. Another worker got there first, or this person already has an answer in
       * flight and this one waits its turn.
       */
      result.skipped++;
      deps.onEvent?.({ type: 'skipped', idempotencyKey: queued.idempotencyKey, reason: taken.code });
      continue;
    }

    const settled = await deliver(taken.intent, deps);
    if (settled === 'delivered') result.delivered++;
    else if (settled === 'quarantined') result.quarantined++;
    else result.failed++;
  }

  const swept = sweep(deps.outbox);
  if (swept) deps.onEvent?.({ type: 'swept', count: swept });

  return result;
}

async function deliver(
  intent: DeliveryIntent,
  deps: WorkerDeps
): Promise<'delivered' | 'failed' | 'quarantined'> {
  const recipient = intent.recipientId;
  if (!recipient) {
    /*
     * A claimed record with no recipient cannot be delivered by anybody, so retrying is pointless.
     * Straight to quarantine, where it stays visible.
     */
    const settled = markFailed(deps.outbox, intent.idempotencyKey, 'recipient already redacted');
    deps.onEvent?.({
      type: 'quarantined',
      idempotencyKey: intent.idempotencyKey,
      reason: 'recipient already redacted',
    });
    return settled?.status === 'QUARANTINED' ? 'quarantined' : 'failed';
  }

  try {
    const text = await deps.answer(intent.question, intent.role, intent.conversationKey);
    await deps.push(recipient, text);
    markDelivered(deps.outbox, intent.idempotencyKey);

    // BR-010, recorded here for the same reason the receipt is: the message has reached the
    // customer, so nothing this does may turn into a retry.
    try {
      deps.recordOutbound?.({
        recipientId: recipient,
        text,
        ...(intent.lineEventId ? { inReplyToEventId: intent.lineEventId } : {}),
      });
    } catch {
      // Archiving is bookkeeping about a delivered message; a failure is not a delivery failure.
    }

    /*
     * The receipt is reported after the record is terminal, on purpose. It is bookkeeping about a
     * message the customer already has; if it throws, the delivery still happened, and letting that
     * reopen the record would send the message a second time.
     */
    if (deps.reportDelivery) {
      if (!intent.inboundMessageId) {
        deps.onEvent?.({
          type: 'receipt',
          idempotencyKey: intent.idempotencyKey,
          reported: false,
          reason: 'no inbound message id — the event was not forwarded to the cloud',
        });
      } else {
        try {
          await deps.reportDelivery({ inboundMessageId: intent.inboundMessageId, text, source: 'STACK' });
          deps.onEvent?.({ type: 'receipt', idempotencyKey: intent.idempotencyKey, reported: true });
        } catch (error) {
          deps.onEvent?.({
            type: 'receipt',
            idempotencyKey: intent.idempotencyKey,
            reported: false,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    deps.onEvent?.({
      type: 'delivered',
      idempotencyKey: intent.idempotencyKey,
      conversationKey: intent.conversationKey,
      attempts: intent.attempts,
    });
    return 'delivered';
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const settled = markFailed(deps.outbox, intent.idempotencyKey, reason);
    const quarantined = settled?.status === 'QUARANTINED';
    deps.onEvent?.({
      type: quarantined ? 'quarantined' : 'failed',
      idempotencyKey: intent.idempotencyKey,
      attempts: intent.attempts,
      reason,
    });
    return quarantined ? 'quarantined' : 'failed';
  }
}

/**
 * Run the queue continuously.
 *
 * A tick is scheduled after the previous one finishes rather than on a fixed interval, so a slow
 * answer cannot cause passes to pile up on top of each other. Returns the function that stops it.
 */
export function startWorker(deps: WorkerDeps, intervalMs: number): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await drainOnce(deps);
    } catch (error) {
      // A failure in the loop itself must not end the loop.
      deps.onEvent?.({
        type: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
