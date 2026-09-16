'use client'

// @req FR-159 — the Dashboard reserves the approved provider performance layout
// and states which reader each metric waits for.
// @spec SDD-086 — a metric with no connected reader renders an unavailable
// state, never a zero, a dash or a placeholder chart standing in for evidence.
// @tested tests/unit/marketing-strategy-ui.test.js

import { PlugZap } from 'lucide-react'
import { Card, SectionTitle } from '@/components/ui'
import { PROVIDER_METRICS, PROVIDER_PANELS, providerReaderConnected } from './marketing-contract'
import { SourceNote } from './MarketingState'

function WaitingCard({ label, help }) {
  return (
    <Card>
      <p className="text-[10px] font-semibold text-muted">{label}</p>
      <p className="mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold" style={{ background: 'var(--brand-tint)', color: 'var(--brand-dark)' }}>
        <PlugZap size={12} aria-hidden /> Not connected
      </p>
      <p className="mt-1 text-[10px] text-muted">{help}</p>
    </Card>
  )
}

function WaitingPanel({ label, help }) {
  return (
    <Card>
      <p className="text-xs font-bold">{label}</p>
      <div className="mt-2 grid min-h-40 place-items-center rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
        <p className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--brand-dark)' }}>
          <PlugZap size={12} aria-hidden /> Not connected
        </p>
        <p className="text-[10px] text-muted">{help}</p>
      </div>
    </Card>
  )
}

// `source` is supplied by a future Integration provider reader. Until one
// exists every caller passes nothing, and this component renders the reserved
// layout without inventing a single number.
export default function MarketingPerformance({ source = null }) {
  const connected = providerReaderConnected(source)
  return (
    <section aria-label="Measured provider performance" className="mb-5">
      <Card className="mb-3">
        <SectionTitle caption={connected ? `Reader: ${source.providerName}` : 'No ad, analytics, or SEO provider reader is connected to this first slice'}>
          Measured provider performance
        </SectionTitle>
        {!connected && (
          <p className="mt-2 text-[11px] text-muted">
            Provider metrics are unavailable. Connect an approved provider reader before showing spend, reach,
            conversions, or return. Plan intent is not a performance observation, so these cards stay empty rather
            than reporting zero.
          </p>
        )}
        <SourceNote>Integration provider readers. Marketing never computes a measurement from planning intent.</SourceNote>
      </Card>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PROVIDER_METRICS.map((metric) => (
          <WaitingCard key={metric.key} label={metric.label} help={metric.help} />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {PROVIDER_PANELS.map((panel) => (
          <WaitingPanel key={panel.key} label={panel.label} help={panel.help} />
        ))}
      </div>
    </section>
  )
}
