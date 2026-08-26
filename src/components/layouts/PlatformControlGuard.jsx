// @req FR-105 — control data never renders before the operator-only guard passes.
// @spec ADR-048 D2, SEC-020
// @tested tests/unit/platform-control-guard.test.js

import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolvePlatformControlDecision } from '@/lib/platform-control-guard'

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
  if (decision.state !== 'READY') notFound()
  return children
}
