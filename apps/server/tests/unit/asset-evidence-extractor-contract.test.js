// @req FR-138 — OCR/Vision output is strict candidate evidence, never approval.
// @spec SDD-082, BR-025, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-extractor-contract.test.js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

async function loadExtractor() {
  try { return await import(pathToFileURL(path.resolve('src/modules/asset-management/infrastructure/openai-asset-evidence-extractor.js')).href) } catch { return null }
}

function openAiResponse(output) {
  return new Response(JSON.stringify({
    id: 'resp_asset_1', model: 'gpt-5-mini',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const candidate = {
  schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'PAYMENT_SLIP',
  fields: [{ field: 'paymentReference', value: 'TX-001', confidence: 0.91, page: 1, anchor: 'TX-001', bounds: null }],
}

describe('FR-138 OpenAI evidence extractor', () => {
  it('sends an image with store:false and strict structured output, then returns attributable candidate fields', async () => {
    const module = await loadExtractor()
    expect(module, 'OpenAI Asset evidence extractor must exist').not.toBeNull()
    if (!module) return
    const fetchFn = vi.fn().mockResolvedValue(openAiResponse(candidate))
    const extractor = module.createOpenAiAssetEvidenceExtractor({ apiKey: 'openai-secret', model: 'gpt-5-mini', fetchFn })

    const result = await extractor.extract({ content: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg', name: 'slip.jpg', fileAssetId: 'file-a' })
    const [, request] = fetchFn.mock.calls[0]
    const body = JSON.parse(request.body)
    expect(body.store).toBe(false)
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true, name: 'asset_evidence_extraction' })
    expect(body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_image', image_url: expect.stringMatching(/^data:image\/jpeg;base64,/) }),
    ]))
    expect(result).toMatchObject({
      provider: 'openai', model: 'gpt-5-mini', responseId: 'resp_asset_1', status: 'CANDIDATE',
      fields: [expect.objectContaining({ field: 'paymentReference', confidence: 0.91, evidenceFileAssetId: 'file-a' })],
    })
    expect(JSON.stringify(result)).not.toContain('openai-secret')
  })

  it('uses input_file for PDF and refuses malformed provider output', async () => {
    const module = await loadExtractor()
    expect(module, 'OpenAI Asset evidence extractor must exist').not.toBeNull()
    if (!module) return
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(openAiResponse(candidate))
      .mockResolvedValueOnce(openAiResponse({ status: 'APPROVED', fields: [] }))
    const extractor = module.createOpenAiAssetEvidenceExtractor({ apiKey: 'secret', fetchFn })

    await extractor.extract({ content: Buffer.from('%PDF-1.7'), mime: 'application/pdf', name: 'receipt.pdf', fileAssetId: 'file-pdf' })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body.input[0].content).toContainEqual(expect.objectContaining({ type: 'input_file', filename: 'receipt.pdf', file_data: expect.any(String) }))
    await expect(extractor.extract({ content: Buffer.from('x'), mime: 'image/png', name: 'x.png', fileAssetId: 'file-x' }))
      .rejects.toThrow(/provider output/i)
  })
})
