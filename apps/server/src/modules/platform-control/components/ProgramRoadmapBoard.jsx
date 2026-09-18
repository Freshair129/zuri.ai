'use client'

// @req FR-105 — render the submitted programme without treating it as Business progress.
// @req FR-211 — and, in a second tab, the domain map & inventory.
// @req FR-216 — each phase card carries its planned figures and, beside them, the
//   time and tokens measured for its lanes; done cards read green, review orange.
// @req FR-219 — each task card carries evidence badges and its subtask progress.
// @req FR-240 — phase cards split tokens and show tool calls, prompts and compactions;
//   task telemetry lists the most used tools, errors and denials.
// @req FR-241 — `audience="member"`: no Agent devices tab and no per-person or
//   per-device rows. Lanes, sizing and the measured-through time arrive as props
//   from the server page, so this client module never bundles the generated
//   usage block with its tool and model names (ADR-092 D3).
// @spec ADR-048 D3, ADR-086 D1, D6, ADR-092, SDD-055, NFR-008
// @tested tests/unit/platform-control-route-contract.test.js, tests/unit/platform-control-domain-map.test.js, tests/unit/program-roadmap-board-telemetry.test.js, tests/unit/programme-member-view.test.js

import { useState } from 'react'
import { Boxes, ChevronDown, ClipboardList, Flag, Gauge, History, Layers3, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import { Card, Kpi, PageHeader, ProgressBar, StatusPill } from '@/components/ui'
import {
  PROGRAMME_DELIVERABLES,
  PROGRAMME_GATES,
  PROGRAMME_HISTORY,
  PROGRAMME_PHASES,
  PROGRAMME_SNAPSHOT,
  PROGRAMME_TASKS,
} from '@/modules/platform-control/program-roadmap-data'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import {
  formatDuration,
  formatTokens,
  phaseDeliveryMetrics,
  subtaskProgress,
  tokensUsed,
  topTools,
  UNATTRIBUTED_LANE,
} from '@/modules/platform-control/program-delivery-metrics'
import { TONE_WORD } from '@/modules/platform-control/program-task-evidence'
import DomainMapView from './DomainMapView'
import HarnessDevicesView from './HarnessDevicesView'
import TiltCard from './TiltCard'
import styles from './program-roadmap-board.module.css'

// Task Containers (owner request 2026-09-13): a task opens the way it does on
// the html board — links, container identity, definition of done with the
// per-criterion `checked` flags the document records, changelog, dependencies.
// The data is PROGRAMME_CONTAINERS, generated from the markdown YAML; links
// point at the repository on GitHub because a file path is not a URL here.
const REPO_BLOB = 'https://github.com/Freshair129/zuri.ai/blob/main/'

function RepoLink({ path }) {
  if (!path || path === 'unavailable') return <span className={styles.na}>unavailable</span>
  return (
    <a className={styles.link} href={`${REPO_BLOB}${path}`} target="_blank" rel="noopener noreferrer">
      {path}
    </a>
  )
}

function Criterion({ label, tone, item }) {
  return (
    <div className={`${styles.dodCol} ${styles[`dod${tone}`]}`}>
      <h5 className={styles.dodHead}>{label}</h5>
      <div className={styles.crit}>
        <span
          className={`${styles.box} ${item.checked ? styles.boxOn : ''}`}
          role="img"
          aria-label={item.checked ? 'checked: true in the document' : 'checked: false in the document'}
          title={item.checked ? 'checked: true ใน .md' : 'checked: false ใน .md'}
        />
        <span>{item.text}</span>
      </div>
    </div>
  )
}

// ---- FR-216 / FR-219 (ADR-086): delivery telemetry and evidence badges -------

const TONE_GLYPH = { done: '✓', review: '◐', fix: '✕', empty: '○' }
const STATUS_ORDER = ['done', 'review', 'in-progress', 'assigned', 'ready', 'planned', 'blocked']

function EvidenceBadges({ id, evidence }) {
  if (!evidence) return null
  return (
    <div className={styles.badges} data-testid={`task-badges-${id}`}>
      {evidence.evidence.map((badge) => (
        <span
          key={badge.key}
          className={styles.badge}
          data-tone={badge.tone}
          data-badge={badge.key}
          title={`${badge.key} · ${TONE_WORD[badge.tone]} — ${badge.detail}`}
          aria-label={`${badge.key} ${TONE_WORD[badge.tone]}`}
        >
          <span aria-hidden className={styles.badgeGlyph}>{TONE_GLYPH[badge.tone]}</span>
          {badge.key}
        </span>
      ))}
      {evidence.descriptors.map((d) => (
        <span key={d.key} className={`${styles.badge} ${styles.badgeNeutral}`} data-badge={d.key} title={d.detail}>{d.label}</span>
      ))}
    </div>
  )
}

function SubtaskBar({ id, subtasks }) {
  const percent = subtaskProgress(subtasks)
  if (percent === null) return null
  const done = subtasks.filter((s) => s.status === 'done').length
  return (
    <div className={styles.subtaskBar} data-testid={`task-subtasks-${id}`}>
      <span className="shrink-0 text-[11px] text-muted">subtask {done}/{subtasks.length} · {percent}%</span>
      <span className="min-w-0 flex-1"><ProgressBar percent={percent} tone="green" label={`${id} subtask progress`} /></span>
      <span className={styles.subtaskChips} aria-hidden>
        {subtasks.map((s) => <span key={s.id} className={styles.subtaskChip} data-status={s.status} title={`${s.id} · ${s.status} — ${s.title}`}>{s.id}</span>)}
      </span>
    </div>
  )
}

function usageSources(sources) {
  return sources.map((s) => (s.startsWith('report:') ? `${s.slice('report:'.length)} (รายงาน)` : s)).join(', ')
}

// FR-240: the token split and the usage detail beside it. A lane whose reports and
// logs carried no detail says so rather than showing zeros (ADR-086 D7).
function UsageDetailRow({ tokens, detail, detailSessions = 0, sessions = 0, testId }) {
  const errorRate = detail?.toolCalls ? Math.round((detail.toolErrors / detail.toolCalls) * 1000) / 10 : 0
  return (
    <div className={styles.metricRow} data-testid={testId} data-detail={detailSessions ? 'true' : 'false'}>
      <span className={styles.metricLabel}>ละเอียด</span>
      <span className={styles.metric} title="input ที่ไม่ได้มาจาก cache"><b>{formatTokens(tokens.input)}</b> in</span>
      <span className={styles.metric} title="output รวม thinking"><b>{formatTokens(tokens.output)}</b> out</span>
      {detailSessions ? (
        <>
          <span className={styles.metric} title="ส่วนหนึ่งของ output"><b>{formatTokens(detail.reasoningTokens)}</b> thinking</span>
          <span className={styles.metric} title={`5 นาที ${formatTokens(detail.cacheWrite5mTokens)} · 1 ชั่วโมง ${formatTokens(detail.cacheWrite1hTokens)}`}><b>{formatTokens(tokens.cacheWrite)}</b> cache write</span>
          <span className={styles.metric}><b>{formatTokens(tokens.cacheRead)}</b> cache read</span>
          <span className={styles.metric} title={`error ${detail.toolErrors} · ถูกปฏิเสธ ${detail.toolDenials}`}><b>{detail.toolCalls.toLocaleString()}</b> tool call · error {errorRate}%</span>
          <span className={styles.metric}><b>{detail.prompts}</b> prompt</span>
          <span className={styles.metric}><b>{detail.compactions}</b> compaction</span>
          {detail.webSearchRequests + detail.webFetchRequests > 0 && <span className={styles.metricMuted}>web search {detail.webSearchRequests} · fetch {detail.webFetchRequests}</span>}
          {detailSessions < sessions && <span className={styles.metricMuted}>มีรายละเอียด {detailSessions}/{sessions} session</span>}
        </>
      ) : (
        <span className={styles.metricMuted}>ยังไม่มีรายละเอียด (tool call, thinking, prompt) — plugin หรือ meter รุ่นก่อน FR-239</span>
      )}
    </div>
  )
}

// FR-221: usage per person (and per device in task detail). The meter's local-log
// figures carry no person and are shown as such, never guessed.
function Breakdown({ rows, testId, noPersonLabel = 'ไม่ระบุคน (log เครื่อง operator)' }) {
  const entries = Object.entries(rows || {}).sort((a, b) => b[1].used - a[1].used)
  if (!entries.length) return null
  return (
    <span className={styles.breakdown} data-testid={testId}>
      {entries.map(([label, row]) => (
        <span key={label || 'none'} className={styles.breakdownChip} title={`cache read ${formatTokens(row.cacheRead)} · ${row.sessions} session`}>
          {label || noPersonLabel} <b>{formatTokens(row.used)}</b>
        </span>
      ))}
    </span>
  )
}

function PhaseMetrics({ phase, metrics, member = false }) {
  const m = metrics.measured
  const breakdown = STATUS_ORDER.filter((s) => metrics.byStatus[s]).map((s) => `${s} ${metrics.byStatus[s]}`).join(' · ')
  return (
    <div className={styles.metrics} data-testid={`phase-metrics-${phase.id}`}>
      <div className={styles.metricRow}>
        <span className={styles.metricLabel}>แผน</span>
        <span className={styles.metric}><b>{metrics.sprintCount}</b> sprint</span>
        <span className={styles.metric} title={breakdown}><b>{metrics.taskCount}</b> task</span>
        <span className={styles.metric} title="size = ผลรวม complexity point (C-1 = 1, C-2 = 2, C-3 = 3)"><b>{metrics.sizePoints}</b> pt</span>
        <span className={styles.metric} title={`plan window ${phase.start} → ${phase.end}`}><b>{metrics.planDays ?? '—'}</b> วัน</span>
        <span className={styles.metric} title="effort ประมาณจากตาราง sizing ในเอกสารโปรแกรม"><b>~{metrics.effortHours}</b> ชม. effort</span>
        <span className={styles.metric} title="predicted_token_usage รวมของทุก task — ค่าคาดการณ์"><b>{formatTokens(metrics.predictedTokens)}</b> token คาดการณ์</span>
        <span className={styles.metricMuted}>{breakdown}</span>
      </div>
      <div className={styles.metricRow} data-measured={m ? 'true' : 'false'}>
        <span className={`${styles.metricLabel} ${styles.metricLabelMeasured}`}>วัดจริง</span>
        {m ? (
          <>
            <span className={styles.metric} title={`input ${m.tokens.input.toLocaleString()} · cache write ${m.tokens.cacheWrite.toLocaleString()} · output ${m.tokens.output.toLocaleString()}`}>
              <b>{formatTokens(m.used)}</b> token ใช้ไป
            </span>
            <span className={styles.metricMuted}>+ cache read {formatTokens(m.tokens.cacheRead)}</span>
            {metrics.done ? (
              <>
                <span className={styles.metric}><b>{m.elapsedDays === null ? '—' : m.elapsedDays < 1 ? formatDuration(m.elapsedDays * 1440) : `${m.elapsedDays.toFixed(1)} วัน`}</b> เวลาจริง</span>
                <span className={styles.metric}><b>{formatDuration(m.activeMinutes)}</b> active</span>
              </>
            ) : (
              <span className={styles.metricMuted}>เวลาจริงแสดงเมื่อ phase done · active ถึงตอนนี้ {formatDuration(m.activeMinutes)}</span>
            )}
            <span className={styles.metricMuted}>{m.sessions} session · วัดได้ {m.coveredTasks}/{metrics.taskCount} task · {usageSources(m.sources)}</span>
            {member ? null : <Breakdown rows={m.byPerson} testId={`phase-people-${phase.id}`} />}
          </>
        ) : (
          <span className={styles.metricMuted}>ยังไม่วัด — ไม่มี lane ที่ประกาศ branch และมี session ใน phase นี้</span>
        )}
      </div>
      {m ? <UsageDetailRow tokens={m.tokens} detail={m.detail} detailSessions={m.detailSessions} sessions={m.sessions} testId={`phase-detail-${phase.id}`} /> : null}
    </div>
  )
}

function LaneTelemetry({ id, laneUsage, lanes = [], member = false }) {
  const lane = lanes.find((l) => l.tasks.includes(id))
  const m = laneUsage[lane?.id] || laneUsage[`TASK:${id}`]
  return (
    <div className={styles.infoSec} data-testid={`task-telemetry-${id}`}>
      <span className={styles.secLabel}>Delivery telemetry</span>
      {m ? (
        <p className="text-xs">
          {lane ? <>lane <code>{lane.id}</code> ({lane.tasks.length} task ใช้ร่วมกัน · branch {lane.branches.join(', ')}) · </> : null}
          ใช้ไป <b>{tokensUsed(m.tokens).toLocaleString()}</b> token (+ cache read {m.tokens.cacheRead.toLocaleString()}) · active {formatDuration(m.activeMinutes)} · {m.sessions} session · {usageSources(m.sources)}
          {m.firstActivityAt && <> · {m.firstActivityAt.slice(0, 16).replace('T', ' ')} → {m.lastActivityAt.slice(0, 16).replace('T', ' ')} UTC</>}
        </p>
      ) : null}
      {m && !member ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">ตามคน</span><Breakdown rows={m.byPerson} testId={`task-people-${id}`} />
          {Object.keys(m.byDevice || {}).length > 0 && <><span className="text-muted">ตาม device</span><Breakdown rows={m.byDevice} testId={`task-devices-${id}`} /></>}
        </p>
      ) : null}
      {m?.detailSessions ? (
        <div className="mt-2 space-y-1 text-xs" data-testid={`task-tools-${id}`}>
          <p>
            <span className="text-muted">tool call </span><b>{m.detail.toolCalls.toLocaleString()}</b>
            <span className="text-muted"> · error </span><b>{m.detail.toolErrors}</b>
            <span className="text-muted"> · ถูกปฏิเสธ </span><b>{m.detail.toolDenials}</b>
            <span className="text-muted"> · thinking </span><b>{formatTokens(m.detail.reasoningTokens)}</b>
            <span className="text-muted"> · prompt </span><b>{m.detail.prompts}</b>
            <span className="text-muted"> · compaction </span><b>{m.detail.compactions}</b>
            {Object.keys(m.detail.models || {}).length > 0 && <span className="text-muted"> · {Object.entries(m.detail.models).map(([model, n]) => `${model} ${n}`).join(', ')}</span>}
          </p>
          <p className={styles.breakdown}>
            {topTools(m.detail).map((tool) => (
              <span key={tool.name} className={styles.breakdownChip} title={`error ${tool.errors}`}>{tool.name} <b>{tool.calls}</b>{tool.errors ? <span className="text-muted"> ({tool.errors} error)</span> : null}</span>
            ))}
          </p>
        </div>
      ) : m ? (
        <p className="mt-1 text-xs text-muted">ยังไม่มีรายละเอียด tool call ของ lane นี้</p>
      ) : (
        <p className="text-xs text-muted">ยังไม่วัด{lane ? ` — lane ${lane.id} ยังไม่มี session บน ${lane.branches.join(', ')}` : ' — task นี้ไม่อยู่ใน lane ใด'}</p>
      )}
    </div>
  )
}

function TaskUsageSummary({ usage, detailed = false }) {
  if (!usage) return null
  const plan = usage.plan?.predictedTokens
  const actual = usage.actual
  const used = actual?.tokens?.usedTokens
  return (
    <div className={styles.infoSec} data-testid={`task-usage-ledger-${usage.taskCode}`}>
      <span className={styles.secLabel}>Task usage ledger</span>
      <div className={styles.metricRow}>
        <span className={styles.metricLabel}>แผน</span>
        <span className={styles.metric} title="ค่าคาดการณ์จาก Task Container ไม่ใช่การวัดจริง">
          <b>{plan == null ? '—' : formatTokens(plan)}</b> token planned
        </span>
        <span className={`${styles.metricLabel} ${styles.metricLabelMeasured}`}>วัดจริง</span>
        {actual ? (
          <>
            <span className={styles.metric} title="input + cache write + output; cache read แสดงแยก"><b>{formatTokens(used)}</b> token used</span>
            <span className={styles.metricMuted}>cache read {formatTokens(actual.tokens.cacheReadTokens)} · {actual.requestCount} requests · {formatDuration(actual.activeMinutes)} active</span>
          </>
        ) : (
          <span className={styles.metricMuted}>ยังไม่มี actual — {usage.measurementStatus}</span>
        )}
      </div>
      <div className={styles.metricRow}>
        <span className={styles.metricLabel}>สถานะ</span>
        <span className={styles.metric}>{usage.measurementStatus}</span>
        <span className={styles.metricMuted}>reconciliation {usage.reconciliationStatus} · attribution {usage.attribution.kind}</span>
        {actual ? <span className={styles.metricMuted}>{actual.reportCount} report{actual.reportCount === 1 ? '' : 's'}</span> : null}
      </div>
      {detailed && usage.warnings?.length > 0 ? <p className="text-xs text-muted">warnings: {usage.warnings.join(', ')}</p> : null}
    </div>
  )
}

function TaskDetail({ id, status, container, laneUsage, lanes, member, taskUsage }) {
  if (!container) return <p className="mt-2 text-xs text-muted">No Task Container is recorded for {id} in the document.</p>
  return (
    <div className={styles.detail} data-testid={`task-detail-${id}`}>
      <div className={styles.kvGrid}>
        <div className={styles.kv}><div className={styles.k}>Code link</div><div className={styles.v}><RepoLink path={container.links.code} /></div></div>
        <div className={styles.kv}><div className={styles.k}>Doc link</div><div className={styles.v}><RepoLink path={container.links.doc} /></div></div>
        <div className={styles.kv}><div className={styles.k}>Test link</div><div className={styles.v}><RepoLink path={container.links.test} /></div></div>
      </div>
      <div className={styles.infoSec}>
        <div className={styles.kvGrid}>
          <div className={styles.kv}><div className={styles.k}>Task container</div><div className={styles.v}>{container.container} · v{container.version}</div></div>
          <div className={styles.kv}><div className={styles.k}>Parent</div><div className={styles.v}>{container.phase} / {container.sprint}</div></div>
          <div className={styles.kv}><div className={styles.k}>Status · people</div><div className={styles.v}>{status} · PIC {container.pic} · exec {container.executor} · approver {container.approver} · auditor {container.auditor}</div></div>
        </div>
      </div>
      <div className={styles.infoSec}>
        <span className={styles.secLabel}>Definition of Done</span>
        <div className={styles.dod}>
          <Criterion label="Acceptance" tone="Acceptance" item={container.dod.acceptance} />
          <Criterion label="Success" tone="Success" item={container.dod.success} />
          <Criterion label="Exit" tone="Exit" item={container.dod.exit} />
        </div>
      </div>
      {container.subtasks?.length > 0 && (
        <div className={styles.infoSec}>
          <span className={styles.secLabel}>Subtasks</span>
          <ul className="space-y-1">
            {container.subtasks.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                <code className="font-semibold">{s.id}</code><StatusPill status={badgeStatus(s.status)} /><span>{s.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <TaskUsageSummary usage={taskUsage} detailed />
      <LaneTelemetry id={id} laneUsage={laneUsage} lanes={lanes} member={member} />
      <div className={styles.infoSec}>
        <span className={styles.secLabel}>Changelog</span>
        <p className={styles.changelog}>{container.changelog}</p>
        <div className={styles.dep}>
          <span className={styles.k}>Dependencies</span>
          {container.dependsOn.length === 0 ? (
            <span className={styles.na}>none</span>
          ) : (
            container.dependsOn.map((dep) => (
              <a key={dep} href={`#task-${dep}`} className={styles.depCode}>{dep}</a>
            ))
          )}
          <span className="ml-auto text-[11px] text-muted">evidence: {container.evidence}</span>
        </div>
      </div>
    </div>
  )
}

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

// FR-211 (owner request 2026-09-13): a second view on the same operator page —
// the domain map & inventory, projected on the server from the generated
// domain-state snapshot and handed in as `domainMap`. `?view=domains` opens it
// directly; switching tabs rewrites only the query string, never navigates.
const VIEWS = [
  { id: 'programme', label: 'Programme plan', icon: Layers3 },
  { id: 'domains', label: 'Domain map & inventory', icon: Boxes },
  // FR-220 (ADR-087 D3): paired agent harness devices — activate or revoke.
  { id: 'devices', label: 'Agent devices', icon: MonitorSmartphone },
]

const toneOf = (status) => (status === 'done' ? 'done' : status === 'review' ? 'review' : null)

const NO_SIZING = { points: {}, effortHours: {} }
const closingLabel = (iso) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'short' })

export default function ProgramRoadmapBoard({
  domainMap = null,
  initialView = 'programme',
  laneUsage = {},
  usageReports = { available: false, count: 0 },
  taskEvidence = null,
  lanes = [],
  sizing = NO_SIZING,
  measuredThrough = null,
  taskUsageLedger = null,
  // FR-241 (ADR-092): 'member' is the signed-in view at /roadmap.
  audience = 'operator',
  closesAt = null,
}) {
  const member = audience === 'member'
  const views = member ? VIEWS.filter(({ id }) => id !== 'devices') : VIEWS
  const laneUsageMap = new Map(Object.entries(laneUsage))
  const taskUsageByCode = new Map((taskUsageLedger?.tasks || []).map((task) => [task.taskCode, task]))
  const [view, setView] = useState(domainMap && views.some(({ id }) => id !== 'programme' && id === initialView) ? initialView : 'programme')
  const selectView = (next) => {
    setView(next)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next === 'programme') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  const [openPhase, setOpenPhase] = useState('PHASE-ZAI-01')
  const [openTasks, setOpenTasks] = useState(() => new Set())
  const toggleTask = (id) =>
    setOpenTasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={member ? 'PLATFORM PROGRAMME · SIGNED-IN PREVIEW' : 'PLATFORM PROGRAMME · OPERATOR ONLY'}
        title="Zuri AI — 24-week delivery programme"
        subtitle="Read-only plan snapshot. It is not Business progress and it is not calculated from Git activity."
      />

      {member && closesAt && (
        <p className={styles.legend} data-testid="member-view-window">
          <ShieldCheck size={14} aria-hidden />
          เปิดให้ทุกคนที่เข้าสู่ระบบอ่านได้ถึง {closingLabel(closesAt)} · อ่านอย่างเดียว · ไม่แสดงยอดการใช้งานแยกตามคนหรือเครื่อง
        </p>
      )}

      {domainMap && (
        <div className={styles.tabs} role="tablist" aria-label="Roadmap views">
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`roadmap-tab-${id}`}
              aria-selected={view === id}
              aria-controls={`roadmap-panel-${id}`}
              className={styles.tab}
              onClick={() => selectView(id)}
            >
              <Icon size={15} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'devices' && domainMap && !member ? (
        <div role="tabpanel" id="roadmap-panel-devices" aria-labelledby="roadmap-tab-devices">
          <HarnessDevicesView />
        </div>
      ) : view === 'domains' && domainMap ? (
        <div role="tabpanel" id="roadmap-panel-domains" aria-labelledby="roadmap-tab-domains">
          <DomainMapView domainMap={domainMap} />
        </div>
      ) : (
      <div role={domainMap ? 'tabpanel' : undefined} id="roadmap-panel-programme" aria-labelledby={domainMap ? 'roadmap-tab-programme' : undefined} className="space-y-6">
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
          <div className={styles.legend} data-testid="delivery-legend">
            <Gauge size={14} aria-hidden />
            <span>badge:</span>
            {['done', 'review', 'fix', 'empty'].map((tone) => (
              <span key={tone} className={styles.badge} data-tone={tone}><span aria-hidden className={styles.badgeGlyph}>{TONE_GLYPH[tone]}</span>{TONE_WORD[tone]}</span>
            ))}
            <span className="text-muted">
              · วัดจริงถึง {measuredThrough ? `${measuredThrough.slice(0, 16).replace('T', ' ')} UTC` : '—'} จาก log ของ agent
              · รายงานจาก agent {usageReports.available ? `${usageReports.count} รายงาน` : 'ยังไม่เปิดใช้ (migration ยังไม่ apply)'}
              {laneUsage[UNATTRIBUTED_LANE] ? `· ยังไม่ผูก lane ${laneUsage[UNATTRIBUTED_LANE].sessions} รายงาน (${formatTokens(tokensUsed(laneUsage[UNATTRIBUTED_LANE].tokens))} token)` : ''}
              · effort: C-1 {sizing.effortHours['C-1'] ?? '—'} ชม. · C-2 {sizing.effortHours['C-2'] ?? '—'} ชม. · C-3 {sizing.effortHours['C-3'] ?? '—'} ชม.
            </span>
          </div>
          <div className="space-y-3">
            {PROGRAMME_PHASES.map((phase) => {
              const expanded = openPhase === phase.id
              const tasks = PROGRAMME_TASKS.filter((task) => phase.sprints.some((sprint) => sprint.id === task[1]))
              const metrics = phaseDeliveryMetrics({
                phase, tasks: PROGRAMME_TASKS, containers: PROGRAMME_CONTAINERS, sizing, lanes, laneUsage: laneUsageMap,
              })
              return (
                <Card key={phase.id} className={`p-0 ${styles.phase}`} data-tone={toneOf(phase.status) || undefined} data-testid={`phase-card-${phase.id}`}>
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
                  <PhaseMetrics phase={phase} metrics={metrics} member={member} />
                  <ProgressBar percent={phase.progress} label={`${phase.id} submitted plan progress`} />
                  {expanded && (
                    <div className={`space-y-4 p-4 ${styles.phaseBody}`}>
                      {phase.sprints.map((sprint) => (
                        <div key={sprint.id} className={styles.sprint} data-tone={toneOf(sprint.status) || undefined}>
                          <div className={`flex flex-wrap items-center gap-2 ${styles.sprintHead}`}>
                            <strong className="text-sm">{sprint.id}</strong><StatusPill status={badgeStatus(sprint.status)} />
                            <span className="text-xs text-muted">{sprint.weeks} · {sprint.dates}</span>
                            <span className="ml-auto text-xs text-muted">plan {sprint.progress}%</span>
                          </div>
                          <p className="mb-2 text-xs text-muted">{sprint.goal}</p>
                          <ul className="space-y-2" aria-label={`${sprint.id} tasks`}>
                            {tasks.filter((task) => task[1] === sprint.id).map(([id, , title, type, complexity, scope, status]) => {
                              const open = openTasks.has(id)
                              const container = PROGRAMME_CONTAINERS[id]
                              return (
                                <TiltCard as="li" key={id} id={`task-${id}`} className={`${styles.task} ${open ? styles.taskOpen : ''}`} data-status={status} data-open={open ? 'true' : 'false'}>
                                  <button
                                    type="button"
                                    className={`flex w-full items-start gap-3 p-3 text-left ${styles.taskHead}`}
                                    onClick={() => toggleTask(id)}
                                    aria-expanded={open}
                                    aria-controls={`task-detail-${id}`}
                                  >
                                    <span className={styles.taskDot} aria-hidden />
                                    <span className="min-w-0 flex-1">
                                      <span className="flex flex-wrap items-center gap-2">
                                        <code className="text-[11px] font-semibold">{id}</code><StatusPill status={badgeStatus(status)} />
                                        <span className="ml-auto text-[11px] text-muted" title={`complexity ${complexity}`}>{type} · {scope}</span>
                                        {container && <span className="text-[11px] text-muted">PIC <b className="text-[var(--text-primary)]">{container.pic}</b> · plan {container.predictedTokens.toLocaleString()} tok</span>}
                                        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                                      </span>
                                      <span className="mt-1 block text-sm font-semibold">{title}</span>
                                    </span>
                                  </button>
                                  <div className={styles.taskMeta}>
                                    <EvidenceBadges id={id} evidence={taskEvidence?.[id]} />
                                    <SubtaskBar id={id} subtasks={container?.subtasks || []} />
                                    {taskUsageByCode.has(id) && <TaskUsageSummary usage={taskUsageByCode.get(id)} />}
                                  </div>
                                  {open && (
                                    <div id={`task-detail-${id}`}>
                                      <TaskDetail id={id} status={status} container={container} laneUsage={laneUsage} lanes={lanes} member={member} taskUsage={taskUsageByCode.get(id)} />
                                    </div>
                                  )}
                                </TiltCard>
                              )
                            })}
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
      )}
    </div>
  )
}
