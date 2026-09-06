/**
 * The seam between "how Zuri decides what to say" and "which model says it".
 *
 * WHY THIS EXISTS
 * ---------------
 * `answerWithModel` used to construct an Anthropic client directly, and `LlmOptions`
 * carried `apiKey` as a required field. That put a cloud assumption inside the type:
 * a business running a model on its own hardware has no API key to give, so the
 * local-first deployment this runtime is built for could not actually be expressed.
 *
 * The orchestration around the model — scoped evidence, the unverified-number check,
 * the deterministic fallback — is provider-neutral already and does not move. Only
 * the call itself is behind this port.
 *
 * WHY THE PORT IS THIS HIGH-LEVEL
 * -------------------------------
 * It takes a whole turn (system + history + tools) and returns finished text, rather
 * than exposing one chat completion and running the tool loop above it. Anthropic and
 * OpenAI-compatible servers genuinely disagree about how tool calls are represented
 * and continued, and a shared loop would have to model both. Each adapter runs the
 * loop its own provider's way; the caller only ever sees the answer.
 */

/** JSON Schema for a tool's input. Kept as data so no provider SDK leaks upward. */
export type JsonSchema = Record<string, unknown>;

/**
 * One tool the model may call.
 *
 * `run` returns the string the model sees. Recording evidence is the caller's job and
 * happens inside `run`, so an adapter cannot forget to do it.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (input: Record<string, never>) => Promise<string>;
}

/**
 * One image handed to the model alongside the text of a turn.
 *
 * Added for edge-executed evidence extraction (the cloud's FR-143 lane), which is the
 * first caller here that has to show the model a document rather than describe it. It is
 * optional on the request precisely so every existing text-only caller is untouched, and
 * so an adapter that has no image channel can refuse loudly instead of quietly dropping
 * the picture and answering about nothing — a model that "reads" a receipt it was never
 * shown produces exactly the confident fiction a human reviewer would then approve.
 */
export interface ModelImage {
  /** Media type as the source declared it, e.g. `image/jpeg`. Not guessed from the bytes. */
  mime: string;
  /** Base64 payload with no `data:` prefix; the adapter adds whatever wrapping its wire format wants. */
  base64: string;
}

export interface ModelRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolSpec[];
  /**
   * Images to attach to the last user turn. Omitted (the normal case) means a plain text turn.
   * An adapter that cannot carry images MUST throw rather than ignore this field.
   */
  images?: ModelImage[];
  /** Stops a model that keeps calling tools instead of answering. */
  maxIterations: number;
  /** A LINE reply token expires in about thirty seconds; this is the hard ceiling. */
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ModelReply {
  /** Empty means the model produced no usable text; the caller falls back to rules. */
  text: string;
}

export interface ModelPort {
  /** For diagnostics and health output — never a secret. */
  readonly id: string;
  readonly model: string;
  generate(request: ModelRequest): Promise<ModelReply>;
}

/** Reasoning effort where a provider supports it; ignored where it does not. */
export type Effort = 'low' | 'medium' | 'high';

export interface ModelPortConfig {
  /**
   * `anthropic` calls the hosted API and requires a key.
   *
   * `openai-compatible` covers every local runtime worth naming — Ollama, vLLM,
   * LM Studio, llama.cpp, LocalAI — because they all speak the OpenAI chat API. One
   * adapter, not one per vendor, and `apiKey` is optional because a model on the
   * business's own hardware has nobody to authenticate to.
   */
  provider: 'anthropic' | 'openai-compatible';
  model: string;
  effort: Effort;
  apiKey?: string;
  /** Required for openai-compatible, e.g. http://localhost:11434/v1 */
  baseUrl?: string;
  /**
   * Context window. Left to the server by default, which is usually the right call —
   * except it is also what decides whether the model fits in VRAM. Measured on a
   * 12GB card, pathumma-thaillm-8b took 11GB at the server's chosen 40960 and spilled
   * onto the CPU; at 8192 it took 6.1GB and stayed entirely on the GPU. A LINE turn
   * never needs 40k tokens, so this is free headroom rather than a compromise.
   */
  numCtx?: number;
}
