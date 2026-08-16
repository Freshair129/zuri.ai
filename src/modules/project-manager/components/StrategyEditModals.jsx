'use client'

// @req FR-059 — OWNER-scoped editing surface for Business Strategy: create/edit
// the Business Roadmap and its 2-3 horizons, create/edit Goals, and link/unlink
// Projects to a Goal. The read model stays FR-041's `getBusinessStrategy` — every
// modal here writes, then the caller re-reads through the existing GET.
// @spec BR-001 — every mutation surfaces the server's exact 400/403/409 outcome
// to the OWNER instead of swallowing it (authorization/isolation are enforced by
// business-strategy-mutation-service.js; this file only hides the edit affordance
// from non-OWNER viewers and stays graceful if a 403 arrives anyway).
// @spec NFR-004 — each modal traps focus, closes on Escape, and every field is a
// native <label> wrapping its control (Field from '@/components/ui').
// @tested tests/unit/fr059-strategy-edit-ui.test.js, tests/e2e/fr059-strategy-edit.spec.js

import { useEffect, useRef, useState } from 'react'
import { Modal, Field } from '@/components/ui'
import { GOAL_STATUSES, GOAL_PRIORITIES, ROADMAP_STATUSES } from '@/lib/validation/enums'
import { Trash2 } from 'lucide-react'
import { api } from './useApi'

function toDateInputValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Wraps the shared `Modal` (which only offers a backdrop click and a close
 * button) with the focus management and Escape-to-close NFR-004 requires:
 * initial focus lands on the first real field (not the ✕ button), Tab/Shift+Tab
 * are trapped inside the dialog, Escape closes it, and focus returns to the
 * element that opened it.
 */
function A11yModal({ open, title, onClose, wide, children }) {
  const containerRef = useRef(null)
  // T3b-1 FIX 4: `onClose` is a fresh inline arrow from the parent (page.jsx)
  // on every parent render. The old deps `[open, onClose]` meant every
  // `reload()` after a mutation — while this modal stayed open (LinkProjectModal
  // deliberately does, to link/unlink several Projects in one sitting) — tore
  // this effect down and re-ran it, restoring focus to whatever
  // `document.activeElement` was *at that instant* (React may already have
  // replaced the node the user was on, e.g. after the select's option list
  // changed), which is not the same as leaving focus alone. Measured live:
  // focus was on the select before linking, and on `<body>` after. Reading
  // the latest `onClose` through a ref instead — updated every render, but
  // not a dependency — keeps the effect (and the focus it manages) tied only
  // to `open` actually transitioning, not to the parent re-rendering.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return
      const firstField = container.querySelector('input:not([type="hidden"]), select, textarea')
      const firstFocusable = firstField || container.querySelector(FOCUSABLE_SELECTOR)
      firstFocusable?.focus()
    })

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
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

    // T3b-1 FIX 4 (the other half): a currently-focused element that becomes
    // `disabled` mid-mutation (every submit button here does, via `busy`) is
    // a browser focus fix-up, not a React re-render — it moves focus straight
    // to `document.body`, independent of the effect-teardown issue fixed
    // above, and stays there once the button re-enables (nothing refocuses
    // it). Confirmed empirically: Chromium fires `focusout` on the disabled
    // element but no matching `focusin` for the implicit move to `<body>`, so
    // a `focusin` listener alone cannot catch this — `focusout` is the event
    // that actually fires; the check has to run on the next tick, after the
    // browser's fix-up has landed on `document.activeElement`. While this
    // dialog is open, ending up on `<body>` is always a bug: pull focus back
    // in rather than leaving a still-open modal with focus outside it
    // entirely (LinkProjectModal deliberately stays open across a
    // link/unlink specifically so this needs to keep working).
    function reclaimFocusIfEscapedToBody() {
      setTimeout(() => {
        if (document.activeElement !== document.body) return
        const container = containerRef.current
        const target = container?.querySelector(FOCUSABLE_SELECTOR)
        target?.focus()
      }, 0)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusout', reclaimFocusIfEscapedToBody, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusout', reclaimFocusIfEscapedToBody, true)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [open])

  return (
    <div ref={containerRef}>
      <Modal open={open} title={title} onClose={onClose} wide={wide}>
        {children}
      </Modal>
    </div>
  )
}

function FormError({ message }) {
  if (!message) return null
  return (
    <p className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
      {message}
    </p>
  )
}

function FormInfo({ message }) {
  if (!message) return null
  return (
    <p className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--brand-tint)', color: 'var(--brand-dark)' }} role="status">
      {message}
    </p>
  )
}

// Mirrors business-strategy-mutation-service.js's assertHorizonCardinality /
// assertHorizonsWellFormed client-side, so a malformed submit never leaves the
// editor at all — the 400 those functions throw is still handled below as a
// fallback (a concurrent edit could still make the client-side check stale).
function validateHorizons(rows) {
  if (rows.length < 2 || rows.length > 3) return 'Business roadmap must have 2 or 3 horizons'
  const keys = new Set()
  for (const row of rows) {
    const key = row.key.trim()
    const label = row.label.trim()
    if (!key || !label) return 'Every horizon needs a key and a label'
    if (keys.has(key)) return `Duplicate horizon key "${key}"`
    keys.add(key)
  }
  return null
}

const blankHorizon = (position) => ({ key: '', label: '', description: '', targetAt: '', goalCount: 0, position })

// T3b-1 FIX 2: each row now carries the horizon's real `position` all the way
// from the FR-041 read model through to submit, instead of the modal
// resubmitting the array's own 0-based index as `position` on every save.
// The old `horizons.map((row, index) => ({ ..., position: index }))` rewrote
// the seeded 1/2/3 to 0/1/2 on every save — including a title-only edit that
// never touched the horizons at all — and prisma/seed.js's idempotent
// `roadmapId_position` upsert then collides (P2002) on the very next
// `db:seed`. Exported as pure functions (not inlined in the component) so
// the round-trip — read model -> row state -> submit payload — is directly
// unit-testable without a DOM: see the "Horizon position carry-through"
// describe block in tests/unit/fr059-strategy-edit-ui.test.js.

/** Seed each row's `position` from the real FR-041 horizon it represents. */
export function horizonRowsFromRoadmap(roadmap) {
  return roadmap?.horizons?.length
    ? roadmap.horizons.map((horizon) => ({
        key: horizon.key,
        label: horizon.label,
        description: horizon.description || '',
        targetAt: toDateInputValue(horizon.targetAt),
        goalCount: horizon.goals?.length || 0,
        position: horizon.position,
      }))
    : [blankHorizon(0), blankHorizon(1)]
}

/**
 * A fresh position for a newly-added row: one past the highest position
 * already present among the current rows (existing, untouched horizons keep
 * theirs), so it can never collide with an existing row's real position —
 * whether or not those positions happen to be contiguous.
 */
export function nextHorizonPosition(rows) {
  return rows.reduce((max, row) => Math.max(max, row.position), -1) + 1
}

/** Build the PATCH/POST `horizons` payload, carrying each row's own position. */
export function horizonsPayloadFromRows(rows) {
  return rows.map((row) => ({
    key: row.key.trim(),
    label: row.label.trim(),
    position: row.position,
    description: row.description || null,
    targetAt: row.targetAt || null,
  }))
}

/**
 * Create or edit the Business Roadmap and its 2-3 horizons. `horizons` is
 * reconciled by `key` on the server (FR-059 §3.1): editing a row in place keeps
 * its `id` (and every Goal attached to it) intact; a row whose key is new is
 * inserted; removing a row deletes that horizon only if it carries no Goal.
 */
export function RoadmapModal({ open, onClose, businessId, roadmap, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: roadmap?.title || '',
    description: roadmap?.description || '',
    status: roadmap?.status || 'ACTIVE',
    startAt: toDateInputValue(roadmap?.startAt),
    targetAt: toDateInputValue(roadmap?.targetAt),
  }))
  const [horizons, setHorizons] = useState(() => horizonRowsFromRoadmap(roadmap))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const updateHorizon = (index, patch) => setHorizons((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addHorizon = () => {
    if (horizons.length >= 3) {
      setError('Business roadmap must have 2 or 3 horizons')
      return
    }
    setError(null)
    setHorizons((rows) => [...rows, blankHorizon(nextHorizonPosition(rows))])
  }

  const removeHorizon = (index) => {
    const row = horizons[index]
    if (row.goalCount > 0) {
      setError(`Cannot remove horizon "${row.key}" — it still has ${row.goalCount} goal(s) attached. Move or update those goals first.`)
      return
    }
    if (horizons.length <= 2) {
      setError('Business roadmap must have 2 or 3 horizons')
      return
    }
    setError(null)
    setHorizons((rows) => rows.filter((_, i) => i !== index))
  }

  const submit = async (e) => {
    e.preventDefault()
    const validationError = validateHorizons(horizons)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        title: form.title,
        description: form.description || null,
        status: form.status,
        startAt: form.startAt || null,
        targetAt: form.targetAt || null,
        horizons: horizonsPayloadFromRows(horizons),
      }
      if (roadmap) {
        await api(`/api/business/roadmaps/${roadmap.id}`, { method: 'PATCH', body })
      } else {
        await api('/api/business/roadmaps', { method: 'POST', body: { businessId, ...body } })
      }
      onSaved?.()
      onClose()
    } catch (err) {
      // Surfaces business-strategy-mutation-service.js's message verbatim —
      // duplicate key/position, the horizon-removal-has-goals refusal, and the
      // 403 "Owner permission is required" all land here rather than being
      // swallowed (FR-059 remediation review, §3.1 decision).
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <A11yModal open={open} onClose={onClose} title={roadmap ? `Edit ${roadmap.code}` : 'Create Business Roadmap'} wide>
      <form onSubmit={submit}>
        <Field label="Title">
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {ROADMAP_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Start date">
            <input className="input" type="date" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
          </Field>
          <Field label="Target date">
            <input className="input" type="date" value={form.targetAt} onChange={(e) => set('targetAt', e.target.value)} />
          </Field>
        </div>

        <div className="mb-2 mt-3 flex items-center justify-between">
          <p className="text-[11px] font-bold text-muted">Horizons (2–3 required)</p>
          <button type="button" className="btn px-2 py-1 text-[11px]" onClick={addHorizon} disabled={horizons.length >= 3}>
            + Add horizon
          </button>
        </div>
        <div className="space-y-2">
          {horizons.map((row, index) => (
            <div key={index} className="rounded-xl border border-[var(--border)] p-3">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 max-md:grid-cols-1">
                <Field label="Key">
                  <input
                    className="input"
                    value={row.key}
                    placeholder="e.g. SHORT"
                    aria-label={`Horizon ${index + 1} key`}
                    onChange={(e) => updateHorizon(index, { key: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Label">
                  <input
                    className="input"
                    value={row.label}
                    aria-label={`Horizon ${index + 1} label`}
                    onChange={(e) => updateHorizon(index, { label: e.target.value })}
                    required
                  />
                </Field>
                <div className="flex items-end pb-3">
                  <button
                    type="button"
                    className="btn px-2 py-1.5"
                    onClick={() => removeHorizon(index)}
                    disabled={horizons.length <= 2}
                    aria-label={`Remove horizon ${row.label || index + 1}`}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                <Field label="Description">
                  <input
                    className="input"
                    value={row.description}
                    aria-label={`Horizon ${index + 1} description`}
                    onChange={(e) => updateHorizon(index, { description: e.target.value })}
                  />
                </Field>
                <Field label="Target date">
                  <input
                    className="input"
                    type="date"
                    value={row.targetAt}
                    aria-label={`Horizon ${index + 1} target date`}
                    onChange={(e) => updateHorizon(index, { targetAt: e.target.value })}
                  />
                </Field>
              </div>
              {row.goalCount > 0 && <p className="mt-1 text-[10px] text-muted">{row.goalCount} goal{row.goalCount === 1 ? '' : 's'} attached — this horizon cannot be removed.</p>}
            </div>
          ))}
        </div>

        <FormError message={error} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </A11yModal>
  )
}

/**
 * Create or edit a Goal. `horizonId` is always a real selection — the select
 * never offers a "no horizon" option, because a Goal created without one is
 * invisible to the FR-041 read model (FR-059 §3.2).
 */
export function GoalModal({ open, onClose, businessId, roadmapId, horizons, goal, currentHorizonId, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: goal?.title || '',
    description: goal?.description || '',
    horizonId: currentHorizonId || horizons[0]?.id || '',
    status: goal?.status || 'PLANNED',
    priority: goal?.priority || 'MEDIUM',
    progress: goal?.progress ?? 0,
    startAt: toDateInputValue(goal?.startAt),
    targetAt: toDateInputValue(goal?.targetAt),
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.horizonId) {
      setError('Choose a horizon for this Goal')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        title: form.title,
        description: form.description || null,
        horizonId: form.horizonId,
        status: form.status,
        priority: form.priority,
        progress: Number(form.progress) || 0,
        startAt: form.startAt || null,
        targetAt: form.targetAt || null,
      }
      if (goal) {
        await api(`/api/business/goals/${goal.id}`, { method: 'PATCH', body })
      } else {
        await api('/api/business/goals', { method: 'POST', body: { businessId, roadmapId, ...body } })
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
    <A11yModal open={open} onClose={onClose} title={goal ? `Edit ${goal.code}` : 'Create Goal'}>
      <form onSubmit={submit}>
        <Field label="Title">
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Horizon">
          <select className="input" value={form.horizonId} onChange={(e) => set('horizonId', e.target.value)} required>
            {horizons.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {GOAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {GOAL_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Progress %">
            <input className="input" type="number" min="0" max="100" value={form.progress} onChange={(e) => set('progress', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="Start date">
            <input className="input" type="date" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
          </Field>
          <Field label="Target date">
            <input className="input" type="date" value={form.targetAt} onChange={(e) => set('targetAt', e.target.value)} />
          </Field>
        </div>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </A11yModal>
  )
}

/**
 * Link/unlink Projects on a Goal. Re-linking an already-linked Project comes
 * back as a 409 (FR-059 §4.3) — treated as a normal, non-alarming outcome (the
 * list is refreshed instead of showing a red error), not a crash.
 */
export function LinkProjectModal({ open, onClose, goal, projects, onSaved }) {
  const linkedIds = new Set((goal.projects || []).map((p) => p.id))
  const available = (projects || []).filter((p) => !linkedIds.has(p.id))
  const [selectedProjectId, setSelectedProjectId] = useState(available[0]?.id || '')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  // This modal deliberately stays open across a link/unlink (so the OWNER can
  // work through several Projects in one sitting) while `goal` keeps updating
  // from the freshly-reloaded strategy after every mutation. Once linked, the
  // selection is no longer a valid choice in `available` — drop it back to the
  // new first option rather than leaving a stale, already-linked id selected.
  useEffect(() => {
    if (!available.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(available[0]?.id || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.map((p) => p.id).join(',')])

  const link = async () => {
    if (!selectedProjectId) return
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await api(`/api/business/goals/${goal.id}/projects`, { method: 'POST', body: { projectId: selectedProjectId } })
      onSaved?.()
    } catch (err) {
      // T3b-1 FIX 6: keyed on the HTTP status api() now attaches, not on
      // message text — a server-message reword would otherwise silently
      // degrade this to a generic red error instead of the intended calm one.
      if (err.status === 409) {
        // A normal outcome (FR-059 §2), not a fault: someone else linked it
        // first. Refresh instead of alarming the OWNER with a red error.
        setInfo('This Project is already linked to the Goal.')
        onSaved?.()
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (projectId) => {
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await api(`/api/business/goals/${goal.id}/projects/${projectId}`, { method: 'DELETE' })
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <A11yModal open={open} onClose={onClose} title={`Link Projects · ${goal.code}`}>
      <div>
        <p className="mb-1 text-[11px] font-bold text-muted">Linked projects</p>
        {(goal.projects || []).length === 0 && <p className="mb-3 text-[11px] text-muted">No Project linked yet.</p>}
        <div className="mb-3 space-y-1.5">
          {(goal.projects || []).map((project) => (
            <div key={project.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] p-2 text-[11px]">
              <span>{project.code} · {project.name}</span>
              <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => unlink(project.id)} disabled={busy}>
                Unlink
              </button>
            </div>
          ))}
        </div>
        <Field label="Link a project">
          <select className="input" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} disabled={available.length === 0}>
            {available.length === 0
              ? <option value="">No unlinked Projects in this Business</option>
              : available.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </Field>
        <FormError message={error} />
        <FormInfo message={info} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={link} disabled={busy || !selectedProjectId}>
            {busy ? 'Linking…' : 'Link'}
          </button>
        </div>
      </div>
    </A11yModal>
  )
}
