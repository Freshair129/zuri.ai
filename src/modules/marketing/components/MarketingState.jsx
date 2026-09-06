'use client'

// @req FR-153 — Marketing pages distinguish loading, denied/error, empty, and
// unavailable capability states so a missing provider signal is never shown as zero.
// @spec SDD-086 — provider metrics are outside this first native planning slice.
// @tested tests/unit/marketing-strategy-ui.test.js

import { Card, EmptyState, ErrorState } from '@/components/ui'

export function MarketingDataState({ loading, error, retry, children }) {
  if (loading) {
    return <div className="card grid min-h-28 place-items-center p-6 text-xs text-muted" role="status">Loading Marketing data…</div>
  }
  if (error) return <ErrorState title="Marketing data is unavailable" detail={error} retry={retry} />
  return children
}

export function UnavailableState({ title = 'Not available yet', hint }) {
  return <EmptyState title={title} hint={hint || 'This capability has no connected source in the current slice.'} />
}

export function ScopeNotice({ children = 'Choose a Business in the shell to view Marketing.' }) {
  return <div className="card p-4 text-xs text-muted" role="status">{children}</div>
}

export function InlineNotice({ children, tone = 'info' }) {
  const styles = tone === 'error'
    ? { background: 'var(--danger-bg)', color: 'var(--danger)' }
    : { background: 'var(--brand-tint)', color: 'var(--brand-dark)' }
  return <p className="rounded-lg px-3 py-2 text-[11px]" style={styles} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}

export function SourceNote({ children }) {
  return <p className="mt-2 text-[10px] text-muted">Source: {children}</p>
}
