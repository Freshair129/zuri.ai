// @spec ADR-048 D1-D3
// @tested tests/unit/knowledge-studio/authorization.test.js, tests/unit/knowledge-studio/knowledge-studio-data.test.js

import { requireKnowledgeStudioOperator } from '@/modules/platform-control/knowledge-studio/authorization'
import { readKnowledgeStudioDocument } from '@/modules/platform-control/knowledge-studio/knowledge-studio-data'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

function json(body, status = 200) {
  return Response.json(body, { status, headers })
}

export async function GET(request) {
  try {
    await requireKnowledgeStudioOperator(request)
    const nodeId = new URL(request.url).searchParams.get('nodeId')
    const document = await readKnowledgeStudioDocument(nodeId)
    if (!document) return json({ error: 'Document node not found.' }, 404)
    return json(document)
  } catch (error) {
    const status = Number.isInteger(error?.status) && [401, 403, 503].includes(error.status) ? error.status : 503
    const message = status === 401 ? 'Authentication required.'
      : status === 403 ? 'Installation operator access required.'
        : error?.code === 'ENOENT'
      ? 'The generated document graph is unavailable. Run npm run docs:graph and retry.'
      : 'The requested document is unavailable.'
    return json({ error: message }, status)
  }
}
