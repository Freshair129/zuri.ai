import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROGRAMME_DELIVERABLES, PROGRAMME_GATES, PROGRAMME_PHASES, PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'

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
    expect(PROGRAMME_TASKS).toHaveLength(30)
    expect(PROGRAMME_GATES).toHaveLength(8)
    expect(PROGRAMME_DELIVERABLES).toHaveLength(10)
  })
})
