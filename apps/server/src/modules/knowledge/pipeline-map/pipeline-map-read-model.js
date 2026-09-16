import dataPipelineMap from '../../../../runtime/data-pipeline-map.json'
import { isDomainVisible } from '@/config/domains'

// @req FR-213 — the Data Pipeline Map reads one committed generated projection
//   (FR-212). It measures nothing, takes no request and issues no query: the same
//   architecture metadata is returned to every admitted viewer.
// @req FR-212 — the one runtime consumer of the generated projection; it reads
//   `runtime/data-pipeline-map.json` as committed and never re-derives a status.
// @req FR-214 — admission is the Knowledge (GKS) slot's own key.
// @spec ADR-085 D4, FR-060, FR-061, SEC-008
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js
//
// The decision is pure and mirrors `resolveProductReadinessDecision` (FR-124):
// the server cannot see which Business the browser has selected (the selection
// lives in the client's scope context), so it asks whether the viewer holds
// `knowledge` in any visible Business, and the BusinessShell guard applies the
// per-Business grant on navigation. What could leak across that difference is
// nothing — the projection carries no Business data.

export function getDataPipelineMap() {
  return dataPipelineMap
}

export function resolvePipelineMapDecision({ viewer = null, viewerError = null } = {}) {
  if (viewerError || !viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }
  if (!isDomainVisible('knowledge', viewer.visibleDomains)) return { state: 'FORBIDDEN' }
  return { state: 'READY' }
}
