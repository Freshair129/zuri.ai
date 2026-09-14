// @req FR-173 — Knowledge source admission and corpus publication UI in the Knowledge (GKS) slot.
// @spec ADR-072, ADR-085 D1, SEC-001, SEC-008
// @tested tests/unit/knowledge-documents-ui.test.js

import { requirePipelineMapViewer } from '@/modules/knowledge/pipeline-map/pipeline-map-access'
import KnowledgeDocumentsView from '@/modules/knowledge/ui/KnowledgeDocumentsView'

export const metadata = { title: 'Documents — Knowledge (GKS)' }

export default async function KnowledgeDocumentsPage({ searchParams }) {
  await requirePipelineMapViewer()
  return <KnowledgeDocumentsView initialTab={searchParams?.tab} />
}
