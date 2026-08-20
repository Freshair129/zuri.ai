'use client'

// @req FR-094 — render the submitted programme without treating it as Business progress.
// @spec ADR-039 D3, SDD-052, NFR-008
// @tested tests/unit/platform-control-route-contract.test.js

import { useState } from 'react'
import { ChevronDown, ClipboardList, Flag, Layers3, ShieldCheck } from 'lucide-react'
import { Card, Kpi, PageHeader, ProgressBar, StatusPill } from '@/components/ui'
import {
  PROGRAMME_DELIVERABLES,
  PROGRAMME_GATES,
  PROGRAMME_PHASES,
  PROGRAMME_SNAPSHOT,
  PROGRAMME_TASKS,
} from '@/modules/platform-control/program-roadmap-data'

const badgeStatus = (status) => status.toUpperCase().replace(/-/g, '_')

export default function ProgramRoadmapBoard() {
  const [openPhase, setOpenPhase] = useState('PHASE-ZAI-01')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PLATFORM PROGRAMME · OPERATOR ONLY"
        title="Zuri AI — 24-week delivery programme"
        subtitle="Read-only plan snapshot. It is not Business progress and it is not calculated from Git activity."
      />

      <Card warm className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="pill pill-review">{PROGRAMME_SNAPSHOT.status.toUpperCase()} PLAN</span>
        <span className="text-xs text-muted">{PROGRAMME_SNAPSHOT.programmeStart} → {PROGRAMME_SNAPSHOT.programmeEnd}</span>
        <span className="text-xs text-muted">baseline <code className="font-semibold text-[var(--text-primary)]">{PROGRAMME_SNAPSHOT.baselineCommit}</code></span>
        <span className="text-xs text-muted">{PROGRAMME_SNAPSHOT.sourceLabel} · v{PROGRAMME_SNAPSHOT.version}</span>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Programme scope">
        <Kpi label="Delivery window" value="24 weeks" meta="24 Aug 2026 – 7 Feb 2027" />
        <Kpi label="Programme structure" value="6 / 12" meta="phases / two-week sprints" />
        <Kpi label="Task containers" value={PROGRAMME_TASKS.length} meta="submitted work items" />
        <Kpi label="Acceptance gates" value={PROGRAMME_GATES.length} meta="all eight currently unmet in plan" tone="warn" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Layers3 size={17} aria-hidden />
            <h2 className="text-base font-bold">Phases, sprints and tasks</h2>
          </div>
          <div className="space-y-3">
            {PROGRAMME_PHASES.map((phase) => {
              const expanded = openPhase === phase.id
              const tasks = PROGRAMME_TASKS.filter((task) => phase.sprints.some((sprint) => sprint.id === task[1]))
              return (
                <Card key={phase.id} className="p-0">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 p-4 text-left hover:bg-[var(--bg-subtle)]"
                    onClick={() => setOpenPhase(expanded ? null : phase.id)}
                    aria-expanded={expanded}
                  >
                    <ChevronDown size={18} className={`mt-0.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong>{phase.id}</strong><StatusPill status={badgeStatus(phase.status)} />
                        <span className="text-xs text-muted">{phase.weeks} · {phase.dates}</span>
                      </span>
                      <span className="mt-1 block text-sm text-muted">{phase.goal}</span>
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs text-muted">plan {phase.progress}%</span>
                  </button>
                  <ProgressBar percent={phase.progress} label={`${phase.id} submitted plan progress`} />
                  {expanded && (
                    <div className="space-y-4 border-t border-[var(--border)] p-4">
                      {phase.sprints.map((sprint) => (
                        <div key={sprint.id}>
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <strong className="text-sm">{sprint.id}</strong><StatusPill status={badgeStatus(sprint.status)} />
                            <span className="text-xs text-muted">{sprint.weeks} · {sprint.dates}</span>
                          </div>
                          <p className="mb-2 text-xs text-muted">{sprint.goal}</p>
                          <ul className="space-y-2" aria-label={`${sprint.id} tasks`}>
                            {tasks.filter((task) => task[1] === sprint.id).map(([id, , title, type, complexity, scope, status]) => (
                              <li key={id} className="rounded-md border border-[var(--border-subtle)] bg-white p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <code className="text-[11px] font-semibold">{id}</code><StatusPill status={badgeStatus(status)} />
                                  <span className="ml-auto text-[11px] text-muted">{type} · {complexity} · {scope}</span>
                                </div>
                                <p className="mt-1 text-sm">{title}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        </div>

        <aside className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center gap-2"><ClipboardList size={17} aria-hidden /><h2 className="font-bold">10 deliverables</h2></div>
            <ol className="space-y-2 text-xs text-muted">
              {PROGRAMME_DELIVERABLES.map((deliverable, index) => <li key={deliverable} className="flex gap-2"><span className="font-semibold text-[var(--action-primary)]">{String(index + 1).padStart(2, '0')}</span>{deliverable}</li>)}
            </ol>
          </Card>
          <Card>
            <div className="mb-3 flex items-center gap-2"><Flag size={17} aria-hidden /><h2 className="font-bold">8 acceptance gates</h2></div>
            <ul className="space-y-3">
              {PROGRAMME_GATES.map(([id, description, status]) => (
                <li key={id} className="text-xs"><div className="flex items-center gap-2"><code className="font-semibold">{id}</code><StatusPill status={badgeStatus(status)} /></div><p className="mt-1 text-muted">{description}</p></li>
              ))}
            </ul>
          </Card>
          <Card warm>
            <div className="flex items-start gap-2"><ShieldCheck size={17} className="mt-0.5 shrink-0" aria-hidden /><p className="text-xs text-muted">Plan progress above is supplied by the submitted roadmap. It is not deployment readiness, UAT acceptance or live repository velocity.</p></div>
          </Card>
        </aside>
      </section>
    </div>
  )
}
