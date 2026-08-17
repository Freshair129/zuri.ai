'use client'

// @req FR-014 — the immutable audit event browser: filter by entityType and
// list occurredAt/action/actorType/payload from /api/audit.
// @tested tests/e2e/smoke.spec.js
import { useState } from 'react'
import { PageHeader, DataTable, StatusPill, EmptyState, ErrorState, TruncationNotice } from '@/components/ui'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'

const ENTITY_TYPES = [
  '', 'PROJECT', 'WORKSTREAM', 'WORK_ITEM', 'WORK_CONTAINER', 'MILESTONE', 'GATE',
  'DEPENDENCY', 'REPOSITORY', 'PROJECT_REPOSITORY', 'WORKSPACE', 'PORTFOLIO', 'TENANT',
  'BUSINESS', 'BRANCH', 'LEGAL_ENTITY', 'SNAPSHOT',
]

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
      <div className="mb-3">
        <select className="input w-auto" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Filter by entity type">
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>{t ? t.replace(/_/g, ' ') : 'All entity types'}</option>
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
                <code className="block max-w-md truncate text-[9px] text-muted">{JSON.stringify(e.payload)}</code>
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
