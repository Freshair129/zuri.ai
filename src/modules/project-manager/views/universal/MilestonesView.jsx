'use client'

import { Card, SectionTitle, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { useFetch, LoadingCard } from '../../components/useApi'
import StatusSelect from '../../components/StatusSelect'

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
                  {m.code} · {m.project?.code}
                  {m.workstream ? ` · ${m.workstream.code}` : ''} · weight {m.weight}
                </p>
                <p className="truncate text-xs font-bold">{m.title}</p>
                {m.targetAt && <p className="text-[9px] text-muted">target {new Date(m.targetAt).toLocaleDateString()}</p>}
              </div>
              <StatusSelect entity="milestone" id={m.id} value={m.status} statuses={['PLANNED', 'IN_PROGRESS', 'DONE', 'MISSED']} onChanged={reload} />
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
                    {g.code} · {g.project?.code}
                    {g.workstream ? ` · ${g.workstream.code}` : ''} · {g.required ? 'required' : 'optional'}
                  </small>
                </div>
                <StatusSelect entity="gate" id={g.id} value={g.status} statuses={['OPEN', 'PASSED', 'BLOCKED', 'WAIVED']} onChanged={reload} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
