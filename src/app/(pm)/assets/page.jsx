'use client'

// @req FR-133 — Business-scoped Asset Management foundation dashboard.
// @req FR-134, FR-135, FR-136 — visibly distinguishes local contract readiness
// from provider-backed OCR/LINE/Sheet/Procurement/Finance capability.
// @spec ADR-055, SDD-078, SDD-079, SDD-080, SEC-023
// @tested tests/unit/asset-management-navigation.test.js, tests/unit/asset-management-api-ui-contract.test.js
import { AlertTriangle, CheckCircle2, FileCheck2, PackageCheck, ScanLine, WalletCards } from 'lucide-react'
import { Card, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'

const FOUNDATION = [
  ['แบบข้อมูลกลาง', 'Web · API · Excel/Sheet · Agent · LINE metadata', 'READY'],
  ['หลักฐานบังคับ', 'รูป/PDF/e-receipt + หลักฐานจ่ายเงิน', 'READY'],
  ['ตรวจ PR / PO / Lot', 'ตรวจโครงสร้างและ conflict ก่อน apply', 'READY'],
  ['ผู้รับผิดชอบ/ผู้ใช้/ที่ตั้ง', 'เก็บเป็นประวัติช่วงเวลา ไม่เขียนทับ', 'READY'],
  ['Project allocation', 'Asset เป็นผู้เขียน; Project Inventory อ่านอย่างเดียว', 'READY'],
  ['ค่าเสื่อม', 'Straight-line preview สำหรับ Finance review', 'READY'],
]

const ADAPTERS = [
  ['LINE attachment bytes', 'รอ transport ส่ง trusted FileAsset reference'],
  ['OCR / Vision provider', 'รอ provider + secret + retention policy'],
  ['Google Sheet live sync', 'ใช้ template เดียวกันได้ แต่ยังไม่ใช่ live connector'],
  ['Procurement lookup', 'ยังไม่มี PR/PO/GRN authority ใน runtime'],
  ['Finance posting', 'preview ได้ แต่ยังไม่สร้างสมุดบัญชีหรือ journal'],
]

export default function AssetManagementPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness

  return <div>
    <PageHeader
      eyebrow="Asset Management · FEAT-015"
      title="ทะเบียนทรัพย์สินบริษัท"
      subtitle={`รับและตรวจหลักฐาน ผูก PR/PO ติดตามผู้รับผิดชอบ ที่ตั้ง Project และค่าเสื่อมแบบตรวจสอบย้อนกลับได้${business ? ` · ${business.name}` : ''}`}
      actions={<>
        <button type="button" className="btn btn-primary" disabled title="เปิดเมื่อ mutation policy ได้รับอนุมัติ">
          <PackageCheck size={15} /> รับอุปกรณ์ใหม่
        </button>
        <button type="button" className="btn" disabled title="ใช้ template กลาง; live import อยู่ใน phase ถัดไป">
          <FileCheck2 size={15} /> นำเข้า Excel / Sheet
        </button>
      </>}
    />

    <div className="mb-4 grid gap-3 md:grid-cols-3">
      <Card><p className="text-[10px] font-semibold text-muted">สถานะ Foundation</p><p className="mt-1 text-xl font-bold">Contract ready</p><p className="mt-1 text-[10px] text-muted">preview-only · ยังไม่ apply ทรัพย์สินจริง</p></Card>
      <Card><p className="text-[10px] font-semibold text-muted">Pipeline definition</p><p className="mt-1 text-sm font-bold">DPL-ASSET-REGISTER-IMPORT-V1</p><p className="mt-1 text-[10px] text-muted">ใช้ ledger กลาง แต่ไม่ปนกับ knowledge pipeline</p></Card>
      <Card><p className="text-[10px] font-semibold text-muted">Finance boundary</p><p className="mt-1 text-xl font-bold">Preview only</p><p className="mt-1 text-[10px] text-muted">ไม่มี capitalization / journal / tax posting</p></Card>
    </div>

    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <Card>
        <SectionTitle caption="กฎเหล่านี้ทำงานใน validation contract และทดสอบแบบ deterministic แล้ว">สิ่งที่ foundation ตรวจได้</SectionTitle>
        <div className="grid gap-2">
          {FOUNDATION.map(([title, detail, status]) => <div key={title} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
            <div className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0" size={16} style={{ color: 'var(--success)' }} /><div><p className="text-xs font-bold">{title}</p><p className="mt-0.5 text-[10px] text-muted">{detail}</p></div></div>
            <StatusPill status={status} />
          </div>)}
        </div>
      </Card>

      <Card warm>
        <SectionTitle caption="แสดงตรงตาม runtime จริง — ไม่รายงานว่า connected">Adapter ที่ยังไม่พร้อมใช้งาน</SectionTitle>
        <div className="grid gap-2">
          {ADAPTERS.map(([title, detail], index) => <div key={title} className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
            <div className="flex items-center gap-2">
              {index === 0 ? <ScanLine size={15} /> : index === 4 ? <WalletCards size={15} /> : <AlertTriangle size={15} />}
              <p className="text-xs font-bold">{title}</p>
            </div>
            <p className="mt-1 text-[10px] text-muted">{detail}</p>
            <div className="mt-2"><StatusPill status="UNAVAILABLE" /></div>
          </div>)}
        </div>
      </Card>
    </div>

    <Card className="mt-4">
      <SectionTitle caption="ลำดับเดียวกันทุกช่องทาง; candidate ไม่สามารถอนุมัติตัวเอง">Intake → Validate</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        {['รับ envelope', 'ตรวจไฟล์', 'OCR/Vision candidate', 'Normalize', 'Scope + PR/PO/Lot', 'Reconcile', 'Human confirm', 'Approval', 'Transactional apply'].map((stage, index) => <div key={stage} className="flex items-center gap-2">
          <span className="rounded-lg border border-[var(--border)] px-2.5 py-1.5">{stage}</span>
          {index < 8 && <span className="text-muted" aria-hidden>→</span>}
        </div>)}
      </div>
    </Card>
  </div>
}
