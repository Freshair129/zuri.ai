'use client'

import { useState } from 'react'
import { Modal, Field } from '@/components/ui'
import { ITEM_SUBTYPES, WORK_STATUSES } from '@/lib/validation/enums'
import { api } from './useApi'

/**
 * Create/edit a WorkItem. Neutral core model: subtype + optional numeric
 * fields + metrics JSON for mode-specific evidence.
 */
export default function WorkItemModal({ open, onClose, workstream, containers = [], item, defaultSubtype, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: item?.title || '',
    subtype: item?.subtype || defaultSubtype || 'TASK',
    status: item?.status || 'PLANNED',
    containerId: item?.containerId || containers[0]?.id || '',
    weight: item?.weight ?? 1,
    numericValue: item?.numericValue ?? '',
    probability: item?.probability ?? '',
    metricsText: JSON.stringify(item?.metrics || {}, null, 2),
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let metrics
      try {
        metrics = form.metricsText.trim() ? JSON.parse(form.metricsText) : {}
      } catch {
        throw new Error('Metrics must be valid JSON')
      }
      const body = {
        title: form.title,
        subtype: form.subtype,
        status: form.status,
        containerId: form.containerId || null,
        weight: Number(form.weight) || 1,
        numericValue: form.numericValue === '' ? null : Number(form.numericValue),
        probability: form.probability === '' ? null : Number(form.probability),
        metrics,
      }
      await api(`/api/work/${item.id}`, { method: 'PATCH', body })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!item) return null

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${item.code}`}>
      <form onSubmit={submit}>
        <Field label="Title">
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="Type">
            <select className="input" value={form.subtype} onChange={(e) => set('subtype', e.target.value)}>
              {ITEM_SUBTYPES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {WORK_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Container">
            <select className="input" value={form.containerId} onChange={(e) => set('containerId', e.target.value)}>
              <option value="">(none)</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Weight">
            <input className="input" type="number" step="0.1" value={form.weight} onChange={(e) => set('weight', e.target.value)} />
          </Field>
          <Field label="Value (e.g. deal size)">
            <input className="input" type="number" step="0.01" value={form.numericValue} onChange={(e) => set('numericValue', e.target.value)} />
          </Field>
          <Field label="Probability (0–1)">
            <input className="input" type="number" min="0" max="1" step="0.05" value={form.probability} onChange={(e) => set('probability', e.target.value)} />
          </Field>
        </div>
        <Field label="Metrics (JSON)" hint="Mode-specific evidence, e.g. {'recordsTotal': 100, 'validated': 40}">
          <textarea className="input font-mono text-[10px]" rows={4} value={form.metricsText} onChange={(e) => set('metricsText', e.target.value)} />
        </Field>
        {error && (
          <p className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
