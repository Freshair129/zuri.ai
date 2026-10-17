import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import WorkerObservabilityPanel, {
  classifyWorkerObservabilityFailure,
  collectLocalChanges,
  createInitialWorkerObservabilityState,
  reduceWorkerObservabilityState,
} from '@/modules/platform-control/components/WorkerObservabilityPanel'

globalThis.React = React

describe('worker observability UI', () => {
  it('shows a truthful local-only panel with memory marked NOT_CAPTURED and no actions', () => {
    const html = renderToStaticMarkup(createElement(WorkerObservabilityPanel))
    expect(html).toContain('LOCAL CONTROLLER')
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
})
