import { MODEL_PROVIDER_CODES, MODEL_ID_PATTERN, PRIVATE_RUNTIME_PROVIDER } from '@/lib/validation/enums'

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
//   PRIVATE_RUNTIME_NOT_CONFIGURED  `prp` chosen on a server with no private runtime
//                           address configured (FR-267) — an operator's fix, not the owner's

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

// A granted-model list is small — a handful of aliases. Anything larger is not the
// answer this probe asked for, and it is not read into memory to find out.
const PRP_MODEL_LIST_MAX_BYTES = 256 * 1024

/**
 * @req FR-267 — the model ids in a PRP `GET /v1/models` reply (its `ModelList`:
 * `{ object: 'list', data: [{ id, object: 'model' }] }`), or null when the reply is
 * not that shape. Only the ids are read, and only to test membership; the list is
 * never returned, logged or stored.
 */
async function grantedModelIds(response) {
  let text
  try {
    text = await response.text()
  } catch {
    return null
  }
  if (typeof text !== 'string' || text.length > PRP_MODEL_LIST_MAX_BYTES) return null
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!json || !Array.isArray(json.data)) return null
  return new Set(json.data.map((entry) => entry?.id).filter((id) => typeof id === 'string'))
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
  async function validateKey({ provider, apiKey, model, baseUrl }) {
    if (!MODEL_PROVIDER_CODES.includes(provider)) throw modelProviderFailure('MODEL_PROVIDER_UNSUPPORTED', 400)
    // Checked here as well as at the service boundary: this port builds a URL from
    // the value, so it does not trust a caller to have validated it first.
    if (typeof model !== 'string' || !MODEL_ID_PATTERN.test(model)) throw modelProviderFailure('MODEL_ID_INVALID', 400)
    if (provider === PRIVATE_RUNTIME_PROVIDER) return validatePrivateRuntime({ apiKey, model, baseUrl })
    if (!MODEL_PROVIDER_API[provider]) throw modelProviderFailure('MODEL_PROVIDER_UNSUPPORTED', 400)

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

  /**
   * @req FR-267 — prove a PRP client key and the alias it will be used with.
   *
   * PRP's client contract has `GET /v1/models` — "list granted model aliases" — and no
   * per-model read, so the check is the list: 401/403 is the key, and an alias missing
   * from what *this key* is granted is the model. That is a stronger answer than
   * "the model exists": a key not granted the alias could not use it either.
   *
   * This is the one probe that reads a success body, and only because the answer is
   * in it. It is the operator's own runtime, not a third party, and only the ids are
   * read, bounded, to test membership. Redirects are refused: the configured origin is
   * the only place this key may be sent (ADR-099 D10).
   */
  async function validatePrivateRuntime({ apiKey, model, baseUrl }) {
    // No configured runtime is a refusal, never a guess at an address.
    if (typeof baseUrl !== 'string' || !baseUrl) throw modelProviderFailure('PRIVATE_RUNTIME_NOT_CONFIGURED', 503)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchFn(`${baseUrl}/v1/models`, {
        method: 'GET', headers: authHeaders(PRIVATE_RUNTIME_PROVIDER, apiKey), signal: controller.signal, redirect: 'error',
      })
    } catch {
      throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401 || response.status === 403) throw modelProviderFailure('MODEL_KEY_REJECTED', 422)
    // PRP answers 503 NO_ELIGIBLE_NODE when no GPU can serve; that is unavailability
    // and says nothing about the key, so nothing is stored and the owner may retry.
    if (!response.ok) throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    const granted = await grantedModelIds(response)
    if (!granted) throw modelProviderFailure('MODEL_PROVIDER_UNAVAILABLE', 503)
    if (!granted.has(model)) throw modelProviderFailure('MODEL_NOT_FOUND', 422)
    return { provider: PRIVATE_RUNTIME_PROVIDER, validationCode: `MODEL_KEY_VALIDATED:${PRIVATE_RUNTIME_PROVIDER.toUpperCase()}` }
  }

  return { validateKey }
}
