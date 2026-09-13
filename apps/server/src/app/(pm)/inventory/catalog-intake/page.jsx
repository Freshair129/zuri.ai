'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FileUp, RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'

// @req FR-209 — the Import tab: download this Business's catalogue workbook,
//   upload a filled one, and read the preview the server made after resolving
//   every row against the catalogue — which rows create a SKU, which match an
//   existing one (and by what), which conflict or are invalid and why.
// @req FR-208 — the same tab previews a pasted JSON envelope's items, lists
//   recent intakes, and commits or cancels a preview with the plan hash it
//   showed; a commit is all or nothing, so the button exists only for a
//   committable, still-open preview.
// @spec ADR-084 D1..D3; BR-009, BR-041; SEC-001 — every request names the
//   selected Business as a selector the server validates; nothing is written
//   before a person confirms.
// @tested tests/unit/inventory-catalog-intake-page.test.js, tests/e2e/fr209-catalog-intake.spec.js

async function api(url, method = 'GET', body, { form = false } = {}) {
  const response = await fetch(url, { method, ...(body ? (form ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { status: response.status, issues: result.issues, details: result.details })
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const DECISION = {
  CREATE: { label: 'สร้างใหม่', color: 'var(--success)' },
  MATCH: { label: 'พบของเดิม · เพิ่มข้อมูล', color: 'var(--action-primary)' },
  UNCHANGED: { label: 'มีอยู่แล้ว', color: 'inherit' },
  CONFLICT: { label: 'ติดปัญหา', color: 'var(--danger)' },
  INVALID: { label: 'ข้อมูลผิด', color: 'var(--danger)' },
}
const STATUS = { PREVIEWED: 'รอยืนยัน', COMMITTED: 'บันทึกแล้ว', CANCELLED: 'ยกเลิกแล้ว' }
const CHANNEL = { REST_API: 'API', EXCEL: 'Excel', LINE_OA: 'LINE', WEB: 'หน้าเว็บ' }

const ERROR_TEXT = {
  INVENTORY_CATALOG_WORKBOOK_HEADER_MISMATCH: 'หัวตารางไม่ตรงกับแม่แบบ — ดาวน์โหลดแม่แบบใหม่แล้วกรอกตามนั้น',
  INVENTORY_CATALOG_WORKBOOK_SHEET_MISSING: 'ไม่พบชีต Products ในไฟล์',
  INVENTORY_CATALOG_WORKBOOK_UNREADABLE: 'อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .xlsx',
  INVENTORY_CATALOG_WORKBOOK_EMPTY: 'ไฟล์ไม่มีแถวข้อมูล',
  INVENTORY_CATALOG_WORKBOOK_TOO_MANY_ROWS: 'ไฟล์มีเกิน 500 แถว — แบ่งเป็นหลายไฟล์',
  INVENTORY_CATALOG_INTAKE_PLAN_STALE: 'แคตตาล็อกเปลี่ยนไปหลังตรวจ — กดตรวจอีกครั้งก่อนบันทึก',
  INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE: 'ยังบันทึกไม่ได้ เพราะมีรายการที่ติดปัญหา',
  INVENTORY_CATALOG_INTAKE_EXPIRED: 'ผลตรวจหมดอายุแล้ว — ตรวจใหม่อีกครั้ง',
  INVENTORY_CATALOG_INTAKE_CANCELLED: 'รายการนี้ถูกยกเลิกแล้ว',
  INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED: 'ข้อมูลชุดนี้ใช้รหัสอ้างอิงซ้ำกับชุดอื่น',
}
function errorText(error) {
  if (ERROR_TEXT[error.message]) return ERROR_TEXT[error.message]
  if (error.status === 404) return 'ไม่พบรายการใน Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ'
  if (Array.isArray(error.issues)) return `ข้อมูลไม่ถูกต้อง: ${error.issues.join(' · ')}`
  return error.message
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function actionSummary(item) {
  const identifiers = item.actions.filter((a) => a.type === 'ADD_IDENTIFIER').map((a) => a.payload.value)
  const conversions = item.actions.filter((a) => a.type === 'ADD_UNIT_CONVERSION').map((a) => `${a.payload.unit}=${a.payload.factor}`)
  const parts = []
  if (item.actions.some((a) => a.type === 'CREATE_MASTER')) parts.push(`สร้างสินค้าหลัก ${item.master?.code}`)
  if (item.actions.some((a) => a.type === 'CREATE_PRODUCT')) parts.push(`สร้าง SKU ใต้ ${item.master?.code}`)
  if (identifiers.length) parts.push(`รหัส ${identifiers.join(', ')}`)
  if (conversions.length) parts.push(`หน่วย ${conversions.join(', ')}`)
  return parts.join(' · ') || '—'
}

export default function InventoryCatalogIntakePage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [intake, setIntake] = useState(null)
  const [recent, setRecent] = useState([])
  const [file, setFile] = useState(null)
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refreshRecent = useCallback(async () => {
    if (!businessId) { setRecent([]); return }
    setRecent(await api(`/api/inventory/catalog-intakes?businessId=${encodeURIComponent(businessId)}&limit=10`))
  }, [businessId])

  useEffect(() => { setIntake(null); refreshRecent().catch((err) => setError(errorText(err))) }, [refreshRecent])

  async function run(fn) {
    if (busy || !businessId) return
    setBusy(true); setError(''); setMessage('')
    try { await fn(); await refreshRecent() }
    catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }

  const uploadWorkbook = () => run(async () => {
    const form = new FormData()
    form.append('businessId', businessId)
    form.append('file', file)
    const result = await api('/api/inventory/catalog-intakes/xlsx', 'POST', form, { form: true })
    setIntake(result.intake)
    setMessage(result.replayed ? `ไฟล์นี้เคย${STATUS[result.intake.status]} (${result.intake.code})` : `ตรวจไฟล์แล้ว ${result.intake.code} — ยังไม่มีอะไรถูกบันทึก`)
  })

  const previewJson = () => run(async () => {
    let parsed
    try { parsed = JSON.parse(json) } catch { throw new Error('JSON ไม่ถูกต้อง') }
    const items = Array.isArray(parsed) ? parsed : parsed?.items
    if (!Array.isArray(items)) throw new Error('ต้องเป็น array ของรายการ หรือ envelope ที่มี items')
    const correlationId = `web:${await sha256Hex(JSON.stringify(items))}`
    const result = await api('/api/inventory/catalog-intakes/preview', 'POST', { schemaVersion: '1.0', businessId, source: { channel: 'WEB', correlationId }, items })
    setIntake(result.intake)
    setMessage(`ตรวจรายการแล้ว ${result.intake.code} — ยังไม่มีอะไรถูกบันทึก`)
  })

  const commit = () => run(async () => {
    const result = await api('/api/inventory/catalog-intakes/commit', 'POST', { businessId, intakeId: intake.id, planHash: intake.planHash })
    setIntake(result.intake)
    const r = result.intake.result
    setMessage(`บันทึกแล้ว ${result.intake.code} · สร้าง SKU ใหม่ ${r.created.length} · เพิ่มข้อมูลให้ SKU เดิม ${r.matched.length} · สินค้าหลักใหม่ ${r.mastersCreated.length}`)
  })

  const cancel = () => run(async () => {
    const result = await api(`/api/inventory/catalog-intakes/${intake.id}`, 'PATCH', { action: 'CANCEL', version: intake.version })
    setIntake(result)
    setMessage(`ยกเลิก ${result.code} แล้ว — ไม่มีอะไรถูกบันทึก`)
  })

  const open = (id) => run(async () => { setIntake(await api(`/api/inventory/catalog-intakes/${id}`)) })

  const counts = intake?.plan?.counts
  const expired = intake && intake.status === 'PREVIEWED' && new Date(intake.expiresAt).getTime() <= Date.now()
  const canCommit = intake && intake.status === 'PREVIEWED' && intake.committable && !expired
  const created = useMemo(() => new Map((intake?.result?.created ?? []).map((r) => [r.code, r.productId])), [intake])

  const itemColumns = [
    { key: 'ref', label: 'แถว / รายการ', render: (r) => <span className="text-xs">{r.ref}</span> },
    { key: 'code', label: 'รหัส SKU', render: (r) => <span className="font-mono text-xs">{r.code ?? '—'}</span> },
    { key: 'decision', label: 'ผลตรวจ', render: (r) => <span className="text-xs font-semibold" style={{ color: DECISION[r.decision]?.color }}>{DECISION[r.decision]?.label ?? r.decision}</span> },
    {
      key: 'product', label: 'SKU ในระบบ', render: (r) => {
        const id = r.product?.id ?? created.get(r.code)
        const code = r.product?.code ?? (created.has(r.code) ? r.code : null)
        return id ? <Link className="font-mono text-xs underline" href={`/inventory/products/${id}`}>{code}</Link> : <span className="text-muted">—</span>
      },
    },
    { key: 'actions', label: 'สิ่งที่จะทำ', render: (r) => <span className="text-xs">{r.matchedBy ? `${r.matchedBy === 'IDENTIFIER' ? 'ตรงบาร์โค้ด/รหัสคู่ค้า' : 'ตรงรหัส SKU'} · ` : ''}{actionSummary(r)}</span> },
    {
      key: 'notes', label: 'ปัญหา / หมายเหตุ', render: (r) => <span className="grid gap-0.5 text-xs">
        {r.issues.map((i, n) => <span key={`i${n}`} style={{ color: 'var(--danger)' }}>{i.message}{i.path ? ` (${i.path})` : ''}</span>)}
        {r.warnings.map((w, n) => <span key={`w${n}`} style={{ color: 'var(--warning)' }}>{w.message}</span>)}
      </span>,
    },
  ]
  const recentColumns = [
    { key: 'code', label: 'รหัส', render: (r) => <button type="button" className="font-mono text-xs underline" onClick={() => open(r.id)} disabled={busy}>{r.code}</button> },
    { key: 'channel', label: 'ช่องทาง', render: (r) => CHANNEL[r.sourceChannel] ?? r.sourceChannel },
    { key: 'items', label: 'รายการ', render: (r) => r.itemCount },
    { key: 'status', label: 'สถานะ', render: (r) => `${STATUS[r.status] ?? r.status}${r.status === 'PREVIEWED' && !r.committable ? ' · ติดปัญหา' : ''}` },
    { key: 'createdAt', label: 'เมื่อ', render: (r) => new Date(r.createdAt).toLocaleString('th-TH') },
  ]

  return <div>
    <PageHeader
      eyebrow="Inventory · FEAT-032"
      title="นำเข้าสินค้า"
      subtitle={`Excel / JSON / LINE (#sku) — ระบบค้นหา SKU เดิมก่อนสร้างเสมอ และบันทึกทั้งชุดหรือไม่บันทึกเลย${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refreshRecent().catch((err) => setError(errorText(err)))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อนำเข้าสินค้า</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {business && <div className="mb-4 grid gap-4 xl:grid-cols-2">
      <Card>
        <SectionTitle caption="แม่แบบมีรหัสหมวดหมู่และสินค้าหลักของ Business นี้ในชีต Lookups">Excel</SectionTitle>
        <a className="btn mb-3 inline-flex" href={`/api/inventory/catalog-intakes/template?businessId=${encodeURIComponent(businessId)}`}><Download size={15} /> ดาวน์โหลดแม่แบบ</a>
        <label className="grid gap-1 text-xs font-semibold">ไฟล์ .xlsx ที่กรอกแล้ว
          <input className={fieldClass} aria-label="ไฟล์ .xlsx ที่กรอกแล้ว" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>
        <div className="mt-3"><button type="button" className="btn btn-primary" onClick={uploadWorkbook} disabled={busy || !file}><FileUp size={15} /> ตรวจไฟล์</button></div>
      </Card>
      <Card>
        <SectionTitle caption="array ของรายการในรูปแบบ envelope v1 — แบบเดียวกับ POST /api/inventory/catalog-intakes/preview">JSON</SectionTitle>
        <label className="grid gap-1 text-xs font-semibold">รายการ (JSON)
          <textarea className={`${fieldClass} font-mono`} aria-label="รายการ (JSON)" rows={6} value={json} onChange={(e) => setJson(e.target.value)} placeholder={'[{ "sku": { "code": "TMB-BLK" }, "master": { "code": "PM-TUMBLER" }, "identifiers": [{ "kind": "GTIN", "value": "8850123456786" }] }]'} disabled={busy} />
        </label>
        <div className="mt-3"><button type="button" className="btn" onClick={previewJson} disabled={busy || !json.trim()}>ตรวจ JSON</button></div>
        <p className="mt-2 text-xs text-muted">ใน LINE: ส่ง <span className="font-mono">#sku</span> เพื่อดูวิธีใช้ (เฉพาะบัญชี LINE ที่ยืนยันตัวตนแล้วและมีสิทธิ์จัดการคลัง)</p>
      </Card>
    </div>}

    {intake && <div className="mb-4">
      <SectionTitle caption={`${CHANNEL[intake.sourceChannel] ?? intake.sourceChannel} · ${STATUS[intake.status] ?? intake.status}${intake.status === 'PREVIEWED' ? ` · หมดอายุ ${new Date(intake.expiresAt).toLocaleString('th-TH')}` : ''}`}>ผลตรวจ {intake.code}</SectionTitle>
      {counts && <div className="mb-3 grid gap-3 md:grid-cols-5">
        <Kpi label="ทั้งหมด" value={counts.total} />
        <Kpi label="สร้างใหม่" value={counts.create} meta={counts.createMasters ? `สินค้าหลักใหม่ ${counts.createMasters}` : undefined} />
        <Kpi label="พบของเดิม" value={counts.match + counts.unchanged} meta="ไม่แก้ข้อมูล SKU เดิม" />
        <Kpi label="ติดปัญหา" value={counts.conflict} tone={counts.conflict ? 'bad' : 'good'} />
        <Kpi label="ข้อมูลผิด" value={counts.invalid} tone={counts.invalid ? 'bad' : 'good'} />
      </div>}
      <DataTable columns={itemColumns} rows={intake.plan?.items ?? []} rowKey={(r) => `${r.index}-${r.ref}`} />
      {intake.status === 'PREVIEWED' && <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={commit} disabled={busy || !canCommit}>ยืนยันบันทึกทั้งชุด</button>
        <button type="button" className="btn" onClick={cancel} disabled={busy}>ยกเลิก</button>
        {!intake.committable && <span className="text-xs" style={{ color: 'var(--danger)' }}>แก้รายการที่ติดปัญหาแล้วตรวจใหม่ — ระบบบันทึกทั้งชุดหรือไม่บันทึกเลย</span>}
        {expired && <span className="text-xs" style={{ color: 'var(--danger)' }}>ผลตรวจหมดอายุแล้ว — ตรวจใหม่อีกครั้ง</span>}
      </div>}
    </div>}

    {business && <Card>
      <SectionTitle caption="10 รายการล่าสุดจากทุกช่องทาง — กดรหัสเพื่อดูผลตรวจ">การนำเข้าล่าสุด</SectionTitle>
      <DataTable columns={recentColumns} rows={recent} rowKey={(r) => r.id} empty={<p className="text-sm text-muted">ยังไม่มีการนำเข้า</p>} />
    </Card>}
  </div>
}
