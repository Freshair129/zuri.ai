import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolvePipelineMapDecision } from './pipeline-map-read-model'

// @req FR-213 — the server-side seam: no projection is rendered, and so none
//   reaches the RSC payload, before a trusted viewer holding `knowledge` is resolved.
// @spec ADR-085 D4, FR-046, SEC-008
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js
//
// The Next-only wiring for the pure decision next door, in the shape FR-124's
// `requireProductReadinessViewer` established.

function serverRequest() {
  const cookieHeader = cookies().getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
  return new Request('https://zuri.local/knowledge/data-pipeline', { headers: { cookie: cookieHeader } })
}

export async function requirePipelineMapViewer() {
  let viewer = null
  let viewerError = null
  try {
    viewer = await resolveRequestViewer(serverRequest())
  } catch (error) {
    viewerError = error
  }
  const decision = resolvePipelineMapDecision({ viewer, viewerError })
  if (decision.state === 'AUTH_REQUIRED') redirect(decision.redirect)
  // Non-enumerating, like FR-124: a viewer without the slot is told the page does not exist.
  if (decision.state !== 'READY') notFound()
  return viewer
}
