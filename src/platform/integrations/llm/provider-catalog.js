// @req FR-048 — the Platform surface and the agent runtime share one public LLM
// provider allow-list. The keys are derived from `PUBLIC_LINE_PROVIDERS`, which
// the provider port validates against; only the display label and the model hint
// live here. A hand-copied second list would let the page offer a provider the
// port rejects at submit, or hide one the port accepts.
// @spec SDD-025, SEC-009 — presentation only; no credential ever passes through here.
// @tested tests/unit/fr048-provider-catalog.test.js
import { PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'

const PRESENTATION = {
  openrouter: { name: 'OpenRouter', modelHint: 'openai/gpt-4o-mini' },
  openai: { name: 'OpenAI', modelHint: 'gpt-4o-mini' },
  anthropic: { name: 'Anthropic', modelHint: 'claude-3-5-haiku-latest' },
  gemini: { name: 'Google Gemini', modelHint: 'gemini-2.0-flash' },
  groq: { name: 'Groq', modelHint: 'llama-3.3-70b-versatile' },
}

export const LLM_PROVIDER_CATALOG = Object.freeze(PUBLIC_LINE_PROVIDERS.map((key) => {
  const presentation = PRESENTATION[key]
  // Fail at import rather than rendering a provider with no name: adding one to
  // the port and forgetting the label here is the drift this module exists to stop.
  if (!presentation) throw new Error(`LLM_PROVIDER_PRESENTATION_MISSING: ${key}`)
  return Object.freeze({ key, ...presentation })
}))

export const LLM_PROVIDER_KEYS = Object.freeze(LLM_PROVIDER_CATALOG.map((provider) => provider.key))

export function providerByKey(key) {
  return LLM_PROVIDER_CATALOG.find((provider) => provider.key === key) ?? null
}
