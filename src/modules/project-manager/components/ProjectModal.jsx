'use client'

import { useState } from 'react'
import { Modal, Field } from '@/components/ui'
import { PROJECT_STATUSES } from '@/lib/validation/enums'
import { api } from './useApi'

export default function ProjectModal({ open, onClose, workspaces = [], project, defaultWorkspaceId, workspaceLabel = 'Space', onSaved }) {
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    description: project?.description || '',
    workspaceId: project?.workspaceId || defaultWorkspaceId || workspaces[0]?.id || '',
    status: project?.status || 'PLANNED',
    startAt: project?.startAt ? project.startAt.slice(0, 10) : '',
    targetAt: project?.targetAt ? project.targetAt.slice(0, 10) : '',
  }))
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
