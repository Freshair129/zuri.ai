// @req FR-237 — the Knowledge (GKS) slot's LINE knowledge-gap report page.
// @spec ADR-090 D7
// @tested tests/unit/knowledge-gap-report-ui.test.js
import { PageHeader } from '@/components/ui'
import KnowledgeGapReport from '@/modules/knowledge/ui/KnowledgeGapReport'

export const metadata = { title: 'Knowledge (GKS) · Knowledge gap report' }

export default function KnowledgeGapReportPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Knowledge (GKS) · FR-237"
        title="รายงานช่องว่างความรู้ (LINE)"
        subtitle="คำถามที่ตอบไม่ได้ (NO_EVIDENCE) นับตาม Business — จำนวน สินค้าที่เกี่ยวข้อง (ถ้าทราบ) และเวลาล่าสุดเท่านั้น ไม่มีข้อความคำถาม และไม่มีข้อมูลใดเข้าสู่ GKS"
      />
      <KnowledgeGapReport />
    </div>
  )
}
