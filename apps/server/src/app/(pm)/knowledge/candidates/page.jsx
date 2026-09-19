// @req FR-236 — the Knowledge (GKS) slot's LINE FAQ candidate review page.
// @spec ADR-090 D6
// @tested tests/unit/knowledge-candidates-ui.test.js
import { PageHeader } from '@/components/ui'
import KnowledgeCandidateReview from '@/modules/knowledge/ui/KnowledgeCandidateReview'

export const metadata = { title: 'Knowledge (GKS) · LINE FAQ candidates' }

export default function KnowledgeCandidatesPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Knowledge (GKS) · FR-236"
        title="LINE FAQ candidates"
        subtitle="ร่าง Q/A แบบ locator-only จากบทสนทนา LINE ที่ consent = GRANTED → OWNER / LINE_OA_PUBLISHER แก้ไข อนุมัติ หรือปฏิเสธ"
      />
      <KnowledgeCandidateReview />
    </div>
  )
}
