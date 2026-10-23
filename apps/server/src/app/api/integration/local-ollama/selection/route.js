import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertMainDevLocalOllamaAvailable, selectMainDevLocalOllamaModel } from '@/modules/integration/application/local-ollama-selection-service'

// @req FR-079, FR-080 — the owner selects an installed model ID for the scoped
//   test profile; provider origin, Business, account and credentials stay server-side.
// @spec ADR-100 D5, D9; SEC-001, SEC-030 — bounded input, trusted scope and no cache.
// @tested tests/unit/local-ollama-owner-routes.test.js
export const dynamic = 'force-dynamic'

const BODY_LIMIT_BYTES = 16 * 1024

async function readBody(request) {
  const contentLength = request.headers.get('content-length')
  if (/^\d+$/.test(contentLength ?? '') && Number(contentLength) > BODY_LIMIT_BYTES) {
    try { await request.body?.cancel?.() } catch {}
    throw httpError(413, 'LOCAL_OLLAMA_INPUT_TOO_LARGE')
  }

  const body = request.body
  if (!body || typeof body.getReader !== 'function') throw httpError(400, 'LOCAL_OLLAMA_INPUT_INVALID')

  const reader = body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > BODY_LIMIT_BYTES) {
        try { await reader.cancel() } catch {}
        throw httpError(413, 'LOCAL_OLLAMA_INPUT_TOO_LARGE')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (Number(error?.status) === 413) throw error
    throw httpError(400, 'LOCAL_OLLAMA_INPUT_INVALID')
  } finally {
    try { reader.releaseLock() } catch {}
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw httpError(400, 'LOCAL_OLLAMA_INPUT_INVALID') }
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, 'LOCAL_OLLAMA_INPUT_INVALID')
  }
}

export async function POST(request) {
  const response = await handle(async () => {
    const viewer = await resolveRequestViewer(request)
    assertMainDevLocalOllamaAvailable()
    const body = await readBody(request)
    return selectMainDevLocalOllamaModel(body, { viewer })
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
