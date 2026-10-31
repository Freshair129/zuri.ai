// @req FR-267 — explicit synthetic qualification of the configured PRP path.
// @spec ADR-100 D7, SEC-030 — no key or provider body in output; no LINE sends.
// @tested services/conversation-runtime/test/private-runtime-network.test.js
import { readFile } from 'node:fs/promises'
import { createModelPort } from '../src/model-port.js'
import { normalizePrivateRuntimeBaseUrl } from '../src/private-runtime-config.js'

try {
  const baseUrl = normalizePrivateRuntimeBaseUrl(process.env.ZURI_PRIVATE_RUNTIME_BASE_URL)
  const model = process.env.ZURI_PRIVATE_RUNTIME_PROBE_MODEL
  if (!baseUrl || !model || !process.env.ZURI_PRIVATE_RUNTIME_PROBE_KEY_FILE) throw new Error('PROBE_CONFIG_REQUIRED')
  const apiKey = (await readFile(process.env.ZURI_PRIVATE_RUNTIME_PROBE_KEY_FILE, 'utf8')).trim()
  if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error('PROBE_KEY_INVALID')
  const signal = AbortSignal.timeout(10_000)
  const listing = await fetch(`${baseUrl}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'error', signal })
  if (!listing.ok) throw new Error(`PROBE_MODELS_HTTP_${listing.status}`)
  // Limit the read before parsing, even in this operator-only diagnostic.
  const reader = listing.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256 * 1024) { void reader.cancel(); throw new Error('PROBE_MODELS_TOO_LARGE') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  const models = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!models?.data?.some(entry => entry.id === model)) throw new Error('PROBE_ALIAS_NOT_GRANTED')
  const invalid = await fetch(`${baseUrl}/v1/models`, { headers: { authorization: 'Bearer synthetic-invalid-probe-key' }, redirect: 'error', signal })
  void invalid.body?.cancel()
  if (![401, 403].includes(invalid.status)) throw new Error('PROBE_INVALID_KEY_ACCEPTED')
  const deniedModel = process.env.ZURI_PRIVATE_RUNTIME_PROBE_DENIED_MODEL
  if (deniedModel) {
    if (models.data.some(entry => entry.id === deniedModel)) throw new Error('PROBE_DENIED_ALIAS_LISTED')
    const denied = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: deniedModel, messages: [{ role: 'user', content: 'Synthetic access refusal check' }], stream: false, max_tokens: 1 }) })
    void denied.body?.cancel()
    if (denied.status !== 403) throw new Error('PROBE_DENIED_ALIAS_NOT_REFUSED')
  }
  const text = await createModelPort({ privateRuntimeBaseUrl: baseUrl }).generate({
    question: 'Repeat the synthetic evidence value.', evidence: { records: [{ value: 'PRP synthetic qualification' }] },
    credential: { provider: 'prp', model, apiKey, baseUrl }, deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  })
  if (!text.trim()) throw new Error('PROBE_EMPTY_REPLY')
  process.stdout.write(`${JSON.stringify({ status: 'PASS', models: 'PASS', invalidKey: 'PASS', unauthorizedAlias: deniedModel ? 'PASS' : 'NOT_RUN', completion: 'PASS',
    scope: 'synthetic-provider-path-only', hardwareQualified: false, productionQualified: false })}\n`)
} catch (error) {
  const code = /^(?:MODEL_|PROBE_)[A-Z0-9_]+$/.test(error?.code ?? error?.message ?? '') ? error.code ?? error.message : 'PROBE_TRANSPORT_FAILED'
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code })}\n`)
  process.exitCode = 1
}
