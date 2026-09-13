// @req FR-216 — the phase card renders its planned figures and its measured figures
//   (or "not measured"), and done/review cards carry their tint.
// @req FR-219 — task cards render evidence badges with a glyph and a word, and a
//   subtask progress bar only when the container lists subtasks.
// @spec ADR-086 D1, D6; NFR-008
// @tested tests/unit/program-roadmap-board-telemetry.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { mergeLaneUsage } from '@/modules/platform-control/program-delivery-metrics'
import { projectTaskEvidence } from '@/modules/platform-control/program-task-evidence'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { PROGRAMME_LANES, PROGRAMME_USAGE } from '@/modules/platform-control/program-roadmap-telemetry'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

globalThis.React = React

const snapshot = getProductReadinessSnapshot()
const render = (props = {}) => renderToStaticMarkup(createElement(ProgramRoadmapBoard, {
  laneUsage: Object.fromEntries(mergeLaneUsage({ lanes: PROGRAMME_LANES, usage: PROGRAMME_USAGE, reports: [] })),
  usageReports: { available: false, count: 0 },
  taskEvidence: projectTaskEvidence({ tasks: PROGRAMME_TASKS, containers: PROGRAMME_CONTAINERS, snapshot }),
  ...props,
}))

describe('FR-216 phase cards', () => {
  it('shows planned figures on every phase and a measured row that says what it knows', () => {
    const html = render()
    expect(html).toContain('data-testid="delivery-legend"')
    for (const phase of ['PHASE-ZAI-01', 'PHASE-ZAI-02', 'PHASE-ZAI-06']) {
      expect(html).toContain(`data-testid="phase-metrics-${phase}"`)
    }
    const phase01 = html.slice(html.indexOf('data-testid="phase-metrics-PHASE-ZAI-01"'), html.indexOf('data-testid="phase-metrics-PHASE-ZAI-02"'))
    expect(phase01).toMatch(/<b>2<\/b> sprint/)
    expect(phase01).toMatch(/<b>28<\/b> วัน/)
    expect(phase01).toContain('ชม. effort')
    // PHASE-ZAI-06 has no lane: it must say so rather than show 0 or a prediction.
    const phase06 = html.slice(html.indexOf('data-testid="phase-metrics-PHASE-ZAI-06"'))
    expect(phase06).toContain('ยังไม่วัด')
    expect(phase06).toContain('data-measured="false"')
  })

  it('tints done and review cards and keeps the status word', () => {
    const html = render()
    // PHASE-ZAI-01 opens by default, so its sprints and tasks are in the markup.
    expect(html).toMatch(/data-status="done"/)
    expect(html).toMatch(/data-status="review"/)
    expect(html).toContain('pill')
  })

  it('still renders, without badges or measurements, when the page passes nothing new', () => {
    const html = renderToStaticMarkup(createElement(ProgramRoadmapBoard, {}))
    expect(html).toContain('data-testid="phase-metrics-PHASE-ZAI-01"')
    expect(html).not.toContain('data-testid="task-badges-')
  })
})

describe('FR-219 task cards', () => {
  it('renders nine badges per visible task, each evidence badge with a glyph and a word for assistive tech', () => {
    const html = render()
    const badges = html.slice(html.indexOf('data-testid="task-badges-TASK-ZAI-005"'))
    for (const key of ['DOC', 'CODE', 'TEST', 'FR', 'NFR', 'FEAT']) expect(badges).toContain(`data-badge="${key}"`)
    expect(badges).toMatch(/aria-label="FR (เสร็จ|รอรีวิว|ต้องแก้|ว่าง)"/)
    for (const key of ['DOMAIN', 'COMPLEXITY', 'PRIORITY']) expect(badges).toContain(`data-badge="${key}"`)
  })

  it('draws a subtask bar only for a container that lists subtasks', () => {
    const html = render()
    expect(html).toContain('data-testid="task-subtasks-TASK-ZAI-066"')
    expect(html).toContain('TASK-ZAI-066 subtask progress')
    expect(html).not.toContain('data-testid="task-subtasks-TASK-ZAI-005"')
  })
})
