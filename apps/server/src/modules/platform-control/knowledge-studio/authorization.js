// @req FR-289 — require installation-operator authority for every Studio endpoint.
// @spec ADR-048 D1-D3
// @tested tests/unit/knowledge-studio/authorization.test.js

import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'

export async function requireKnowledgeStudioOperator(request, {
  resolveViewer = resolveRequestViewer,
  isOperator = isInstallationOperator,
} = {}) {
  const viewer = await resolveViewer(request)
  if (!isOperator(viewer)) {
    const error = new Error('Installation operator access required.')
    error.status = 403
    throw error
  }
  return viewer
}
