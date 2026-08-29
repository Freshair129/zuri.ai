import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveProductReadinessDecision } from './product-readiness-read-model'

// @req FR-124 — the server-side seam: no readiness snapshot is rendered, and so
// none reaches the RSC payload, before a trusted viewer has been resolved.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md, FR-046, FR-060, SEC-008
// @tested tests/unit/fr124-product-readiness-read-model.test.js
//
// Split from the read model on purpose: the decision is pure and unit-tested,
// this file is the Next-only wiring that feeds it. Mirrors
// `PlatformControlGuard` (FR-105), which is the only other server-rendered
// projection in the app.

function serverRequest() {
  const cookieHeader = cookies().getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
  return new Request('https://zuri.local/platform/product-readiness', { headers: { cookie: cookieHeader } })
}

export async function requireProductReadinessViewer() {
  let viewer = null
  let viewerError = null
  try {
    viewer = await resolveRequestViewer(serverRequest())
  } catch (error) {
    viewerError = error
  }
  const decision = resolveProductReadinessDecision({ viewer, viewerError })

  if (decision.state === 'AUTH_REQUIRED') redirect(decision.redirect)
  // A viewer without Platform visibility is told the surface does not exist
  // rather than that it exists and is barred — the same non-enumerating answer
  // an unknown domain key gets below.
  if (decision.state !== 'READY') notFound()
  return viewer
}
