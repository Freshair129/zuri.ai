'use client'

// @req FR-155 — owners can create and revise a validated Marketing plan.
// @spec SDD-086 — plan fields describe intent; KPI_ATTAINMENT needs PM metric
// targets and observations and is never inferred from successMetric prose.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import { useEffect, useState } from 'react'
import { Card, Field, SectionTitle } from '@/components/ui'
import { PLAN_CHANNELS, emptyPlanPayload, normalizePlanPayload, validatePlanPayload } from './marketing-contract'
import { InlineNotice } from './MarketingState'

export function PlanForm({ plan, onSubmit, onCancel, busy = false }) {
  const [title, setTitle] = useState(plan?.title || '')
  const [payload, setPayload] = useState(() => normalizePlanPayload(plan?.currentVersion?.payload || plan?.payload || emptyPlanPayload()))
  const [errors, setErrors] = useState([])

  useEffect(() => {
    setTitle(plan?.title || '')
    setPayload(normalizePlanPayload(plan?.currentVersion?.payload || plan?.payload || emptyPlanPayload()))
    setErrors([])
  }, [plan?.id, plan?.currentRevision, plan?.currentVersion?.id])

  const update = (key, value) => setPayload((current) => ({ ...current, [key]: value }))
  const updateAction = (index, titleValue) => setPayload((current) => ({
    ...current,
    actions: current.actions.map((action, actionIndex) => actionIndex === index ? { ...action, title: titleValue } : action),
  }))
  const toggleChannel = (channel) => setPayload((current) => ({
    ...current,
    channels: current.channels.includes(channel) ? current.channels.filter((item) => item !== channel) : [...current.channels, channel],
  }))
  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = validatePlanPayload(payload, title)
    if (nextErrors.length) {
      setErrors(nextErrors)
      return
    }
    setErrors([])
    await onSubmit({ title: title.trim(), payload: normalizePlanPayload(payload) })
  }

  return (
    <Card className="mb-4" data-testid="marketing-plan-form">
      <SectionTitle caption="Planning intent is versioned after each save">{plan ? 'Revise plan' : 'New Marketing plan'}</SectionTitle>
      {errors.length > 0 && <InlineNotice tone="error">{errors.join(' ')}</InlineNotice>}
      <form onSubmit={submit} className="mt-3 space-y-1">
        <Field label="Plan title">
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required disabled={busy} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Objective"><textarea className="input min-h-24" value={payload.objective} onChange={(event) => update('objective', event.target.value)} required disabled={busy} /></Field>
          <Field label="Situation"><textarea className="input min-h-24" value={payload.situation} onChange={(event) => update('situation', event.target.value)} required disabled={busy} /></Field>
          <Field label="Audience"><textarea className="input min-h-24" value={payload.audience} onChange={(event) => update('audience', event.target.value)} required disabled={busy} /></Field>
          <Field label="Success metric intent" hint="This describes the intent only; PM supplies KPI targets and observations.">
            <textarea className="input min-h-24" value={payload.successMetric} onChange={(event) => update('successMetric', event.target.value)} required disabled={busy} />
          </Field>
        </div>
        <fieldset className="mb-3">
          <legend className="mb-1 block text-[11px] font-bold text-muted">Channels</legend>
          <div className="flex flex-wrap gap-2">
            {PLAN_CHANNELS.map((channel) => (
              <label key={channel.value} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px]">
                <input type="checkbox" checked={payload.channels.includes(channel.value)} onChange={() => toggleChannel(channel.value)} disabled={busy} />
                {channel.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Budget" hint="Enter 0 when no budget is allocated."><input className="input" type="number" min="0" step="0.01" value={payload.budget} onChange={(event) => update('budget', event.target.value)} required disabled={busy} /></Field>
          <Field label="Currency" hint="Three-letter code"><input className="input uppercase" maxLength={3} value={payload.currency} onChange={(event) => update('currency', event.target.value.toUpperCase())} required disabled={busy} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1 block text-[11px] font-bold text-muted">Actions</legend>
          <div className="space-y-2">
            {payload.actions.map((action, index) => (
              <div key={index} className="flex gap-2">
                <input className="input" aria-label={`Action ${index + 1}`} value={action.title} onChange={(event) => updateAction(index, event.target.value)} required disabled={busy} />
                {payload.actions.length > 1 && <button type="button" className="btn px-2" onClick={() => update('actions', payload.actions.filter((_, actionIndex) => actionIndex !== index))} disabled={busy} aria-label={`Remove action ${index + 1}`}>×</button>}
              </div>
            ))}
          </div>
          <button type="button" className="btn mt-2 text-[11px]" onClick={() => update('actions', [...payload.actions, { title: '' }])} disabled={busy}>Add action</button>
        </fieldset>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : plan ? 'Save revision' : 'Create plan'}</button>
        </div>
      </form>
    </Card>
  )
}
