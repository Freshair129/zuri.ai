// @req FR-105 — control data never renders before the operator-only guard passes.
// @spec ADR-048 D2, SEC-020
// @req FR-046 — a 503 SESSION_UNAVAILABLE viewer failure renders the shared
// retry state instead of redirecting to /login like AUTH_REQUIRED does.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/platform-control-guard.test.js, tests/unit/viewer-failure.test.js

import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolvePlatformControlDecision } from '@/lib/platform-control-guard'
import { SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH } from '@/lib/viewer-failure'
import PlatformControlSessionRetry from './PlatformControlSessionRetry'

function serverRequest() {
  const cookieHeader = cookies().getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
  return new Request('https://zuri.local/control/roadmap', { headers: { cookie: cookieHeader } })
}

export default async function PlatformControlGuard({ children }) {
  let viewer = null
  let viewerError = null
  try {
    viewer = await resolveRequestViewer(serverRequest())
  } catch (error) {
    viewerError = error
  }
  const decision = resolvePlatformControlDecision({ viewer, viewerError })

  if (decision.state === 'AUTH_REQUIRED') redirect('/login')
  if (decision.state === 'SESSION_UNAVAILABLE') {
    return <PlatformControlSessionRetry title={SESSION_UNAVAILABLE_TITLE_TH} detail={SESSION_UNAVAILABLE_DETAIL_TH} />
  }
  if (decision.state !== 'READY') notFound()
  return children
}
