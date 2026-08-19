'use client'

// Wrapper for one execution mode: lists matching workstreams (optionally
// scoped to a project), shows strategy-based progress with explanation, and
// renders the mode-specific body over the neutral core model.
//
// @req FR-009 — the seven execution modes, in both of their instances: the
// global `/execution/{mode}` and the project-scoped
// `/projects/{id}/execution/{mode}`. The two differ only by `projectId`, so
// anything project-shaped in here is guarded rather than assumed.
// @spec SDD-019, ADR-012 — `ProjectTabs` is the project-local navigation
// boundary; a drill-down underneath it still owes the user a named way back up.
// @tested tests/unit/project-execution-backpath.test.js

import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'
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

/**
 * The way back out of a project-scoped execution mode.
 *
 * This route was a leaf. The Workstream cards on the Project detail page are
 * its only inbound link, and nothing on the page pointed back, so the only
 * exits were the browser's back button and the top-level nav — and the nav
 * drops the user out of the project entirely. A drill-down keeps a visible
 * path back to the thing it drilled from.
 *
 * Rendered only in project scope. This view also serves the global
 * `/execution/{mode}`, where `projectId` is undefined and a link built from it
 * would read `/projects/undefined`: a broken exit is worse than no exit.
 *
 * The link renders before the project is loaded and survives that fetch
 * failing — an escape hatch that depends on a round trip is not a predictable
 * one. Only the label waits, and it names the project's `code` rather than
 * saying "Back", because the shell breadcrumb above already ends at this
 * project as inert text: this is the only linked way up, so it should say
 * where it goes.
 */
function ProjectBackPath({ projectId, project, modeLabel }) {
  const projectLabel = project?.code || project?.name || null
  // "Project path", and neither of the two names it would otherwise collide
  // with. This page already carries a landmark called "Breadcrumb" (the shell's
  // scope path, Portfolio → Tenant → Business → Project) and one called
  // "Project sections" (the tab bar) — so "Breadcrumb" would be a duplicate
  // entry in a screen reader's landmark list, and "Project section" would differ
  // from the tab bar by one letter, which is a distinction nobody can hear.
  // Landmarks of one role are chosen by name, so the names have to be tellable
  // apart out loud.
  return (
    <nav aria-label="Project path" className="mb-3 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
      <Link
        href={`/projects/${projectId}`}
        className="flex shrink-0 items-center gap-1.5 font-semibold transition hover:text-[var(--text)]"
        // The visible crumb is a bare code next to an arrow glyph, so the
        // accessible name spells out both the direction and the destination.
        aria-label={projectLabel ? `Back to project ${projectLabel} workstreams` : 'Back to project workstreams'}
      >
        <ArrowLeft size={13} aria-hidden />
        {projectLabel || 'Project'}
      </Link>
      <ChevronRight size={12} aria-hidden className="shrink-0 opacity-50" />
      <span className="truncate font-semibold text-[var(--text)]" aria-current="page">
        Execution · {modeLabel}
      </span>
    </nav>
  )
}

export default function ExecutionModeView({ mode, projectId }) {
  const query = projectId ? `/api/workstreams?executionMode=${mode}&projectId=${projectId}` : `/api/workstreams?executionMode=${mode}`
  const { data, loading, error, reload } = useFetch(query)
  // Read purely so the back-path can name its destination. The ternary is
  // load-bearing: `useFetch(null)` is a no-op, and an unguarded template would
  // have the global view asking the API for `/api/projects/undefined`.
  const project = useFetch(projectId ? `/api/projects/${projectId}` : null)

  return (
    <div>
      {projectId ? (
        <ProjectBackPath projectId={projectId} project={project.data} modeLabel={MODE_LABELS[mode]} />
      ) : null}
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
            // Scope-aware for the same reason the crumb is: an empty project
            // scope is exactly when the back-path matters most, and sending
            // that user to the portfolio-wide list is sending them somewhere
            // they were never coming from.
            projectId ? (
              <Link className="btn btn-primary" href={`/projects/${projectId}`}>
                Back to {project.data?.code || 'project'}
              </Link>
            ) : (
              <Link className="btn btn-primary" href="/projects">
                Go to projects
              </Link>
            )
          }
        />
      )}
      {(data || []).map((ws) => (
        <WorkstreamPanel key={ws.id} workstream={ws} reload={reload} />
      ))}
    </div>
  )
}
