import type { ModelPort, ModelReply, ModelRequest } from '../model-port.js';

/**
 * Core model first, second model only if the first cannot answer.
 *
 * WHAT THE HARDWARE ACTUALLY ALLOWS
 * ---------------------------------
 * Measured on the target box (RTX 3060 12GB, ollama 0.32.14) at `num_ctx: 8192`:
 *
 *   pathumma-thaillm-8b   6.1 GB   100% GPU
 *   qwen3.5:9b            5.7 GB   100% GPU
 *
 * 11.8 GB of a 12 GB card, so they do not both fit. Pinning the second evicted the
 * first — `ollama ps` showed only the newcomer. Only ONE model is resident at a time,
 * which decides what a fallback can be for.
 *
 * So this is not load balancing and not a latency race. The core model is pinned and
 * answers in ~3s; the fallback is cold and costs tens of seconds, which is past the
 * LINE reply token. It exists for the case where the core model is broken — evicted,
 * crashed, returning nothing — where a slow answer through the ack-and-push path
 * still beats no answer.
 *
 * Below both sits the deterministic reader, which is always available and never
 * guesses. That is the caller's job, not this wrapper's: an empty reply here means
 * "neither model produced anything trustworthy", and `answerWithModel` already reads
 * that as its signal to use the rules answer.
 */

export interface FallbackPortOptions {
  core: ModelPort;
  fallback: ModelPort;
  /** Told what happened, for diagnostics. Never receives prompt or reply text. */
  onFallback?: (info: { from: string; to: string; reason: string }) => void;
}

export function createFallbackPort({ core, fallback, onFallback }: FallbackPortOptions): ModelPort {
  return {
    id: `${core.id}+${fallback.id}`,
    model: core.model,

    async generate(request: ModelRequest): Promise<ModelReply> {
      let reason: string;
      try {
        const reply = await core.generate(request);
        // Empty text is a real outcome, not an error: the model ran out of iterations
        // or produced nothing usable. Worth a second opinion, since the alternative
        // is the deterministic answer either way.
        if (reply.text.trim()) return reply;
        reason = 'CORE_EMPTY';
      } catch (error) {
        reason = error instanceof Error ? error.message : 'CORE_FAILED';
      }

      // The clock is the reason this is a guard rather than an unconditional retry.
      // The fallback is not resident, so it pays a cold load; if the turn's deadline
      // has already passed there is nothing to win by starting one, and the caller
      // falls through to rules immediately instead.
      if (request.signal.aborted) return { text: '' };

      onFallback?.({ from: core.model, to: fallback.model, reason });

      try {
        return await fallback.generate(request);
      } catch {
        // Both gone. Empty is the caller's signal for the deterministic answer, which
        // is always available — so a customer still gets a reply.
        return { text: '' };
      }
    },
  };
}
