'use client'

// @req FR-105 — render the submitted programme without treating it as Business progress.
// @spec ADR-048 D3, SDD-055, NFR-008
// @tested tests/unit/platform-control-route-contract.test.js

import { useState } from 'react'
import { ChevronDown, ClipboardList, Flag, History, Layers3, ShieldCheck } from 'lucide-react'
import { Card, Kpi, PageHeader, ProgressBar, StatusPill } from '@/components/ui'
import {
  PROGRAMME_DELIVERABLES,
  PROGRAMME_GATES,
  PROGRAMME_HISTORY,
  PROGRAMME_PHASES,
  PROGRAMME_SNAPSHOT,
  PROGRAMME_TASKS,
} from '@/modules/platform-control/program-roadmap-data'
import TiltCard from './TiltCard'
import styles from './program-roadmap-board.module.css'

// Presentation pass 2026-09-13 (owner: the deployed page was "all white, no
// accent, no dark mode, no tilt"): status-coloured task cards, tinted phase and
// sprint blocks, tilt + glow on cards, and theme tokens from the shell. Nothing
// here changes what the page says (ADR-048 D3); it only changes how it looks.

const badgeStatus = (status) => status.toUpperCase().replace(/-/g, '_')
const numberWord = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n)
const fmtK = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))

// Inline SVG of the document's section 5.3 / 5.3.1 series. Pure function of
// PROGRAMME_HISTORY — no fetch, no git, no client library (ADR-048 D3; the
// hand-rolled SVG precedent is FR-101).
function HistoryChart({ history }) {
  const rows = history.rows
  const W = 960
  const H = 260
  const padL = 44
  const padR = 52
  const padT = 16
  const padB = 40
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = rows.length
  const x = (i) => padL + (i + 0.5) * (iw / n)
  const maxCommits = Math.max(...rows.map((r) => r[2]))
  const maxLines = Math.max(...rows.map((r) => r[5]))
  const maxFr = Math.max(...rows.map((r) => r[6] || 0))
  const maxTests = Math.max(...rows.map((r) => r[8]))
  const yCommits = (v) => padT + ih - (v / maxCommits) * ih
  const yLines = (v) => padT + ih - (v / maxLines) * ih
  const yFr = (v) => padT + ih - (v / maxFr) * ih
  const yTests = (v) => padT + ih - (v / maxTests) * ih
  const bw = Math.max(4, (iw / n) * 0.6)
  const path = (fn, idx) =>
    rows
      .map((r, i) => (r[idx] === null ? null : `${x(i).toFixed(1)},${fn(r[idx]).toFixed(1)}`))
      .filter(Boolean)
      .map((p, i) => (i === 0 ? `M${p}` : `L${p}`))
      .join('')
  const baselineIndex = rows.findIndex((r) => r[0] === history.baselineDay)
  const last = rows[n - 1]
  const gridColor = 'var(--chart-grid, #E5E7EB)'
  const mutedText = 'var(--chart-text, #6B7280)'
  const faintText = 'var(--chart-text-faint, #9CA3AF)'
  const barFill = 'var(--chart-bar, #FDE8D0)'
  const barStroke = 'var(--chart-bar-stroke, #F09420)'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[560px]" role="img" aria-label={`Repository history ${rows[0][0]} to ${last[0]}: commits per day, cumulative net lines, declared requirements and test files`}>
      {[0, 1, 2, 3, 4].map((g) => {
        const yy = padT + ih - (g / 4) * ih
        return (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke={gridColor} strokeWidth="1" />
            <text x={padL - 6} y={yy + 4} fontSize="10" textAnchor="end" fill={mutedText}>{Math.round((maxCommits * g) / 4)}</text>
            <text x={W - padR + 6} y={yy + 4} fontSize="10" textAnchor="start" fill={mutedText}>{fmtK(Math.round((maxLines * g) / 4))}</text>
          </g>
        )
      })}
      {baselineIndex >= 0 && (
        <g>
          <line x1={x(baselineIndex) + bw / 2 + 2} x2={x(baselineIndex) + bw / 2 + 2} y1={padT} y2={padT + ih} stroke="#E8820C" strokeDasharray="4 3" />
          <text x={x(baselineIndex) + bw / 2 + 6} y={padT + 10} fontSize="10" fill="#B86A08">baseline · programme W1</text>
        </g>
      )}
      {rows.map((r, i) => (
        <rect key={r[0]} x={x(i) - bw / 2} y={yCommits(r[2])} width={bw} height={padT + ih - yCommits(r[2])} rx="1.5" fill={barFill} stroke={barStroke} strokeWidth="0.5">
          <title>{`${r[0]} ${r[1]}: ${r[2]} commits, +${r[3].toLocaleString()} / -${r[4].toLocaleString()} lines`}</title>
        </rect>
      ))}
      <path d={path(yLines, 5)} fill="none" stroke="#E8820C" strokeWidth="2" strokeLinejoin="round" />
      <path d={path(yFr, 6)} fill="none" stroke="#3D7A9E" strokeWidth="2" strokeLinejoin="round" />
      <path d={path(yTests, 8)} fill="none" stroke="#6B7280" strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
      <text x={W - padR + 6} y={yLines(last[5]) + 14} fontSize="10" fill="#B86A08">{fmtK(last[5])} lines</text>
      {rows.map((r, i) =>
        i % 3 === 0 || i === n - 1 ? (
          <g key={`x-${r[0]}`}>
            <text x={x(i)} y={H - padB + 14} fontSize="10" textAnchor="middle" fill={mutedText}>{r[0]}</text>
            <text x={x(i)} y={H - padB + 26} fontSize="9" textAnchor="middle" fill={faintText}>{r[1].slice(5)}</text>
          </g>
        ) : null,
      )}
      <text x={padL} y={H - 4} fontSize="10" fill={mutedText}>left axis: commits per day · right axis: cumulative net lines (monorepo relocation excluded) · FR and tests scaled to full height, end values labelled</text>
    </svg>
  )
}

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
        <Kpi label="Acceptance gates" value={PROGRAMME_GATES.length} meta={`${PROGRAMME_GATES.filter(([, , status]) => status === 'unmet').length === PROGRAMME_GATES.length ? 'all' : `${PROGRAMME_GATES.filter(([, , status]) => status === 'unmet').length} of`} ${numberWord(PROGRAMME_GATES.length)} currently unmet in plan`} tone="warn" />
      </section>

      <Card>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <History size={17} aria-hidden />
          <h2 className="text-base font-bold">Repository history {PROGRAMME_HISTORY.rows[0][0]} – {PROGRAMME_HISTORY.rows.at(-1)[0]}</h2>
          <span className="text-xs text-muted">{PROGRAMME_HISTORY.rows[0][1]} → {PROGRAMME_HISTORY.rows.at(-1)[1]} · measured at <code className="font-semibold text-[var(--text-primary)]">{PROGRAMME_HISTORY.measuredAt}</code> on {PROGRAMME_HISTORY.measuredOn}</span>
        </div>
        <p className="mb-3 text-xs text-muted">{PROGRAMME_HISTORY.note} Copied from the document's sections 5.3 and 5.3.1; the page measures nothing itself.</p>
        <div className="flex flex-wrap gap-4 px-1 pb-1 text-[11px] text-muted">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[#F09420] bg-[#FDE8D0] align-[-1px]" />commits / day</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#E8820C] align-[-1px]" />cumulative net lines (D27 monorepo relocation excluded)</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#3D7A9E] align-[-1px]" />FR declared (ends at {PROGRAMME_HISTORY.rows.at(-1)[6]})</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#6B7280] align-[-1px]" />test files tracked (ends at {PROGRAMME_HISTORY.rows.at(-1)[8]})</span>
        </div>
        <div className={styles.chartFrame}>
          <HistoryChart history={PROGRAMME_HISTORY} />
        </div>
      </Card>

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
                <Card key={phase.id} className={`p-0 ${styles.phase}`}>
                  <button
                    type="button"
                    className={`flex w-full items-start gap-3 p-4 text-left ${styles.phaseHead}`}
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
                    <div className={`space-y-4 p-4 ${styles.phaseBody}`}>
                      {phase.sprints.map((sprint) => (
                        <div key={sprint.id} className={styles.sprint}>
                          <div className={`flex flex-wrap items-center gap-2 ${styles.sprintHead}`}>
                            <strong className="text-sm">{sprint.id}</strong><StatusPill status={badgeStatus(sprint.status)} />
                            <span className="text-xs text-muted">{sprint.weeks} · {sprint.dates}</span>
                            <span className="ml-auto text-xs text-muted">plan {sprint.progress}%</span>
                          </div>
                          <p className="mb-2 text-xs text-muted">{sprint.goal}</p>
                          <ul className="space-y-2" aria-label={`${sprint.id} tasks`}>
                            {tasks.filter((task) => task[1] === sprint.id).map(([id, , title, type, complexity, scope, status]) => (
                              <TiltCard as="li" key={id} className={`p-3 ${styles.task}`} data-status={status}>
                                <div className="flex items-start gap-3">
                                  <span className={styles.taskDot} aria-hidden />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <code className="text-[11px] font-semibold">{id}</code><StatusPill status={badgeStatus(status)} />
                                      <span className="ml-auto text-[11px] text-muted">{type} · {complexity} · {scope}</span>
                                    </div>
                                    <p className="mt-1 text-sm font-semibold">{title}</p>
                                  </div>
                                </div>
                              </TiltCard>
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
          <TiltCard className="rounded-xl">
            <Card className={styles.sideCard}>
              <div className="mb-3 flex items-center gap-2"><ClipboardList size={17} aria-hidden /><h2 className="font-bold">{PROGRAMME_DELIVERABLES.length} deliverables</h2></div>
              <ol className="space-y-2 text-xs text-muted">
                {PROGRAMME_DELIVERABLES.map((deliverable, index) => <li key={deliverable} className="flex gap-2"><span className="font-semibold text-[var(--action-primary)]">{String(index + 1).padStart(2, '0')}</span>{deliverable}</li>)}
              </ol>
            </Card>
          </TiltCard>
          <TiltCard className="rounded-xl">
            <Card className={styles.sideCard}>
              <div className="mb-3 flex items-center gap-2"><Flag size={17} aria-hidden /><h2 className="font-bold">{PROGRAMME_GATES.length} acceptance gates</h2></div>
              <ul className="space-y-3">
                {PROGRAMME_GATES.map(([id, description, status]) => (
                  <li key={id} className="text-xs"><div className="flex items-center gap-2"><code className="font-semibold">{id}</code><StatusPill status={badgeStatus(status)} /></div><p className="mt-1 text-muted">{description}</p></li>
                ))}
              </ul>
            </Card>
          </TiltCard>
          <Card warm>
            <div className="flex items-start gap-2"><ShieldCheck size={17} className="mt-0.5 shrink-0" aria-hidden /><p className="text-xs text-muted">Plan progress above is supplied by the submitted roadmap. It is not deployment readiness, UAT acceptance or live repository velocity.</p></div>
          </Card>
        </aside>
      </section>
    </div>
  )
}
