import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-172 — every knowledge HTTP/MCP surface resolves the existing trusted
// session or an explicitly configured Enterprise API grant before dispatch.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-admission-routes.test.js

export async function resolveKnowledgeRequestViewer(request, options = {}) {
  const apiViewer = await resolveApiAccessViewer(request, options)
  return apiViewer || resolveRequestViewer(request, options)
}

function missingService() {
  const error = new Error('Knowledge corpus service is unavailable')
  error.status = 503
  error.code = 'KNOWLEDGE_CORPUS_SERVICE_UNAVAILABLE'
  return error
}

export async function resolveKnowledgeCorpusService() {
  let module
  try {
    module = await import('./knowledge-corpus-service.js')
  } catch {
    throw missingService()
  }
  return module
}

export function readRouteParams(context) {
  const params = context?.params
  return params && typeof params.then === 'function' ? params : Promise.resolve(params || {})
}

export function strictKnowledgeBody(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Knowledge request body must be an object')
    error.status = 400
    throw error
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) {
    const error = new Error(`Unsupported knowledge request field: ${unknown[0]}`)
    error.status = 400
    throw error
  }
  return value
}
