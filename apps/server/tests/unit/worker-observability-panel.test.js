import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import WorkerObservabilityPanel, {
  classifyWorkerObservabilityFailure,
  collectLocalChanges,
  createInitialWorkerObservabilityState,
  reduceWorkerObservabilityState,
  TaskWorktreeStatus,
} from '@/modules/platform-control/components/WorkerObservabilityPanel'
import { readWorkerObservabilitySource } from '@/modules/platform-control/application/worker-observability-source'
import { unknownWorkerObservabilitySnapshot } from '@/modules/platform-control/worker-observability-contract'

globalThis.React = React

describe('worker observability UI', () => {
  it('shows a truthful local-only panel with memory marked NOT_CAPTURED and no actions', () => {
    const html = renderToStaticMarkup(createElement(WorkerObservabilityPanel))
    expect(html).toContain('LOCAL CONTROLLER')
    expect(html).toContain('Active role assignments')
    expect(html).toContain('not process counts')
    expect(html).toContain('does not show Codex sessions or every workspace')
    expect(html).toContain('NOT_CAPTURED')
    expect(html).toContain('worker-source-unknown')
    expect(html).toContain('UNKNOWN')
    expect(html).toContain('Events since this page opened')
    expect(html).not.toMatch(/<button\b/i)
  })

  it('distinguishes missing sessions, Installation Operator access, and unavailable session service', () => {
    expect(classifyWorkerObservabilityFailure(401, 'AUTH_REQUIRED')).toMatchObject({
      connection: 'auth-required',
      reason: 'AUTH_REQUIRED',
      label: 'ต้องเข้าสู่ระบบใหม่',
      message: 'เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่',
    })
    expect(classifyWorkerObservabilityFailure(403, 'OPERATOR_REQUIRED')).toMatchObject({
      connection: 'operator-required',
      reason: 'OPERATOR_REQUIRED',
      label: 'ไม่มีสิทธิ์ Installation Operator',
      message: 'บัญชีนี้ไม่มีสิทธิ์ Installation Operator',
    })
    expect(classifyWorkerObservabilityFailure(503, 'SESSION_UNAVAILABLE')).toMatchObject({
      connection: 'session-unavailable',
      reason: 'SESSION_UNAVAILABLE',
      label: 'บริการเซสชันไม่พร้อมชั่วคราว',
      message: 'บริการตรวจสอบเซสชันไม่พร้อมชั่วคราว กรุณาลองอีกครั้งภายหลัง',
    })
  })

  it('keeps other safe 403 errors distinct from authentication and hides unsafe error text', () => {
    expect(classifyWorkerObservabilityFailure(403, 'SAME_ORIGIN_REQUIRED')).toMatchObject({
      connection: 'forbidden',
      reason: 'SAME_ORIGIN_REQUIRED',
      label: 'คำขอไม่ตรงกับเว็บไซต์ต้นทาง',
    })
    expect(classifyWorkerObservabilityFailure(403, 'SCOPE_NOT_AVAILABLE')).toMatchObject({
      connection: 'forbidden',
      reason: 'SCOPE_NOT_AVAILABLE',
      label: 'คำขอถูกปฏิเสธ',
    })
    expect(classifyWorkerObservabilityFailure(403, '<script>alert(1)</script>')).toMatchObject({
      connection: 'forbidden',
      reason: 'HTTP_403',
      label: 'คำขอถูกปฏิเสธ',
    })
    expect(classifyWorkerObservabilityFailure(503, 'SERVICE_UNAVAILABLE')).toBeNull()
  })

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'OPERATOR_REQUIRED'],
  ])('clears previously observed history after HTTP %i and establishes a fresh baseline on recovery', (status, code) => {
    const liveSnapshot = (tag, objectId, head, fingerprint) => ({
      schemaVersion: 'worker-observability/v1',
      state: 'LIVE',
      localTags: [{ name: tag, objectId }],
      localTagsTruncated: false,
      localStatus: { headCommit: head, fingerprint, changedFiles: 2 },
      observedAt: '2026-10-17T06:00:00.000Z',
    })

    let state = createInitialWorkerObservabilityState()
    state = reduceWorkerObservabilityState(state, {
      type: 'snapshot',
      snapshot: liveSnapshot('private-tag-before', 'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(64)),
    })
    state = reduceWorkerObservabilityState(state, {
      type: 'snapshot',
      snapshot: liveSnapshot('private-tag-after', 'd'.repeat(40), 'e'.repeat(40), 'f'.repeat(64)),
    })
    expect(state.localChanges.length).toBeGreaterThan(0)

    state = reduceWorkerObservabilityState(state, {
      type: 'failure',
      failure: classifyWorkerObservabilityFailure(status, code),
    })
    expect(state.snapshot.state).toBe('UNKNOWN')
    expect(state.snapshot.reason).toBe(code)
    expect(state.localChanges).toEqual([])
    expect(state.baseline).toBeNull()
    expect(JSON.stringify(state)).not.toContain('private-tag')

    state = reduceWorkerObservabilityState(state, {
      type: 'snapshot',
      snapshot: liveSnapshot('private-tag-after-recovery', '1'.repeat(40), '2'.repeat(40), '3'.repeat(64)),
    })
    expect(state.snapshot.state).toBe('LIVE')
    expect(state.failure).toBeNull()
    expect(state.localChanges).toEqual([])
  })

  it('adds a Workers tab for operators while keeping it out of the member board', () => {
    const operator = renderToStaticMarkup(createElement(ProgramRoadmapBoard, { domainMap: {}, initialView: 'workers' }))
    const member = renderToStaticMarkup(createElement(ProgramRoadmapBoard, { domainMap: {}, initialView: 'workers', audience: 'member' }))
    expect(operator).toContain('roadmap-tab-workers')
    expect(operator).toContain('worker-observability-panel')
    expect(member).not.toContain('roadmap-tab-workers')
    expect(member).not.toContain('worker-observability-panel')
  })

  it('records only local tag and working-tree transitions after the first baseline', () => {
    const changes = collectLocalChanges({
      tags: [{ name: 'release-a', objectId: 'a'.repeat(40) }],
      headCommit: 'b'.repeat(40),
      fingerprint: 'c'.repeat(64),
    }, {
      localTags: [{ name: 'release-b', objectId: 'd'.repeat(40) }],
      localStatus: { headCommit: 'e'.repeat(40), fingerprint: 'f'.repeat(64), changedFiles: 2 },
      observedAt: '2026-10-16T04:00:00.000Z',
    })
    expect(changes.map(({ kind }) => kind)).toEqual([
      'LOCAL_TAG_ADDED_OR_MOVED', 'LOCAL_TAG_REMOVED', 'LOCAL_HEAD_CHANGED', 'LOCAL_WORKTREE_CHANGED',
    ])
    expect(JSON.stringify(changes)).not.toContain('file/path')
  })

  it('reports only an aggregate tag-set transition when either displayed list is truncated', () => {
    const changes = collectLocalChanges({
      tags: [{ name: 'visible-old', objectId: 'a'.repeat(40) }],
      tagsTruncated: true,
      tagSetFingerprint: 'b'.repeat(64),
      headCommit: null,
      fingerprint: null,
    }, {
      localTags: [{ name: 'visible-new', objectId: 'c'.repeat(40) }],
      localTagsTruncated: true,
      localTagSetFingerprint: 'd'.repeat(64),
      localStatus: {},
      observedAt: '2026-10-16T04:00:00.000Z',
    })
    expect(changes).toEqual([{
      kind: 'LOCAL_TAG_SET_CHANGED',
      label: 'aggregate-only change (tag list truncated)',
      observedAt: '2026-10-16T04:00:00.000Z',
    }])

    const withoutFingerprint = collectLocalChanges({ tags: [{ name: 'visible-old', objectId: 'a'.repeat(40) }], tagsTruncated: true }, {
      localTags: [{ name: 'visible-new', objectId: 'c'.repeat(40) }], localTagsTruncated: true, localStatus: {},
    })
    expect(withoutFingerprint).toEqual([])
  })

  it('accepts sanitized task worktree status while keeping context lineage NOT_CAPTURED', () => {
    const observedAt = '2026-10-17T06:00:00.000Z'
    const headCommit = 'a'.repeat(40)
    const snapshot = unknownWorkerObservabilitySnapshot('TEST', new Date(observedAt))
    snapshot.state = 'LIVE'
    snapshot.freshness = 'SNAPSHOT'
    snapshot.source.controllerLiveness = 'VERIFIED'
    snapshot.source.eventChain = 'VERIFIED'
    snapshot.summary = { activeWorkers: 1, queuedWorkers: 0, activeTasks: 1, mode: 'SOLO' }
    snapshot.assignments = [{
      assignmentRef: 'worker-001', taskId: 'TASK-ZAI-119', cycleNo: 1, role: 'worker', stage: 'WORKER_IMPLEMENTATION',
      state: 'RUNNING', attempt: 1, checkedHeadCommit: headCommit,
      lease: { state: 'FRESH', heartbeatAt: observedAt, ageMs: 0, active: true }, active: true, queued: false,
      localCheck: { state: 'NOT_CAPTURED', scope: 'LOCAL_ONLY', receiptDigest: null },
      contextMemory: { state: 'NOT_CAPTURED', sourceKindCounts: [], digest: null },
    }]
    snapshot.localStatus = {
      changedFiles: 0, fingerprint: null, headCommit, observedAt,
      taskWorktrees: [{
        workspaceRef: 'workspace-0123456789abcdef', taskId: 'TASK-ZAI-119', cycleNo: 1,
        branch: 'codex/task-zai-119', headCommit, dirtyFileCount: 2,
        candidateHeadMatch: 'MATCH', verificationState: 'VERIFIED', reason: null, observedAt,
      }],
    }
    const root = mkdtempSync(path.join(tmpdir(), 'worker-observability-source-'))
    const filePath = path.join(root, 'snapshot.json')
    try {
      writeFileSync(filePath, JSON.stringify(snapshot))
      const read = readWorkerObservabilitySource({ filePath, now: () => new Date(observedAt) })
      expect(read.state).toBe('LIVE')
      expect(read.localStatus.taskWorktrees[0]).toMatchObject({
        workspaceRef: 'workspace-0123456789abcdef', taskId: 'TASK-ZAI-119',
        branch: 'codex/task-zai-119', headCommit, dirtyFileCount: 2, candidateHeadMatch: 'MATCH',
      })
      expect(read.assignments[0].contextMemory).toEqual({ state: 'NOT_CAPTURED', sourceKindCounts: [], digest: null })
      const serialized = JSON.stringify(read)
      expect(serialized).not.toContain(root)
      expect(serialized).not.toMatch(/prompt|session|owner|model|credential|absolutePath/i)

      snapshot.assignments[0].contextMemory = { state: 'CAPTURED', sourceKindCounts: [], digest: 'b'.repeat(64) }
      writeFileSync(filePath, JSON.stringify(snapshot))
      const captured = readWorkerObservabilitySource({ filePath, now: () => new Date(observedAt) })
      expect(captured.state).toBe('UNKNOWN')
      expect(captured.reason).toBe('SOURCE_INVALID')
      expect(JSON.stringify(captured)).not.toContain(root)

      snapshot.assignments[0].contextMemory = { state: 'NOT_CAPTURED', sourceKindCounts: [], digest: null }
      for (const branch of ['codex//task', 'codex/../secret', 'codex/./secret']) {
        snapshot.localStatus.taskWorktrees[0].branch = branch
        writeFileSync(filePath, JSON.stringify(snapshot))
        const rejected = readWorkerObservabilitySource({ filePath, now: () => new Date(observedAt) })
        expect(rejected.state).toBe('UNKNOWN')
        expect(rejected.reason).toBe('SOURCE_INVALID')
        expect(JSON.stringify(rejected)).not.toContain(branch)
      }
      const credentialBranch = `codex/${['github', 'pat'].join('_')}_${'A'.repeat(40)}`
      snapshot.localStatus.taskWorktrees[0].branch = credentialBranch
      writeFileSync(filePath, JSON.stringify(snapshot))
      const credentialRejected = readWorkerObservabilitySource({ filePath, now: () => new Date(observedAt) })
      expect(credentialRejected.state).toBe('UNKNOWN')
      expect(credentialRejected.reason).toBe('SOURCE_INVALID')
      expect(JSON.stringify(credentialRejected)).not.toContain(credentialBranch)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renders only the sanitized task worktree status fields', () => {
    const html = renderToStaticMarkup(createElement(TaskWorktreeStatus, {
      task: { taskId: 'TASK-ZAI-119' },
      worktree: {
        workspaceRef: 'workspace-0123456789abcdef', branch: 'codex/task-zai-119',
        headCommit: 'a'.repeat(40), dirtyFileCount: 2, candidateHeadMatch: 'MATCH', verificationState: 'VERIFIED',
      },
    }))
    expect(html).toContain('Task worktree')
    expect(html).toContain('workspace-0123456789abcdef')
    expect(html).toContain('codex/task-zai-119')
    expect(html).toContain('MATCH')
    expect(html).toContain(`title="${'a'.repeat(40)}"`)
    expect(html).toContain(`aria-label="Exact worktree HEAD ${'a'.repeat(40)}"`)
    expect(html).not.toMatch(/absolutePath|prompt|session|owner|model|credential/i)
  })
})
