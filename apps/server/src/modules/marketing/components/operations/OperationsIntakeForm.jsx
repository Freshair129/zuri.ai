'use client'

// @req FR-162 — new Intake captures only Marketing-owned request fields and
// leaves PM/CRM/Commerce/provider writes to their owner contracts.
// @spec SDD-089, SEC-001
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import { useState } from 'react'
import { Card } from '@/components/ui'

const initial = (value = {}) => ({
  title: value.title || '',
  capability: value.capability || '',
  objective: value.objective || '',
  requiredAt: value.requiredAt ? String(value.requiredAt).slice(0, 10) : '',
  evidenceReference: value.evidenceReference || '',
  responsibleOwnerId: value.responsibleOwnerId || '',
})

export default function OperationsIntakeForm({ value, busy = false, submitLabel = 'Save intake', onSubmit, onCancel }) {
  const [fields, setFields] = useState(() => initial(value))
  const [error, setError] = useState(null)
  const set = (key, next) => setFields((current) => ({ ...current, [key]: next }))
  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit({
        ...fields,
        requiredAt: fields.requiredAt ? new Date(`${fields.requiredAt}T00:00:00.000Z`).toISOString() : null,
        evidenceReference: fields.evidenceReference || null,
        responsibleOwnerId: fields.responsibleOwnerId || null,
      })
    } catch (requestError) {
      setError(requestError.message)
    }
  }
  return <Card data-testid="marketing-operations-intake-form" className="max-w-3xl">
    <form className="grid gap-4" onSubmit={submit}>
      <label><span className="mb-1 block text-xs font-semibold">Request title</span><input className="input" required maxLength={200} value={fields.title} onChange={(event) => set('title', event.target.value)} placeholder="Autumn landing refresh" /></label>
      <label><span className="mb-1 block text-xs font-semibold">Capability owner</span><input className="input" required maxLength={100} value={fields.capability} onChange={(event) => set('capability', event.target.value)} placeholder="Website & CRO" /></label>
      <label><span className="mb-1 block text-xs font-semibold">Business objective</span><textarea className="input min-h-28" required maxLength={4000} value={fields.objective} onChange={(event) => set('objective', event.target.value)} placeholder="What outcome should this request support?" /></label>
      <div className="grid gap-4 md:grid-cols-2">
        <label><span className="mb-1 block text-xs font-semibold">Required date</span><input className="input" type="date" value={fields.requiredAt} onChange={(event) => set('requiredAt', event.target.value)} /></label>
        <label><span className="mb-1 block text-xs font-semibold">Responsible owner ID <span className="font-normal text-muted">(optional)</span></span><input className="input" maxLength={100} value={fields.responsibleOwnerId} onChange={(event) => set('responsibleOwnerId', event.target.value)} placeholder="Person UUID" /></label>
      </div>
      <label><span className="mb-1 block text-xs font-semibold">Evidence reference <span className="font-normal text-muted">(optional)</span></span><input className="input" maxLength={4000} value={fields.evidenceReference} onChange={(event) => set('evidenceReference', event.target.value)} placeholder="Analytics report, brief or source link" /></label>
      {error && <p role="alert" className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>{onCancel && <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>}</div>
    </form>
  </Card>
}
