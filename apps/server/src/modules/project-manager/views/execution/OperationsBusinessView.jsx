'use client'

import Link from 'next/link'
import { useScope } from '@/context/ScopeContext'
import { Card, EmptyState, ErrorState, PageHeader, ProgressBar, StatusPill } from '@/components/ui'
import { formatProgressPercent } from '../../progress/strategies'
import { LoadingCard, useFetch } from '../../components/useApi'
import { buildOperationsWorkstreamViewModel } from './operations-business-read-model'

function EvidenceSummary({ result }) {
  const evidence = result.evidence || {}
  const metrics = []
  if (Number.isFinite(evidence.slaMet) && Number.isFinite(evidence.slaTotal)) {
    metrics.push(`SLA checks met ${evidence.slaMet}/${evidence.slaTotal}`)
  }
  if (Number.isFinite(evidence.incidents)) metrics.push(`Incidents ${evidence.incidents}`)
  if (Number.isFinite(evidence.itemCount)) metrics.push(`Tracked items ${evidence.itemCount}`)
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 text-xs">
      <p className="font-semibold">Progress evidence</p>
      {metrics.length > 0
        ? <p className="mt-1 text-muted">{metrics.join(' · ')}</p>
        : <p className="mt-1 text-muted">No Operations evidence metrics are recorded for this workstream.</p>}
      <p className="mt-1 text-[11px] text-muted">No linked evidence reference is exposed in the current PM record.</p>
      {(result.warnings || []).length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-[11px] text-muted">
          {result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
        </ul>
      )}
    </div>
  )
}

function OperationsWorkstream({ workstream }) {
  const { progress: result, earliestRecordedTargetAt: due, project } = buildOperationsWorkstreamViewModel(workstream)
  return (
    <Card id={`workstream-${workstream.id}`} className="mb-4 scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] text-muted">{workstream.code} · {workstream.progressStrategy?.replace(/_/g, ' ') || 'Operations progress'}</p>
          <h2 className="font-bold">{workstream.name}</h2>
          <p className="mt-1 text-xs text-muted">
            Project: {project?.code || project?.name || 'Project'}
            {due ? ` · Earliest recorded target ${due.toLocaleDateString()}` : ' · No target date recorded'}
          </p>
        </div>
        <StatusPill status={workstream.status} />
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-bold">{formatProgressPercent(result.percent)}</span>
        <span className="text-xs text-muted">calculated from the existing {workstream.progressStrategy?.replace(/_/g, ' ')} strategy</span>
      </div>
      <div className="mt-2"><ProgressBar percent={result.percent} label={`${workstream.name} progress`} /></div>
      <EvidenceSummary result={result} />
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        {project?.id && (
          <Link className="font-semibold text-[var(--accent)] hover:underline" href={`/projects/${project.id}`}>
            Open owning project
          </Link>
        )}
        {project?.id && (
          <Link className="font-semibold text-[var(--accent)] hover:underline" href={`/projects/${project.id}/execution/operations#workstream-${workstream.id}`}>
            Open project Workstream
          </Link>
        )}
      </div>
    </Card>
  )
}

export default function OperationsBusinessView() {
  const { shell, currentBusiness, loaded } = useScope()
  const businessId = shell.activeBusinessId || null
  const businessQuery = businessId ? `&businessId=${encodeURIComponent(businessId)}` : ''
  const { data, loading, error, reload } = useFetch(
    businessId ? `/api/workstreams?executionMode=OPERATIONS${businessQuery}` : null,
    [],
    businessId,
  )

  return (
    <div>
      <PageHeader
        eyebrow="Work Management · Execution"
        title="Operations"
        subtitle={currentBusiness ? `Read-only Operations workstreams for ${currentBusiness.name}.` : 'Operations workstreams for the selected Business.'}
      />
      {!loaded && <LoadingCard />}
      {loaded && !businessId && (
        <EmptyState title="Select a Business" hint="Choose a Business in the scope selector to view its Operations workstreams." />
      )}
      {businessId && loading && <LoadingCard />}
      {businessId && error && <ErrorState detail={error} retry={reload} />}
      {businessId && !loading && !error && (!data || data.length === 0) && (
        <EmptyState title="No Operations workstreams" hint="This Business has no workstreams using the Operations execution mode." />
      )}
      {businessId && !loading && !error && (data || []).map((workstream) => (
        <OperationsWorkstream key={workstream.id} workstream={workstream} />
      ))}
    </div>
  )
}
