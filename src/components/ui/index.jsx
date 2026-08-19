'use client'

// @req NFR-008 — shared V2 UI exposes consistent state, accessibility, and token-backed primitives.
// @spec SDD-010, ADR-010 — components consume the Zuri Heritage semantic/component token contract.
// @tested tests/unit/design-system.test.js

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>
            {eyebrow}
          </p>
        )}
        <h1 className="mt-0.5 text-[28px] font-bold leading-9 tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, warm, className = '', ...rest }) {
  return (
    <div className={`card ${warm ? 'card-subtle' : ''} p-4 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, caption }) {
  return (
    <div className="mb-3">
      <h2 className="text-[13px] font-bold">{children}</h2>
      {caption && <p className="mt-0.5 text-[10px] text-muted">{caption}</p>}
    </div>
  )
}

const STATUS_PILL = {
  ACTIVE: 'pill-active',
  IN_PROGRESS: 'pill-active',
  DONE: 'pill-done',
  PASSED: 'pill-active',
  COMPLETED: 'pill-done',
  PLANNED: 'pill-planned',
  READY: 'pill-planned',
  OPEN: 'pill-gate',
  REVIEW: 'pill-review',
  ON_HOLD: 'pill-review',
  MISSED: 'pill-blocked',
  BLOCKED: 'pill-blocked',
  CANCELLED: 'pill-done',
  ARCHIVED: 'pill-done',
  WAIVED: 'pill-review',
  // FR-080 AC-075.3 integration health. DEGRADED reads as review rather than
  // blocked on purpose: it means "we cannot currently prove this works", which is
  // a different call to action from ERROR, where we know it does not.
  CONNECTED: 'pill-active',
  DEGRADED: 'pill-review',
  ERROR: 'pill-blocked',
  DISABLED: 'pill-done',
  MISCONFIGURED: 'pill-blocked',
}

export function StatusPill({ status }) {
  const cls = STATUS_PILL[status] || 'pill-planned'
  // Text label means color is never the sole status indicator.
  return <span className={`pill ${cls}`}>{String(status || '').replace(/_/g, ' ')}</span>
}

export function ProgressBar({ percent, tone, label }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  const toneCls = tone === 'blue' ? 'progress-fill-blue' : tone === 'green' ? 'progress-fill-green' : ''
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'progress'}
    >
      <span className={`progress-fill ${toneCls}`} style={{ width: `${p}%` }} />
    </div>
  )
}

export function Kpi({ label, value, meta, tone }) {
  const color =
    tone === 'good' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : tone === 'bad' ? 'var(--danger)' : 'var(--ink)'
  return (
    <Card>
      <p className="text-[10px] font-semibold text-muted">{label}</p>
      <p className="mt-1 text-[26px] font-bold tracking-tight" style={{ color }}>
        {value}
      </p>
      {meta && <p className="mt-1 text-[10px] text-muted">{meta}</p>}
    </Card>
  )
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="card grid place-items-center gap-2 p-10 text-center">
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl text-lg"
        style={{ background: 'var(--brand-tint)', color: 'var(--brand-dark)' }}
        aria-hidden
      >
        ∅
      </div>
      <p className="text-sm font-bold">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted">{hint}</p>}
      {action}
    </div>
  )
}

/**
 * States that a list is a window, not the whole set.
 *
 * @req FR-005, FR-014 — a row cap the user cannot see is a wrong answer rather
 * than a short page: `AllWorkView` searches client-side over the rows it was
 * given, and an audit log is read to answer "did this happen?". Both were
 * capped silently (500 and 200). Rendered as a notice above the table rather
 * than a row inside it, so it survives client-side filtering of the rows.
 */
export function TruncationNotice({ shown, limit, noun = 'rows', hint }) {
  return (
    <p
      className="mb-2 rounded-lg px-3 py-2 text-[11px]"
      style={{ background: 'var(--warn-bg, var(--brand-tint))', color: 'var(--warn, var(--brand-dark))' }}
      role="status"
    >
      Showing the most recent {shown ?? limit} {noun} — there are more than this limit of {limit}.
      {hint ? ` ${hint}` : ''}
    </p>
  )
}

export function ErrorState({ title = 'Something went wrong', detail, retry }) {
  return (
    <div className="card grid place-items-center gap-2 p-10 text-center" role="alert">
      <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>
        {title}
      </p>
      {detail && <p className="max-w-md text-xs text-muted">{detail}</p>}
      {retry && (
        <button type="button" className="btn" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Modal({ open, title, onClose, children, wide }) {
  if (!open) return null
  return (
    <div
      className="modal-backdrop flex items-start justify-center overflow-y-auto p-6 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`modal-surface w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold">{title}</h2>
          <button type="button" className="btn px-2 py-1" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] font-bold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-muted">{hint}</span>}
    </label>
  )
}

export function DataTable({ columns, rows, empty, rowKey, onRowClick }) {
  if (!rows || rows.length === 0) {
    return empty || <EmptyState title="Nothing here yet" />
  }
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="border-b border-[var(--border)] p-2.5 text-left font-semibold text-[var(--text-tertiary)]"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey ? rowKey(row) : row.id}
              className={`border-b border-[#F0F1F3] last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-brand-surface' : ''}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className="p-2.5 align-middle">
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
