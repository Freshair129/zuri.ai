import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-260 — the route is a protected read-only Mission Control surface.
// @req FR-263 — the member /roadmap projection does not import or serialize
// Mission Control/PORL data.
// @req FR-264 — the board uses bounded mobile evidence scrolling.
// @spec ADR-048 D1-D3, ADR-092 D3, NFR-008
// @tested tests/unit/mission-control-route-contract.test.js

const fromRoot = (...parts) => resolve(process.cwd(), ...parts)
const routePath = fromRoot('src', 'app', '(control)', 'control', 'mission-control', 'page.jsx')
const boardPath = fromRoot('src', 'modules', 'platform-control', 'mission-control', 'components', 'MissionControlBoard.jsx')
const cssPath = fromRoot('src', 'modules', 'platform-control', 'mission-control', 'components', 'mission-control-board.module.css')

describe('Mission Control route contract', () => {
  it('exists under the operator control route group and only invokes read-side modules', () => {
    expect(existsSync(routePath)).toBe(true)
    const page = readFileSync(routePath, 'utf8')
    expect(page).toContain('buildMissionControlReadModel')
    expect(page).toContain('createProgrammeOrchestrationRunLedgerAdapter')
    expect(page).not.toContain('POST')
    expect(page).not.toContain('prisma')
    expect(page).not.toContain('ROADMAP.md')
  })

  it('keeps the member page independent of PORL and Mission Control', () => {
    const memberPage = readFileSync(fromRoot('src', 'app', 'roadmap', 'page.jsx'), 'utf8')
    const memberProjection = readFileSync(fromRoot('src', 'modules', 'platform-control', 'programme-member-view.js'), 'utf8')
    expect(memberPage.toLowerCase()).not.toContain('mission-control')
    expect(memberPage).not.toContain('programme-orchestration-run-ledger')
    expect(memberPage).not.toContain('candidateParallelPairs')
    expect(memberProjection).toContain('@req FR-263')
  })

  it('keeps the board read-only, keyboard discoverable and bounded on narrow screens', () => {
    const board = readFileSync(boardPath, 'utf8')
    const css = readFileSync(cssPath, 'utf8')
    expect(board).toContain('data-testid="mission-control-view"')
    expect(board).toContain('<details')
    expect(board).not.toContain('onClick')
    expect(board).not.toContain('fetch(')
    expect(css).toContain('overflow-x: auto')
    expect(css).toContain('@media (max-width: 540px)')
    expect(css).toContain('min-width: 0')
  })
})
