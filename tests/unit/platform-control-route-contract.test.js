import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROGRAMME_DELIVERABLES, PROGRAMME_EVIDENCE_SNAPSHOT, PROGRAMME_GATES, PROGRAMME_PHASES, PROGRAMME_SNAPSHOT, PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'

// @req FR-094 — the roadmap is a contained platform projection, not a Business domain.
// @spec ADR-039 D1, D3, SDD-052
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

  it('keeps the public programme share static and separate from the operator guard', () => {
    const pagePath = fromRoot('src', 'app', 'programme', 'page.jsx')
    expect(existsSync(pagePath)).toBe(true)
    const page = readFileSync(pagePath, 'utf8')
    const scopeContext = readFileSync(fromRoot('src', 'context', 'ScopeContext.jsx'), 'utf8')
    expect(page).toContain('ProgramRoadmapBoard publicShare')
    expect(page).not.toContain('PlatformControlGuard')
    expect(page).not.toMatch(/fetch\(|axios|createClient\(/i)
    expect(scopeContext).toContain("const PUBLIC_STATIC_PATHS = new Set(['/programme'])")
    expect(scopeContext).toContain('PUBLIC_STATIC_PATHS.has(pathname)')
  })

  it('preserves the submitted programme shape as a static projection', () => {
    expect(PROGRAMME_PHASES).toHaveLength(6)
    expect(PROGRAMME_PHASES.flatMap((phase) => phase.sprints)).toHaveLength(12)
    expect(PROGRAMME_TASKS).toHaveLength(30)
    expect(PROGRAMME_GATES).toHaveLength(8)
    expect(PROGRAMME_DELIVERABLES).toHaveLength(10)
  })

  it('anchors Day 1 and migration evidence without adding a runtime source integration', () => {
    expect(PROGRAMME_SNAPSHOT.programmeStart).toBe('2026-08-11')
    expect(PROGRAMME_EVIDENCE_SNAPSHOT.github.dailyCommits).toHaveLength(10)
    expect(PROGRAMME_EVIDENCE_SNAPSHOT.github.totalCommits).toBe(347)
    expect(PROGRAMME_EVIDENCE_SNAPSHOT.migrations.map((item) => item.id)).toEqual(['SG-SOURCE', 'SG-KNOWLEDGE', 'SG-CUSTOMER', 'SG-REVIEW'])
    const dataModule = readFileSync(fromRoot('src', 'modules', 'platform-control', 'program-roadmap-data.js'), 'utf8')
    expect(dataModule).not.toMatch(/fetch\(|axios|from\s+['"]duckdb|createClient\(/i)
  })
})
