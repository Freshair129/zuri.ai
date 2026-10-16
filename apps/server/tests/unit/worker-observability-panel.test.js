import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import WorkerObservabilityPanel, { collectLocalChanges } from '@/modules/platform-control/components/WorkerObservabilityPanel'

globalThis.React = React

describe('worker observability UI', () => {
  it('shows a truthful local-only panel with memory marked NOT_CAPTURED and no actions', () => {
    const html = renderToStaticMarkup(createElement(WorkerObservabilityPanel))
    expect(html).toContain('LOCAL CONTROLLER')
    expect(html).toContain('NOT_CAPTURED')
    expect(html).toContain('Events since this page opened')
    expect(html).not.toMatch(/<button\b/i)
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
})
