// @req FR-133, FR-135 — Asset Register page.
// @spec SDD-078, SDD-080, SEC-023, ADR-055
// @tested tests/unit/asset-management-navigation.test.js
import Link from 'next/link'
import { PackagePlus } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import AssetRegisterWorkspace from '@/modules/asset-management/components/AssetRegisterWorkspace'

export default function AssetRegisterPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Asset Management · FR-133..135"
        title="ทะเบียนทรัพย์สินบริษัท"
        subtitle="ตรวจสอบรายการทรัพย์สินที่ขึ้นทะเบียนแล้ว ค้นหาตามหมวดหมู่/ที่ตั้ง และดูรหัส QR Tag ประจำอุปกรณ์"
        actions={
          <>
            <Link className="btn btn-primary text-xs" href="/assets/receiving">
              <PackagePlus size={15} /> ตรวจรับอุปกรณ์ใหม่
            </Link>
          </>
        }
      />
      <AssetRegisterWorkspace />
    </div>
  )
}
