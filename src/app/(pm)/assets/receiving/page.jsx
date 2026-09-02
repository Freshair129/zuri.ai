// @req FR-137, FR-138, FR-139 — evidence-to-review receiving workspace.
// @spec SDD-081, SDD-082, SDD-083, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { PageHeader } from '@/components/ui'
import AssetReceivingWorkspace from '@/modules/asset-management/components/AssetReceivingWorkspace'

export default function AssetReceivingPage() {
  return <div>
    <PageHeader
      eyebrow="Asset Management · FR-137..139"
      title="ตรวจรับอุปกรณ์และหลักฐาน"
      subtitle="อัปโหลดหลักฐาน → OCR/Vision candidate → Human review → READY_FOR_REGISTRATION"
    />
    <AssetReceivingWorkspace />
  </div>
}
