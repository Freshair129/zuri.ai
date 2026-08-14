'use client'

// Wrapper for one execution mode: lists matching workstreams (optionally
// scoped to a project), shows strategy-based progress with explanation, and
// renders the mode-specific body over the neutral core model.

import { useMemo } from 'react'
import Link from 'next/link'
import { PageHeader, Card, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS } from '@/lib/validation/enums'
import { useFetch, LoadingCard } from '../../components/useApi'
import ProgressExplain from '../../components/ProgressExplain'
import { MODE_BODIES } from './mode-bodies'

const MODE_VOCAB = {
  SOFTWARE_SPRINT: 'Release → Sprint → Epic → Task/Bug',
  DATA_MIGRATION: 'Stage → Batch → Dataset → Validation → Reconciliation',
  B2B_SALES: 'Pipeline → Stage → Account → Deal → Activity',
  B2C_CAMPAIGN: 'Campaign → Wave → Channel → Creative/Experiment',
  PRODUCT_LAUNCH: 'Phase → Milestone → Deliverable → Gate',
  OPERATIONS: 'Period → Process → Run → Checklist/Issue/SLA',
  BUSINESS_EXPANSION: 'Initiative → Site → Milestone → Approval → Go-live',
}

function hydrate(ws) {
  const parse = (s) => {
    try { return JSON.parse(s || '{}') } catch { return {} }
  }
  return {
    ...ws,
    viewConfig: parse(ws.viewConfigJson),
    items: (ws.items || []).map((i) => ({ ...i, metrics: parse(i.metricDataJson), metadata: parse(i.metadataJson) })),
    containers: (ws.containers || []).map((c) => ({ ...c, metadata: parse(c.metadataJson) })),
  }
}

function WorkstreamPanel({ workstream, reload }) {
  const ws = useMemo(() => hydrate(workstream), [workstream])
  const progress = useFetch(`/api/progress/workstream/${ws.id}`, [ws.updatedAt, ws.items.length])
  const Body = MODE_BODIES[ws.executionMode]

  const reloadAll = () => {
    reload()
    progress.reload()
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-start justify-between gap-3 max-md:flex-col">
        <div>
          <p className="text-[9px] text-muted">
            {ws.code} · {ws.project ? `${ws.project.code} · ` : ''}strategy {ws.progressStrategy.replace(/_/g, ' ')} · weight {ws.progressWeight}
          </p>
          <h2 className="text-sm font-bold">{ws.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={ws.status} />
        </div>
      </div>
      <div className="mb-4">
        {progress.loading ? (
          <p className="text-[10px] text-muted">Calculating progress…</p>
        ) : progress.error ? (
          <p className="text-[10px]" style={{ color: 'var(--danger)' }}>{progress.error}</p>
        ) : (
          <ProgressExplain result={progress.data} />
        )}
      </div>
      {Body ? <Body workstream={ws} reload={reloadAll} progress={progress.data} /> : null}
    </Card>
  )
}

export default function ExecutionModeView({ mode, projectId }) {
  const query = projectId ? `/api/workstreams?executionMode=${mode}&projectId=${projectId}` : `/api/workstreams?executionMode=${mode}`
  const { data, loading, error, reload } = useFetch(query)

  return (
    <div>
      <PageHeader
        eyebrow={`Execution · ${MODE_VOCAB[mode]}`}
        title={MODE_LABELS[mode]}
        subtitle={`Workstreams running in ${MODE_LABELS[mode]} mode${projectId ? ' within this project' : ' across your scope'}.`}
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState
          title={`No ${MODE_LABELS[mode]} workstreams yet`}
          hint="Import an agent PlanEnvelope with this execution mode."
          action={
            <Link className="btn btn-primary" href="/projects">
              Go to projects
            </Link>
          }
        />
      )}
      {(data || []).map((ws) => (
        <WorkstreamPanel key={ws.id} workstream={ws} reload={reload} />
      ))}
    </div>
  )
}
