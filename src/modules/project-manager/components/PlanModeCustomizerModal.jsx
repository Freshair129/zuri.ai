'use client'

// @req FR-009, FR-012, FR-017 — Plan Mode Customizer: design an execution plan
// across the 7 canonical modes with explicit Delegator (AI or human) and Human
// Approver bindings. The form is serialized by the shared human-plan builder
// into a PlanEnvelope and travels the one intake pipeline — dry-run preview,
// a human confirms, transactional commit. It never writes on its own.
// @spec BR-003, BR-004, BR-009, SDD-006, SDD-009
// @spec SDD-018 — Business and Space choices come from the shell's scope
// inventory (ScopeContext); there is no second broad list endpoint behind
// this modal.
// @tested tests/unit/plan-intake-flow.test.js, tests/unit/work-surface-scope-inventory.test.js, tests/integration/plan-mode-modal-intake.test.js

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Sparkles, CheckCircle2 } from 'lucide-react'
import { Modal, Field } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { visibleWorkspaces } from '@/lib/shell-mode'
import { EXECUTION_MODES, MODE_LABELS } from '@/lib/validation/enums'
import { buildPlanModeEnvelope } from '../import/plan-mode-envelope'
import { useFetch } from './useApi'
import { usePlanIntake } from './usePlanIntake'
import PlanPreview from './PlanPreview'

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

const DEFAULT_STREAMS = [
  {
    name: 'Data Extraction & Validation',
    mode: 'DATA_MIGRATION',
    itemsText: 'สกัดข้อมูลลูกค้าปี 2020\nตรวจสอบความถูกต้องของข้อมูล\nสรุปผลส่งมอบให้ Approver',
  },
]

export default function PlanModeCustomizerModal({ open, onClose, onGenerated }) {
  const scope = useScope()
  const businesses = scope.businesses
  const { data: viewer } = useFetch(open ? '/api/viewer' : null)
  const intake = usePlanIntake()

  const [objective, setObjective] = useState('')
  const [description, setDescription] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [delegator, setDelegator] = useState('')
  const [approver, setApprover] = useState('')
  const [mode, setMode] = useState('DATA_MIGRATION')
  const [streams, setStreams] = useState(DEFAULT_STREAMS)
  const [error, setError] = useState(null)

  // Derived, never copied into state: the shell's active Business is the
  // default, and a Space is offered only inside the chosen Business — its own
  // Spaces plus group-level ones, the same rule the shell applies.
  const effectiveBusinessId = businessId || scope.shell.activeBusinessId || businesses[0]?.id || ''
  const business = businesses.find((b) => b.id === effectiveBusinessId) || null
  const workspaces = useMemo(() => visibleWorkspaces(scope.workspaces, business), [scope.workspaces, business])
  const pick = (id) => (id && workspaces.some((w) => w.id === id) ? id : '')
  const effectiveWorkspaceId = pick(workspaceId) || pick(scope.selection.workspaceId) || workspaces[0]?.id || ''
  const workspace = workspaces.find((w) => w.id === effectiveWorkspaceId) || null

  useEffect(() => {
    if (!open) return
    const name = viewer?.principal?.displayName
    if (name && !delegator) setDelegator(name)
    if (!approver) setApprover(name || 'Human Approver')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewer])

  // Confirm only ever commits what was previewed: any edit after the dry run
  // discards it, so the button the human presses describes the plan they see.
  const formKey = JSON.stringify({ objective, description, effectiveWorkspaceId, delegator, approver, streams })
  const previewedKey = useRef(null)
  useEffect(() => {
    if ((intake.dryRun || intake.errors) && previewedKey.current !== formKey) intake.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey])

  const applyPreset = (modeKey) => {
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
    setStreams((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const addStream = () => {
    setStreams((prev) => [
      ...prev,
      { name: `Stream ${prev.length + 1}`, mode: 'OPERATIONS', itemsText: 'งานย่อยที่ 1' },
    ])
  }

  const removeStream = (idx) => {
    setStreams((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  const close = () => {
    intake.reset()
    setError(null)
    onClose?.()
  }

  // Leg 1 — read-only dry run. The server validates the envelope, checks the
  // seven-mode semantic contract and diffs it against the Space; nothing is
  // written until the human confirms the preview it returns.
  const preview = async (e) => {
    e.preventDefault()
    setError(null)
    if (!objective.trim()) return setError('กรุณาระบุวัตถุประสงค์ของแผนงาน (Objective)')
    if (!workspace) return setError('ไม่พบ Space ปลายทางใน Business นี้ — สร้าง Space ก่อนนำเข้าแผน')
    if (!streams.some((s) => s.name.trim())) return setError('กรุณาเพิ่มอย่างน้อย 1 สายงาน')
    let plan
    try {
      plan = buildPlanModeEnvelope({
        objective,
        description,
        workspaceCode: workspace.code,
        streams,
        delegator,
        approver,
      })
    } catch (err) {
      return setError(err.message || 'Failed to build plan')
    }
    previewedKey.current = formKey
    await intake.preview(plan, { workspaceId: workspace.id })
  }

  // Leg 2 — transactional commit of exactly the previewed envelope.
  const confirm = async () => {
    const next = await intake.confirm()
    if (!next.committed) return
    onGenerated?.(next.committed)
    close()
  }

  if (!open) return null

  const errors = error ? [error] : intake.errors
  const busy = intake.busy

  return (
    <Modal open={open} onClose={close} title="✨ Custom Plan Mode (สร้างแผนงานตามโหมดปฏิบัติการ)" wide>
      <form onSubmit={preview} className="space-y-3">
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
            onChange={(e) => setObjective(e.target.value)}
            placeholder="ระบุเป้าหมายหรือโจทย์ที่ต้องการวางแผน..."
            required
          />
        </Field>

        <Field label="รายละเอียด / ขอบเขต (Scope & Description)">
          <textarea
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ระบุเงื่อนไข ขอบเขตเวลา หรือรายละเอียดเพิ่มเติม..."
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="หน่วยธุรกิจ (Business)">
            <select
              className="input"
              value={effectiveBusinessId}
              onChange={(e) => {
                setBusinessId(e.target.value)
                setWorkspaceId('')
              }}
              aria-label="หน่วยธุรกิจ"
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Space ปลายทาง (Target Workspace)" hint="แผนจะถูกนำเข้าใน Space นี้">
            <select
              className="input"
              value={effectiveWorkspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              aria-label="Space ปลายทาง"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="ผู้สั่งงาน / Delegator (AI หรือ คน)" hint="ผู้ที่ริเริ่มคำสั่ง">
            <input
              className="input"
              value={delegator}
              onChange={(e) => setDelegator(e.target.value)}
              placeholder="เช่น AI Planning Agent, คุณสมชาย"
              required
            />
          </Field>
          <Field label="ผู้อนุมัติ / Human Approver" hint="ผู้ตรวจสอบผลลัพธ์">
            <input
              className="input"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
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

        {intake.dryRun && <PlanPreview dryRun={intake.dryRun} />}

        {errors && errors.length > 0 && (
          <ul className="space-y-1" role="alert">
            {errors.map((message, i) => (
              <li key={i} className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                {message}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={close}>
            ยกเลิก
          </button>
          <button
            type="submit"
            className={`btn flex items-center gap-1.5 ${intake.dryRun ? '' : 'btn-primary'}`}
            disabled={busy}
          >
            <Sparkles size={14} />
            {busy && !intake.dryRun ? 'กำลังตรวจสอบแผน…' : 'ตรวจสอบแผน (Dry run)'}
          </button>
          {intake.dryRun && (
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={confirm}
              disabled={busy || !intake.canConfirm}
              title={intake.canConfirm ? 'นำเข้าแผนตามพรีวิวนี้ในธุรกรรมเดียว' : 'แก้ไขข้อขัดแย้งในพรีวิวก่อนยืนยัน'}
            >
              <CheckCircle2 size={14} />
              {busy ? 'กำลังนำเข้า…' : 'ยืนยันสร้าง Execution Plan'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
