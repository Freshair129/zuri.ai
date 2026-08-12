'use client'

import { useState } from 'react'
import { Modal, Field } from '@/components/ui'
import {
  EXECUTION_MODES,
  PROGRESS_STRATEGIES,
  MODE_DEFAULT_STRATEGY,
  MODE_LABELS,
  WORKSTREAM_STATUSES,
} from '@/lib/validation/enums'
import { api } from './useApi'

export default function WorkstreamModal({ open, onClose, projectId, workstream, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: workstream?.name || '',
    executionMode: workstream?.executionMode || 'SOFTWARE_SPRINT',
    progressStrategy: workstream?.progressStrategy || MODE_DEFAULT_STRATEGY.SOFTWARE_SPRINT,
    progressWeight: workstream?.progressWeight ?? 1,
    status: workstream?.status || 'PLANNED',
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
        executionMode: form.executionMode,
        progressStrategy: form.progressStrategy,
        progressWeight: Number(form.progressWeight) || 1,
        status: form.status,
      }
      if (workstream) {
        await api(`/api/workstreams/${workstream.id}`, { method: 'PATCH', body })
      } else {
        await api('/api/workstreams', { method: 'POST', body: { ...body, projectId } })
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={workstream ? `Edit ${workstream.code}` : 'New workstream'}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="Execution mode">
            <select
              className="input"
              value={form.executionMode}
              onChange={(e) => {
                set('executionMode', e.target.value)
                set('progressStrategy', MODE_DEFAULT_STRATEGY[e.target.value])
              }}
            >
              {EXECUTION_MODES.map((m) => (
                <option key={m} value={m}>{MODE_LABELS[m]}</option>
              ))}
            </select>
          </Field>
          <Field label="Progress strategy" hint="Defaults to the mode's canonical strategy">
            <select className="input" value={form.progressStrategy} onChange={(e) => set('progressStrategy', e.target.value)}>
              {PROGRESS_STRATEGIES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Progress weight" hint="Weight in the project roll-up">
            <input className="input" type="number" min="0.1" step="0.1" value={form.progressWeight} onChange={(e) => set('progressWeight', e.target.value)} />
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {WORKSTREAM_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
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
