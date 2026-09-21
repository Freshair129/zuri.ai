// @req FR-048 — one browser-safe provider allow-list shared by UI and runtime.
// @spec SDD-025, SEC-009 — contains no runtime, credentials or server-only imports.
// @tested tests/unit/fr048-provider-catalog.test.js
export const PUBLIC_LINE_PROVIDERS = Object.freeze(['openrouter', 'openai', 'anthropic', 'gemini', 'groq'])
export const LOCAL_EVAL_PROVIDERS = Object.freeze(['ollama'])
// The operator's own Private Runtime Platform (ADR-100 D7). Kept apart from the
// public list on purpose: it is not a public provider, and it is the one production
// provider whose address is operator configuration rather than a fixed constant, so
// the port requires that address instead of defaulting one.
export const PRIVATE_RUNTIME_PROVIDERS = Object.freeze(['prp'])
