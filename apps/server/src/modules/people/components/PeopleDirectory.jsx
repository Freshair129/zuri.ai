'use client'

// @req FR-042 - HR / People peer domain directory.
// @req FR-193 - the roster is Employment (who works here); "system access" is
// a column derived from Membership, shown but never the roster's source. This
// component also OWNS the write path: ADR-078 D1 moved the roster onto
// Employment and `employment-service.js` shipped all four lifecycle
// operations, but nothing called them and this page had no control that wrote
// — so on a real installation the directory sat empty telling the owner to
// "add an Employment record" with no way to add one.
// @spec ADR-013, ADR-078 D1, BR-034, SDD-093, SDD-020 - People is Business-scoped; Project Team stays in Development.
// @tested tests/unit/people-directory.test.js

import { useState } from 'react'
import { UserPlus, UserRound, Users } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, Kpi, Modal, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
// Imported, never re-typed: `enums.js` is the single source of truth and a
// hand-copied list is a preflight CRITICAL precisely because it drifts from
// the validator silently (CLAUDE.md).
import { EMPLOYMENT_TYPES } from '@/lib/validation/enums'

export default function PeopleDirectory({ directoryOnly = false }) {
  const scope = useScope()
  // BusinessShellGuard resolves BUSINESS_REQUIRED/FORBIDDEN and redirects to
  // `/businesses` before this component mounts, so an authorized
  // `activeBusinessId` is a precondition here (FR-044; ADR-015 Consequences).
  const businessId = scope.shell.activeBusinessId
  const { data, loading, error, reload } = useFetch(
    businessId ? `/api/people?businessId=${encodeURIComponent(businessId)}` : null,
    [businessId],
  )

  const [draft, setDraft] = useState(null)
  const [removal, setRemoval] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  // A failed mutation is shown, never swallowed — the defect the preflight
  // `client-mutation` check exists to stop (CLAUDE.md).
  const [actionError, setActionError] = useState(null)

  async function run(work) {
    setBusy(true)
    setActionError(null)
    try {
      await work()
      setDraft(null)
      setRemoval(null)
      reload()
    } catch (err) {
      setActionError(err?.message || 'The change did not go through.')
    } finally {
      setBusy(false)
    }
  }

  const create = (form) =>
    run(() =>
      api('/api/people/employment', {
        method: 'POST',
        body: {
          personId: form.personId,
          businessId,
          tenantId: data.business.tenantId ?? scope.shell.activeBusiness?.tenantId,
          title: form.title || null,
          employeeNo: form.employeeNo || null,
          employmentType: form.employmentType,
        },
      }),
    )

  const transition = (employmentId, action, reason) =>
    run(() =>
      api(`/api/people/employment/${encodeURIComponent(employmentId)}`, {
        method: 'PATCH',
        body: { action, ...(reason ? { reason } : {}) },
      }),
    )

  // @req FR-191, FR-193 — one explicit grant or one Employment, separately.
  // @spec ADR-082, BR-034 — server-derived capabilities control visibility;
  // the lifecycle services also enforce them on every request.
  // @tested tests/e2e/fr193-access-members.spec.js
  const remove = () => removal.kind === 'membership'
    ? run(() => api(`/api/platform/users/memberships/${encodeURIComponent(removal.grantId)}/lifecycle`, {
      method: 'POST', body: { action: 'REVOKE', reason: removal.reason.trim() },
    }))
    : transition(removal.employmentId, 'end', removal.reason.trim())

  const employmentRows = data?.people.filter((entry) => showHistory || entry.status !== 'ENDED') ?? []

  return (
    <div>
      <PageHeader
        eyebrow="HR / People"
        title={directoryOnly ? 'People Directory' : `${scope.shell.activeBusiness?.name || 'Business'} People`}
        subtitle="Members with access to this Business and their separate employment records."
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && data && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Kpi label="Employment" value={data.summary.peopleCount} meta="employment records in this Business" />
            <Kpi label="Active" value={data.summary.activeCount} meta="currently working" />
            <Kpi label="On leave" value={data.summary.onLeaveCount} meta="temporarily away" />
            <Kpi
              label="Members with access"
              value={data.summary.accessMemberCount}
              meta="via organization or Business membership"
            />
          </div>

            <Card>
              <SectionTitle caption="Members with organization-wide access or access to this Business. Employment can be added separately when needed.">
                Members with access ({data.summary.accessMemberCount})
              </SectionTitle>
              {data.accessMembers.length === 0 ? (
                <EmptyState title="No members with access" hint="Members granted access to this Business or its organization will appear here." />
              ) : <ul className="divide-y divide-[var(--border)]">
                {data.accessMembers.map(({ person, hasOpenEmployment, employmentStatus, grants }) => (
                  <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="text-xs">
                      <span className="block font-bold">{person.displayName}</span>
                      <span className="block text-muted">{person.email || person.code}</span>
                    </span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-muted">{hasOpenEmployment ? `Employment: ${employmentStatus}` : 'No open Employment'}</span>
                      {!hasOpenEmployment && data.canManageEmployment && (
                        <button
                          type="button"
                          disabled={busy}
                          className="btn btn-ghost text-xs"
                          aria-label={`Add Employment for ${person.displayName}`}
                          onClick={() => setDraft({ personId: person.id, displayName: person.displayName, employmentType: 'EMPLOYEE', title: '', employeeNo: '' })}
                        >
                          <UserPlus size={12} aria-hidden /> Add Employment
                        </button>
                      )}
                      {grants.some((grant) => grant.canRemove) && (
                        <button type="button" disabled={busy} className="btn btn-ghost text-xs"
                          aria-label={`Remove access for ${person.displayName}`}
                          onClick={() => {
                            setActionError(null)
                            setRemoval({ kind: 'membership', displayName: person.displayName, grants, grantId: grants.find((grant) => grant.canRemove).id, reason: '' })
                          }}>
                          Remove
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>}
            </Card>

          {actionError && <ErrorState detail={actionError} retry={() => setActionError(null)} />}

          <Card>
            <SectionTitle caption="Open employment records. Removed records are retained in history. Changes here do not change a member's system access.">
              Employment
            </SectionTitle>
            {data.summary.endedCount > 0 && (
              <label className="mb-3 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
                Show employment history ({data.summary.endedCount})
              </label>
            )}
            {employmentRows.length === 0 ? (
              <EmptyState
                title={data.people.length ? 'No open Employment records' : 'No Employment records in this Business'}
                hint={
                  data.people.length ? 'Select Show employment history to view ended records.' : data.summary.accessWithoutEmploymentCount > 0
                    ? 'Nobody has an employment record yet. The people with access are listed above — pick one to create their record.'
                    : 'Create an employment record when workforce data is ready.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2 py-2">Person</th>
                      <th className="px-2 py-2">Title</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Branch</th>
                      <th className="px-2 py-2">System access</th>
                      <th className="px-2 py-2">Employment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employmentRows.map((entry) => (
                      <tr key={entry.employmentId} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-dark)]" aria-hidden>
                              <UserRound size={14} />
                            </span>
                            <span>
                              <span className="block font-bold">{entry.person.displayName}</span>
                              <span className="block text-[10px] text-muted">{entry.person.email || entry.person.code}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-3">{entry.title || '—'}</td>
                        <td className="px-2 py-3">{entry.employmentType}</td>
                        <td className="px-2 py-3"><span className="pill pill-planned">{entry.status}</span></td>
                        <td className="px-2 py-3">{entry.branch?.name || '—'}</td>
                        <td className="px-2 py-3">{entry.hasSystemAccess ? 'Yes' : 'No'}</td>
                        <td className="px-2 py-3">
                          {entry.status === 'ENDED' ? (
                            // Terminal on purpose: a re-hire is a new row, not a
                            // reopened one (ADR-078 D1).
                            <span className="text-muted">ended</span>
                          ) : (
                            <span className="flex gap-1">
                              {data.canManageEmployment && (entry.status === 'ACTIVE' ? (
                                <button type="button" disabled={busy} className="btn btn-ghost text-[11px]" onClick={() => transition(entry.employmentId, 'on_leave')}>
                                  On leave
                                </button>
                              ) : (
                                <button type="button" disabled={busy} className="btn btn-ghost text-[11px]" onClick={() => transition(entry.employmentId, 'reinstate')}>
                                  Reinstate
                                </button>
                              ))}
                              {data.canRemoveEmployment && <button
                                type="button"
                                disabled={busy}
                                className="btn btn-ghost text-[11px]"
                                aria-label={`Remove Employment for ${entry.person.displayName}`}
                                onClick={() => {
                                  setActionError(null)
                                  setRemoval({ kind: 'employment', employmentId: entry.employmentId, displayName: entry.person.displayName, reason: '' })
                                }}
                              >
                                Remove
                              </button>}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="mt-3 flex items-center gap-1 text-[10px] text-muted"><Users size={12} aria-hidden /> Project Team is a separate Project-local view.</p>

          <Modal open={Boolean(removal)} title={removal?.kind === 'membership' ? 'Remove member access' : 'Remove Employment'} onClose={() => { if (!busy) setRemoval(null) }}>
            {removal && <form onSubmit={(event) => { event.preventDefault(); remove() }}>
              <p className="mb-3 text-sm font-bold">{removal.displayName}</p>
              {removal.kind === 'membership' ? <>
                <Field label="Access grant">
                  <select aria-label="Access grant" className="input" value={removal.grantId} disabled={busy}
                    onChange={(event) => setRemoval({ ...removal, grantId: event.target.value })}>
                    {removal.grants.map((grant) => <option key={grant.id} value={grant.id} disabled={!grant.canRemove}>
                      {grant.scopeType === 'TENANT' ? 'Organization — all businesses' : 'This Business'} · {grant.role}{!grant.canRemove ? ' (organization owner required)' : ''}
                    </option>)}
                  </select>
                </Field>
                <p className="mb-3 text-xs text-muted">
                  {removal.grants.find((grant) => grant.id === removal.grantId)?.scopeType === 'TENANT'
                    ? 'This withdraws the selected organization-wide membership across all businesses in this organization.'
                    : 'This withdraws the selected membership for this Business.'}
                  {' '}Dependent access roles are also withdrawn. Other memberships or platform grants may still provide access. Employment stays unchanged.
                </p>
              </> : <p className="mb-3 text-xs text-muted">
                This ends the Employment and moves it to history. Membership and system access stay unchanged. A later re-hire creates a new record.
              </p>}
              <Field label="Reason">
                <textarea className="input" required maxLength={500} disabled={busy} value={removal.reason}
                  onChange={(event) => setRemoval({ ...removal, reason: event.target.value })} />
              </Field>
              {actionError && <ErrorState detail={actionError} retry={() => setActionError(null)} />}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRemoval(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !removal.reason.trim()}>{busy ? 'Removing…' : 'Confirm Remove'}</button>
              </div>
            </form>}
          </Modal>

          <Modal open={Boolean(draft)} title="New employment record" onClose={() => setDraft(null)}>
            {draft && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  create(draft)
                }}
              >
                <p className="mb-3 text-xs text-muted">
                  Creating an employment record for <b>{draft.displayName}</b>. This records that they work
                  here; it grants no access of its own, and changes nothing about the Membership they already hold.
                </p>
                <Field label="Title">
                  <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="เช่น ผู้จัดการร้าน" />
                </Field>
                <Field label="Employee number" hint="Optional. The HR identifier this Business already uses.">
                  <input className="input" value={draft.employeeNo} onChange={(e) => setDraft({ ...draft, employeeNo: e.target.value })} />
                </Field>
                <Field label="Employment type">
                  <select className="input" value={draft.employmentType} onChange={(e) => setDraft({ ...draft, employmentType: e.target.value })}>
                    {EMPLOYMENT_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </Field>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create record'}</button>
                </div>
              </form>
            )}
          </Modal>
        </>
      )}
    </div>
  )
}
