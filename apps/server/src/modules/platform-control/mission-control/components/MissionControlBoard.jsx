'use client'

// @req FR-260 — render the installation-operator Mission Control projection.
// @req FR-261 — show source, freshness, proof scope and NOT_RUN explicitly.
// @req FR-262 — show candidate-parallel work and the first unmet merge gate.
// @req FR-264 — keep the read-only evidence view keyboard accessible and
// mobile-scannable without document-level horizontal overflow.
// @spec ADR-048 D1-D3, ADR-086 D1/D7, ADR-092 D3, NFR-008
// @tested tests/unit/mission-control-route-contract.test.js, tests/e2e/fr260-mission-control.spec.js

import { Card, Kpi, PageHeader, StatusPill } from '@/components/ui'
import styles from './mission-control-board.module.css'

const stateLabel = {
  LIVE: 'LIVE',
  SNAPSHOT: 'SNAPSHOT',
  UNKNOWN: 'UNKNOWN',
  NOT_RUN: 'NOT RUN',
  BLOCKED: 'BLOCKED',
  MERGE_SAFE: 'MERGE SAFE',
  NOT_SAFE: 'NOT MERGE SAFE',
  CANDIDATE_PARALLEL: 'CANDIDATE PARALLEL',
  PASS: 'PASS',
  FAIL: 'FAIL',
}

function StateBadge({ value }) {
  const label = stateLabel[value] || String(value || 'UNKNOWN').replace(/_/g, ' ')
  return (
    <span className={styles.stateBadge} data-state={value || 'UNKNOWN'}>
      {label}
    </span>
  )
}

function SourceStamp({ source, observedAt, capturedAt }) {
  const stamp = observedAt || capturedAt
  return (
    <span className={styles.sourceStamp}>
      <span>{source?.ref || 'PORL unavailable'}</span>
      {stamp ? <time dateTime={stamp}>{stamp.replace('T', ' ').replace('.000Z', 'Z')}</time> : <span>time unavailable</span>}
    </span>
  )
}

function GateTrace({ pair }) {
  return (
    <div className={styles.gateTrace} aria-label="Merge gate trace">
      <StateBadge value={pair.scheduling} />
      <span aria-hidden className={styles.traceArrow}>→</span>
      {pair.gates.map((item) => (
        <span key={item.id} className={styles.gateItem} data-gate-state={item.state} title={item.reason}>
          <b>{item.id}</b> <StateBadge value={item.state} />
        </span>
      ))}
    </div>
  )
}

function TaskRow({ task }) {
  return (
    <tr data-testid={'mission-task-' + task.id}>
      <th scope="row">
        <code>{task.id}</code>
        <span className={styles.taskTitle}>{task.title}</span>
      </th>
      <td><StatusPill status={String(task.status || '').toUpperCase().replace(/-/g, '_')} /></td>
      <td><StateBadge value={task.execution.freshness} /></td>
      <td><StateBadge value={task.execution.runState} /></td>
      <td><StateBadge value={task.execution.proofScope} /></td>
      <td><SourceStamp source={task.execution.source} observedAt={task.execution.observedAt} capturedAt={task.execution.capturedAt} /></td>
    </tr>
  )
}

export default function MissionControlBoard({ model }) {
  const taskById = new Map(model.tasks.map((task) => [task.id, task]))
  const visiblePairs = model.candidateParallelPairs.slice(0, 36)
  const liveCount = model.porl.freshnessCounts.LIVE || 0
  const snapshotCount = model.porl.freshnessCounts.SNAPSHOT || 0
  const unknownCount = model.porl.freshnessCounts.UNKNOWN || 0

  return (
    <div className={styles.root} data-testid="mission-control-view">
      <PageHeader
        eyebrow="MISSION CONTROL · INSTALLATION OPERATOR"
        title="DAG orchestration observability"
        subtitle="Read-only projection of the canonical roadmap DAG and provenance-bound orchestration observations."
        actions={<span className={styles.readOnlyMark}>READ ONLY</span>}
      />

      <div className={styles.authorityBanner} role="note" data-testid="mission-control-authority">
        <div>
          <b>Source of truth</b>
          <span><code>{model.authority.source}</code> → <code>{model.authority.generatedProjection}</code></span>
        </div>
        <span>{model.authority.parallelPolicy}</span>
      </div>

      <div className={styles.kpiGrid}>
        <Kpi label="Roadmap nodes" value={model.authority.nodeCount} meta={model.authority.edgeCount + ' dependency edges'} />
        <Kpi label="Topological waves" value={model.authority.waveCount} meta={model.summary.candidateParallelPairCount + ' candidate pairs'} />
        <Kpi label="PORL observations" value={model.porl.observationCount} meta={model.porl.availability + ' · ' + model.porl.reason} tone={model.porl.observationCount > 0 ? 'good' : 'warn'} />
        <Kpi label="Blocked roadmap tasks" value={model.summary.blockedTaskCount} meta={model.summary.notSafePairCount + ' pairs not merge-safe'} tone={model.summary.blockedTaskCount > 0 ? 'bad' : 'good'} />
      </div>

      <div className={styles.panelGrid}>
        <Card className={styles.porlCard} data-testid="mission-control-porl">
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>PORL read boundary</p>
              <h2>Execution evidence</h2>
            </div>
            <StateBadge value={model.porl.observationCount > 0 ? 'SNAPSHOT' : 'UNKNOWN'} />
          </div>
          <p className={styles.bodyCopy}>
            No orchestration writer or connector is configured in this release. Missing records are not idle, successful, or live.
          </p>
          <dl className={styles.definitionList}>
            <div><dt>Source</dt><dd>{model.porl.source.ref}</dd></div>
            <div><dt>LIVE</dt><dd>{liveCount}</dd></div>
            <div><dt>SNAPSHOT</dt><dd>{snapshotCount}</dd></div>
            <div><dt>UNKNOWN</dt><dd>{unknownCount}</dd></div>
            <div><dt>Checks</dt><dd><StateBadge value="NOT_RUN" /></dd></div>
          </dl>
          {model.porl.quarantinedCount > 0 ? <p className={styles.warning}>Quarantined records: {model.porl.quarantinedCount}. They do not enter the projection.</p> : null}
        </Card>

        <Card className={styles.blockerCard} data-testid="mission-control-blockers">
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>Roadmap blockers</p>
              <h2>What still prevents acceptance</h2>
            </div>
            <StateBadge value="BLOCKED" />
          </div>
          <div className={styles.blockerList}>
            {model.blockers.map((blocker) => (
              <details key={blocker.id} open>
                <summary>
                  <span>{blocker.label}</span>
                  <StateBadge value={blocker.state} />
                </summary>
                <p>{blocker.reason}</p>
                <ul>
                  {blocker.tasks.map((task) => (
                    <li key={task.id}>
                      <code>{task.id}</code> <span>{task.title}</span>
                    </li>
                  ))}
                </ul>
                {blocker.externalDependency ? <p className={styles.externalNote}>External dependency named by the roadmap: <b>{blocker.externalDependency}</b></p> : null}
              </details>
            ))}
          </div>
        </Card>
      </div>

      <Card className={styles.gatesCard} data-testid="mission-control-gates">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.eyebrow}>Scheduling versus merge safety</p>
            <h2>Candidate-parallel gate traces</h2>
          </div>
          <span className={styles.muted}>{visiblePairs.length} of {model.candidateParallelPairs.length} pairs shown</span>
        </div>
        <p className={styles.bodyCopy}>
          Same-wave placement is only a candidate. A pair becomes merge-safe only when every gate passes; an unknown gate stays unknown.
        </p>
        <div className={styles.tableViewport}>
          <table className={styles.table} aria-label="Candidate parallel merge safety gates">
            <thead>
              <tr>
                <th scope="col">Wave</th>
                <th scope="col">Tasks</th>
                <th scope="col">Result</th>
                <th scope="col">First unmet gate</th>
                <th scope="col">Trace</th>
              </tr>
            </thead>
            <tbody>
              {visiblePairs.map((pair) => (
                <tr key={pair.id}>
                  <td>{pair.wave}</td>
                  <td><code>{pair.taskIds.join(' ↔ ')}</code></td>
                  <td><StateBadge value={pair.mergeState} /></td>
                  <td>{pair.firstUnmet ? <><b>{pair.firstUnmet.id}</b><span className={styles.cellNote}>{pair.firstUnmet.reason}</span></> : 'all gates pass'}</td>
                  <td><GateTrace pair={pair} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className={styles.wavesCard} data-testid="mission-control-waves">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.eyebrow}>Canonical DAG</p>
            <h2>Roadmap waves and evidence</h2>
          </div>
          <span className={styles.muted}>{model.authority.nodeCount} tasks · {model.authority.waveCount} waves</span>
        </div>
        <div className={styles.waveList}>
          {model.waves.map((wave) => (
            <details key={wave.wave} open={wave.wave === 1}>
              <summary>
                <span>Wave {wave.wave}</span>
                <span className={styles.summaryMeta}>{wave.taskIds.length} tasks · {wave.candidatePairCount} candidate pairs</span>
              </summary>
              <div className={styles.tableViewport}>
                <table className={styles.table} aria-label={'Wave ' + wave.wave + ' roadmap tasks'}>
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">SOT</th>
                      <th scope="col">Freshness</th>
                      <th scope="col">Run</th>
                      <th scope="col">Proof</th>
                      <th scope="col">Source / time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wave.taskIds.map((id) => taskById.has(id) ? <TaskRow key={id} task={taskById.get(id)} /> : null)}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </Card>
    </div>
  )
}
