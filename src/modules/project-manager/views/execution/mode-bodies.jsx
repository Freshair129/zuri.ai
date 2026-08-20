'use client'

// @req FR-009 — seven execution views over the neutral core model
// @tested tests/e2e/smoke.spec.js (7 view tests)
// Seven execution-view bodies. Every body reads/writes the SAME neutral
// WorkContainer/WorkItem model — mode-specific vocabulary lives only here.

import { Card, SectionTitle, StatusPill, ProgressBar, DataTable, EmptyState } from '@/components/ui'
import { WORK_STATUSES, MILESTONE_STATUSES, GATE_STATUSES } from '@/lib/validation/enums'
import { activeItems, formatProgressPercent } from '../../progress/strategies'
import StatusSelect from '../../components/StatusSelect'

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString())

function ItemCard({ item, reload }) {
  return (
    <div className="mb-2 rounded-xl border border-[#E8EAED] bg-white p-2.5 shadow-sm hover:border-[#F0BE81]">
      <p className="text-[8px] text-[#9BA4AF]">{item.code}</p>
      <p className="mt-0.5 text-[11px] font-bold leading-snug">{item.title}</p>
      <div className="mt-2 flex items-center justify-between gap-1 text-[9px] text-[#8A94A1]">
        <span>w{item.weight}</span>
        <StatusSelect entity="work" id={item.id} value={item.status} statuses={WORK_STATUSES} onChanged={reload} />
      </div>
    </div>
  )
}

// Sprint board groups the seven WORK_STATUSES values into fewer visual
// columns. The grouping is a genuine filter (a status→column map), but it
// must still be exhaustive: every WORK_STATUSES value needs a column, or an
// item in an ungrouped status silently disappears from the board (the same
// defect class as FR-063 in KanbanBoard.jsx). CANCELLED previously had no
// column and vanished; it now gets its own terminal column.
const SPRINT_COLUMN_LABELS = {
  PLANNED: 'Backlog',
  READY: 'Backlog',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  BLOCKED: 'Review',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}
const SPRINT_COLUMN_ORDER = ['Backlog', 'In Progress', 'Review', 'Done', 'Cancelled']

function buildSprintColumns() {
  const byLabel = new Map(SPRINT_COLUMN_ORDER.map((label) => [label, []]))
  for (const status of WORK_STATUSES) {
    // Fallback: an unmapped future status gets its own column instead of
    // being dropped, so this can't repeat the CANCELLED bug.
    const label = SPRINT_COLUMN_LABELS[status] || status
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label).push(status)
  }
  return [...byLabel.entries()].map(([label, statuses]) => ({ key: label, label, statuses }))
}

/** 1. SOFTWARE_SPRINT — Sprint Board (kanban by status). */
export function SprintBoard({ workstream, reload }) {
  const columns = buildSprintColumns()
  const sprints = workstream.containers.filter((c) => c.subtype === 'SPRINT')
  return (
    <div>
      {sprints.length > 0 && (
        <p className="mb-2 text-[10px] text-muted">
          Sprint: <b>{sprints.map((s) => s.title).join(', ')}</b>
        </p>
      )}
      <div className="grid grid-cols-5 gap-2.5 overflow-x-auto max-md:grid-cols-1">
        {columns.map((col) => {
          const items = workstream.items.filter((i) => col.statuses.includes(i.status))
          return (
            <div key={col.key} className="min-h-[220px] rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-2.5">
              <div className="mb-2 flex justify-between text-[9px] font-extrabold text-[#8A94A1]">
                <span>{col.label}</span>
                <span>{items.length}</span>
              </div>
              {items.map((i) => (
                <ItemCard key={i.id} item={i} reload={reload} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 2. DATA_MIGRATION — Migration Monitor (dataset validation table). */
export function MigrationMonitor({ workstream, reload }) {
  const datasets = workstream.items.filter((i) => i.subtype === 'DATASET' || i.metrics.recordsTotal)
  if (datasets.length === 0) return <EmptyState title="No datasets tracked" hint="Add DATASET items with recordsTotal/validated metrics." />
  return (
    <div className="space-y-3">
      {datasets.map((d) => {
        const m = d.metrics
        const pct = m.recordsTotal > 0 ? Math.round(((m.validated || 0) / m.recordsTotal) * 100) : 0
        return (
          <Card key={d.id}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[9px] text-muted">{d.code}</p>
                <p className="text-xs font-bold">{d.title}</p>
              </div>
              <StatusSelect entity="work" id={d.id} value={d.status} statuses={WORK_STATUSES} onChanged={reload} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1"><ProgressBar percent={pct} tone="blue" label={`${d.title} validation`} /></div>
              <span className="text-xs font-bold">{pct}%</span>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-2 text-center text-[10px] max-md:grid-cols-3">
              <div><p className="text-muted">Total</p><p className="font-bold">{fmt(m.recordsTotal)}</p></div>
              <div><p className="text-muted">Processed</p><p className="font-bold">{fmt(m.processed)}</p></div>
              <div><p className="text-muted">Validated</p><p className="font-bold" style={{ color: 'var(--success)' }}>{fmt(m.validated)}</p></div>
              <div><p className="text-muted">Failed</p><p className="font-bold" style={{ color: 'var(--danger)' }}>{fmt(m.failed)}</p></div>
              <div><p className="text-muted">Reconciled</p><p className="font-bold">{fmt(m.reconciled)}</p></div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

/** 3. B2B_SALES — weighted pipeline board. */
export function SalesPipeline({ workstream, reload }) {
  // @req FR-009 — the same population the calculator sums over (activeItems),
  // not the raw list: a cancelled deal used to count here and not there.
  const deals = activeItems(workstream.items).filter((i) => i.subtype === 'DEAL' || i.numericValue != null)
  const stages = ['Discovery', 'Proposal', 'Negotiation', 'Won']
  const stageOf = (d) =>
    d.status === 'DONE' ? 'Won' : d.metadata.stage && stages.includes(d.metadata.stage) ? d.metadata.stage : 'Discovery'
  const totals = {
    pipeline: deals.reduce((s, d) => s + (d.numericValue || 0), 0),
    weighted: deals.reduce((s, d) => s + (d.status === 'DONE' ? d.numericValue || 0 : (d.numericValue || 0) * (d.probability || 0)), 0),
    won: deals.filter((d) => d.status === 'DONE').reduce((s, d) => s + (d.numericValue || 0), 0),
  }
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <Card><p className="text-[10px] text-muted">Pipeline value</p><p className="text-lg font-bold">{fmt(totals.pipeline)}</p></Card>
        <Card><p className="text-[10px] text-muted">Weighted value</p><p className="text-lg font-bold" style={{ color: 'var(--brand)' }}>{fmt(Math.round(totals.weighted))}</p></Card>
        <Card><p className="text-[10px] text-muted">Won revenue</p><p className="text-lg font-bold" style={{ color: 'var(--success)' }}>{fmt(totals.won)}</p></Card>
      </div>
      <div className="grid grid-cols-4 gap-2.5 overflow-x-auto max-md:grid-cols-1">
        {stages.map((stage) => {
          const stageDeals = deals.filter((d) => stageOf(d) === stage)
          const stageValue = stageDeals.reduce((s, d) => s + (d.numericValue || 0), 0)
          return (
            <div key={stage} className="min-h-[180px] rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-2.5">
              <div className="mb-2 flex justify-between text-[9px] font-extrabold text-[#8A94A1]">
                <span>{stage}</span><span>{fmt(stageValue)}</span>
              </div>
              {stageDeals.map((d) => (
                <div key={d.id} className="mb-2 rounded-xl border border-[#E8EAED] bg-white p-2.5">
                  <p className="text-[8px] text-[#9BA4AF]">{d.code}</p>
                  <p className="text-[11px] font-bold">{d.title}</p>
                  <div className="mt-1.5 flex items-center justify-between text-[9px]">
                    <span className="font-bold">{fmt(d.numericValue)}</span>
                    <span className="text-muted">{d.probability != null ? `${Math.round(d.probability * 100)}%` : '—'}</span>
                  </div>
                  <div className="mt-1.5">
                    <StatusSelect entity="work" id={d.id} value={d.status} statuses={WORK_STATUSES} onChanged={reload} />
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 4. B2C_CAMPAIGN — Campaign Control (KPI cards + creatives). */
export function CampaignControl({ workstream, reload, progress }) {
  const kpis = progress?.evidence?.kpis || []
  return (
    <div>
      {kpis.length > 0 ? (
        <div className="mb-3 grid grid-cols-4 gap-3 max-md:grid-cols-2">
          {kpis.map((k) => (
            <Card key={k.key}>
              <p className="text-[10px] text-muted">{k.label}</p>
              <p className="text-lg font-bold">{fmt(k.actual)}</p>
              <p className="text-[9px] text-muted">target {fmt(k.target)} {k.direction === 'down' ? '(lower is better)' : ''}</p>
              <div className="mt-1.5"><ProgressBar percent={k.attainment * 100} label={`${k.label} attainment`} /></div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="mb-3 rounded-lg px-3 py-2 text-[10px]" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
          No KPI targets configured for this campaign workstream.
        </p>
      )}
      <SectionTitle caption="Creatives, audiences and experiments in this campaign">Campaign assets</SectionTitle>
      <DataTable
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'title', label: 'Asset' },
          { key: 'subtype', label: 'Type', render: (r) => <StatusPill status={r.subtype} /> },
          { key: 'leads', label: 'Leads', render: (r) => fmt(r.metrics.leads) },
          { key: 'conversions', label: 'Conv.', render: (r) => fmt(r.metrics.conversions) },
          { key: 'revenue', label: 'Revenue', render: (r) => fmt(r.metrics.revenue) },
          { key: 'spend', label: 'Spend', render: (r) => fmt(r.metrics.spend) },
          {
            key: 'status', label: 'Status',
            render: (r) => <StatusSelect entity="work" id={r.id} value={r.status} statuses={WORK_STATUSES} onChanged={reload} />,
          },
        ]}
        rows={workstream.items}
        empty={<EmptyState title="No campaign assets yet" hint="Add CREATIVE / AUDIENCE / EXPERIMENT items with KPI metrics." />}
      />
    </div>
  )
}

/** 5. PRODUCT_LAUNCH — Launch Timeline (milestones + gates). */
export function LaunchTimeline({ workstream, reload }) {
  const milestones = [...(workstream.milestones || [])].sort((a, b) =>
    String(a.targetAt || '9999').localeCompare(String(b.targetAt || '9999'))
  )
  return (
    <div className="grid grid-cols-[1.5fr_1fr] gap-3 max-md:grid-cols-1">
      <Card>
        <SectionTitle caption="Weighted milestones drive launch readiness">Milestones</SectionTitle>
        {milestones.length === 0 && <p className="text-xs text-muted">No milestones yet.</p>}
        <div className="space-y-2">
          {milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-2.5">
              <div className="flex-1">
                <p className="text-[9px] text-muted">{m.code} · weight {m.weight}</p>
                <p className="text-xs font-bold">{m.title}</p>
                {m.targetAt && <p className="text-[9px] text-muted">target {new Date(m.targetAt).toLocaleDateString()}</p>}
              </div>
              <StatusSelect entity="milestone" id={m.id} value={m.status} statuses={MILESTONE_STATUSES} onChanged={reload} />
            </div>
          ))}
        </div>
      </Card>
      <div>
        <Card>
          <SectionTitle caption="Required gates cap readiness until passed">Launch gates</SectionTitle>
          <div className="space-y-2">
            {(workstream.gates || []).map((g) => (
              <div key={g.id} className={`gate-row ${g.status === 'PASSED' ? 'done' : g.status === 'BLOCKED' ? 'blocked' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[11px]">{g.title}</b>
                  <StatusSelect entity="gate" id={g.id} value={g.status} statuses={GATE_STATUSES} onChanged={reload} />
                </div>
                <small className="text-muted">{g.code} · {g.required ? 'required' : 'optional'}</small>
              </div>
            ))}
            {(workstream.gates || []).length === 0 && <p className="text-xs text-muted">No gates defined.</p>}
          </div>
        </Card>
        <Card className="mt-3">
          <SectionTitle>Deliverables</SectionTitle>
          {workstream.items.map((i) => (
            <div key={i.id} className="mb-2 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold">{i.title}</span>
              <StatusSelect entity="work" id={i.id} value={i.status} statuses={WORK_STATUSES} onChanged={reload} />
            </div>
          ))}
          {workstream.items.length === 0 && <p className="text-xs text-muted">No deliverables.</p>}
        </Card>
      </div>
    </div>
  )
}

/** 6. OPERATIONS — Operations Board (checklists, SLA, issues). */
export function OperationsBoard({ workstream, reload }) {
  const checklists = workstream.items.filter((i) => i.subtype === 'CHECKLIST_ITEM')
  const issues = workstream.items.filter((i) => i.subtype === 'ISSUE')
  const others = workstream.items.filter((i) => !['CHECKLIST_ITEM', 'ISSUE'].includes(i.subtype))
  // @req FR-009 — same population as slaScore; see activeItems.
  const opsItems = activeItems(workstream.items)
  const slaMet = opsItems.reduce((s, i) => s + (i.metrics.slaMet || 0), 0)
  const slaTotal = opsItems.reduce((s, i) => s + (i.metrics.slaTotal || 0), 0)
  const incidents = opsItems.reduce((s, i) => s + (i.metrics.incidents || 0), 0)
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <Card><p className="text-[10px] text-muted">SLA attainment</p><p className="text-lg font-bold">{slaTotal > 0 ? `${Math.round((slaMet / slaTotal) * 100)}%` : '—'}</p><p className="text-[9px] text-muted">{fmt(slaMet)} / {fmt(slaTotal)} checks met</p></Card>
        <Card><p className="text-[10px] text-muted">Open incidents</p><p className="text-lg font-bold" style={{ color: incidents > 0 ? 'var(--danger)' : 'var(--success)' }}>{incidents}</p></Card>
        <Card><p className="text-[10px] text-muted">Process items</p><p className="text-lg font-bold">{workstream.items.length}</p></Card>
      </div>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <Card>
          <SectionTitle>Checklists & runs</SectionTitle>
          {[...checklists, ...others].map((i) => (
            <div key={i.id} className="mb-2 flex items-center justify-between gap-2 text-[11px]">
              <div>
                <p className="font-semibold">{i.title}</p>
                {i.metrics.slaTotal > 0 && <p className="text-[9px] text-muted">SLA {i.metrics.slaMet || 0}/{i.metrics.slaTotal}</p>}
              </div>
              <StatusSelect entity="work" id={i.id} value={i.status} statuses={WORK_STATUSES} onChanged={reload} />
            </div>
          ))}
          {checklists.length + others.length === 0 && <p className="text-xs text-muted">No checklist items.</p>}
        </Card>
        <Card>
          <SectionTitle>Issues</SectionTitle>
          {issues.map((i) => (
            <div key={i.id} className="mb-2 flex items-center justify-between gap-2 text-[11px]">
              <div>
                <p className="font-semibold">{i.title}</p>
                {i.metrics.incidents > 0 && <p className="text-[9px]" style={{ color: 'var(--danger)' }}>{i.metrics.incidents} incident(s)</p>}
              </div>
              <StatusSelect entity="work" id={i.id} value={i.status} statuses={WORK_STATUSES} onChanged={reload} />
            </div>
          ))}
          {issues.length === 0 && <p className="text-xs text-muted">No open issues.</p>}
        </Card>
      </div>
    </div>
  )
}

/** 7. BUSINESS_EXPANSION — Expansion Portfolio (readiness dimensions). */
export function ExpansionPortfolio({ workstream, reload, progress }) {
  const dimensions = progress?.evidence?.dimensions || []
  const sites = workstream.containers.filter((c) => c.subtype === 'EXPANSION_SITE' || c.subtype === 'EXPANSION_INITIATIVE')
  return (
    <div>
      {sites.length > 0 && (
        <p className="mb-2 text-[10px] text-muted">Sites: <b>{sites.map((s) => s.title).join(', ')}</b></p>
      )}
      <div className="grid grid-cols-[1fr_1.4fr] gap-3 max-md:grid-cols-1">
        <Card>
          <SectionTitle caption="Weighted readiness per dimension">Readiness</SectionTitle>
          {dimensions.length === 0 && <p className="text-xs text-muted">No readiness data yet.</p>}
          <div className="space-y-2">
            {dimensions.map((d) => (
              <div key={d.name} className="flex items-center gap-2">
                <span className="w-20 text-[10px] font-bold capitalize">{d.name}</span>
                <div className="flex-1"><ProgressBar percent={d.percent} tone={d.percent === 100 ? 'green' : undefined} label={`${d.name} readiness`} /></div>
                <span className="w-10 text-right text-[10px] font-semibold">{formatProgressPercent(d.percent)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {(workstream.gates || []).map((g) => (
              <div key={g.id} className={`gate-row ${g.status === 'PASSED' ? 'done' : g.status === 'BLOCKED' ? 'blocked' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[11px]">{g.title}</b>
                  <StatusSelect entity="gate" id={g.id} value={g.status} statuses={GATE_STATUSES} onChanged={reload} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle caption="Approvals and setup actions">Actions</SectionTitle>
          {workstream.items.map((i) => (
            <div key={i.id} className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-2.5 text-[11px]">
              <div>
                <p className="font-semibold">{i.title}</p>
                <p className="text-[9px] capitalize text-muted">{(i.metadata.dimension || 'general')} · {i.subtype.replace(/_/g, ' ')} · w{i.weight}</p>
              </div>
              <StatusSelect entity="work" id={i.id} value={i.status} statuses={WORK_STATUSES} onChanged={reload} />
            </div>
          ))}
          {workstream.items.length === 0 && <p className="text-xs text-muted">No expansion actions yet.</p>}
        </Card>
      </div>
    </div>
  )
}

export const MODE_BODIES = {
  SOFTWARE_SPRINT: SprintBoard,
  DATA_MIGRATION: MigrationMonitor,
  B2B_SALES: SalesPipeline,
  B2C_CAMPAIGN: CampaignControl,
  PRODUCT_LAUNCH: LaunchTimeline,
  OPERATIONS: OperationsBoard,
  BUSINESS_EXPANSION: ExpansionPortfolio,
}
