'use client'

// Wrapper for one execution mode: lists matching workstreams (optionally
// scoped to a project), shows strategy-based progress with explanation, and
// renders the mode-specific body over the neutral core model.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { PageHeader, Card, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS } from '@/lib/validation/enums'
import { useFetch, LoadingCard } from '../../components/useApi'
import ProgressExplain from '../../components/ProgressExplain'
import WorkItemModal from '../../components/WorkItemModal'
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

const MODE_DEFAULT_ITEM = {
  SOFTWARE_SPRINT: 'TASK',
  DATA_MIGRATION: 'DATASET',
  B2B_SALES: 'DEAL',
  B2C_CAMPAIGN: 'CREATIVE',
  PRODUCT_LAUNCH: 'DELIVERABLE',
  OPERATIONS: 'CHECKLIST_ITEM',
  BUSINESS_EXPANSION: 'SETUP_ACTION',
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
  const [addOpen, setAddOpen] = useState(false)
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
          <button type="button" className="btn flex items-center gap-1" onClick={() => setAddOpen(true)}>
            <Plus size={12} aria-hidden /> Add item
          </button>
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
      {addOpen && (
        <WorkItemModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          workstream={ws}
          containers={ws.containers}
          defaultSubtype={MODE_DEFAULT_ITEM[ws.executionMode]}
          onSaved={reloadAll}
        />
      )}
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
          hint="Create a workstream with this execution mode inside a project, or import an agent plan."
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
