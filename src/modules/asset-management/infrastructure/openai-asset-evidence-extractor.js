// @req FR-138 — OpenAI is the first strict candidate extractor behind the Asset port.
// @spec SDD-082, SDD-085, BR-025, NFR-022, SEC-024, ADR-056, ADR-059
// @tested tests/unit/asset-evidence-extractor-contract.test.js
//
// The candidate schema moved to a shared module (SDD-085) so the edge completion
// path (FR-143) validates a device-posted candidate with the very object this
// adapter asks the provider for. Re-exported here because the contract test and
// the poller import it from this path.
import { zCandidate, CANDIDATE_OUTPUT_SCHEMA as OUTPUT_SCHEMA } from './asset-evidence-candidate-schema'

export { zCandidate, CANDIDATE_OUTPUT_SCHEMA } from './asset-evidence-candidate-schema'

function extractorError(message, status = 503) {
  const error = new Error(message)
  error.status = status
  return error
}

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text
    }
  }
  return null
}

function inputContent({ content, mime, name }) {
  const base64 = Buffer.from(content).toString('base64')
  if (mime === 'application/pdf') {
    return { type: 'input_file', filename: name, file_data: `data:application/pdf;base64,${base64}` }
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw extractorError('Unsupported evidence MIME for extraction', 415)
  }
  return { type: 'input_image', image_url: `data:${mime};base64,${base64}`, detail: 'high' }
}

export function createOpenAiAssetEvidenceExtractor({
  apiKey,
  model = 'gpt-5-mini',
  endpoint = 'https://api.openai.com/v1/responses',
  fetchFn = fetch,
  timeoutMs = 45_000,
} = {}) {
  return Object.freeze({
    async extract({ content, mime, name, fileAssetId }) {
      if (!apiKey) throw extractorError('OpenAI API key is not configured')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetchFn(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            store: false,
            input: [{
              role: 'user',
              content: [
                { type: 'input_text', text: 'Extract only visible asset receipt, invoice, delivery, or payment-slip fields. Never infer approval or authority. Return null provenance values when unavailable.' },
                inputContent({ content, mime, name }),
              ],
            }],
            text: { format: { type: 'json_schema', name: 'asset_evidence_extraction', strict: true, schema: OUTPUT_SCHEMA } },
          }),
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw extractorError('OpenAI extraction timed out')
        throw extractorError(`OpenAI extraction unavailable: ${error?.message || 'unknown error'}`)
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        throw extractorError(`OpenAI extraction failed (${response.status})`)
      }
      let payload
      try { payload = await response.json() } catch { throw extractorError('OpenAI provider output was not JSON') }
      const text = outputText(payload)
      let candidate
      try { candidate = zCandidate.parse(JSON.parse(text || '')) } catch { throw extractorError('OpenAI provider output did not match the Asset candidate schema') }
      return {
        provider: 'openai',
        model: payload.model || model,
        responseId: payload.id || null,
        ...candidate,
        fields: candidate.fields.map((field) => ({ ...field, evidenceFileAssetId: fileAssetId })),
      }
    },
  })
}

export function createConfiguredOpenAiAssetEvidenceExtractor(env = process.env, options = {}) {
  return createOpenAiAssetEvidenceExtractor({
    apiKey: env.OPENAI_API_KEY,
    model: env.ZURI_ASSET_EVIDENCE_MODEL || 'gpt-5-mini',
    ...options,
  })
}
