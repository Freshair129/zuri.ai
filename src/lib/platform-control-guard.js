// @req FR-094 — the Platform Programme Roadmap is outside the Business shell.
// @spec ADR-039 D1-D3, SEC-018 — only the installation operator may mount it.
// @tested tests/unit/platform-control-guard.test.js

import { isInstallationOperator } from '@/modules/identity/viewer-authority'

/**
 * Resolve the Platform Control boundary before its shell or programme data mounts.
 *
 * This intentionally accepts neither selection nor Business data. Adding either
 * argument would make an installation-level control surface accidentally depend
 * on the Business Shell it is meant to stay outside.
 */
export function resolvePlatformControlDecision({ viewerLoading = false, viewerError = null, viewer = null } = {}) {
  if (viewerLoading) return { state: 'LOADING' }
  if (viewerError || !viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }
  if (!isInstallationOperator(viewer)) return { state: 'FORBIDDEN' }
  return { state: 'READY' }
}
