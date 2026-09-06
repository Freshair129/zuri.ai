'use client'

// @req FR-153 — plan revisions remain immutable and are inspectable with exact
// changed fields, rather than appearing as an overwritten draft.
// @spec SDD-086 — version comparison is labelled as a comparison, not a fictional scenario metric.
// @tested tests/unit/marketing-strategy-ui.test.js

import { Card, SectionTitle, StatusPill } from '@/components/ui'
import { diffPlanPayload, formatMarketingDate } from './marketing-contract'

export function PlanVersionHistory({ plan }) {
  const versions = [...(plan?.versions || [])].sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))
  return (
    <Card className="mb-4" data-testid="marketing-plan-versions">
      <SectionTitle caption="Each save appends an immutable revision">Version history</SectionTitle>
      {versions.length === 0 && <p className="text-xs text-muted">No revisions are available.</p>}
      <div className="space-y-2">
        {versions.map((version, index) => {
          const previous = versions[index + 1]
          const changes = previous ? diffPlanPayload(previous.payload, version.payload) : []
          const currentPayload = version.payload || {}
          const previousPayload = previous?.payload || {}
          const titleChanged = previous && (previous.title || plan.title || '') !== (version.title || plan.title || '')
          const changedFields = titleChanged ? ['title', ...changes] : changes
          const content = [
            ['Objective', currentPayload.objective],
            ['Situation', currentPayload.situation],
            ['Audience', currentPayload.audience],
            ['Channels', Array.isArray(currentPayload.channels) ? currentPayload.channels.join(', ') : currentPayload.channels],
            ['Budget', currentPayload.budget === undefined ? undefined : `${currentPayload.budget} ${currentPayload.currency || ''}`.trim()],
            ['Success metric intent', currentPayload.successMetric],
            ['Actions', Array.isArray(currentPayload.actions) ? currentPayload.actions.map((action) => action.title).join('; ') : currentPayload.actions],
          ]
          return (
            <details key={version.id || version.revision} open={index === 0} className="rounded-xl border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-xs font-bold">Revision {version.revision} · {formatMarketingDate(version.createdAt)} {version.id === plan.currentVersion?.id && <span className="ml-1 text-[10px] text-muted">Current</span>}</summary>
              <div className="mt-2 grid gap-1 text-[10px] text-muted sm:grid-cols-2">
                <span>Created by: {version.createdBy || 'Unknown user'}</span>
                <span>{changedFields.length ? `Changed: ${changedFields.join(', ')}` : 'Initial revision'}</span>
              </div>
              <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-2"><p className="text-[10px] font-bold">Saved content</p><dl className="mt-1 space-y-1 text-[10px]">{[['Title', version.title || plan.title], ...content].map(([label, value]) => <div key={label} className="grid gap-2 sm:grid-cols-[9rem_1fr]"><dt className="text-muted">{label}</dt><dd>{value || '—'}</dd></div>)}</dl></div>
              {previous && changedFields.length > 0 && <details className="mt-2 rounded-lg border border-[var(--border)] p-2"><summary className="cursor-pointer text-[10px] font-semibold">Before / after</summary><div className="mt-2 space-y-2 text-[10px]">{changedFields.map((field) => { const before = field === 'title' ? (previous.title || plan.title) : previousPayload[field]; const after = field === 'title' ? (version.title || plan.title) : currentPayload[field]; return <div key={field}><p className="font-semibold">{field}</p><p className="text-muted">Before: {Array.isArray(before) ? before.map((item) => item.title || item).join(', ') : String(before ?? '—')}</p><p>After: {Array.isArray(after) ? after.map((item) => item.title || item).join(', ') : String(after ?? '—')}</p></div> })}</div></details>}
              <details className="mt-2 rounded-lg border border-[var(--border)] p-2"><summary className="cursor-pointer text-[10px] font-semibold">Technical binding</summary><div className="mt-2 grid gap-1 text-[10px] text-muted sm:grid-cols-2"><span>Hash: <code>{version.payloadHash || 'pending'}</code></span><span>Version id: <code>{version.id || 'pending'}</code></span></div></details>
              {version.status && <div className="mt-2"><StatusPill status={version.status} /></div>}
            </details>
          )
        })}
      </div>
    </Card>
  )
}
