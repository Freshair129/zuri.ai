'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'

// @req FR-206 — the SKU hygiene tab: the read-only catalogue hygiene report
//   (lookalikes, nature mismatches, undeclared variant axes, dormant SKUs,
//   missing identifiers, services carrying stock fields) with the action that
//   repairs each finding.
// @req FR-205 — the merge desk: a duplicate is merged into its survivor through
//   the versioned product action, never deleted; phase-out, reactivate and the
//   guarded archive run from the same form.
// @req FR-207 — the replenishment suggestion: every counted, ACTIVE SKU below
//   its reorder point with the quantity to order.
// @spec SEC-001 — every request names the selected Business as a selector the
//   server validates against the trusted viewer; the page calls routes only.
// @tested tests/unit/scm-console-routes.test.js, tests/unit/inventory-hygiene-page.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) {
    const details = Array.isArray(result.details) ? ` (${result.details.map((d) => d.kind || d.code || JSON.stringify(d)).join(', ')})` : ''
    throw new Error((result.issues?.join(' · ') || result.error || 'Request failed') + details)
  }
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'

const KIND_LABEL = {
  NATURE_MISMATCH: 'ประเภทไม่ตรงกับสินค้าหลัก',
  LOOKALIKE_SKUS: 'SKU ซ้ำกัน',
  MASTER_WITHOUT_AXES: 'ยังไม่ประกาศแกน variant',
  MASTER_WITHOUT_SKUS: 'สินค้าหลักไม่มี SKU',
  DORMANT_SKU: 'SKU ไม่เคลื่อนไหว',
  SKU_WITHOUT_IDENTIFIER: 'ไม่มีบาร์โค้ด/รหัสคู่ค้า',
  SERVICE_WITH_STOCK_FIELDS: 'บริการมีค่าสต๊อก',
  PHASE_OUT_WITH_STOCK: 'เลิกขายแต่ยังมีของ',
}
const SEVERITY_LABEL = { HIGH: 'สูง', MEDIUM: 'กลาง', LOW: 'ต่ำ', INFO: 'แจ้งเพื่อทราบ' }
const SUGGESTION_LABEL = {
  MOVE_TO_MASTER_OF_SAME_NATURE: 'ย้ายไปสินค้าหลักที่ประเภทตรงกัน',
  MERGE: 'รวม SKU (MERGE)',
  DECLARE_VARIANT_AXES: 'ประกาศแกน variant ที่สินค้าหลัก',
  PHASE_OUT_OR_ARCHIVE: 'เลิกขาย หรือเก็บถาวร',
  ARCHIVE_MASTER_OR_ADD_SKU: 'เก็บถาวรสินค้าหลัก หรือเพิ่ม SKU',
  ADD_IDENTIFIER: 'เพิ่มบาร์โค้ด / รหัสคู่ค้า',
  CLEAR_STOCK_FIELDS: 'ล้างค่าสต๊อกของบริการ',
  SELL_DOWN: 'ขายให้หมดก่อน archive',
}
const STATUS_LABEL = { ACTIVE: 'ใช้งาน', PHASE_OUT: 'เลิกขาย', ARCHIVED: 'เก็บถาวร' }
const ACTION_LABEL = { MERGE: 'รวมเข้ากับ SKU อื่น (MERGE)', PHASE_OUT: 'เลิกขาย (PHASE_OUT)', REACTIVATE: 'เปิดใช้อีกครั้ง (REACTIVATE)', ARCHIVE: 'เก็บถาวร (ARCHIVE)' }

function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}

export default function InventoryHygienePage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [report, setReport] = useState(null)
  const [replenish, setReplenish] = useState(null)
  const [products, setProducts] = useState([])
  const [dormantDays, setDormantDays] = useState('180')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [action, setAction] = useState('MERGE')
  const [duplicateId, setDuplicateId] = useState('')
  const [survivorId, setSurvivorId] = useState('')
  const [reason, setReason] = useState('')

  const refresh = useCallback(async () => {
    if (!businessId) { setReport(null); setReplenish(null); setProducts([]); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const days = Number.parseInt(dormantDays, 10)
    const [hygiene, suggestion, skus] = await Promise.all([
      api(`/api/inventory/catalog-hygiene?${q}${Number.isFinite(days) ? `&dormantDays=${days}` : ''}`),
      api(`/api/inventory/replenishment?${q}`),
      api(`/api/inventory/products?${q}&includeArchived=true`),
    ])
    setReport(hygiene); setReplenish(suggestion); setProducts(skus)
  }, [businessId, dormantDays])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  const live = useMemo(() => products.filter((p) => p.status !== 'ARCHIVED'), [products])
  const survivors = useMemo(() => products.filter((p) => p.status === 'ACTIVE' && p.id !== duplicateId), [products, duplicateId])
  const subjects = useMemo(() => (action === 'REACTIVATE' ? products.filter((p) => p.status !== 'ACTIVE' && !p.mergedIntoProductId) : action === 'PHASE_OUT' ? products.filter((p) => p.status === 'ACTIVE') : live), [action, products, live])

  async function runAction() {
    const subject = products.find((p) => p.id === (duplicateId || subjects[0]?.id))
    if (!subject || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const body = { action, version: subject.version, ...(reason ? { reason } : {}), ...(action === 'MERGE' ? { into: survivorId || survivors[0]?.id } : {}) }
      const row = await api(`/api/inventory/products/${subject.id}`, 'PATCH', body)
      setMessage(action === 'MERGE'
        ? `รวม ${subject.code} เข้ากับ ${products.find((p) => p.id === row.mergedIntoProductId)?.code ?? row.mergedIntoProductId} แล้ว — ledger ของ ${subject.code} ยังอยู่`
        : `${ACTION_LABEL[action]} ${subject.code} แล้ว · สถานะ ${STATUS_LABEL[row.status] || row.status}`)
      setReason('')
      await refresh()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const findingColumns = [
    { key: 'severity', label: 'ระดับ', render: (r) => <span style={{ color: r.severity === 'HIGH' ? 'var(--danger)' : r.severity === 'MEDIUM' ? 'var(--warning)' : 'inherit' }}>{SEVERITY_LABEL[r.severity] || r.severity}</span> },
    { key: 'kind', label: 'ประเภท', render: (r) => KIND_LABEL[r.kind] || r.kind },
    { key: 'codes', label: 'รหัส', render: (r) => <span className="font-mono text-xs">{r.codes.join(', ')}</span> },
    { key: 'message', label: 'รายละเอียด', render: (r) => <span className="text-xs">{r.message}{r.idleDays !== undefined ? ` (${r.idleDays} วัน)` : ''}{r.onHand !== undefined ? ` (คงเหลือ ${r.onHand})` : ''}</span> },
    { key: 'suggestion', label: 'แนะนำ', render: (r) => SUGGESTION_LABEL[r.suggestion] || r.suggestion },
  ]
  const replenishColumns = [
    { key: 'code', label: 'รหัส', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'ชื่อ', render: (r) => r.name || '—' },
    { key: 'onHand', label: 'คงเหลือ', render: (r) => `${r.onHand} ${r.unit || ''}` },
    { key: 'threshold', label: 'จุดสั่งซื้อ', render: (r) => r.reorderPoint ?? `${r.safetyStock} (safety)` },
    { key: 'suggestedQty', label: 'ควรสั่ง', render: (r) => <strong>{r.suggestedQty}</strong> },
    { key: 'leadTimeDays', label: 'Lead time (วัน)', render: (r) => r.leadTimeDays ?? '—' },
  ]

  return <div>
    <PageHeader
      eyebrow="Inventory · FEAT-031"
      title="SKU Hygiene"
      subtitle={`รายงานความสะอาดของแคตตาล็อก — SKU ซ้ำ บริการที่ปนกับสินค้า SKU นิ่ง และจุดสั่งซื้อ${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูรายงาน</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {report && <div className="mb-4 grid gap-3 md:grid-cols-5">
      <Kpi label="ข้อค้นพบทั้งหมด" value={report.total} tone={report.total ? 'warn' : 'good'} meta={`${report.catalogue.live} SKU ใช้งาน / ${report.catalogue.masters} สินค้าหลัก`} />
      <Kpi label="ระดับสูง" value={report.bySeverity.HIGH} tone={report.bySeverity.HIGH ? 'bad' : 'good'} meta="SKU ซ้ำ · ประเภทไม่ตรง" />
      <Kpi label="ระดับกลาง" value={report.bySeverity.MEDIUM} tone={report.bySeverity.MEDIUM ? 'warn' : 'good'} meta="ไม่มีแกน variant · SKU นิ่ง" />
      <Kpi label="ระดับต่ำ" value={report.bySeverity.LOW + report.bySeverity.INFO} meta="ไม่มีบาร์โค้ด · สินค้าหลักว่าง" />
      <Kpi label="ควรสั่งซื้อ" value={replenish?.counts.suggested ?? 0} tone={replenish?.counts.suggested ? 'warn' : 'good'} meta="ต่ำกว่าจุดสั่งซื้อ" />
    </div>}

    {report && <div className="mb-4">
      <SectionTitle caption="คำนวณจากแคตตาล็อกและ ledger ทุกครั้งที่โหลด — รายงานนี้ไม่เขียนอะไร การแก้ไขทำผ่านฟอร์มด้านล่าง">ข้อค้นพบ</SectionTitle>
      <div className="mb-2 flex items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold">SKU นิ่งเกิน (วัน)<input className={fieldClass} aria-label="SKU นิ่งเกิน (วัน)" type="number" min="1" max="3650" value={dormantDays} onChange={(e) => setDormantDays(e.target.value)} /></label>
      </div>
      <DataTable columns={findingColumns} rows={report.findings} rowKey={(r, i) => `${r.kind}-${r.codes.join('|')}-${i}`} empty={<Card><p className="text-sm text-muted">ไม่พบข้อค้นพบ — แคตตาล็อกสะอาด</p></Card>} />
    </div>}

    {business && <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <SectionTitle caption="MERGE ย้ายยอดคงเหลือ บาร์โค้ด หน่วยแปลง bundle และสูตรไปยัง SKU ที่เหลือ แล้วเก็บ SKU ซ้ำไว้ชี้ไปหามัน — ไม่มีอะไรถูกลบ">จัดการวงจรชีวิต SKU</SectionTitle>
        <fieldset disabled={busy || !products.length} className="grid gap-3 md:grid-cols-2">
          <Select label="การกระทำ" options={Object.entries(ACTION_LABEL)} value={action} onChange={(e) => { setAction(e.target.value); setDuplicateId('') }} />
          <Select label={action === 'MERGE' ? 'SKU ที่ซ้ำ (จะถูกรวม)' : 'SKU'} options={subjects.map((p) => [p.id, `${p.code}${p.name ? ` · ${p.name}` : ''} · ${STATUS_LABEL[p.status] || p.status}`])} value={duplicateId} onChange={(e) => setDuplicateId(e.target.value)} />
          {action === 'MERGE' && <Select label="SKU ที่เหลือ (survivor)" options={survivors.map((p) => [p.id, `${p.code}${p.name ? ` · ${p.name}` : ''}`])} value={survivorId} onChange={(e) => setSurvivorId(e.target.value)} />}
          <label className="grid gap-1 text-xs font-semibold md:col-span-2">เหตุผล (บันทึกใน audit)<input className={fieldClass} aria-label="เหตุผล" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </fieldset>
        {!subjects.length && <p className="mt-2 text-xs text-muted">ไม่มี SKU ที่ทำ {ACTION_LABEL[action]} ได้</p>}
        <div className="mt-3"><button type="button" className="btn btn-primary" onClick={runAction} disabled={busy || !subjects.length || (action === 'MERGE' && !survivors.length)}>ดำเนินการ</button></div>
      </Card>

      <Card>
        <SectionTitle caption="SKU นับสต๊อกที่ใช้งานอยู่และต่ำกว่าจุดสั่งซื้อ (หรือ safety stock เมื่อไม่ได้ตั้ง) — เป็นข้อเสนอ ไม่ใช่ใบสั่งซื้อ">ควรสั่งซื้อ</SectionTitle>
        {replenish && <DataTable columns={replenishColumns} rows={replenish.rows} rowKey={(r) => r.productId} empty={<p className="text-sm text-muted">ไม่มี SKU ต่ำกว่าจุดสั่งซื้อ</p>} />}
      </Card>
    </div>}
  </div>
}
