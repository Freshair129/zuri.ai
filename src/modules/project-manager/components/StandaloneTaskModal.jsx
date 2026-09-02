'use client'

// @req FR-005, FR-017 — Create Task on All Work is an intake surface: the one
// task becomes a PlanEnvelope and travels dry run → preview → human confirms →
// transactional commit through the shared pipeline. It never writes a
// WorkItem or Workstream directly ("direct modal creation is edit-only"). A
// standalone task — no Project picked — lands in the Business's inbox
// Project, which the form names before anything is sent; see
// docs/domains/project-manager/features/FR-017-standalone-task-inbox.md.
// @spec BR-004, BR-009, SDD-009, SEC-001
// @spec SDD-018 — Business and Space come from the shell's scope inventory
// (ScopeContext); there is no second broad list endpoint behind this modal.
// @tested tests/unit/task-intake-modal.test.js, tests/unit/work-surface-scope-inventory.test.js, tests/integration/task-modal-intake.test.js

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eye } from 'lucide-react'
import { Modal, Field } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { WORK_STATUSES } from '@/lib/validation/enums'
import {
  INBOX_MODE,
  allowedItemSubtypes,
  buildTaskEnvelope,
  generalWorkstreamFor,
  inboxProjectFor,
  inboxWorkstreamFor,
} from '../import/task-envelope'
import { useFetch } from './useApi'
import { usePlanIntake } from './usePlanIntake'
import PlanPreview from './PlanPreview'

export default function StandaloneTaskModal({ open, onClose, onSaved }) {
  const scope = useScope()
  const businesses = scope.businesses
  const intake = usePlanIntake()
  const { data: viewer } = useFetch(open ? '/api/viewer' : null)

  const [businessId, setBusinessId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [workstreamId, setWorkstreamId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [subtype, setSubtype] = useState('')
  const [status, setStatus] = useState('PLANNED')
  const [weight, setWeight] = useState(1)
  const [delegator, setDelegator] = useState('')
  const [approver, setApprover] = useState('')
  const [error, setError] = useState(null)

  // Derived, never copied into state: the shell's active Business is the default.
  const effectiveBusinessId = businessId || scope.shell.activeBusinessId || businesses[0]?.id || ''
  const business = businesses.find((b) => b.id === effectiveBusinessId) || null

  // The project list route refuses an unscoped read and answers `{ items }`.
  const { data: projects } = useFetch(
    open && effectiveBusinessId ? `/api/projects?businessId=${encodeURIComponent(effectiveBusinessId)}` : null
  )
  const projectRows = (projects?.items || []).filter((p) => !effectiveBusinessId || p.businessId === effectiveBusinessId)
  const project = projectRows.find((p) => p.id === projectId) || null

  // A bound Project's workstreams, read only once a Project is picked.
  const { data: workstreamRows } = useFetch(
    open && project ? `/api/workstreams?projectId=${encodeURIComponent(project.id)}` : null
  )
  const workstreams = Array.isArray(workstreamRows) ? workstreamRows : []
  const workstream = workstreams.find((w) => w.id === workstreamId) || workstreams[0] || null

  // Destination Space: the bound Project's own Space, else the Business's own
  // Space (the shell's selected one when it belongs to this Business).
  const ownSpaces = scope.workspaces.filter((w) => w.businessId === effectiveBusinessId)
  const targetWorkspace = project
    ? scope.workspaces.find((w) => w.id === project.workspaceId)
      || (project.workspaceId ? { id: project.workspaceId, code: project.workspace?.code, name: project.workspace?.name } : null)
    : ownSpaces.find((w) => w.id === scope.selection.workspaceId) || ownSpaces[0] || null

  // BR-004 — the form offers only the subtypes the destination mode allows.
  const targetMode = workstream?.executionMode || INBOX_MODE
  const subtypes = allowedItemSubtypes(targetMode)
  const effectiveSubtype = subtypes.includes(subtype) ? subtype : subtypes[0] || ''

  // Where the task will land, named before anything is sent.
  const destination = project
    ? {
        project: { code: project.code, name: project.name },
        workstream: workstream || generalWorkstreamFor(project),
        isNewWorkstream: !workstream,
      }
    : {
        project: inboxProjectFor(business),
        workstream: inboxWorkstreamFor(business),
        isNewWorkstream: false,
      }

  useEffect(() => {
    if (open && viewer?.principal?.displayName && !delegator) setDelegator(viewer.principal.displayName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewer])

  // Confirm only ever commits what was previewed: any edit after the dry run
  // discards it, so the button the human presses describes the task they see.
  const formKey = JSON.stringify({
    effectiveBusinessId,
    projectId,
    workstreamId: workstream?.id || '',
    targetWorkspaceId: targetWorkspace?.id || '',
    title,
    description,
    effectiveSubtype,
    status,
    weight,
    delegator,
    approver,
  })
  const previewedKey = useRef(null)
  useEffect(() => {
    if ((intake.dryRun || intake.errors) && previewedKey.current !== formKey) intake.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey])

  const close = () => {
    intake.reset()
    setError(null)
    onClose?.()
  }

  // Leg 1 — read-only dry run of the one-task envelope.
  const preview = async (e) => {
    e.preventDefault()
    setError(null)
    if (!title.trim()) return setError('กรุณาระบุชื่องาน (Task Title)')
    if (!business) return setError('เลือกหน่วยธุรกิจก่อน')
    if (!targetWorkspace) return setError(`${business.name} ยังไม่มี Space — สร้าง Space ก่อนจึงจะสร้างงานได้`)
    let plan
    try {
      plan = buildTaskEnvelope({
        business,
        project,
        workstream,
        task: {
          title,
          description,
          subtype: effectiveSubtype,
          status,
          weight,
          createdBy: viewer?.principal?.displayName || 'User',
          delegator,
          approver,
          workspaceCode: targetWorkspace.code,
        },
      })
    } catch (err) {
      return setError(err.message || 'Failed to build task')
    }
    previewedKey.current = formKey
    await intake.preview(plan, { workspaceId: targetWorkspace.id })
  }

  // Leg 2 — transactional commit of exactly the previewed envelope.
  const confirm = async () => {
    const next = await intake.confirm()
    if (!next.committed) return
    onSaved?.(next.committed)
    close()
  }

  if (!open) return null

  const errors = error ? [error] : intake.errors
  const busy = intake.busy

  return (
    <Modal open={open} onClose={close} title="✨ Create Task (งานใหม่)" wide>
      <form onSubmit={preview} className="space-y-3">
        <Field label="ชื่องาน / Task Title" hint="เช่น ดึงข้อมูลลูกค้าเก่าปี 2020, ส่งเอกสารสรุปยอดขาย">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ใส่หัวข้องานที่ต้องการมอบหมายหรือสร้างขึ้น..."
            required
            autoFocus
          />
        </Field>

        <Field label="รายละเอียดงาน (Description)">
          <textarea
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="รายละเอียดเพิ่มเติม หรือคำสั่งงานที่ต้องการให้ดำเนินการ..."
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="หน่วยธุรกิจ (Business Scope)">
            <select
              className="input"
              value={effectiveBusinessId}
              onChange={(e) => {
                setBusinessId(e.target.value)
                setProjectId('')
                setWorkstreamId('')
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

          <Field label="ผูกเข้ากับ Project (ทางเลือก / ผูกทีหลังได้)" hint="ปล่อยว่างไว้ งานจะอยู่ในกล่องงานทั่วไปของหน่วยธุรกิจ">
            <select
              className="input"
              value={project ? project.id : ''}
              onChange={(e) => {
                setProjectId(e.target.value)
                setWorkstreamId('')
              }}
              aria-label="ผูกเข้ากับ Project"
            >
              <option value="">(Standalone — ยังไม่สังกัดโปรเจกต์)</option>
              {projectRows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
        </div>

        {project && (
          <Field label="สายงาน (Workstream)" hint={workstreams.length === 0 ? 'โปรเจกต์นี้ยังไม่มีสายงาน — จะสร้าง General Tasks & Operations ให้พร้อมงานนี้' : undefined}>
            <select
              className="input"
              value={workstream ? workstream.id : ''}
              onChange={(e) => setWorkstreamId(e.target.value)}
              aria-label="สายงาน"
              disabled={workstreams.length === 0}
            >
              {workstreams.length === 0 ? (
                <option value="">{generalWorkstreamFor(project).name} (สร้างใหม่)</option>
              ) : (
                workstreams.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code}) · {w.executionMode.replace(/_/g, ' ')}
                  </option>
                ))
              )}
            </select>
          </Field>
        )}

        <p className="rounded-lg bg-[#FAFBFC] px-3 py-2 text-[11px] text-muted" data-task-destination>
          {targetWorkspace ? (
            <>
              ปลายทาง: <b>{destination.project.name}</b> ({destination.project.code}) › {destination.workstream.name}
              {destination.isNewWorkstream ? ' (สร้างใหม่)' : ''} · Space {targetWorkspace.code || ''}
              {!project ? ' — งานที่ไม่ผูกโปรเจกต์จะรวมอยู่ในกล่องงานทั่วไปของหน่วยธุรกิจนี้' : ''}
            </>
          ) : (
            <>{business?.name || 'หน่วยธุรกิจนี้'} ยังไม่มี Space — สร้าง Space ก่อนจึงจะสร้างงานได้</>
          )}
        </p>

        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="ผู้สั่งงาน / Delegator (AI หรือ คน)">
            <input
              className="input"
              value={delegator}
              onChange={(e) => setDelegator(e.target.value)}
              placeholder="ชื่อผู้สั่งงาน หรือ AI Agent"
            />
          </Field>

          <Field label="ผู้อนุมัติผลงาน (Human Approver)">
            <input
              className="input"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              placeholder="เช่น คุณพรพร, ผู้จัดการสาขา"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Field label="ประเภท (Type)" hint={`ตามโหมด ${targetMode.replace(/_/g, ' ')} ของสายงานปลายทาง`}>
            <select className="input" value={effectiveSubtype} onChange={(e) => setSubtype(e.target.value)} aria-label="ประเภท">
              {subtypes.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สถานะเริ่มต้น">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะเริ่มต้น">
              {WORK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="น้ำหนักงาน (Weight)">
            <input
              className="input"
              type="number"
              min="0.1"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
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
            <Eye size={14} />
            {busy && !intake.dryRun ? 'กำลังตรวจสอบ…' : 'ตรวจสอบ (Dry run)'}
          </button>
          {intake.dryRun && (
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={confirm}
              disabled={busy || !intake.canConfirm}
              title={intake.canConfirm ? 'สร้างงานตามพรีวิวนี้ในธุรกรรมเดียว' : 'แก้ไขข้อขัดแย้งในพรีวิวก่อนยืนยัน'}
            >
              <CheckCircle2 size={14} />
              {busy ? 'กำลังสร้าง…' : 'ยืนยันสร้าง Task'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
