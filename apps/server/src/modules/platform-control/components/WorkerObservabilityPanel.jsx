'use client'

import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, GitBranch, Radio, ShieldCheck } from 'lucide-react'
import { Card, Kpi } from '@/components/ui'
import { unknownWorkerObservabilitySnapshot } from '../worker-observability-contract'
import styles from './worker-observability-panel.module.css'

const POLL_MS = 5000
const EMPTY_SNAPSHOT = unknownWorkerObservabilitySnapshot('LOADING')

function timeLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  return new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function shortHash(value) {
  return typeof value === 'string' ? value.slice(0, 12) : '—'
}

function countLabel(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : '—'
}

export function collectLocalChanges(previous, next) {
  const changes = []
  const beforeTags = new Map((previous.tags || []).map((tag) => [tag.name, tag.objectId]))
  const afterTags = new Map((next.localTags || []).map((tag) => [tag.name, tag.objectId]))
  for (const [name, objectId] of afterTags) {
    if (beforeTags.get(name) !== objectId) changes.push({ kind: 'LOCAL_TAG_ADDED_OR_MOVED', label: name, observedAt: next.observedAt })
  }
  for (const name of beforeTags.keys()) {
    if (!afterTags.has(name)) changes.push({ kind: 'LOCAL_TAG_REMOVED', label: name, observedAt: next.observedAt })
  }
  if (previous.headCommit && next.localStatus?.headCommit && previous.headCommit !== next.localStatus.headCommit) {
    changes.push({ kind: 'LOCAL_HEAD_CHANGED', label: shortHash(next.localStatus.headCommit), observedAt: next.observedAt })
  }
  if (previous.fingerprint && next.localStatus?.fingerprint && previous.fingerprint !== next.localStatus.fingerprint) {
    changes.push({ kind: 'LOCAL_WORKTREE_CHANGED', label: `${countLabel(next.localStatus.changedFiles)} changed files`, observedAt: next.observedAt })
  }
  return changes
}

export default function WorkerObservabilityPanel() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [connection, setConnection] = useState('loading')
  const [localChanges, setLocalChanges] = useState([])
  const baseline = useRef(null)

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let timer = null
    let activeController = null
    const openedAt = new Date().toISOString()

    const refresh = async () => {
      if (disposed || inFlight) return
      inFlight = true
      activeController = new AbortController()
      try {
        const query = new URLSearchParams({ since: openedAt })
        const response = await fetch(`/api/platform/worker-observability?${query}`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: activeController.signal,
        })
        if (response.status === 401 || response.status === 403) {
          if (!disposed) {
            setConnection('unauthorized')
            setSnapshot(unknownWorkerObservabilitySnapshot('AUTH_REQUIRED'))
          }
          return
        }
        if (!response.ok) throw new Error('SOURCE_UNAVAILABLE')
        const next = await response.json()
        if (disposed) return
        if (next?.schemaVersion !== 'worker-observability/v1' || !['LIVE', 'UNKNOWN'].includes(next.state)) {
          setSnapshot(unknownWorkerObservabilitySnapshot('SOURCE_INVALID'))
          setConnection('unknown')
          return
        }
        if (next.state === 'LIVE' && baseline.current) {
          const additions = collectLocalChanges(baseline.current, next)
          if (additions.length) setLocalChanges((current) => [...additions, ...current].slice(0, 100))
        }
        if (next.state === 'LIVE') {
          baseline.current = {
            tags: Array.isArray(next.localTags) ? next.localTags : [],
            headCommit: next.localStatus?.headCommit ?? null,
            fingerprint: next.localStatus?.fingerprint ?? null,
          }
        }
        setSnapshot(next)
        setConnection(next.state === 'LIVE' ? 'connected' : 'unknown')
      } catch (error) {
        if (!disposed && error?.name !== 'AbortError') {
          setSnapshot(unknownWorkerObservabilitySnapshot('SOURCE_UNAVAILABLE'))
          setConnection('unavailable')
        }
      } finally {
        inFlight = false
        if (!disposed) timer = setTimeout(refresh, POLL_MS)
      }
    }

    refresh()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      activeController?.abort()
    }
  }, [])

  const isLive = snapshot.state === 'LIVE'
  const statusLabel = connection === 'connected' ? 'LIVE · LOCAL' : connection === 'loading' ? 'กำลังอ่านข้อมูล' : connection === 'unauthorized' ? 'ไม่มีสิทธิ์อ่าน' : 'UNKNOWN'

  return (
    <section className={styles.panel} data-testid="worker-observability-panel" aria-labelledby="worker-observability-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>LOCAL CONTROLLER · READ ONLY</p>
          <h2 id="worker-observability-title">Workers and activity</h2>
          <p className={styles.description}>สถานะจาก controller ledger และ local event receipts ณ เวลาที่อ่าน ไม่มีคำสั่ง dispatch, retry, merge หรือ deploy ในหน้านี้</p>
        </div>
        <span className={styles.connection} data-state={connection} role="status">
          <Radio size={14} aria-hidden /> {statusLabel}
        </span>
      </div>

      {snapshot.state === 'UNKNOWN' && (
        <div className={styles.notice} role="status" data-testid="worker-source-unknown">
          <AlertTriangle size={17} aria-hidden />
          <span>อ่านข้อมูล worker ไม่ได้หรือหลักฐานไม่ครบ จึงแสดง UNKNOWN แทนการคาดเดา{snapshot.reason && snapshot.reason !== 'LOADING' ? ` · ${snapshot.reason}` : ''}</span>
        </div>
      )}

      <div className={styles.kpis} aria-label="Worker summary">
        <Kpi label="Workers active" value={isLive ? countLabel(snapshot.summary.activeWorkers) : '—'} meta={isLive ? `${countLabel(snapshot.summary.activeTasks)} task` : 'UNKNOWN'} />
        <Kpi label="Queued" value={isLive ? countLabel(snapshot.summary.queuedWorkers) : '—'} meta="persisted READY stages" />
        <Kpi label="Mode" value={isLive ? snapshot.summary.mode : 'UNKNOWN'} meta="distinct task leases" />
        <Kpi label="Last read" value={timeLabel(snapshot.observedAt)} meta={isLive ? 'local snapshot' : 'source not verified'} />
      </div>

      <Card className={styles.subsection}>
        <div className={styles.sectionHeading}>
          <Activity size={16} aria-hidden />
          <h3>Assignments</h3>
          <span className={styles.muted}>opaque references · no prompt, path, session, owner, model, or effort</span>
        </div>
        {isLive && snapshot.assignments.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Ref</th><th scope="col">Task / cycle</th><th scope="col">Role / stage</th><th scope="col">State / attempt</th><th scope="col">Lease</th><th scope="col">Checked head</th><th scope="col">Context</th></tr></thead>
              <tbody>{snapshot.assignments.map((assignment) => (
                <tr key={assignment.assignmentRef} data-testid={`worker-assignment-${assignment.assignmentRef}`}>
                  <td><code>{assignment.assignmentRef}</code></td>
                  <td><code>{assignment.taskId}</code><span className={styles.muted}> · cycle {assignment.cycleNo}</span></td>
                  <td>{assignment.role}<span className={styles.muted}> · {assignment.stage}</span></td>
                  <td><span data-state={assignment.state}>{assignment.state}</span><span className={styles.muted}> · attempt {assignment.attempt}</span></td>
                  <td><span data-state={assignment.lease.state}>{assignment.lease.state}</span>{assignment.lease.ageMs == null ? null : <span className={styles.muted}> · {assignment.lease.ageMs} ms</span>}</td>
                  <td><code title={assignment.checkedHeadCommit || ''}>{shortHash(assignment.checkedHeadCommit)}</code></td>
                  <td><span className={styles.context}><ShieldCheck size={13} aria-hidden />{assignment.contextMemory?.state || 'NOT_CAPTURED'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>{isLive ? 'ไม่มี assignment ใน current cycle' : 'ไม่มีข้อมูลที่ยืนยันได้'}</p>}
      </Card>

      <Card className={styles.subsection}>
        <div className={styles.sectionHeading}><GitBranch size={16} aria-hidden /><h3>Tasks and local CI receipts</h3><span className={styles.muted}>receipt must match current head and base</span></div>
        {isLive && snapshot.tasks.length ? (
          <div className={styles.taskList}>{snapshot.tasks.map((task) => (
            <article className={styles.task} key={`${task.taskId}:${task.cycleNo}`} data-testid={`worker-task-${task.taskId}`}>
              <div className={styles.taskTitle}><strong><code>{task.taskId}</code></strong><span className={styles.muted}>cycle {task.cycleNo} · {task.state}</span></div>
              <div className={styles.hashes}><span>base <code title={task.baseCommit || ''}>{shortHash(task.baseCommit)}</code></span><span>candidate <code title={task.candidateHeadCommit || ''}>{shortHash(task.candidateHeadCommit)}</code></span></div>
              <p className={styles.ci}>CI receipt (local): <strong data-state={task.ci?.state || 'UNKNOWN'}>{task.ci?.state || 'UNKNOWN'}</strong>
                <span className={styles.muted}> · pass {countLabel(task.ci?.checks?.passed)} / fail {countLabel(task.ci?.checks?.failed)} / pending {countLabel(task.ci?.checks?.pending)} / unknown {countLabel(task.ci?.checks?.unknown)}</span>
                {task.ci?.observedAt ? <span className={styles.muted}> · {timeLabel(task.ci.observedAt)}</span> : null}
              </p>
            </article>
          ))}</div>
        ) : <p className={styles.empty}>{isLive ? 'ยังไม่มี task ใน controller ledger' : 'ไม่มีข้อมูลที่ยืนยันได้'}</p>}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.subsection}>
          <div className={styles.sectionHeading}><Activity size={16} aria-hidden /><h3>Events since this page opened</h3><span className={styles.muted}>{snapshot.events?.length || 0}</span></div>
          {snapshot.events?.length ? <ol className={styles.events}>{snapshot.events.slice(0, 50).map((event, index) => <li key={`${event.kind}:${event.sequence ?? index}:${event.observedAt}`}>
            <time dateTime={event.observedAt}>{timeLabel(event.observedAt)}</time><strong>{event.kind}</strong><span>{event.taskId || 'controller'}{event.cycleNo ? ` · cycle ${event.cycleNo}` : ''}{event.role ? ` · ${event.role}` : ''}</span><span data-state={event.status}>{event.status}</span>
          </li>)}</ol> : <p className={styles.empty}>ยังไม่มี event ในช่วงเวลานี้</p>}
        </Card>
        <Card className={styles.subsection}>
          <div className={styles.sectionHeading}><GitBranch size={16} aria-hidden /><h3>Local status and tags</h3></div>
          <p className={styles.statusLine}>Working tree: <strong>{isLive && snapshot.localStatus.changedFiles != null ? `${snapshot.localStatus.changedFiles} changed files` : 'UNKNOWN'}</strong></p>
          <p className={styles.muted}>head <code title={snapshot.localStatus.headCommit || ''}>{shortHash(snapshot.localStatus.headCommit)}</code> · fingerprint <code title={snapshot.localStatus.fingerprint || ''}>{shortHash(snapshot.localStatus.fingerprint)}</code></p>
          <p className={styles.statusLine}>Local tags: <strong>{isLive ? countLabel(snapshot.localTagCount) : 'UNKNOWN'}</strong>{snapshot.localTagsTruncated ? ' · list truncated' : ''}</p>
          <ul className={styles.tags}>{(snapshot.localTags || []).slice(0, 40).map((tag) => <li key={tag.name}><code>{tag.name}</code><span title={tag.objectId}>{shortHash(tag.objectId)}</span></li>)}</ul>
          <h4 className={styles.changeTitle}>Changes observed since page opened</h4>
          {localChanges.length ? <ul className={styles.changes}>{localChanges.slice(0, 30).map((change, index) => <li key={`${change.kind}:${change.label}:${change.observedAt}:${index}`}><time dateTime={change.observedAt}>{timeLabel(change.observedAt)}</time><strong>{change.kind}</strong><span>{change.label}</span></li>)}</ul> : <p className={styles.empty}>กำลังเก็บ baseline จาก snapshot แรก</p>}
        </Card>
      </div>

      <p className={styles.footer}>Proof scope: local snapshot only · controller event chain <strong>{snapshot.source?.eventChain || 'UNKNOWN'}</strong> · supervisor receipts <strong>{snapshot.source?.supervisorReceipts || 'NOT_CAPTURED'}</strong> · local CI receipt source <strong>{snapshot.source?.ciReceipts || 'UNKNOWN'}</strong>. Context or memory lineage is <strong>NOT_CAPTURED</strong> unless a verified content-free receipt exists. This view makes no hosted, PORL, or production claim.</p>
    </section>
  )
}
