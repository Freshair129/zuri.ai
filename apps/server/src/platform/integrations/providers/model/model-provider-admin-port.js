import { MODEL_PROVIDER_CODES } from '@/lib/validation/enums'

// @req FR-266 — the Integration lane's model-provider admin port: prove an API key
//   against its provider before anything is stored, and say only whether it worked.
// @spec ADR-100 D4; ADR-089 D3, D7; SEC-030; SDD-101
// @tested tests/unit/platform/model-provider-admin-port.test.js
//
// The one operation is a cheap authenticated read that every provider exposes and
// that costs no tokens — a model listing, not a completion. A completion would
// spend the owner's money to answer a question the listing already answers, and
// would make "is this key valid?" depend on a model name the owner has not chosen yet.
//
// What never leaves this module: the key, in a return value, an error, or a log
// line. Provider error bodies are never read: they routinely quote the key prefix,
// the organisation and the account, and none of that is ours to surface (SEC-030).
//
// Refusal codes:
//   MODEL_KEY_REJECTED      the provider refused the key (401/403) — one code, so a
//                           response cannot distinguish "wrong key" from "key without
//                           access to this endpoint"
//   MODEL_PROVIDER_UNAVAILABLE  provider 5xx, 429, timeout or network failure; nothing
//                           is stored, and the caller may retry
//   MODEL_PROVIDER_UNSUPPORTED  a provider code with no probe here

export const MODEL_PROVIDER_API = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1/models?limit=1',
  openai: 'https://api.openai.com/v1/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
  groq: 'https://api.groq.com/openai/v1/models',
})

export function modelProviderFailure(code, status) {
  const error = new Error(code)
  error.code = code
  error.status = status
  return error
}

/**
 * The authorization each provider wants. Built here and handed straight to
 * `fetch`, never stored, never returned. Gemini takes the key in a header
 * (`x-goog-api-key`) rather than the query string on purpose: a query string is
 * the one place a secret reliably survives in proxy and server access logs.
 */
function authHeaders(provider, apiKey) {
  if (provider === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  if (provider === 'gemini') return { 'x-goog-api-key': apiKey }
  return { authorization: `Bearer ${apiKey}` }
}

export function createModelProviderAdminPort({ fetchFn = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchFn !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw modelProviderFailure('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID', 503)
  }

  /**
   * Prove the key. Resolves to the provider code on success; throws one of the
   * three refusal codes otherwise. It returns no provider payload at all — the
   * caller needs the verdict, and a model list is one more thing that could carry
   * an organisation name into a response.
   */
  async function validateKey({ provider, apiKey }) {
    if (!MODEL_PROVIDER_CODES.includes(provider)) throw modelProviderFailure('MODEL_PROVIDER_UNSUPPORTED', 400)
    const url = MODEL_PROVIDER_API[provider]
    if (!url) throw modelProviderFailure('MODEL_PROVIDER_UNSUPPORTED', 400)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchFn(url, { method: 'GET', headers: authHeaders(provider, apiKey), signal: controller.signal })
    } catch {
      // A network failure and an abort are the same answer to the caller: we do
      // not know whether this key is good, so nothing may be stored as if we did.
      throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401 || response.status === 403) throw modelProviderFailure('MODEL_KEY_REJECTED', 422)
    // 400 and 404 mean this probe is wrong for this provider, not that the key is
    // bad. Reporting them as a rejected key would tell an owner to replace a key
    // that works, so they are reported as our own unavailability instead.
    if (!response.ok) throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    return { provider, validationCode: `MODEL_KEY_VALIDATED:${provider.toUpperCase()}` }
  }

  return { validateKey }
}
