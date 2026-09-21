import { MODEL_PROVIDER_CODES, MODEL_ID_PATTERN } from '@/lib/validation/enums'

// @req FR-266 — the Integration lane's model-provider admin port: prove an API key
//   *and the model id it will be used with* against the provider before anything is
//   stored, and say only whether it worked.
// @spec ADR-100 D4; ADR-089 D3, D7; SEC-030; SDD-101
// @tested tests/unit/platform/model-provider-admin-port.test.js
//
// The one operation is a cheap authenticated read that every provider exposes and
// that costs no tokens: *retrieve one model*, not a completion. A completion would
// spend the owner's money to answer a question the read already answers.
//
// It reads the one model the owner chose rather than listing all of them, because
// that single call answers both questions an owner can get wrong. Until 2026-09-21
// this port listed models, which proved the key and said nothing about the model:
// a typo, or a model the provider had since retired, saved cleanly and then failed
// on every customer's message — the first sign of the mistake was a customer.
//
// What never leaves this module: the key, in a return value, an error, or a log
// line. Provider error bodies are never read: they routinely quote the key prefix,
// the organisation and the account, and none of that is ours to surface (SEC-030).
// The status code alone carries the verdict.
//
// Refusal codes:
//   MODEL_KEY_REJECTED      the provider refused the key (401/403) — one code, so a
//                           response cannot distinguish "wrong key" from "key without
//                           access to this endpoint"
//   MODEL_NOT_FOUND         the key is accepted but this model is not available to
//                           it (404) — it does not exist, was retired, or this key's
//                           account cannot use it. All three mean the same thing to
//                           an owner: pick a model this key can call.
//   MODEL_ID_INVALID        the model id is missing or malformed; no call is made
//   MODEL_PROVIDER_UNAVAILABLE  provider 5xx, 429, timeout or network failure; nothing
//                           is stored, and the caller may retry
//   MODEL_PROVIDER_UNSUPPORTED  a provider code with no probe here

export const MODEL_PROVIDER_API = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1/models/',
  openai: 'https://api.openai.com/v1/models/',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
  groq: 'https://api.groq.com/openai/v1/models/',
})

/**
 * The probe URL for one model. The model id is percent-encoded as a single path
 * segment: `MODEL_ID_PATTERN` admits `/` and `.` (fine-tuned and namespaced ids use
 * them), and an unencoded `a/../../x` would walk out of `/models/` to another
 * endpoint on the provider's host under the owner's key.
 */
export function modelProbeUrl(provider, model) {
  return `${MODEL_PROVIDER_API[provider]}${encodeURIComponent(model)}`
}

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
   * Prove the key and the model together. Resolves to the provider code on
   * success; throws one of the refusal codes otherwise. It returns no provider
   * payload at all — the caller needs the verdict, and a model record is one more
   * thing that could carry an organisation name into a response.
   */
  async function validateKey({ provider, apiKey, model }) {
    if (!MODEL_PROVIDER_CODES.includes(provider)) throw modelProviderFailure('MODEL_PROVIDER_UNSUPPORTED', 400)
    if (!MODEL_PROVIDER_API[provider]) throw modelProviderFailure('MODEL_PROVIDER_UNSUPPORTED', 400)
    // Checked here as well as at the service boundary: this port builds a URL from
    // the value, so it does not trust a caller to have validated it first.
    if (typeof model !== 'string' || !MODEL_ID_PATTERN.test(model)) throw modelProviderFailure('MODEL_ID_INVALID', 400)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchFn(modelProbeUrl(provider, model), { method: 'GET', headers: authHeaders(provider, apiKey), signal: controller.signal })
    } catch {
      // A network failure and an abort are the same answer to the caller: we do
      // not know whether this key is good, so nothing may be stored as if we did.
      throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401 || response.status === 403) throw modelProviderFailure('MODEL_KEY_REJECTED', 422)
    // 404 now has one meaning: the key got through and the model is not there for
    // it. (When this probe listed models, 404 meant the probe itself was wrong, and
    // was reported as unavailability for that reason.) The key is checked first by
    // the provider, so a 404 is never a bad key in disguise.
    if (response.status === 404) throw modelProviderFailure('MODEL_NOT_FOUND', 422)
    // Anything else — 400, 429, 5xx — says nothing reliable about the key or the
    // model, so it is our unavailability and the owner may retry. Reporting it as a
    // rejected key would tell an owner to replace a key that works.
    if (!response.ok) throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    return { provider, validationCode: `MODEL_KEY_VALIDATED:${provider.toUpperCase()}` }
  }

  return { validateKey }
}
