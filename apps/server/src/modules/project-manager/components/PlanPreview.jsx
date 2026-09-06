'use client'

// @req FR-012 — the read-only dry-run preview a human confirms before commit:
// inserts, updates and conflicts by entity kind, plus the Space the plan
// resolved to. Shared by the /work intake modals so both show the same
// evidence before the same commit leg.
// @spec BR-009, SDD-009
// @tested tests/unit/plan-intake-flow.test.js

const TONES = {
  inserts: { bg: 'var(--success-bg)', fg: 'var(--success)' },
  updates: { bg: 'var(--rest-blue)', fg: 'var(--rest-blue-text)' },
  conflicts: { bg: 'var(--danger-bg)', fg: 'var(--danger)' },
}

function PreviewList({ title, rows = [], tone }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-muted">
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted">none</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row, i) => (
            <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: tone.bg, color: tone.fg }}>
              <b>{row.kind}</b> {row.code} — {row.title || row.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PlanPreview({ dryRun }) {
  if (!dryRun?.preview) return null
  const { preview, workspace } = dryRun
  return (
    <div className="rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-3" data-plan-preview>
      <p className="text-[11px] font-bold">พรีวิว dry run — ยังไม่มีการเขียนข้อมูลใด ๆ</p>
      <p className="text-[10px] text-muted">
        Space ปลายทาง: {workspace?.code || '?'}
        {workspace?.name ? ` · ${workspace.name}` : ''}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 max-md:grid-cols-1">
        <PreviewList title="เพิ่มใหม่ (Inserts)" rows={preview.inserts} tone={TONES.inserts} />
        <PreviewList title="อัปเดต (Updates)" rows={preview.updates} tone={TONES.updates} />
        <PreviewList title="ขัดแย้ง (Conflicts)" rows={preview.conflicts} tone={TONES.conflicts} />
      </div>
      <p className="mt-2 text-[10px] text-muted">{preview.dependencyCount ?? 0} dependency edge(s) in plan.</p>
    </div>
  )
}
