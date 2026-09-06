'use client'

// @req FR-017, FR-069 — Human users can create an editable plan in a popup;
// the result is serialized to PlanEnvelope before the existing dry-run path.
// @spec BR-003, BR-009, SDD-006
// @tested tests/unit/human-plan-builder.test.js, tests/e2e/smoke.spec.js

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field, Modal } from '@/components/ui'
import { EXECUTION_MODES, MODE_LABELS } from '@/lib/validation/enums'
import { buildHumanPlan } from '../import/human-plan-builder'

const EMPTY_STREAM = { name: '', mode: 'SOFTWARE_SPRINT', itemsText: '' }

export default function HumanPlanBuilderModal({
  open,
  onClose,
  workspaces = [],
  defaultWorkspaceId = '',
  onGenerate,
  busy = false,
}) {
  const [objective, setObjective] = useState('')
  const [description, setDescription] = useState('')
  const [targetAt, setTargetAt] = useState('')
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId)
  const [streams, setStreams] = useState([{ ...EMPTY_STREAM }])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setWorkspaceId(defaultWorkspaceId || workspaces[0]?.id || '')
    setError('')
  }, [open, defaultWorkspaceId, workspaces])

  const patchStream = (index, patch) => {
    setStreams((current) => current.map((stream, i) => (i === index ? { ...stream, ...patch } : stream)))
  }

  const addStream = () => setStreams((current) => [...current, { ...EMPTY_STREAM }])

  const removeStream = (index) => {
    setStreams((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)))
  }

  const submit = (event) => {
    event.preventDefault()
    const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId)
    if (!objective.trim()) {
      setError('กรุณาระบุเป้าหมายหรือชื่อโปรเจกต์')
      return
    }
    if (!selectedWorkspace) {
      setError('กรุณาเลือก Space ปลายทาง')
      return
    }
    if (!streams.some((stream) => stream.name.trim())) {
      setError('กรุณาเพิ่มอย่างน้อย 1 สายงาน')
      return
    }

    try {
      const plan = buildHumanPlan({
        objective,
        description,
        targetAt,
        workspaceCode: selectedWorkspace.code,
        streams,
      })
      onGenerate(plan)
    } catch (buildError) {
      setError(buildError.message)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create plan from UI" wide>
      <form onSubmit={submit}>
        <p className="mb-4 rounded-lg bg-[var(--brand-surface)] px-3 py-2 text-[11px] text-muted">
          กรอกข้อมูลในฟอร์มนี้ ระบบจะสร้าง PlanEnvelope JSON ให้ดูในช่อง Plan JSON แล้วส่งเข้า validate + dry-run pipeline เดิม
        </p>

        {error && <p className="mb-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">{error}</p>}

        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="ชื่อหรือเป้าหมายโปรเจกต์">
            <input
              className="input"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="เช่น เปิดสาขาเชียงใหม่"
              aria-label="ชื่อหรือเป้าหมายโปรเจกต์"
              autoFocus
            />
          </Field>
          <Field label="Space ปลายทาง">
            <select className="input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} aria-label="Space ปลายทาง">
              <option value="">เลือก Space</option>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.code} · {workspace.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="รายละเอียดแผน">
            <textarea className="input" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} aria-label="รายละเอียดแผน" />
          </Field>
          <Field label="วันเป้าหมาย (ถ้ามี)">
            <input className="input" type="date" value={targetAt} onChange={(event) => setTargetAt(event.target.value)} aria-label="วันเป้าหมาย" />
          </Field>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-bold">สายงานของแผน</p>
            <p className="text-[10px] text-muted">เลือก execution mode ต่อสายงาน และใส่งานเริ่มต้นทีละบรรทัด</p>
          </div>
          <button type="button" className="btn flex items-center gap-1 px-2 py-1 text-[10px]" onClick={addStream}>
            <Plus size={12} aria-hidden /> เพิ่มสายงาน
          </button>
        </div>

        <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
          {streams.map((stream, index) => (
            <div key={index} className="rounded-xl border border-[var(--border)] bg-[var(--surface-mid)] p-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 grid-cols-2 gap-3 max-md:grid-cols-1">
                  <Field label={`ชื่อสายงานที่ ${index + 1}`}>
                    <input
                      className="input"
                      value={stream.name}
                      onChange={(event) => patchStream(index, { name: event.target.value })}
                      placeholder="เช่น หาทำเลและสัญญา"
                      aria-label={`ชื่อสายงานที่ ${index + 1}`}
                    />
                  </Field>
                  <Field label="ลักษณะงานของสายงาน">
                    <select className="input" value={stream.mode} onChange={(event) => patchStream(index, { mode: event.target.value })} aria-label={`ลักษณะงานของสายงานที่ ${index + 1}`}>
                      {EXECUTION_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode]} ({mode})</option>)}
                    </select>
                  </Field>
                </div>
                <button type="button" className="btn mt-5 px-2 py-1" onClick={() => removeStream(index)} aria-label={`ลบสายงานที่ ${index + 1}`}>
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
              <Field label="งานเริ่มต้น (บรรทัดละรายการ — เว้นว่างได้)">
                <textarea
                  className="input"
                  rows={2}
                  value={stream.itemsText}
                  onChange={(event) => patchStream(index, { itemsText: event.target.value })}
                  placeholder={'สำรวจทำเล\nสรุปข้อเสนอเช่า'}
                  aria-label={`งานเริ่มต้นของสายงานที่ ${index + 1}`}
                />
              </Field>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'กำลังตรวจ…' : 'สร้าง Plan และตรวจสอบ'}</button>
        </div>
      </form>
    </Modal>
  )
}
