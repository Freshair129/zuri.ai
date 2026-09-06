'use client'

// @req FR-014 — the immutable audit event browser: filter by entityType and
// list occurredAt/action/actorType/payload from /api/audit.
// @req FR-046 — the API this page reads is a deliberate installation-wide
// read (see src/app/api/audit/route.js). This page is mounted inside the
// per-Business shell, so it must say that its rows are not scoped to the
// active Business — never add a Business filter here, that would contradict
// the requirement the API implements.
// @tested tests/e2e/smoke.spec.js, tests/unit/audit-page.test.js
import { useState } from 'react'
import { PageHeader, DataTable, StatusPill, EmptyState, ErrorState, TruncationNotice } from '@/components/ui'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'

// The filter's options come from the LOG, not from a list kept here.
//
// This used to be six values derived from `DEPENDENCY_ENDPOINT_TYPES` plus ten
// spelled out by hand. That covered 15 of the 57 entityTypes this codebase
// writes, and the gap was not academic: of the seven types actually present in
// production, four could not be filtered for — PERSON among them, the second
// most common. A partial filter on an audit log is worse than none, because a
// type that is missing from the dropdown looks exactly like a type that never
// happened.
//
// Deriving from one enum was the right instinct (SDD-002) applied to too small
// a source. `AuditEvent.entityType` has no single enum behind it and cannot
// have one: it is written by every domain's write service and it names
// categories that are not models at all (SNAPSHOT, STEP_UP, AGENT_ACTION). The
// only complete source is the table, so the API returns what is in it.
//
// This also removes a failure the old list could not avoid — offering an option
// that matches zero rows, which is indistinguishable from a broken filter.

// Payload fields come from every domain's write service (project, work item,
// goal, membership, ...), so there is no single enum list this page could
// hand-copy to label them — that list would be incomplete the day it was
// written and stale the day after, which is exactly what happened to the
// entityType filter above before it was derived from the log. Instead this
// reuses the one thing every enum in this codebase already has in common: it
// is written as SCREAMING_SNAKE_CASE (enforced for audit entityTypes by
// preflight `audit-entity-type`). That is the same underscore-replacement idiom the
// entityType column and StatusPill already apply on this page — extended to
// payload values that have the same shape, whichever domain wrote them.
const ENUM_LIKE_VALUE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/

// Exported (not just used internally) so the behaviour below is testable
// directly, without a DOM: this project's client components run under a node
// test environment with no DOM (see repositories-page-ui-contract.test.js),
// so these pure functions are the real, checkable render surface for the
// payload column — the JSX in PayloadSummary is just wiring on top of them.
export function humanizeEnumLikeValue(value) {
  return ENUM_LIKE_VALUE.test(value) ? value.replace(/_/g, ' ') : value
}

// "oldStatus" / "old_status" -> "Old status" — sentence case, matching the
// rest of this page's labels ("Filter by entity type", "All entity types").
export function humanizeFieldKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : String(key)
}

// A payload value can be anything a write service chose to record. This never
// throws and never collapses to "[object Object]" — an unrecognized shape
// degrades to a readable string instead.
export function formatPayloadValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return humanizeEnumLikeValue(value)
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatPayloadValue(item)).join(', ') : '[]'
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

// Discriminates a payload into exactly what PayloadSummary needs to render,
// with no JSX in it — so a test can call this directly with a real payload
// shape and assert on the result, instead of asserting on rendered markup or
// on prose. Never throws: an unrecognized shape comes back as `{ kind: 'raw' }`
// rather than propagating an exception.
//   'empty' — nothing to show (null/undefined/{})
//   'fields' — the normal case: an array of { label, value } pairs
//   'raw'    — payload was not the plain object recordAudit() writes (a
//              string, number, boolean, or array) — still legible, never
//              "[object Object]"
export function describePayload(payload) {
  try {
    if (payload === null || payload === undefined) {
      return { kind: 'empty' }
    }
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      return { kind: 'raw', text: formatPayloadValue(payload) }
    }
    const entries = Object.entries(payload)
    if (entries.length === 0) {
      return { kind: 'empty' }
    }
    return {
      kind: 'fields',
      fields: entries.map(([key, value]) => ({ label: humanizeFieldKey(key), value: formatPayloadValue(value) })),
    }
  } catch {
    return { kind: 'raw', text: '(unreadable payload)' }
  }
}

// Renders "what changed" — the fields in the payload and their (humanized)
// values — instead of a raw, CSS-truncated JSON string. A payload that is not
// the plain object recordAudit() normally writes (null, a primitive, an
// array) still renders as legible text rather than crashing or vanishing.
function PayloadSummary({ payload }) {
  const described = describePayload(payload)
  if (described.kind === 'empty') {
    return <span className="text-muted">—</span>
  }
  if (described.kind === 'raw') {
    return <span className="text-[9px] text-muted">{described.text}</span>
  }
  return (
    <dl className="m-0 grid gap-0.5 text-[9px] text-muted">
      {described.fields.map(({ label, value }) => (
        <div key={label} className="flex gap-1">
          <dt className="shrink-0 font-semibold">{label}:</dt>
          <dd className="m-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The filter's options, from the facet the API returned.
 *
 * Exported for the same reason the payload formatters are: this project's
 * client components run under a node test environment with no DOM, so a pure
 * function is the real checkable surface.
 *
 * Two things it has to get right that a plain `.map()` would not:
 *
 *  - **Before the first response there is no facet.** Returning only "All
 *    entity types" is correct — the page is still loading and has nothing to
 *    offer yet. Inventing a placeholder list would show options that may not
 *    exist.
 *  - **The selected value must survive.** The page refetches with
 *    `?entityType=`, and a facet that arrived without the current selection
 *    (a row deleted between renders, or a hand-typed URL) would silently reset
 *    the `<select>` to "All" while the list below stayed filtered. It is kept
 *    as an option, marked so an operator can see why it shows nothing.
 */
export function buildEntityTypeOptions(facets, selected = '') {
  const rows = Array.isArray(facets) ? facets : []
  const options = [{ value: '', label: 'All entity types' }]
  for (const row of rows) {
    if (!row || typeof row.value !== 'string' || !row.value) continue
    const count = Number.isFinite(row.count) ? row.count : null
    options.push({
      value: row.value,
      label: count === null ? humanizeEnumLikeValue(row.value) : `${humanizeEnumLikeValue(row.value)} (${count})`,
    })
  }
  if (selected && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: `${humanizeEnumLikeValue(selected)} (0)` })
  }
  return options
}

export default function AuditPage() {
  const [entityType, setEntityType] = useState('')
  const url = entityType ? `/api/audit?entityType=${entityType}&limit=200` : '/api/audit?limit=200'
  const { data, loading, error, reload } = useFetch(url, [entityType])

  return (
    <div>
      <PageHeader
        eyebrow="Audit"
        title="Audit Log"
        subtitle="Immutable event stream for meaningful state changes — creations, updates, imports, restores."
      />
      {/* @req FR-046 — this page is mounted inside the per-Business shell (see
          the Business breadcrumb above), but the API it reads is a deliberate
          installation-wide read: every row below spans every Business the
          viewer can see, not only the one currently selected. Do not add a
          Business filter to "fix" this — that would contradict FR-046. */}
      <p className="mb-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--warn-bg, var(--brand-tint))', color: 'var(--warn, var(--brand-dark))' }} role="note">
        This log is installation-wide by design: it lists events across every Business you can see, not only the Business shown above.
      </p>
      <div className="mb-3">
        <select className="input w-auto" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Filter by entity type">
          {buildEntityTypeOptions(data?.entityTypes, entityType).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {/* @req FR-014 — this page asks for 200 and the service caps at 500; both
          were silent. An audit log is consulted to answer "did this happen?",
          so an unmarked window turns "not in the visible 200" into "never". */}
      {!loading && !error && data?.truncated && (
        <TruncationNotice limit={data.limit} noun="events" hint="Filter by entity type to narrow the stream." />
      )}
      {!loading && !error && (
        <DataTable
          columns={[
            { key: 'occurredAt', label: 'When', render: (e) => new Date(e.occurredAt).toLocaleString() },
            { key: 'entityType', label: 'Entity', render: (e) => e.entityType.replace(/_/g, ' ') },
            { key: 'action', label: 'Action', render: (e) => <StatusPill status={e.action} /> },
            { key: 'actorType', label: 'Actor' },
            {
              key: 'payload',
              label: 'Payload',
              render: (e) => (
                <div className="max-w-md">
                  <PayloadSummary payload={e.payload} />
                </div>
              ),
            },
          ]}
          rows={data?.events || []}
          rowKey={(e) => e.id}
          empty={<EmptyState title="No audit events" hint="Events appear as soon as you create or change anything." />}
        />
      )}
    </div>
  )
}
