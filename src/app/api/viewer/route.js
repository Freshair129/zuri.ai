// @req FR-031, FR-032 — Home obtains its allowed business set from the viewer gate.
// @spec SDD-011, docs/features/FR-031-viewer-gate.md — the route exposes a resolved viewer, not raw memberships.
// @tested tests/unit/viewer-gate.test.js
import { handle } from '../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(() => resolveViewer())
}
