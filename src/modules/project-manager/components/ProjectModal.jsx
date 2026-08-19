'use client'

// @req FR-087, FR-088 — this modal is the editing path for priority and PIC.
// Without one, both fields could only ever be set by the seed, and the
// Dashboard's Top 5 panel would sit in its empty state permanently — a column
// nobody can fill is a column that teaches the page is broken.
// @spec ADR-036 D3, ADR-036 D4
// @tested tests/unit/projects-dashboard-ui.test.js
import { useState } from 'react'
import { Modal, Field } from '@/components/ui'
import { PROJECT_STATUSES, PROJECT_PRIORITIES } from '@/lib/validation/enums'
import { api, useFetch } from './useApi'

export default function ProjectModal({ open, onClose, workspaces = [], project, defaultWorkspaceId, workspaceLabel = 'Space', onSaved }) {
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    description: project?.description || '',
    workspaceId: project?.workspaceId || defaultWorkspaceId || workspaces[0]?.id || '',
    status: project?.status || 'PLANNED',
    // '' is the unset sentinel in the form and becomes `null` on submit. Unset
    // is a real state for both fields, not a missing value to be defaulted.
    priority: project?.priority || '',
    picPersonId: project?.pic?.id || project?.picPersonId || '',
    startAt: project?.startAt ? project.startAt.slice(0, 10) : '',
    targetAt: project?.targetAt ? project.targetAt.slice(0, 10) : '',
  }))
  // The PIC candidates are this Project's team — the people already scoped to
  // its Business (FR-036). Offering every Person in the tenant would hand out a
  // directory the surface never shows, which is the FR-062 read leak
  // (`.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md`).
  // `members` are Membership rows with their Person included.
  const team = useFetch(project?.id ? `/api/projects/${project.id}/team` : null, [project?.id])
  const candidates = (team.data?.members || []).map((membership) => membership.person).filter(Boolean)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        status: form.status,
        // '' → null, so choosing "Unset" actually clears the stored value. The
        // service distinguishes `undefined` (absent from the patch) from an
        // explicit `null`, which is what makes clearing possible at all.
        priority: form.priority || null,
        picPersonId: form.picPersonId || null,
        startAt: form.startAt || null,
        targetAt: form.targetAt || null,
      }
      await api(`/api/projects/${project.id}`, { method: 'PATCH', body })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Human project creation is the objective wizard. This modal is edit-only.
  if (!project) return null

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${project.code}`}>
      <form onSubmit={submit}>
        <Field label="Objective / name" hint="Describe the outcome. Execution modes are chosen per workstream, not per project.">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority" hint="Ranks the Dashboard's Top 5. Unset means unranked, not lowest.">
            <select className="input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="">Unset</option>
              {PROJECT_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </Field>
          <Field label="PIC" hint="One accountable person, chosen from this Project's team.">
            <select className="input" value={form.picPersonId} onChange={(e) => set('picPersonId', e.target.value)}>
              <option value="">Unset</option>
              {candidates.map((person) => (
                <option key={person.id} value={person.id}>{person.displayName} · {person.code}</option>
              ))}
            </select>
          </Field>
          <Field label="Start date">
            <input className="input" type="date" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
          </Field>
          <Field label="Target date">
            <input className="input" type="date" value={form.targetAt} onChange={(e) => set('targetAt', e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}
