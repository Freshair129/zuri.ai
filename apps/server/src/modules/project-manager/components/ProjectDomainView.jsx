'use client'

import { useEffect, useState } from 'react'
import { Card, EmptyState, ErrorState, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { api, LoadingCard } from './useApi'

// @req FR-251 — authorized Project users can read a scoped, read-only
// projection of the Workstream domain bindings without turning it into a
// domain grant, Feature authority, progress source or write surface.
// @spec ADR-096, SDD-019, docs/architecture/project-manager-system/23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md
// @tested tests/e2e/project-domain-view.spec.js

const UNAVAILABLE = 'UNAVAILABLE'

function countLabel(value) {
  return Number.isInteger(value) && value >= 0 ? String(value) : 'Unknown'
}

function stateLabel(value) {
  if (value === UNAVAILABLE || value == null) return 'Unavailable'
  if (value === 'NOT_BOUND') return 'No feature bindings'
  return String(value).replaceAll('_', ' ')
}

function StatePill({ label, tone = 'planned' }) {
  return <span className={`pill pill-${tone}`}>{label}</span>
}

function DomainState({ label, value }) {
  const unavailable = value === UNAVAILABLE || value == null
  return (
    <div className="min-w-0 rounded-lg bg-[var(--surface-mid)] px-3 py-2">
      <dt className="text-[10px] font-semibold text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-xs font-semibold ${unavailable ? 'text-muted' : ''}`}>
        {stateLabel(value)}
      </dd>
    </div>
  )
}

function DomainRow({ domain }) {
  const mapped = domain.mappingState === 'MAPPED'
  const ownership = domain.ownership || {}
  const work = domain.work || {}
  const featureIds = Array.isArray(domain.featureIds) ? domain.featureIds : []
  const technicalOwnerIds = Array.isArray(ownership.technicalOwnerIds) ? ownership.technicalOwnerIds : []
  const evidence = Array.isArray(domain.evidence) ? domain.evidence : []
  const label = domain.label || 'Unknown domain'

  return (
    <li
      className="card min-w-0 overflow-hidden p-4"
      data-domain-id={domain.domainId}
      data-mapping-state={domain.mappingState}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold">{label}</h3>
          <code className="mt-1 block break-all text-[11px] text-muted">{domain.domainId || 'Unknown domain ID'}</code>
        </div>
        <StatePill label={mapped ? 'Mapped' : 'Unknown binding'} tone={mapped ? 'active' : 'planned'} />
      </div>

      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-[var(--border)] px-3 py-2">
          <p className="text-[10px] font-semibold text-muted">Work served</p>
          <p className="mt-1 break-words text-sm font-bold">{countLabel(work.uniqueWorkCount)} unique work items</p>
          <p className="mt-0.5 break-words text-[11px] text-muted">{countLabel(work.workstreamCount)} workstreams</p>
        </div>
        <div className="min-w-0 rounded-lg border border-[var(--border)] px-3 py-2">
          <p className="text-[10px] font-semibold text-muted">Ownership</p>
          <p className="mt-1 break-words text-sm font-bold">{countLabel(ownership.primaryWorkstreamCount)} primary</p>
          <p className="mt-0.5 break-words text-[11px] text-muted">{countLabel(ownership.supportingWorkstreamCount)} supporting</p>
        </div>
      </div>

      <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
        <DomainState label="Feature state" value={domain.featureState} />
        <DomainState label="Blockers" value={domain.blockerState} />
        <DomainState label="Contract state" value={domain.contractState} />
        <DomainState label="Gap state" value={domain.gapState} />
      </dl>

      <div className="mt-3 space-y-1 text-[11px] text-muted">
        <p>
          <span className="font-semibold text-[var(--text)]">Technical owners:</span>{' '}
          <span className="break-all">{technicalOwnerIds.length > 0 ? technicalOwnerIds.join(', ') : 'None recorded'}</span>
        </p>
        <p>
          <span className="font-semibold text-[var(--text)]">Features:</span>{' '}
          {featureIds.length > 0 ? `${featureIds.length} binding${featureIds.length === 1 ? '' : 's'} reported` : 'No Project Feature bindings available'}
        </p>
        <p>
          <span className="font-semibold text-[var(--text)]">Evidence:</span>{' '}
          {evidence.length > 0 ? `${evidence.length} record${evidence.length === 1 ? '' : 's'}` : 'No evidence available'}
        </p>
      </div>

      {!mapped && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] px-3 py-2 text-[11px] text-muted" role="note">
          This binding has no matching catalog label yet, so the imported ID stays visible as unknown.
        </p>
      )}
    </li>
  )
}

function UnassignedSection({ count }) {
  const unassigned = countLabel(count)
  return (
    <Card data-view-state="unassigned">
      <SectionTitle caption="Active Workstreams without a primary domain binding">Unassigned workstreams</SectionTitle>
      <p className="text-sm font-bold">{unassigned}</p>
      <p className="mt-1 text-xs text-muted">
        {unassigned === '0'
          ? 'Every active Workstream has a primary domain binding.'
          : unassigned === 'Unknown'
            ? 'An unassigned count is not available.'
            : `${unassigned} active Workstream${unassigned === '1' ? '' : 's'} have no primary domain binding.`}
      </p>
    </Card>
  )
}

function requestState(error) {
  if (error?.status === 401) {
    return {
      title: 'Authentication required',
      detail: 'Sign in again to view this Project domain projection.',
      state: 'forbidden',
    }
  }
  if (error?.status === 404) {
    return {
      title: 'Project not found',
      detail: 'This Project is unavailable in the current authorized scope.',
      state: 'not-found',
    }
  }
  return {
    title: 'Execution Domains unavailable',
    detail: error?.message || 'The Project domain projection could not be loaded.',
    state: 'request-failed',
  }
}

function useProjectDomainView(projectId) {
  const [state, setState] = useState({ data: null, loading: Boolean(projectId), error: null, projectId })

  useEffect(() => {
    let current = true
    if (!projectId) {
      setState({ data: null, loading: false, error: null, projectId: null })
      return () => {
        current = false
      }
    }

    setState({ data: null, loading: true, error: null, projectId })
    api(`/api/projects/${encodeURIComponent(projectId)}/domain-view`)
      .then((data) => {
        if (current) setState({ data, loading: false, error: null, projectId })
      })
      .catch((error) => {
        if (current) setState({ data: null, loading: false, error, projectId })
      })

    return () => {
      current = false
    }
  }, [projectId])

  return state
}

export default function ProjectDomainView({ projectId }) {
  const { data, loading, error, projectId: loadedProjectId } = useProjectDomainView(projectId)

  // A route transition can render once before useEffect clears the previous
  // request. Keep that frame in loading state and require the DTO to identify
  // the same Project before showing any counts or IDs.
  const requestIsCurrent = loadedProjectId === projectId
  const dataIsCurrent = !data || String(data.projectId) === String(projectId)

  if (loading || !requestIsCurrent) {
    return (
      <div data-testid="project-domain-view" data-view-state="loading" aria-label="Execution Domains loading">
        <LoadingCard />
      </div>
    )
  }

  if (error) {
    const failure = requestState(error)
    return (
      <div data-testid="project-domain-view" data-view-state={failure.state}>
        <ErrorState title={failure.title} detail={failure.detail} />
      </div>
    )
  }

  if (!data || !dataIsCurrent || !Array.isArray(data.domains)) {
    return (
      <div data-testid="project-domain-view" data-view-state="request-failed">
        <ErrorState title="Execution Domains unavailable" detail="The Project domain projection response is incomplete." />
      </div>
    )
  }

  const domains = data.domains
  const snapshotUnavailable = data.snapshotState === UNAVAILABLE || data.snapshotId == null

  return (
    <div className="min-w-0 space-y-5" data-testid="project-domain-view" data-view-state={domains.length === 0 ? 'empty' : 'ready'}>
      <PageHeader
        eyebrow="Project · Delivery Design"
        title="Execution Domains"
        subtitle="Domains served by this Project's workstreams"
        actions={<StatePill label={snapshotUnavailable ? 'Snapshot unavailable' : `Snapshot ${stateLabel(data.snapshotState)}`} />}
      />

      <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Project domain summary">
        <Kpi label="Unique active work" value={countLabel(data.totalUniqueWorkCount)} meta="Counted once per Project" />
        <Kpi label="Unassigned workstreams" value={countLabel(data.unboundWorkstreamCount)} meta="No primary domain binding" />
        <Kpi label="Domain rows" value={String(domains.length)} meta="Mapped and unknown bindings" />
      </section>

      <Card warm>
        <p className="text-xs leading-5 text-muted" role="note">
          Work is counted once in the Project total. A WorkItem can appear in more than one domain row when it has primary and supporting bindings, so domain row counts are not summed. This page summarizes the Project's Workstream bindings and does not change work or permissions.
        </p>
      </Card>

      <UnassignedSection count={data.unboundWorkstreamCount} />

      {domains.length === 0 ? (
        <section data-view-state="empty" aria-label="Execution domains empty">
          <EmptyState
            title="No execution domains"
            hint="No active Workstream domain bindings were found for this Project. Unassigned workstreams remain visible above."
          />
        </section>
      ) : (
        <section aria-label="Execution domains" data-view-state="domain-list">
          <SectionTitle caption="Stable domain IDs and Workstream-derived counts">Domains served by this Project</SectionTitle>
          <ul className="grid min-w-0 gap-3 lg:grid-cols-2" aria-label="Execution domains">
            {domains.map((domain) => <DomainRow key={domain.domainId} domain={domain} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
