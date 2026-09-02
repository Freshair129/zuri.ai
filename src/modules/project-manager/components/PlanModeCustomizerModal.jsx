'use client'

// @req FR-009, FR-012, FR-017 — Plan Mode Customizer: Design execution plans across
// 7 canonical modes with explicit Requester (AI/Human) and Human Approver bindings.
// The generated PlanEnvelope converges on the same dry-run → preview → confirm
// pipeline as every other intake surface (BR-009, SDD-009) — it is never sent
// straight to a write.
// @spec BR-003, BR-004, SDD-006, BR-009, SDD-009

import { useEffect, useState } from 'react'
import { Plus, Trash2, Sparkles, CheckCircle2 } from 'lucide-react'
import { Modal, Field } from '@/components/ui'
import { EXECUTION_MODES, MODE_LABELS } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from './useApi'
import { buildPlanImportRequest } from './planImportRequest'

const PRESET_EXAMPLES = {
  DATA_MIGRATION: {
    objective: 'ดึงรายชื่อลูกค้าที่เคยซื้อสินค้าช่วงปี 2020',
    description: 'สกัดข้อมูลคำสั่งซื้อและบัญชีลูกค้าย้อนหลังปี 2020 ทำการตรวจสอบยอดรวมและจัดเก็บเข้าฐานข้อมูลกลาง',
    streams: [
      {
        name: 'Data Extraction & Audit 2020',
        mode: 'DATA_MIGRATION',
        items: [
          'สกัดประวัติการสั่งซื้อจาก Legacy Database ปี 2020',
          'ตรวจสอบความถูกต้องของยอดชำระเงินและช่องทางการติดต่อ',
          'ส่งมอบผลลัพธ์รายชื่อลูกค้าให้ทีมตรวจสอบ',
        ],
      },
    ],
  },
  SOFTWARE_SPRINT: {
    objective: 'พัฒนาฟีเจอร์ระบบค้นหาสินค้าอัจฉริยะ',
    description: 'สร้าง Endpoint และ UI สำหรับค้นหาสินค้าตามเงื่อนไขราคาและสต็อก',
    streams: [
      {
        name: 'Core Search API',
        mode: 'SOFTWARE_SPRINT',
        items: ['ออกแบบ API Search Schema', 'ทำ Indexing ข้อมูลสินค้า', 'เขียน Unit Test'],
      },
    ],
  },
  OPERATIONS: {
    objective: 'ตรวจนับสต็อกและทำความสะอาดคลังสินค้ารายเดือน',
    description: 'รันขั้นตอนเช็คลิสต์ตรวจนับยอดคงเหลือจริงเทียบกับระบบ ERP',
    streams: [
      {
        name: 'Monthly Inventory Audit',
        mode: 'OPERATIONS',
        items: ['พิมพ์รายงานสต็อกปัจจุบัน', 'ตรวจนับสินค้าคงเหลือจริง', 'กระทบยอดส่วนต่าง'],
      },
    ],
  },
}

export default function PlanModeCustomizerModal({ open, onClose, onGenerated }) {
  // @req FR-046 — no entry surface prefetches the compatibility inventory from
  // a broad list endpoint; the Business/Workspace inventory already loaded
  // into ScopeContext (via /api/scope) is reused instead of a second fetch.
  const scope = useScope()
  const businesses = scope.businesses
  const workspaces = scope.workspaces
  const { data: viewer } = useFetch('/api/viewer')

  const [objective, setObjective] = useState('')
  const [description, setDescription] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [delegator, setDelegator] = useState('')
  const [approver, setApprover] = useState('')
  const [mode, setMode] = useState('DATA_MIGRATION')
  const [streams, setStreams] = useState([
    {
      name: 'Data Extraction & Validation',
      mode: 'DATA_MIGRATION',
      itemsText: 'สกัดข้อมูลลูกค้าปี 2020\nตรวจสอบความถูกต้องของข้อมูล\nสรุปผลส่งมอบให้ Approver',
    },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Dry-run result awaiting confirmation, plus the exact request that produced
  // it — the commit leg re-sends the same { plan, workspaceId } so it can
  // never authorize or write to a scope the preview did not check.
  const [preview, setPreview] = useState(null)
  const [pendingRequest, setPendingRequest] = useState(null)

  useEffect(() => {
    if (open) {
      if (businesses?.length && !businessId) {
        setBusinessId(businesses[0].id)
      }
      if (viewer?.principal?.displayName && !delegator) {
        setDelegator(viewer.principal.displayName)
      }
      if (!approver) {
        setApprover(viewer?.principal?.displayName || 'Human Approver')
      }
    }
  }, [open, businesses, viewer])

  // A dry-run preview describes one exact envelope. Any further edit makes it
  // stale, so every change below clears it rather than leaving a "Confirm"
  // button that would commit a plan the user no longer sees.
  const invalidatePreview = () => {
    setPreview(null)
    setPendingRequest(null)
    setError(null)
  }

  const applyPreset = (modeKey) => {
    invalidatePreview()
    const preset = PRESET_EXAMPLES[modeKey] || {
      objective: `Custom Execution Plan (${MODE_LABELS[modeKey]})`,
      description: 'แผนการดำเนินงานแบบกำหนดเอง',
      streams: [
        {
          name: `${MODE_LABELS[modeKey]} Execution Stream`,
          mode: modeKey,
          items: ['Task 1: วางแผนและเตรียมข้อมูล', 'Task 2: ดำเนินการตามแผน', 'Task 3: ตรวจสอบและปิดงาน'],
        },
      ],
    }
    setMode(modeKey)
    setObjective(preset.objective)
    setDescription(preset.description)
    setStreams(
      preset.streams.map((s) => ({
        name: s.name,
        mode: s.mode,
        itemsText: s.items.join('\n'),
      }))
    )
  }

  const patchStream = (idx, patch) => {
    invalidatePreview()
    setStreams((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const addStream = () => {
    invalidatePreview()
    setStreams((prev) => [
      ...prev,
      { name: `Stream ${prev.length + 1}`, mode: 'OPERATIONS', itemsText: 'งานย่อยที่ 1' },
    ])
  }

  const removeStream = (idx) => {
    invalidatePreview()
    setStreams((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  const buildEnvelope = () => {
    // Build PlanEnvelope contract
    const selectedBiz = businesses?.find((b) => b.id === businessId) || businesses?.[0]
    const targetWorkspace =
      workspaces?.find((w) => w.businessId === selectedBiz?.id) || workspaces?.[0]

    const codeSuffix = Date.now().toString().slice(-4)
    const projectCode = `PRJ-PLAN-${codeSuffix}`

    const envelope = {
      schemaVersion: '1.0',
      generatedBy: delegator || 'Zuri AI Planning Agent',
      generatedAt: new Date().toISOString(),
      metadata: {
        delegator: delegator.trim(),
        approver: approver.trim(),
        requiresHumanApproval: true,
        planMode: mode,
      },
      scope: {
        businessCode: selectedBiz?.code || 'SMARTGIFT',
        workspaceCode: targetWorkspace?.code || 'WS-DEFAULT',
      },
      project: {
        code: projectCode,
        name: objective.trim(),
        description: description.trim() || undefined,
        status: 'ACTIVE',
      },
      workstreams: streams.map((s, sIdx) => ({
        code: `STR-${codeSuffix}-${sIdx + 1}`,
        name: s.name.trim() || `Stream ${sIdx + 1}`,
        executionMode: s.mode,
        progressStrategy: s.mode === 'DATA_MIGRATION' ? 'METRIC_ROLLUP' : 'TASK_COUNT',
        progressWeight: 1,
        items: s.itemsText
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((title, iIdx) => ({
            code: `TSK-${codeSuffix}-${sIdx + 1}-${iIdx + 1}`,
            title,
            subtype: 'TASK',
            status: 'PLANNED',
            weight: 1,
            metadata: {
              delegator: delegator.trim(),
              approver: approver.trim(),
            },
          })),
      })),
    }

    return { envelope, workspaceId: targetWorkspace?.id }
  }

  // Step 1 — validate + dry run. Never writes: this is the read-only preview
  // required before any commit (@req FR-012, @spec BR-009/SDD-009).
  const submit = async (e) => {
    e.preventDefault()
    if (!objective.trim()) {
      setError('กรุณาระบุวัตถุประสงค์ของแผนงาน (Objective)')
      return
    }
    setBusy(true)
    setError(null)
    setPreview(null)
    setPendingRequest(null)
    try {
      const { envelope, workspaceId: targetWorkspaceId } = buildEnvelope()
      const request = buildPlanImportRequest(envelope, { workspaceId: targetWorkspaceId })
      const dry = await api('/api/import/dry-run', { method: 'POST', body: request })
      if (!dry.valid) {
        setError((dry.errors || []).join(', ') || 'Plan validation failed')
        if (dry.preview) setPreview(dry.preview)
        return
      }
      setPreview(dry.preview)
      setPendingRequest(request)
    } catch (err) {
      setError(err.message || 'Failed to validate plan')
    } finally {
      setBusy(false)
    }
  }

  // Step 2 — transactional commit of the exact request the preview validated.
  const confirmCommit = async () => {
    if (!pendingRequest) return
    setBusy(true)
    setError(null)
    try {
      const res = await api('/api/import/commit', { method: 'POST', body: pendingRequest })
      if (!res.committed) {
        setError((res.errors || []).join(', ') || 'Failed to create plan')
        return
      }
      setPreview(null)
      setPendingRequest(null)
      onGenerated?.(res)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create plan')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="✨ Custom Plan Mode (สร้างแผนงานตามโหมดปฏิบัติการ)">
      <form onSubmit={submit} className="space-y-3">
        {/* Preset quick buttons */}
        <div>
          <label className="text-[11px] font-semibold text-muted">ตัวอย่างแผนสำเร็จรูป (Quick Presets):</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.keys(PRESET_EXAMPLES).map((key) => (
              <button
                key={key}
                type="button"
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                  mode === key
                    ? 'border-amber-500 bg-amber-50 text-amber-900'
                    : 'border-[#ECEEF1] hover:bg-slate-50'
                }`}
                onClick={() => applyPreset(key)}
              >
                {key === 'DATA_MIGRATION' && '📊 Data Extraction (เช่น ลูกค้า 2020)'}
                {key === 'SOFTWARE_SPRINT' && '💻 Software Feature'}
                {key === 'OPERATIONS' && '📋 Operations Checklist'}
              </button>
            ))}
          </div>
        </div>

        <Field label="เป้าหมายของแผน (Plan Objective)" hint="เช่น ดึงรายชื่อลูกค้าที่เคยซื้อสินค้าช่วงปี 2020">
          <input
            className="input"
            value={objective}
            onChange={(e) => { invalidatePreview(); setObjective(e.target.value) }}
            placeholder="ระบุเป้าหมายหรือโจทย์ที่ต้องการวางแผน..."
            required
          />
        </Field>

        <Field label="รายละเอียด / ขอบเขต (Scope & Description)">
          <textarea
            className="input"
            rows={2}
            value={description}
            onChange={(e) => { invalidatePreview(); setDescription(e.target.value) }}
            placeholder="ระบุเงื่อนไข ขอบเขตเวลา หรือรายละเอียดเพิ่มเติม..."
          />
        </Field>

        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Field label="หน่วยธุรกิจ (Business)">
            <select
              className="input"
              value={businessId}
              onChange={(e) => { invalidatePreview(); setBusinessId(e.target.value) }}
            >
              {(businesses || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ผู้สั่งงาน / Delegator (AI หรือ คน)" hint="ผู้ที่ริเริ่มคำสั่ง">
            <input
              className="input"
              value={delegator}
              onChange={(e) => { invalidatePreview(); setDelegator(e.target.value) }}
              placeholder="เช่น AI Planning Agent, คุณสมชาย"
              required
            />
          </Field>
          <Field label="ผู้อนุมัติ / Human Approver" hint="ผู้ตรวจสอบผลลัพธ์">
            <input
              className="input"
              value={approver}
              onChange={(e) => { invalidatePreview(); setApprover(e.target.value) }}
              placeholder="เช่น ผู้จัดการแผนก, Owner"
              required
            />
          </Field>
        </div>

        {/* Workstreams builder */}
        <div className="mt-3 rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold">สายงาน & งานย่อย (Workstreams & Tasks)</h3>
            <button type="button" className="btn btn-sm flex items-center gap-1 text-[11px]" onClick={addStream}>
              <Plus size={12} /> เพิ่มสายงาน
            </button>
          </div>

          <div className="space-y-3">
            {streams.map((stream, idx) => (
              <div key={idx} className="rounded-lg border border-[#ECEEF1] bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <input
                    className="input font-semibold text-xs flex-1"
                    value={stream.name}
                    onChange={(e) => patchStream(idx, { name: e.target.value })}
                    placeholder="ชื่อสายงาน..."
                  />
                  <select
                    className="input text-xs w-auto"
                    value={stream.mode}
                    onChange={(e) => patchStream(idx, { mode: e.target.value })}
                  >
                    {EXECUTION_MODES.map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  {streams.length > 1 && (
                    <button
                      type="button"
                      className="btn text-danger p-1.5"
                      onClick={() => removeStream(idx)}
                      title="ลบสายงาน"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <Field label="รายการงานย่อย (1 บรรทัด = 1 Task)">
                  <textarea
                    className="input font-mono text-[11px]"
                    rows={3}
                    value={stream.itemsText}
                    onChange={(e) => patchStream(idx, { itemsText: e.target.value })}
                    placeholder="ระบุชื่องานแต่ละบรรทัด..."
                  />
                </Field>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        {/* Dry-run preview — nothing has been written yet. Confirming below
            re-sends this exact request to the transactional commit leg. */}
        {preview && pendingRequest && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px]">
            <p className="mb-1 flex items-center gap-1.5 font-bold text-emerald-800">
              <CheckCircle2 size={13} /> ตรวจสอบแล้ว ยังไม่มีการเขียนข้อมูล — กด "ยืนยันสร้างแผน" เพื่อบันทึกจริง
            </p>
            <p className="text-emerald-900">
              เพิ่มใหม่ {preview.inserts.length} รายการ · อัปเดต {preview.updates.length} รายการ
              {preview.conflicts.length > 0 ? ` · ขัดแย้ง ${preview.conflicts.length} รายการ` : ''}
            </p>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          {pendingRequest ? (
            <>
              <button type="button" className="btn" onClick={invalidatePreview} disabled={busy}>
                แก้ไขแผน
              </button>
              <button
                type="button"
                className="btn btn-primary flex items-center gap-1.5"
                onClick={confirmCommit}
                disabled={busy}
              >
                <Sparkles size={14} />
                {busy ? 'กำลังบันทึก…' : 'ยืนยันสร้างแผน'}
              </button>
            </>
          ) : (
            <button type="submit" className="btn btn-primary flex items-center gap-1.5" disabled={busy}>
              <Sparkles size={14} />
              {busy ? 'กำลังตรวจสอบแผน…' : 'ตรวจสอบแผน (Preview)'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
