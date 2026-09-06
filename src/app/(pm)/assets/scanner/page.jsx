// @req FR-133, FR-135 — fast QR token lookup and mobile stocktake scanner page.
// @spec SDD-078, SDD-080, SEC-023, ADR-055
// @tested tests/unit/asset-scanner-ui.test.js
import Link from 'next/link'
import { Package, QrCode } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import AssetScannerWorkspace from '@/modules/asset-management/components/AssetScannerWorkspace'

export default function AssetScannerPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Asset Management · AM-RQ-061"
        title="สแกนและตรวจนับทรัพย์สิน"
        subtitle="สแกน QR Code เพื่อตรวจสอบสถานะผู้ถือครอง ตำแหน่งที่ตั้ง และบันทึกผลตรวจนับหน้างานทันที"
        actions={
          <>
            <Link className="btn btn-secondary text-xs" href="/assets/register">
              <Package size={15} /> ทะเบียนทรัพย์สิน
            </Link>
          </>
        }
      />
      <AssetScannerWorkspace />
    </div>
  )
}
