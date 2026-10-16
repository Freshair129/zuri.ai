'use client'

// @req FR-269 — business-level Balanced Scorecard, kept separate from the
// FR-060 composite health score. The server owns KPI resultStatus calculation;
// this component only displays its DTO and submits OWNER mutations.

import { useEffect, useRef, useState } from 'react'
import { Activity, Archive, Pencil, Plus } from 'lucide-react'
import { Card, ErrorState, Field, Kpi, Modal, SectionTitle } from '@/components/ui'
import {
  BUSINESS_GOAL_PERSPECTIVES,
  BUSINESS_KPI_CADENCES,
  BUSINESS_KPI_DIRECTIONS,
} from '@/lib/validation/enums'
import { api } from './useApi'

const PERSPECTIVE_LABELS = {
  FINANCIAL: 'Financial',
  CUSTOMER: 'Customer',
  INTERNAL_PROCESS: 'Internal Process',
  LEARNING_GROWTH: 'Learning & Growth',
}

const RESULT_STATUS_PILL = {
  OK: 'pill-active',
  WARN: 'pill-review',
  BAD: 'pill-blocked',
  NO_SIGNAL: 'pill-planned',
}

const RESULT_STATUS_TONE = {
  OK: 'good',
  WARN: 'warn',
  BAD: 'bad',
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function ScorecardDialog({ open, title, onClose, children }) {
  const containerRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current
      const firstField = container?.querySelector('input:not([type="hidden"]), select, textarea')
      ;(firstField || container?.querySelector(FOCUSABLE_SELECTOR))?.focus()
    })

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(containerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    let focusRecoveryFrame = null
    function reclaimFocusIfEscaped(event) {
      const container = containerRef.current
      if (!container?.contains(event.target)) return
      if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
      if (focusRecoveryFrame !== null) cancelAnimationFrame(focusRecoveryFrame)
      focusRecoveryFrame = requestAnimationFrame(() => {
        focusRecoveryFrame = null
        const currentContainer = containerRef.current
        if (!currentContainer || currentContainer.contains(document.activeElement)) return
        currentContainer.querySelector(FOCUSABLE_SELECTOR)?.focus()
      })
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusout', reclaimFocusIfEscaped, true)
    return () => {
      cancelAnimationFrame(frame)
      if (focusRecoveryFrame !== null) cancelAnimationFrame(focusRecoveryFrame)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusout', reclaimFocusIfEscaped, true)
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [open])

  return (
    <div ref={containerRef}>
      <Modal open={open} title={title} onClose={onClose}>
        {children}
      </Modal>
    </div>
  )
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(number)
    : String(value)
}

function formatObservedAt(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function resultStatusFor(kpi) {
  // A KPI without a recorded value has no signal, whatever a stale or partial
  // DTO may say. This is an absence of measurement, not a zero or a breach.
  if (!kpi.latestObservation) return 'NO_SIGNAL'
  return kpi.resultStatus || 'STATUS_UNAVAILABLE'
}

function StatusBadge({ status }) {
  const pill = RESULT_STATUS_PILL[status] || 'pill-planned'
  return <span className={`pill ${pill}`} aria-label={`KPI status: ${status.replace(/_/g, ' ')}`}>{status.replace(/_/g, ' ')}</span>
}

function groupedPerspectives(kpiGroups) {
  const byPerspective = new Map((Array.isArray(kpiGroups) ? kpiGroups : []).map((group) => [group.perspective, group.kpis || []]))
  return BUSINESS_GOAL_PERSPECTIVES.map((perspective) => ({
    perspective,
    label: PERSPECTIVE_LABELS[perspective],
    kpis: byPerspective.get(perspective) || [],
  }))
}

function KpiRow({ kpi, canManage, onEdit, onObserve, onArchive }) {
  const observation = kpi.latestObservation || null
  const status = resultStatusFor(kpi)
  const observedAt = formatObservedAt(observation?.observedAt)
  const unit = kpi.unit ? ` ${kpi.unit}` : ''

  return (
    <article className="space-y-2" data-testid={`business-kpi-${kpi.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-bold">{kpi.name}</h4>
          <p className="mt-0.5 text-[10px] text-muted">
            {kpi.direction === 'UP' ? 'Higher is better' : kpi.direction === 'DOWN' ? 'Lower is better' : kpi.direction || 'Direction unavailable'}
            {' · '}{kpi.cadence ? kpi.cadence.replace(/_/g, ' ').toLowerCase() : 'Cadence unavailable'}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <Kpi
        label="Current"
        value={observation ? `${formatValue(observation.value)}${unit}` : '—'}
        meta={observedAt ? `Observed ${observedAt}` : 'No observation yet'}
        tone={RESULT_STATUS_TONE[status]}
      />

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[var(--surface-muted)] p-2">
          <dt className="text-[9px] font-semibold text-muted">Target</dt>
          <dd className="mt-0.5 text-xs font-bold">{formatValue(kpi.target)}{unit}</dd>
        </div>
        <div className="rounded-lg bg-[var(--surface-muted)] p-2">
          <dt className="text-[9px] font-semibold text-muted">Warning threshold</dt>
          <dd className="mt-0.5 text-xs font-bold">{kpi.warningThreshold === null || kpi.warningThreshold === undefined ? '—' : `${formatValue(kpi.warningThreshold)}${unit}`}</dd>
        </div>
      </dl>

      {!observation && (
        <p className="mt-2 text-[10px] text-muted" role="status">
          NO_SIGNAL · Record an observation to show measured status.
        </p>
      )}
      {canManage && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => onEdit(kpi)} aria-label={`Edit ${kpi.name}`}>
            <Pencil size={11} className="mr-1 inline" aria-hidden /> Edit KPI
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => onObserve(kpi)} aria-label={`Record observation for ${kpi.name}`}>
            <Activity size={11} className="mr-1 inline" aria-hidden /> Record observation
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => onArchive(kpi)} aria-label={`Archive ${kpi.name}`}>
            <Archive size={11} className="mr-1 inline" aria-hidden /> Archive KPI
          </button>
        </div>
      )}
    </article>
  )
}

function errorMessage(message) {
  return <p className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">{message}</p>
}

function kpiFormFrom(kpi) {
  return {
    name: kpi?.name || '',
    perspective: kpi?.perspective || BUSINESS_GOAL_PERSPECTIVES[0],
    unit: kpi?.unit || '',
    target: kpi?.target === null || kpi?.target === undefined ? '' : String(kpi.target),
    warningThreshold: kpi?.warningThreshold === null || kpi?.warningThreshold === undefined ? '' : String(kpi.warningThreshold),
    direction: kpi?.direction || BUSINESS_KPI_DIRECTIONS[0],
    cadence: kpi?.cadence || BUSINESS_KPI_CADENCES[1],
  }
}

function KpiEditorDialog({ businessId, kpi, onClose, onSaved }) {
  const [form, setForm] = useState(() => kpiFormFrom(kpi))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: form.name.trim(),
        perspective: form.perspective,
        unit: form.unit.trim(),
        target: Number(form.target),
        warningThreshold: Number(form.warningThreshold),
        direction: form.direction,
        cadence: form.cadence,
      }
      const path = kpi ? `/api/business/kpis/${encodeURIComponent(kpi.id)}` : '/api/business/kpis'
      await api(path, {
        method: kpi ? 'PATCH' : 'POST',
        body: kpi ? body : { businessId, ...body },
      })
      await onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const title = kpi ? `Edit KPI · ${kpi.name}` : 'Create Business KPI'
  return (
    <ScorecardDialog open title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="KPI name">
          <input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={120} required />
        </Field>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field label="Perspective">
            <select className="input" value={form.perspective} onChange={(event) => set('perspective', event.target.value)} required>
              {BUSINESS_GOAL_PERSPECTIVES.map((perspective) => <option key={perspective} value={perspective}>{PERSPECTIVE_LABELS[perspective]}</option>)}
            </select>
          </Field>
          <Field label="Unit">
            <input className="input" value={form.unit} onChange={(event) => set('unit', event.target.value)} maxLength={32} required />
          </Field>
          <Field label="Target">
            <input className="input" type="number" aria-label="Target" step="any" value={form.target} onChange={(event) => set('target', event.target.value)} required />
          </Field>
          <Field label="Warning threshold" hint={form.direction === 'UP' ? 'Must be below the target.' : 'Must be above the target.'}>
            <input className="input" type="number" aria-label="Warning threshold" step="any" value={form.warningThreshold} onChange={(event) => set('warningThreshold', event.target.value)} required />
          </Field>
          <Field label="Direction">
            <select className="input" value={form.direction} onChange={(event) => set('direction', event.target.value)} required>
              {BUSINESS_KPI_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction === 'UP' ? 'Higher is better' : 'Lower is better'}</option>)}
            </select>
          </Field>
          <Field label="Cadence">
            <select className="input" value={form.cadence} onChange={(event) => set('cadence', event.target.value)} required>
              {BUSINESS_KPI_CADENCES.map((cadence) => <option key={cadence} value={cadence}>{cadence[0]}{cadence.slice(1).toLowerCase()}</option>)}
            </select>
          </Field>
        </div>
        {error ? errorMessage(error) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save KPI'}</button>
        </div>
      </form>
    </ScorecardDialog>
  )
}

function ObservationDialog({ kpi, onClose, onSaved }) {
  const [value, setValue] = useState('')
  const [observedAt, setObservedAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { value: Number(value) }
      if (observedAt) body.observedAt = new Date(observedAt).toISOString()
      await api(`/api/business/kpis/${encodeURIComponent(kpi.id)}/observations`, {
        method: 'POST',
        body,
      })
      await onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScorecardDialog open title={`Record observation · ${kpi.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="mb-3 text-[11px] text-muted">Enter a measured value for {kpi.name}{kpi.unit ? ` (${kpi.unit})` : ''}. Observations are append-only.</p>
        <Field label={`Observed value${kpi.unit ? ` (${kpi.unit})` : ''}`}>
          <input className="input" type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} required />
        </Field>
        <Field label="Observed at (optional)" hint="Leave blank to use the server acceptance time.">
          <input className="input" type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} />
        </Field>
        {error ? errorMessage(error) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record observation'}</button>
        </div>
      </form>
    </ScorecardDialog>
  )
}

export default function BusinessKpiScorecard({ businessId, kpiGroups, canManage = false, loading = false, error = null, retry, onSaved }) {
  const [editingKpi, setEditingKpi] = useState(null)
  const [creating, setCreating] = useState(false)
  const [observingKpi, setObservingKpi] = useState(null)
  const [archiveError, setArchiveError] = useState(null)
  const groups = groupedPerspectives(kpiGroups)
  const hasKpis = groups.some((group) => group.kpis.length > 0)

  const archiveKpi = async (kpi) => {
    if (!window.confirm(`Archive KPI “${kpi.name}”? Existing observations will be retained.`)) return
    setArchiveError(null)
    try {
      await api(`/api/business/kpis/${encodeURIComponent(kpi.id)}`, {
        method: 'PATCH',
        body: { status: 'ARCHIVED' },
      })
      await onSaved?.()
    } catch (err) {
      setArchiveError(err.message)
    }
  }

  return (
    <Card className="mb-4" data-testid="business-kpi-scorecard">
      <div className="mb-3 flex items-start justify-between gap-3">
        <SectionTitle caption="Ongoing Business measures, separate from composite health">Business KPI scorecard</SectionTitle>
        {canManage && !loading && !error && (
          <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => setCreating(true)}>
            <Plus size={12} className="mr-1 inline" aria-hidden /> Add KPI
          </button>
        )}
      </div>
      {loading && <p className="text-xs text-muted" role="status">Loading Business KPIs…</p>}
      {!loading && error && <ErrorState detail={error} retry={retry} />}
      {!loading && !error && (
        <div className="space-y-4">
          {archiveError ? errorMessage(archiveError) : null}
          {!hasKpis && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[10px] text-muted" role="status">
              No Business KPIs yet. No signal is available until KPIs and their observations are recorded.
            </p>
          )}
          {groups.map((group) => (
            <section key={group.perspective} aria-labelledby={`business-kpi-group-${group.perspective}`}>
              <h3 id={`business-kpi-group-${group.perspective}`} className="mb-2 text-[11px] font-bold text-muted">{group.label}</h3>
              {group.kpis.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[10px] text-muted">No KPI in this perspective yet.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {group.kpis.map((kpi) => (
                    <KpiRow
                      key={kpi.id}
                      kpi={kpi}
                      canManage={canManage}
                      onEdit={setEditingKpi}
                      onObserve={setObservingKpi}
                      onArchive={archiveKpi}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {canManage && creating && (
        <KpiEditorDialog
          key="new-business-kpi"
          businessId={businessId}
          kpi={null}
          onClose={() => setCreating(false)}
          onSaved={onSaved}
        />
      )}
      {canManage && editingKpi && (
        <KpiEditorDialog
          key={editingKpi.id}
          businessId={businessId}
          kpi={editingKpi}
          onClose={() => setEditingKpi(null)}
          onSaved={onSaved}
        />
      )}
      {canManage && observingKpi && (
        <ObservationDialog
          key={observingKpi.id}
          kpi={observingKpi}
          onClose={() => setObservingKpi(null)}
          onSaved={onSaved}
        />
      )}
    </Card>
  )
}
