/**
 * Keeps a local model resident so the first customer of the day gets an answer.
 *
 * THE PROBLEM THIS SOLVES
 * ----------------------
 * A LINE reply token expires in about thirty seconds. Measured on this machine
 * (RTX 3060 12GB, ollama 0.32.14), a cold model costs far more than that:
 *
 *   qwen3.5:4b            cold 21.2s   warm 6.7s   pinned 2.4-3.0s
 *   qwen3.5:9b            cold 91.1s   warm 9.3s
 *   pathumma-thaillm-8b   cold 37.7s   warm 8.1s
 *
 * So the very first message after the model is evicted does not get a late reply —
 * it gets no reply at all, because the token is already dead when the answer
 * arrives. Pinning turns that into a steady ~3s.
 *
 * WHY THIS IS NOT IN THE OPENAI-COMPATIBLE ADAPTER
 * ------------------------------------------------
 * `keep_alive` is Ollama's, not OpenAI's. Sending it to `/v1/chat/completions`
 * returns 200 and is then ignored — verified: `ollama ps` stayed empty afterwards,
 * which is the worst kind of failure, one that looks like success. It only works on
 * the native `/api/generate`.
 *
 * Keeping it here leaves that adapter a clean OpenAI client that still works against
 * vLLM, LM Studio and LocalAI. Warming is a deployment concern, and a server that
 * does not understand the call simply reports unavailable and is skipped.
 */

export interface WarmResult {
  /** False means the model is not resident; replies will pay the cold cost. */
  pinned: boolean;
  /** Why not, when it is not. Never a raw upstream body. */
  reason?: string;
  ms: number;
}

export interface ModelWarmerOptions {
  /** Ollama's own base, e.g. http://localhost:11434 — NOT the /v1 path. */
  nativeBaseUrl: string;
  model: string;
  /**
   * Must match what the chat path sends. Ollama keys a loaded model by its context
   * size, so warming at one size and answering at another loads it twice — the pin
   * is spent on a copy nothing uses.
   */
  numCtx?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** `-1` is Ollama's "keep this loaded until told otherwise". */
const FOREVER = -1;

/**
 * Load the model and pin it in VRAM.
 *
 * Generates a single token: enough to force the load, cheap enough to run on a
 * schedule. Never throws — a warmer that takes the process down would be worse than
 * the cold start it exists to prevent.
 */
export async function warmModel({
  nativeBaseUrl,
  model,
  numCtx,
  fetchFn = fetch,
  timeoutMs = 180000,
}: ModelWarmerOptions): Promise<WarmResult> {
  const started = Date.now();
  const base = nativeBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');

  try {
    const response = await fetchFn(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'ok',
        stream: false,
        keep_alive: FOREVER,
        // Thinking models spend their budget reasoning before emitting anything, and
        // a warm-up has nothing to reason about (SPEC--LOCAL-LLM-DISPATCH-V2 §5.4).
        think: false,
        options: { num_predict: 1, ...(numCtx ? { num_ctx: numCtx } : {}) },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { pinned: false, reason: `HTTP_${response.status}`, ms: Date.now() - started };
    }
    return { pinned: true, ms: Date.now() - started };
  } catch (error) {
    return {
      pinned: false,
      reason: error instanceof Error ? error.name : 'UNKNOWN',
      ms: Date.now() - started,
    };
  }
}

/**
 * Release the model. For shutdown, or to hand the GPU to something else — this
 * machine also runs heavier ML work that a pinned model would starve.
 */
export async function releaseModel({
  nativeBaseUrl,
  model,
  fetchFn = fetch,
  timeoutMs = 30000,
}: ModelWarmerOptions): Promise<void> {
  const base = nativeBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  try {
    await fetchFn(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Releasing is best-effort: the model is evicted on idle anyway.
  }
}
