'use client'

// @req FR-009 — the global index of the seven execution mode views (no
// projectId), the unscoped half of "global + project-scoped".
import Link from 'next/link'
import { PageHeader, Card } from '@/components/ui'
import { EXECUTION_NAV } from '@/config/modules'
import { MODE_SLUGS, MODE_LABELS } from '@/lib/validation/enums'

const GRAMMAR = {
  sprint: 'Release → Sprint → Epic → Task/Bug',
  migration: 'Stage → Batch → Dataset → Validation → Reconciliation',
  'b2b-sales': 'Pipeline → Stage → Account → Deal → Activity',
  'b2c-campaign': 'Campaign → Wave → Channel → Creative/Experiment',
  'product-launch': 'Phase → Milestone → Deliverable → Gate',
  operations: 'Period → Process → Run → Checklist/Issue/SLA',
  expansion: 'Initiative → Site → Milestone → Approval → Go-live',
}

export default function ExecutionIndexPage() {
  return (
    <div>
      <PageHeader
        eyebrow="All projects"
        title="Seven Execution Modes"
        subtitle="One neutral core model, seven domain views. Execution mode belongs to a workstream — a project may mix modes."
      />
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        {EXECUTION_NAV.map((e, i) => (
          <Link key={e.slug} href={`/execution/${e.slug}`}>
            <Card warm className="relative h-full overflow-hidden transition hover:-translate-y-0.5">
              <span className="absolute -right-5 -top-6 h-24 w-24 rounded-full bg-brand-tint opacity-55" aria-hidden />
              <p className="relative text-[9px] font-extrabold tracking-wide" style={{ color: 'var(--brand)' }}>
                MODE {String(i + 1).padStart(2, '0')} · {MODE_SLUGS[e.slug]}
              </p>
              <p className="relative mt-1.5 text-sm font-bold">{MODE_LABELS[MODE_SLUGS[e.slug]]}</p>
              <p className="relative mt-1 text-[10px] leading-relaxed text-muted">{GRAMMAR[e.slug]}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
