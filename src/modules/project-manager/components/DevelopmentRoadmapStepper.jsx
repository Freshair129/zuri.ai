'use client'

// @req FR-083 — Development Overview Dashboard with Roadmap Stepper and Execution Lanes.
// @spec SDD-018, SDD-033, ADR-011
// @tested tests/unit/fr083-development-dashboard.test.js

import { useState } from 'react'
import { Flag, CheckCircle2, Clock, Sparkles, ChevronRight, Layers } from 'lucide-react'

export default function DevelopmentRoadmapStepper({ strategy, projects = [], onSelectHorizon, selectedHorizonId }) {
  const roadmap = strategy?.roadmap
  const horizons = strategy?.horizons || []
  const goals = strategy?.goals || []

  // Default fallback horizons if no strategy is defined yet
  const displayHorizons = horizons.length > 0 ? horizons : [
    { id: 'hz-1', key: 'H1_FOUNDATION', label: 'Phase 1 · Foundation & Migration', position: 1, targetAt: '2026-09-30' },
    { id: 'hz-2', key: 'H2_CORE', label: 'Phase 2 · Core ERP & Modules', position: 2, targetAt: '2026-12-31' },
    { id: 'hz-3', key: 'H3_EXPANSION', label: 'Phase 3 · Omnichannel & Growth', position: 3, targetAt: '2027-06-30' },
  ]

  const getHorizonMetrics = (hzId, index) => {
    const horizonGoals = goals.filter((g) => g.horizonId === hzId)
    const goalCount = horizonGoals.length
    const avgProgress = goalCount > 0
      ? Math.round(horizonGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / goalCount)
      : (index === 0 ? 82 : index === 1 ? 45 : 10)

    let status = 'IN_PROGRESS'
    if (avgProgress >= 100) status = 'DONE'
    else if (avgProgress === 0 && index > 0) status = 'PLANNED'

    return {
      goalCount,
      progress: avgProgress,
      status,
      goals: horizonGoals,
    }
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3 max-md:flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand-surface)] text-[var(--brand-dark)]">
            <Sparkles size={16} aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">Development Strategic Roadmap</h3>
            <p className="text-[11px] text-[var(--muted)]">
              {roadmap ? `${roadmap.title} · Strategic Horizon Stepper` : 'Multi-horizon delivery roadmap across active workstreams and goals'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--success)]" /> Complete</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" /> In Progress</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--surface-mid)] border border-[var(--border)]" /> Planned</span>
        </div>
      </div>

      {/* Stepper track */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {displayHorizons.map((hz, idx) => {
          const metrics = getHorizonMetrics(hz.id, idx)
          const isSelected = selectedHorizonId === hz.id
          const isDone = metrics.status === 'DONE'
          const isInProgress = metrics.status === 'IN_PROGRESS'

          return (
            <div
              key={hz.id}
              onClick={() => onSelectHorizon?.(isSelected ? null : hz.id)}
              className={`group relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all duration-200 ${
                isSelected
                  ? 'border-[var(--brand)] bg-[var(--brand-surface)] shadow-md ring-2 ring-[var(--brand)]/20'
                  : 'border-[var(--border)] bg-white hover:border-[var(--brand-hover)] hover:bg-[var(--surface-mid)]/40'
              }`}
            >
              {/* Top Step Header */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-[var(--muted)]">
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold ${
                      isDone
                        ? 'bg-[var(--success-bg)] text-[var(--success)]'
                        : isInProgress
                          ? 'bg-[var(--brand)] text-white'
                          : 'bg-[var(--surface-mid)] text-[var(--muted)]'
                    }`}>
                      {idx + 1}
                    </span>
                    {`STAGE 0${idx + 1}`}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                    isDone
                      ? 'bg-[var(--success-bg)] text-[var(--success)]'
                      : isInProgress
                        ? 'bg-[#FDE8D0] text-[var(--brand-dark)]'
                        : 'bg-[var(--surface-mid)] text-[var(--muted)]'
                  }`}>
                    {metrics.progress}%
                  </span>
                </div>

                <h4 className="mt-2.5 text-xs font-bold text-[var(--text)] line-clamp-1 group-hover:text-[var(--brand-dark)]">
                  {hz.label}
                </h4>

                <p className="mt-1 text-[10.5px] text-[var(--muted)] line-clamp-2">
                  {hz.description || (idx === 0 ? 'Core architecture, migration, and base domain spine' : idx === 1 ? 'Product manager workflows, RBAC and LINE integrations' : 'Multi-business ecosystem and scale')}
                </p>
              </div>

              {/* Bottom Progress & Meta */}
              <div className="mt-4 pt-3 border-t border-[var(--border)]">
                {/* Progress bar */}
                <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-mid)]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(4, metrics.progress)}%`,
                      backgroundColor: isDone ? 'var(--success)' : 'var(--brand)',
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
                  <span className="flex items-center gap-1">
                    <Flag size={11} aria-hidden />
                    {metrics.goalCount > 0 ? `${metrics.goalCount} Goals linked` : 'Active Stage'}
                  </span>
                  {hz.targetAt && (
                    <span className="flex items-center gap-1">
                      <Clock size={11} aria-hidden />
                      {new Date(hz.targetAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
