import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROGRAMME_DELIVERABLES, PROGRAMME_GATES, PROGRAMME_HISTORY, PROGRAMME_PHASES, PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'

// @req FR-105 — the roadmap is a contained platform projection, not a Business domain.
// @spec ADR-048 D1, D3, SDD-055
// @tested tests/unit/platform-control-route-contract.test.js

const fromRoot = (...path) => resolve(process.cwd(), ...path)

describe('Platform Programme Roadmap route contract', () => {
  it('has a separate control route group and shell rather than extending the BusinessShell', () => {
    expect(existsSync(fromRoot('src', 'app', '(control)', 'control', 'roadmap', 'page.jsx'))).toBe(true)
    const layout = readFileSync(fromRoot('src', 'app', '(control)', 'layout.jsx'), 'utf8')
    const guard = readFileSync(fromRoot('src', 'components', 'layouts', 'PlatformControlGuard.jsx'), 'utf8')
    expect(layout).toContain('PlatformControlShell')
    expect(layout).not.toContain('AppShell')
    expect(layout).not.toContain('BusinessShellGuard')
    expect(guard).toContain('resolveRequestViewer')
    expect(guard).not.toContain("'use client'")
  })

  it('does not add control routes to the Business DOMAINS registry', () => {
    const domains = readFileSync(fromRoot('src', 'config', 'domains.js'), 'utf8')
    expect(domains).not.toContain('/control/roadmap')
    expect(domains).not.toContain("key: 'platform-control'")
  })

  it('preserves the submitted programme shape as a static projection', () => {
    expect(PROGRAMME_PHASES).toHaveLength(6)
    expect(PROGRAMME_PHASES.flatMap((phase) => phase.sprints)).toHaveLength(12)
    // v0.4.0 (CR-019, 2026-09-13): 30 → 44 tasks, 8 → 9 gates, 10 → 11 deliverables;
    // v0.4.1 (same day): 44 → 51 tasks for the seventeen-stage knowledge base and file system.
    // Phases and sprints are unchanged on purpose — the proposal's six bands still line up.
    expect(PROGRAMME_TASKS).toHaveLength(51)
    expect(PROGRAMME_GATES).toHaveLength(9)
    expect(PROGRAMME_DELIVERABLES).toHaveLength(11)
  })

  it('carries the repository history as document data, labelled as history and not as progress', () => {
    // D1–D13, the D13+ remainder of the baseline day, D14–D34: 35 rows (document sections 5.3 and 5.3.1).
    expect(PROGRAMME_HISTORY.rows).toHaveLength(35)
    expect(PROGRAMME_HISTORY.rows[12][0]).toBe('D13')
    expect(PROGRAMME_HISTORY.rows[12][5]).toBe(211217) // 5.3 closes at the 5.2 net
    expect(PROGRAMME_HISTORY.rows.at(-1)[5]).toBe(621029) // 5.3.1 closes near the lines standing at 2b7ad27d
    expect(PROGRAMME_HISTORY.note).toMatch(/Not plan progress/)
    const board = readFileSync(fromRoot('src', 'modules', 'platform-control', 'components', 'ProgramRoadmapBoard.jsx'), 'utf8')
    expect(board).toContain('Repository history')
    expect(board).not.toContain('git log') // the page never measures git itself (ADR-048 D3)
  })

  it('carries one Task Container per backlog row, with the per-criterion checks the document records', () => {
    const ids = PROGRAMME_TASKS.map(([id]) => id)
    expect(Object.keys(PROGRAMME_CONTAINERS).sort()).toEqual([...ids].sort())
    for (const id of ids) {
      const c = PROGRAMME_CONTAINERS[id]
      expect(c.container).toBe(`TC-${id}`)
      expect(c.dod.acceptance.text.length).toBeGreaterThan(20)
      expect(c.dod.success.text.length).toBeGreaterThan(20)
      expect(c.dod.exit.text.length).toBeGreaterThan(20)
      expect(Array.isArray(c.dependsOn)).toBe(true)
      expect(c.links.code.length).toBeGreaterThan(0)
    }
    // Spot checks against the markdown: 001 has only its success criterion ticked; 031 is closed on all three.
    expect([PROGRAMME_CONTAINERS['TASK-ZAI-001'].dod.acceptance.checked, PROGRAMME_CONTAINERS['TASK-ZAI-001'].dod.success.checked, PROGRAMME_CONTAINERS['TASK-ZAI-001'].dod.exit.checked]).toEqual([false, true, false])
    expect([PROGRAMME_CONTAINERS['TASK-ZAI-031'].dod.acceptance.checked, PROGRAMME_CONTAINERS['TASK-ZAI-031'].dod.success.checked, PROGRAMME_CONTAINERS['TASK-ZAI-031'].dod.exit.checked]).toEqual([true, true, true])
    expect(PROGRAMME_CONTAINERS['TASK-ZAI-038'].dependsOn).toEqual(['TASK-ZAI-031', 'TASK-ZAI-034'])
    const board = readFileSync(fromRoot('src', 'modules', 'platform-control', 'components', 'ProgramRoadmapBoard.jsx'), 'utf8')
    expect(board).toContain('PROGRAMME_CONTAINERS')
    expect(board).toContain('aria-expanded={open}')
  })

  it('themes and decorates the board without changing what it says (owner request 2026-09-13)', () => {
    const shell = readFileSync(fromRoot('src', 'components', 'layouts', 'PlatformControlShell.jsx'), 'utf8')
    const shellCss = readFileSync(fromRoot('src', 'components', 'layouts', 'platform-control-shell.module.css'), 'utf8')
    const board = readFileSync(fromRoot('src', 'modules', 'platform-control', 'components', 'ProgramRoadmapBoard.jsx'), 'utf8')
    const boardCss = readFileSync(fromRoot('src', 'modules', 'platform-control', 'components', 'program-roadmap-board.module.css'), 'utf8')
    // Dark mode is a token override on the shell root, chosen per browser, never a second stylesheet.
    expect(shell).toContain('data-theme={theme ?? undefined}')
    expect(shell).toContain("'zai-control-theme'")
    expect(shellCss).toContain(".root[data-theme='dark']")
    // Status colour never travels alone: the pill text stays next to every coloured edge.
    expect(board).toContain('data-status={status}')
    expect(board).toContain('<StatusPill status={badgeStatus(status)} />')
    expect(boardCss).toContain("[data-status='done']")
    // Tilt is hover chrome that switches itself off for reduced motion and coarse pointers.
    expect(board).toContain('<TiltCard')
    expect(boardCss).toContain('prefers-reduced-motion: reduce')
  })
})
