// @req FR-105 — the Platform Programme Roadmap is outside the Business shell.
// @spec ADR-048 D1-D3, SEC-020 — only the installation operator may mount it.
// @req FR-046 — a 503 SESSION_UNAVAILABLE viewer failure is a server-state
// outage, not a login failure, and must not collapse into the AUTH_REQUIRED
// redirect the way it used to (`viewerError || !viewer`, both branches
// treated identically).
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/platform-control-guard.test.js, tests/unit/viewer-failure.test.js

import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { classifyViewerFailure } from './viewer-failure'

/**
 * Resolve the Platform Control boundary before its shell or programme data mounts.
 *
 * This intentionally accepts neither selection nor Business data. Adding either
 * argument would make an installation-level control surface accidentally depend
 * on the Business Shell it is meant to stay outside.
 */
export function resolvePlatformControlDecision({ viewerLoading = false, viewerError = null, viewer = null } = {}) {
  if (viewerLoading) return { state: 'LOADING' }
  if (viewerError) {
    // `viewerError` arrives either as the thrown Error from
    // `resolveRequestViewer` (carrying `.status`/`.message`, the server guard
    // shape) or as a bare string/body (the shape existing callers/tests pass).
    // Either way the shared classifier — not a hand-rolled check — decides
    // whether this is an outage or a real auth failure.
    const failure = viewerError && typeof viewerError === 'object'
      ? classifyViewerFailure({ status: viewerError.status, body: viewerError.message })
      : classifyViewerFailure({ body: viewerError })
    if (failure === 'SESSION_UNAVAILABLE') return { state: 'SESSION_UNAVAILABLE' }
    return { state: 'AUTH_REQUIRED', redirect: '/login' }
  }
  if (!viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }
  if (!isInstallationOperator(viewer)) return { state: 'FORBIDDEN' }
  return { state: 'READY' }
}
