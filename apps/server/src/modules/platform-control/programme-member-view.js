// @req FR-241 — the programme roadmap member view: a declared 30-day window for any
//   signed-in person, and a projection that carries no person, device, tool or
//   model name to the client.
// @req FR-263 — the member projection remains separate from Mission Control and
//   never receives PORL records, assignments, device/tool/model details,
//   thread identifiers or live orchestration state.
// @spec ADR-092 D1–D3, ADR-048 D3, ADR-086 D7, SEC-020
// @tested tests/unit/programme-member-view.test.js

import { classifyViewerFailure } from '@/lib/viewer-failure'

// ADR-092 D2: a constant, not a runtime switch. Extending or closing the window
// early is a reviewed change to this line and a deploy.
export const MEMBER_VIEW_CLOSES_AT = '2026-10-14T17:00:00.000Z' // 2026-10-15 00:00 Asia/Bangkok

export function isMemberViewOpen(now = Date.now()) {
  return now < Date.parse(MEMBER_VIEW_CLOSES_AT)
}

/**
 * Decide what `/roadmap` renders. The window is checked first, so once it has
 * closed the route is a 404 for everyone — signed in or not, operator or not —
 * and never a login prompt for a page that no longer exists.
 */
export function resolveMemberRoadmapDecision({ viewer = null, viewerError = null, now = Date.now() } = {}) {
  if (!isMemberViewOpen(now)) return { state: 'CLOSED' }
  if (viewerError) {
    const failure = typeof viewerError === 'object'
      ? classifyViewerFailure({ status: viewerError.status, body: viewerError.message })
      : classifyViewerFailure({ body: viewerError })
    if (failure === 'SESSION_UNAVAILABLE') return { state: 'SESSION_UNAVAILABLE' }
    return { state: 'AUTH_REQUIRED', redirect: '/login' }
  }
  if (!viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }
  return { state: 'READY' }
}

/**
 * ADR-092 D3: reduce the operator lane usage to what a member may read. Usage by
 * person and by device, and tool and model names, are dropped here — on the
 * server — so the rendered page payload never carries them.
 */
export function projectMemberLaneUsage(laneUsage = {}) {
  const entries = laneUsage instanceof Map ? [...laneUsage.entries()] : Object.entries(laneUsage)
  return Object.fromEntries(entries.map(([laneId, entry]) => {
    const { byPerson, detail, ...rest } = entry
    const { tools, models, ...counts } = detail || {}
    return [laneId, { ...rest, byPerson: {}, detail: { ...counts, tools: {}, models: {} } }]
  }))
}
