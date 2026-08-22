'use client'

// @req FR-005, FR-017 — Standalone Task Modal: create work items directly with
// creator/assignee attribution, business scope, and optional project binding.
// @spec BR-004, SEC-001

import { useEffect, useState } from 'react'
import { Modal, Field } from '@/components/ui'
import { ITEM_SUBTYPES, WORK_STATUSES } from '@/lib/validation/enums'
import { api, useFetch } from './useApi'

export default function StandaloneTaskModal({ open, onClose, onSaved }) {
  const { data: businesses } = useFetch('/api/businesses')
  const { data: projects } = useFetch('/api/projects')
  const { data: viewer } = useFetch('/api/viewer')

  const [businessId, setBusinessId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [subtype, setSubtype] = useState('TASK')
  const [status, setStatus] = useState('PLANNED')
  const [weight, setWeight] = useState(1)
  const [assigneeRef, setAssigneeRef] = useState('')
  const [approverRef, setApproverRef] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      if (businesses && businesses.length > 0 && !businessId) {
        setBusinessId(businesses[0].id)
      }
      if (viewer?.principal?.displayName && !assigneeRef) {
        setAssigneeRef(viewer.principal.displayName)
      }
    }
  }, [open, businesses, viewer])

  const filteredProjects = (projects || []).filter((p) => !businessId || p.businessId === businessId)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('กรุณาระบุชื่องาน (Task Title)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Create or locate a default ad-hoc workstream under the selected project or business
      let targetProjectId = projectId
      if (!targetProjectId && filteredProjects.length > 0) {
        targetProjectId = filteredProjects[0].id
      }

      // Fetch workstreams for this project
      const wsRes = await api(`/api/workstreams?projectId=${targetProjectId}`)
      let targetWorkstreamId = wsRes?.[0]?.id

      if (!targetWorkstreamId) {
        // Create an ad-hoc Operations workstream
        const newWs = await api('/api/workstreams', {
          method: 'POST',
          body: {
            projectId: targetProjectId,
            name: 'General Tasks & Operations',
            executionMode: 'OPERATIONS',
            progressStrategy: 'TASK_COUNT',
            progressWeight: 1,
          },
        })
        targetWorkstreamId = newWs.id
      }

      // Create the work item with metadata including Creator & Approver
      await api('/api/work', {
        method: 'POST',
        body: {
          workstreamId: targetWorkstreamId,
          title: title.trim(),
          subtype,
          status,
          weight: Number(weight) || 1,
          assigneeRef: assigneeRef.trim() || undefined,
          metadata: {
            description: description.trim() || undefined,
            createdBy: viewer?.principal?.displayName || 'User',
            approver: approverRef.trim() || undefined,
            isStandalone: !projectId,
          },
        },
      })

      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create task')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="✨ Create Task (งานใหม่)">
      <form onSubmit={submit} className="space-y-3">
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
              value={businessId}
              onChange={(e) => {
                setBusinessId(e.target.value)
                setProjectId('')
              }}
            >
              {(businesses || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </Field>

          <Field label="ผูกเข้ากับ Project (ทางเลือก / ผูกทีหลังได้)" hint="สามารถปล่อยว่างเพื่อเป็น Standalone Task ได้">
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">(Standalone — ยังไม่สังกัดโปรเจกต์)</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="ผู้รับผิดชอบ / สั่งงาน (Assignee / Delegator)">
            <input
              className="input"
              value={assigneeRef}
              onChange={(e) => setAssigneeRef(e.target.value)}
              placeholder="ชื่อผู้สั่งงาน หรือ AI Agent"
            />
          </Field>

          <Field label="ผู้อนุมัติผลงาน (Human Approver)">
            <input
              className="input"
              value={approverRef}
              onChange={(e) => setApproverRef(e.target.value)}
              placeholder="เช่น คุณพรพร, ผู้จัดการสาขา"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Field label="ประเภท (Type)">
            <select className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
              {ITEM_SUBTYPES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สถานะเริ่มต้น">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
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

        {error && (
          <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'สร้าง Task ทันที'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
