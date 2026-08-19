'use client'

// @req FR-006 — one component serves both scopes FR-006 declares: the global
// Milestones & Gates browser at `/milestones` and the project-scoped one at
// `/projects/{id}/milestones`. The `projectId` prop is that scope.
// @spec NFR-008 — the drill-down link's text is a bare project code inside a
// dense meta line; it carries an explicit label naming its destination, since
// "PRJ-B01-TRANSFORM" on its own describes nothing to a screen reader.
// @tested tests/unit/global-view-drilldown.test.js

import Link from 'next/link'
import { Card, SectionTitle, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { useFetch, LoadingCard } from '../../components/useApi'
import StatusSelect from '../../components/StatusSelect'
import { MILESTONE_STATUSES, GATE_STATUSES } from '@/lib/validation/enums'

/**
 * The project code in a milestone's or a gate's meta line.
 *
 * @req FR-006 — in GLOBAL scope this is the drill-down into the same view
 * scoped to that project, closing the downward half of the scope navigation
 * (the project-scoped page already carries an "All projects" button upward).
 *
 * In PROJECT scope it stays plain text. Unlike All Work — where the whole
 * Project column is dropped — the code here shares one meta line with the
 * milestone code, its workstream and its weight, so removing it would leave a
 * ragged `MS-x ·  · weight 2`. It is kept as a label and simply not linked: a
 * link would only ever lead to the page the reader is already on.
 *
 * The id is checked, never assumed. A row that arrives without its project
 * relation degrades to text rather than emitting `/projects/undefined/...`,
 * a link that looks live and 404s on click.
 */
export function projectCodeCell(row, { projectId } = {}) {
  const code = row?.project?.code || ''
  const id = row?.project?.id
  if (projectId || !code || !id) return code
  return (
    <Link
      className="underline hover:text-brand-dark"
      href={`/projects/${id}/milestones`}
      aria-label={`View milestones and gates in project ${code}`}
    >
      {code}
    </Link>
  )
}

export default function MilestonesView({ projectId }) {
  const url = projectId ? `/api/milestones?projectId=${projectId}` : '/api/milestones'
  const { data, loading, error, reload } = useFetch(url)

  if (loading) return <LoadingCard />
  if (error) return <ErrorState detail={error} retry={reload} />
  const { milestones = [], gates = [] } = data || {}

  return (
    <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
      <Card>
        <SectionTitle caption="Weighted checkpoints toward delivery">Milestones</SectionTitle>
        {milestones.length === 0 && <EmptyState title="No milestones" hint="Milestones mark weighted checkpoints." />}
        <div className="space-y-2">
          {milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] text-muted">
                  {m.code} · {projectCodeCell(m, { projectId })}
                  {m.workstream ? ` · ${m.workstream.code}` : ''} · weight {m.weight}
                </p>
                <p className="truncate text-xs font-bold">{m.title}</p>
                {m.targetAt && <p className="text-[9px] text-muted">target {new Date(m.targetAt).toLocaleDateString()}</p>}
              </div>
              <StatusSelect entity="milestone" id={m.id} value={m.status} statuses={MILESTONE_STATUSES} onChanged={reload} />
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <SectionTitle caption="Quality/approval gates that guard progress">Gates</SectionTitle>
        {gates.length === 0 && <EmptyState title="No gates" hint="Gates guard readiness — required gates cap progress." />}
        <div className="space-y-2">
          {gates.map((g) => (
            <div key={g.id} className={`gate-row ${g.status === 'PASSED' ? 'done' : g.status === 'BLOCKED' ? 'blocked' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <b className="block truncate text-[11px]">{g.title}</b>
                  <small className="text-muted">
                    {g.code} · {projectCodeCell(g, { projectId })}
                    {g.workstream ? ` · ${g.workstream.code}` : ''} · {g.required ? 'required' : 'optional'}
                  </small>
                </div>
                <StatusSelect entity="gate" id={g.id} value={g.status} statuses={GATE_STATUSES} onChanged={reload} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
