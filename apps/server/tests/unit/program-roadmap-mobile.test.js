// @req FR-105 — the programme board keeps the submitted roadmap as one
// responsive projection, including its evidence state and acceptance gates.
// @req FR-241 — the signed-in member projection keeps the same mobile board and
// privacy boundary as the operator route.
// @spec ADR-048 D3, ADR-092 D1–D4, SUBPLAN-ROADMAP-MOBILE
// @tested tests/unit/program-roadmap-mobile.test.js

import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { ROADMAP_SOT } from '@/modules/platform-control/roadmap-sot'

globalThis.React = React

const renderBoard = (props = {}) => renderToStaticMarkup(createElement(ProgramRoadmapBoard, props))

describe('SUBPLAN-ROADMAP-MOBILE canonical evidence presentation', () => {
  it('renders all 17 GenesisRAG17 stages and the separate production gate from the SOT', () => {
    const html = renderBoard({ audience: 'member', domainMap: { domains: [], overall: {} } })
    const stageMarkers = html.match(/data-testid="genesisrag17-stage-/g) || []
    const productionGate = ROADMAP_SOT.subplans.find((plan) => plan.id === 'SUBPLAN-KI-PRODUCTION-ACTIVATION')

    expect(PROGRAMME_TASKS).toHaveLength(121)
    expect(ROADMAP_SOT.coverage).toHaveLength(17)
    expect(stageMarkers).toHaveLength(17)
    expect(html).toContain('GenesisRAG17 coverage')
    expect(html).toContain('ISOLATED ACCEPTED')
    expect(html).toContain('production-activation-gate')
    expect(html).toContain(productionGate.id)
    expect(html).toContain('NOT STARTED')
    expect(html).toContain('proof')
    expect(html).toContain('implementation')
    expect(html).toContain('TASK-ZAI-119')
  })

  it('keeps phase and task accordions addressable with aria-expanded controls', () => {
    const html = renderBoard()

    expect(html).toContain('aria-expanded="true" aria-controls="phase-detail-PHASE-ZAI-01"')
    expect(html).toContain('id="phase-detail-PHASE-ZAI-01"')
    expect(html).toContain('aria-expanded="false" aria-controls="task-detail-TASK-ZAI-001"')
    expect(html).toContain('data-testid="roadmap-sot-task-TASK-ZAI-001"')
  })

  it('keeps member tabs and server privacy projection intact on the shared board', () => {
    const html = renderBoard({
      audience: 'member',
      domainMap: { domains: [], overall: {} },
      initialView: 'devices',
    })

    expect(html).toContain('roadmap-tab-domains')
    expect(html).not.toContain('roadmap-tab-devices')
    expect(html).not.toContain('harness-devices-view')
    expect(html).not.toContain('phase-people-')
    expect(html).not.toContain('task-devices-')
  })
})
