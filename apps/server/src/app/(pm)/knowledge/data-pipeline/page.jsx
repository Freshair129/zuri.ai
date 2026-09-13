// @req FR-213 — the Data Pipeline Map page, projected on the server and admitted
//   only for a viewer holding the Knowledge (GKS) slot.
// @spec ADR-085 D4, FR-060, FR-061, SEC-008
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js, tests/e2e/fr213-data-pipeline-map.spec.js
import DataPipelineMapView from '@/modules/knowledge/pipeline-map/DataPipelineMapView'
import { requirePipelineMapViewer } from '@/modules/knowledge/pipeline-map/pipeline-map-access'
import { getDataPipelineMap } from '@/modules/knowledge/pipeline-map/pipeline-map-read-model'

export const metadata = { title: 'Data Pipeline Map — Knowledge (GKS)' }

export default async function DataPipelineMapPage({ searchParams }) {
  await requirePipelineMapViewer()
  const chain = typeof searchParams?.chain === 'string' ? searchParams.chain : null
  return <DataPipelineMapView map={getDataPipelineMap()} initialChainId={chain} />
}
