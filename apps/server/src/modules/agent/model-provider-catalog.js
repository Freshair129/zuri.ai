// @req FR-048 — one browser-safe provider allow-list shared by UI and runtime.
// @spec SDD-025, SEC-009 — contains no runtime, credentials or server-only imports.
// @tested tests/unit/fr048-provider-catalog.test.js
export const PUBLIC_LINE_PROVIDERS = Object.freeze(['openrouter', 'openai', 'anthropic', 'gemini', 'groq'])
export const LOCAL_EVAL_PROVIDERS = Object.freeze(['ollama'])
