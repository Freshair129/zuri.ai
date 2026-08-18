'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Card, EmptyState, ErrorState, Kpi, PageHeader, ProgressBar, SectionTitle, StatusPill, TruncationNotice } from '@/components/ui'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

// @req FR-077 — Project Inventory is an additive, read-only Project surface.
// @spec SDD-045, ADR-034, ADR-017
// @tested tests/e2e/fr077-project-inventory.spec.js

function dateLabel(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

function CollectionState({ collection, noun }) {
  if (collection.status === 'UNAVAILABLE') {
    return <p className="text-xs" style={{ color: 'var(--danger)' }}>This section is temporarily unavailable.</p>
  }
  if (collection.status === 'EMPTY') {
    return <p className="text-xs text-muted">No {noun} recorded.</p>
  }
  return null
}

function SectionWindow({ collection, noun }) {
  if (!collection.truncated) return null
  return <TruncationNotice shown={collection.items.length} limit={collection.limit} noun={noun} />
}

function InventorySection({ title, collection, noun, children }) {
  return (
    <Card>
      <SectionTitle caption={`${collection.items.length} shown`}>{title}</SectionTitle>
      <SectionWindow collection={collection} noun={noun} />
      <CollectionState collection={collection} noun={noun} />
      {collection.items.length > 0 && children}
    </Card>
  )
}

export default function ProjectInventoryPage() {
  const { projectId } = useParams()
  const inventory = useFetch(projectId ? `/api/projects/${projectId}/inventory` : null)

  if (inventory.loading) return <LoadingCard />
  if (inventory.error) return <ErrorState title="Project Inventory unavailable" detail={inventory.error} retry={inventory.reload} />
  if (!inventory.data) return <ErrorState title="Project not found" />

  const data = inventory.data
  const { project, sections, summary } = data
  const workItems = sections.work.items.items.slice(0, 6)

  return (
    <div>
      <PageHeader
        eyebrow={`${project.business?.name || 'Shared project'} · Project Inventory`}
        title={project.name}
        subtitle={`${project.code} · Space: ${project.workspace?.code || '—'} · ${project.workspace?.name || '—'}`}
        actions={<StatusPill status={project.status} />}
      />

      <div className="mb-4 grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2">
        <Kpi label="Workstreams" value={summary.counts.workstreams} />
        <Kpi label="Work items" value={summary.counts.workItems} />
        <Kpi label="Milestones" value={summary.counts.milestones} />
        <Kpi label="Files" value={summary.counts.files} />
        <Kpi label="Open required gates" value={summary.openRequiredGates} tone={summary.openRequiredGates ? 'warn' : 'good'} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <Card>
          <SectionTitle caption={sections.progress.rollup.formula || 'Strategy-based project roll-up'}>Progress evidence</SectionTitle>
          <div className="flex items-center gap-3">
            <ProgressBar percent={sections.progress.rollup.percent} label="Project progress" />
            <span className="shrink-0 text-sm font-bold">{sections.progress.rollup.percent}%</span>
          </div>
          {sections.progress.rollup.warnings.length > 0 && (
            <ul className="mt-3 list-disc pl-4 text-[11px] text-muted">
              {sections.progress.rollup.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </Card>
        <InventorySection title="Workstreams" collection={sections.work.workstreams} noun="workstreams">
          <div className="space-y-2">
            {sections.work.workstreams.items.slice(0, 5).map((workstream) => (
              <div key={workstream.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><span className="font-semibold">{workstream.code}</span> · {workstream.name}</span>
                <StatusPill status={workstream.status} />
              </div>
            ))}
          </div>
        </InventorySection>
      </div>

      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <InventorySection title="Work items" collection={sections.work.items} noun="work items">
          <div className="space-y-2">
            {workItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><span className="font-semibold">{item.code}</span> · {item.title}</span>
                <StatusPill status={item.status} />
              </div>
            ))}
          </div>
          <Link className="mt-3 inline-block text-[11px] font-semibold text-brand-dark" href={`/projects/${project.id}/all-work`}>Open all work →</Link>
        </InventorySection>

        <InventorySection title="Milestones" collection={sections.milestones} noun="milestones">
          <div className="space-y-2">
            {sections.milestones.items.slice(0, 5).map((milestone) => (
              <div key={milestone.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><span className="font-semibold">{milestone.code}</span> · {milestone.title}</span>
                <span className="shrink-0 text-muted">{dateLabel(milestone.targetAt)}</span>
              </div>
            ))}
          </div>
        </InventorySection>

        <InventorySection title="Gates" collection={sections.gates} noun="gates">
          <div className="space-y-2">
            {sections.gates.items.slice(0, 5).map((gate) => (
              <div key={gate.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><span className="font-semibold">{gate.code}</span> · {gate.title}</span>
                <StatusPill status={gate.status} />
              </div>
            ))}
          </div>
        </InventorySection>

        <InventorySection title="Dependencies" collection={sections.dependencies} noun="dependencies">
          <div className="space-y-2 text-xs">
            {sections.dependencies.items.slice(0, 5).map((edge) => (
              <div key={edge.id} className="rounded-lg bg-[var(--surface-mid)] px-2.5 py-2">
                <span className="font-semibold">{edge.source.code || edge.source.title}</span> → <span className="font-semibold">{edge.target.code || edge.target.title}</span>
                <span className="ml-2 text-muted">{edge.label}</span>
              </div>
            ))}
          </div>
          <Link className="mt-3 inline-block text-[11px] font-semibold text-brand-dark" href={`/projects/${project.id}/dependencies`}>Open dependency map →</Link>
        </InventorySection>

        <InventorySection title="Files" collection={sections.files} noun="files">
          <div className="space-y-2 text-xs">
            {sections.files.items.slice(0, 5).map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{file.name}</span>
                <span className="shrink-0 text-muted">{file.source === 'FILE_ASSET' ? 'Managed' : 'Legacy'}</span>
              </div>
            ))}
          </div>
          <Link className="mt-3 inline-block text-[11px] font-semibold text-brand-dark" href={`/projects/${project.id}/files`}>Open files →</Link>
        </InventorySection>

        <InventorySection title="Linked repositories" collection={sections.repositories} noun="repositories">
          <div className="space-y-2 text-xs">
            {sections.repositories.items.slice(0, 5).map((link) => (
              <div key={link.linkId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{link.repo.fullName || link.repo.code}</span>
                <span className="shrink-0 text-muted">{link.role}</span>
              </div>
            ))}
          </div>
          <Link className="mt-3 inline-block text-[11px] font-semibold text-brand-dark" href={`/projects/${project.id}/repositories`}>Open repositories →</Link>
        </InventorySection>

        <InventorySection title="Project team" collection={sections.team} noun="team members">
          <div className="space-y-2 text-xs">
            {sections.team.items.slice(0, 5).map((member) => (
              <div key={member.membershipId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{member.person.displayName}</span>
                <span className="shrink-0 text-muted">{member.role}</span>
              </div>
            ))}
          </div>
          <Link className="mt-3 inline-block text-[11px] font-semibold text-brand-dark" href={`/projects/${project.id}/team`}>Open team →</Link>
        </InventorySection>

        <InventorySection title="Recent activity" collection={sections.activity} noun="activity events">
          <div className="space-y-2 text-xs">
            {sections.activity.items.slice(0, 5).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{event.action} · {event.entityType}</span>
                <span className="shrink-0 text-muted">{dateLabel(event.occurredAt)}</span>
              </div>
            ))}
          </div>
        </InventorySection>
      </div>

      {summary.incompleteSections.length > 0 && (
        <p className="mt-4 text-[11px] text-muted" role="status">
          Some sections are showing a bounded or incomplete view: {summary.incompleteSections.join(', ')}.
        </p>
      )}
    </div>
  )
}
