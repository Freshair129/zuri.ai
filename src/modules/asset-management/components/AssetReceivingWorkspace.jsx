'use client'

// @req FR-137, FR-138, FR-139 — usable receiving/upload/review/import surface.
// @spec SDD-081, SDD-082, SDD-083, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { useState } from 'react'
import { FileCheck2, FileUp, ScanLine, ShieldCheck } from 'lucide-react'
import { Card, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'

function messageFrom(error) {
  return error?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

export default function AssetReceivingWorkspace() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [file, setFile] = useState(null)
  const [uploaded, setUploaded] = useState(null)
  const [intake, setIntake] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [workbookPreview, setWorkbookPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => ({
    correlationId: `web-${Date.now()}`, name: '', categoryCode: '', prValue: '', poValue: '',
  }))

  const evidenceId = intake?.evidence?.[0]?.id
  const status = intake?.status || 'DRAFT'
  const canSave = Boolean(businessId && uploaded && form.name && form.categoryCode && form.prValue && form.poValue)
  const templateHref = businessId ? `/api/assets/import/template?businessId=${encodeURIComponent(businessId)}` : '#'

  const run = async (name, action) => {
    setBusy(name); setError('')
    try { await action() } catch (cause) { setError(messageFrom(cause)) } finally { setBusy('') }
  }

  const upload = () => run('upload', async () => {
    if (!file || !businessId) throw new Error('เลือกไฟล์และ Business ก่อน')
    const body = new FormData(); body.set('file', file)
    const result = await jsonRequest('/api/assets/evidence', { method: 'POST', headers: { 'x-zuri-business-id': businessId }, body })
    setUploaded(result.evidence)
  })

  const saveDraft = () => run('save', async () => {
    const envelope = {
      schemaVersion: '1.0', source: { channel: 'WEB', correlationId: form.correlationId }, businessId,
      origin: 'PROCUREMENT_PURCHASE',
      item: { name: form.name, categoryCode: form.categoryCode, quantity: 1, expiryControlled: false },
      evidence: [{ fileAssetId: uploaded.id, role: 'PAYMENT_PROOF' }],
      procurementRefs: [
        { type: 'PR', system: 'ERP', value: form.prValue },
        { type: 'PO', system: 'ERP', value: form.poValue },
      ],
      lot: null, responsibilities: [], location: null, projectAllocation: null, depreciation: null,
    }
    const result = await jsonRequest('/api/assets/intakes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-zuri-business-id': businessId }, body: JSON.stringify(envelope),
    })
    setIntake(result.intake); setCandidate(null)
  })

  const extract = () => run('extract', async () => {
    const result = await jsonRequest(`/api/assets/evidence/${evidenceId}/extract`, {
      method: 'POST', headers: { 'x-zuri-business-id': businessId },
    })
    setCandidate(result.candidate)
    setIntake((current) => ({ ...current, status: 'NEEDS_REVIEW' }))
  })

  const acceptReview = () => run('review', async () => {
    const result = await jsonRequest(`/api/assets/evidence/${evidenceId}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-zuri-business-id': businessId },
      body: JSON.stringify({ decision: 'ACCEPT', corrections: [], note: 'ยืนยันจากหน้า Receiving' }),
    })
    setIntake((current) => ({ ...current, status: result.intakeStatus }))
  })

  const previewWorkbook = (selected) => run('xlsx', async () => {
    if (!selected || !businessId) return
    const body = new FormData(); body.set('file', selected)
    const result = await jsonRequest('/api/assets/import/xlsx', { method: 'POST', headers: { 'x-zuri-business-id': businessId }, body })
    setWorkbookPreview(result)
  })

  return <div className="grid gap-4" aria-busy={Boolean(busy)}>
    <div className="grid gap-3 lg:grid-cols-4">
      {[
        ['1 · Evidence', uploaded ? 'UPLOADED' : 'WAITING'],
        ['2 · OCR candidate', candidate ? 'CANDIDATE' : 'WAITING'],
        ['3 · Human review', status === 'READY_FOR_REGISTRATION' ? 'REVIEWED' : 'WAITING'],
        ['4 · Readiness', status],
      ].map(([label, value]) => <Card key={label}><p className="text-[10px] font-semibold text-muted">{label}</p><div className="mt-2"><StatusPill status={value} /></div></Card>)}
    </div>

    {error && <div role="alert" aria-live="assertive" className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800">{error}</div>}

    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <Card>
        <SectionTitle caption="รองรับ JPEG, PNG, WebP, PDF สูงสุด 20 MiB · เก็บใน private storage">1. แนบหลักฐานการจ่ายเงิน</SectionTitle>
        <label className="grid gap-2 text-xs font-semibold">ไฟล์หลักฐาน (บังคับ)
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <button type="button" className="btn btn-primary mt-3" disabled={!file || !businessId || Boolean(busy)} onClick={upload}>
          <FileUp size={15} /> {busy === 'upload' ? 'กำลังอัปโหลด…' : 'อัปโหลดหลักฐาน'}
        </button>
        {uploaded && <dl className="mt-3 grid gap-1 rounded-xl border border-[var(--border)] p-3 text-[11px]">
          <div><dt className="inline font-semibold">FileAsset:</dt> <dd className="inline">{uploaded.id}</dd></div>
          <div><dt className="inline font-semibold">SHA-256:</dt> <dd className="inline break-all font-mono">{uploaded.sha256}</dd></div>
        </dl>}
      </Card>

      <Card>
        <SectionTitle caption="PR + PO + หลักฐานจ่ายเงินตรวจด้วย contract เดียวกัน">2. สร้าง intake draft</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['name', 'ชื่อทรัพย์สิน'], ['categoryCode', 'รหัสหมวด'], ['prValue', 'เลข PR'], ['poValue', 'เลข PO'],
          ].map(([key, label]) => <label key={key} className="grid gap-1 text-xs font-semibold">{label}
            <input className="input" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
          </label>)}
        </div>
        <button type="button" className="btn btn-primary mt-3" disabled={!canSave || Boolean(busy)} onClick={saveDraft}>
          <FileCheck2 size={15} /> {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกและ Validate'}
        </button>
      </Card>
    </div>

    <Card>
      <SectionTitle caption="AI เสนอค่าเท่านั้น; ผู้ตรวจต้องยืนยันแยกต่างหาก">3. OCR / Vision candidate และ Human review</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!evidenceId || Boolean(busy)} onClick={extract}><ScanLine size={15} /> ตรวจด้วย Vision</button>
        <button type="button" className="btn btn-primary" disabled={!candidate || Boolean(busy)} onClick={acceptReview}><ShieldCheck size={15} /> ยืนยันโดยผู้ตรวจ</button>
      </div>
      {candidate && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Confidence</th><th scope="col">Anchor</th></tr></thead><tbody>
        {candidate.fields.map((field) => <tr key={`${field.field}-${field.anchor || ''}`}><td>{field.field}</td><td>{String(field.value ?? '')}</td><td>{Math.round(field.confidence * 100)}%</td><td>{field.anchor || '—'}</td></tr>)}
      </tbody></table></div>}
      <p className="mt-3 text-[11px] text-muted">ผลสูงสุดของหน้านี้คือ <strong>READY_FOR_REGISTRATION</strong> และยังไม่ออก Asset ID</p>
    </Card>

    <Card>
      <SectionTitle caption="Excel/Google Sheets เป็น snapshot สำหรับ preview ไม่ใช่ทะเบียนหลัก">Excel / Google Sheets-ready</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <a className="btn" aria-disabled={!businessId} href={templateHref}>ดาวน์โหลด Template</a>
        <label className="btn cursor-pointer">Preview .xlsx<input className="sr-only" type="file" accept=".xlsx" onChange={(event) => previewWorkbook(event.target.files?.[0])} /></label>
        {businessId && <a className="btn" href={`/api/assets/intakes/export?businessId=${encodeURIComponent(businessId)}`}>Export .xlsx</a>}
      </div>
      {workbookPreview && <p className="mt-3 text-xs">อ่านได้ {workbookPreview.envelopes?.length || 0} รายการ · พบ {workbookPreview.errors?.length || 0} จุดที่ต้องแก้</p>}
    </Card>
  </div>
}
