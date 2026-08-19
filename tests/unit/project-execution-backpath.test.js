// @req FR-009 — the project-scoped execution mode view is a drill-down off the
// Project detail page, so it owes the user a named way back and a tab
// highlight that names the section they are actually in. The same view serves
// the global route, which must gain neither.
// @req FR-040 — the Project tab bar is the thing doing the naming.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-execution-backpath.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const projectLayout = src('src/app/(pm)/projects/[projectId]/layout.jsx')
const executionView = src('src/modules/project-manager/views/execution/ExecutionModeView.jsx')
const projectExecutionRoute = src('src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx')
const globalExecutionRoute = src('src/app/(pm)/execution/[mode]/page.jsx')
const projectDetail = src('src/app/(pm)/projects/[projectId]/page.jsx')

/**
 * `TAB_SUFFIXES` is deliberately not exported — Next.js reserves a `layout`
 * file's export surface — so the ordering is exercised by lifting the table out
 * of the source and replaying the resolver's first-match rule over it. The
 * resolver's own two lines are pinned below, so this replay cannot quietly
 * drift away from the code it stands in for.
 */
function tabSuffixes() {
  const table = projectLayout.match(/const TAB_SUFFIXES = \[([\s\S]*?)\n\]/)
  if (!table) throw new Error('TAB_SUFFIXES table not found in the project layout')
  return [...table[1].matchAll(/\['([\w-]+)',\s*\[([^\]]*)\]\]/g)].map((row) => [
    row[1],
    [...row[2].matchAll(/'([^']+)'/g)].map((suffix) => suffix[1]),
  ])
}

/**
 * Comments in the view explain why `/projects/undefined` must never be built;
 * the `projectId` guard is what actually stops it. Strip comments before
 * asserting that string is absent, or the explanation trips the assertion and
 * the only way to pass is to delete the reasoning.
 */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BASE = '/projects/p1'

function activeProjectTab(pathname) {
  if (pathname === BASE) return 'project'
  const hit = tabSuffixes().find(([, suffixes]) => suffixes.some((suffix) => pathname.includes(suffix)))
  return hit ? hit[0] : undefined
}

describe('project-scoped execution mode: tab highlight', () => {
  it('replays the same first-match rule the layout applies', () => {
    expect(projectLayout).toContain("if (pathname === base) return 'project'")
    expect(projectLayout).toContain(
      'TAB_SUFFIXES.find(([, suffixes]) => suffixes.some((suffix) => pathname.includes(suffix)))'
    )
  })

  it('highlights Project — the tab whose page is the only inbound link — not Work', () => {
    expect(activeProjectTab(`${BASE}/execution/sprint`)).toBe('project')
    expect(activeProjectTab(`${BASE}/execution/b2c-campaign`)).toBe('project')
    expect(activeProjectTab(`${BASE}/execution/sprint`)).not.toBe('work')
    expect(activeProjectTab(BASE)).toBe('project')
  })

  it('keeps `/execution` ahead of the broad Work row so nothing can reclaim it', () => {
    const keys = tabSuffixes().map(([key]) => key)
    expect(keys.indexOf('project')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('project')).toBeLessThan(keys.indexOf('work'))
    const work = tabSuffixes().find(([key]) => key === 'work')[1]
    expect(work).not.toContain('/execution')
  })

  it('leaves every other project route on the tab it already had', () => {
    for (const suffix of ['/roadmap', '/structure', '/board', '/all-work', '/timeline', '/milestones', '/dependencies']) {
      expect(activeProjectTab(`${BASE}${suffix}`)).toBe('work')
    }
    expect(activeProjectTab(`${BASE}/inventory`)).toBe('inventory')
    expect(activeProjectTab(`${BASE}/team`)).toBe('team')
    expect(activeProjectTab(`${BASE}/files`)).toBe('files')
    expect(activeProjectTab(`${BASE}/import`)).toBe('import')
  })

  // @req FR-008 — same rule as `/execution`: the tab whose page opens the route
  // owns the highlight. Repositories has no tab of its own and is reached from
  // Inventory's "Open repositories →" link, and until this row existed it
  // resolved to `undefined` — a Project page with nothing marked current.
  it('maps the tabless /repositories route to the tab that links to it', () => {
    expect(activeProjectTab(`${BASE}/repositories`)).toBe('inventory')
    expect(src('src/app/(pm)/projects/[projectId]/inventory/page.jsx'))
      .toContain('href={`/projects/${project.id}/repositories`}')
  })

  it('still leaves an unmapped route visibly absent rather than silently wrong', () => {
    expect(activeProjectTab(`${BASE}/not-a-tab`)).toBeUndefined()
  })
})

describe('project-scoped execution mode: back-path', () => {
  it('is reached only from the Project detail page, which is why Project is the honest tab', () => {
    expect(projectDetail).toContain('/projects/${p.id}/execution/${SLUG_BY_MODE[ws.executionMode]}')
  })

  it('renders a breadcrumb back to the project the user drilled from', () => {
    expect(executionView).toContain('href={`/projects/${projectId}`}')
    expect(executionView).toContain('<ProjectBackPath projectId={projectId}')
  })

  // Verified in the browser, which is the only place this was visible: the
  // rendered page carries five `nav` landmarks, two of them from the shell and
  // the tab bar. Naming this one "Breadcrumb" duplicated the shell's exactly,
  // and "Project section" differed from the tab bar's "Project sections" by one
  // letter. Landmarks of one role are chosen by name, so two names that sound
  // alike are one unusable choice.
  it('does not collide with the other navigation landmarks on the page', () => {
    expect(executionView).toContain('<nav aria-label="Project path"')
    const code = codeOnly(executionView)
    expect(code).not.toContain('aria-label="Breadcrumb"')
    expect(code).not.toContain('aria-label="Project section"')
  })

  it('names the destination by project code instead of a bare "Back"', () => {
    expect(executionView).toContain("const projectLabel = project?.code || project?.name || null")
    expect(executionView).toContain('`Back to project ${projectLabel} workstreams`')
    expect(executionView).toContain('{projectLabel || \'Project\'}')
  })

  it('gives the terse crumb an accessible name and hides its decorative glyphs', () => {
    expect(executionView).toContain('<ArrowLeft size={13} aria-hidden />')
    expect(executionView).toContain('<ChevronRight size={12} aria-hidden')
    expect(executionView).toMatch(/aria-label=\{projectLabel \?/)
  })

  it('sends an empty project scope back to its project, not to the portfolio list', () => {
    expect(executionView).toContain('Back to {project.data?.code || \'project\'}')
  })
})

describe('global execution mode: unchanged and unlinked', () => {
  it('passes no projectId, so the shared view stays in global scope', () => {
    expect(globalExecutionRoute).toContain('<ExecutionModeView mode={executionMode} />')
    expect(projectExecutionRoute).toContain('<ExecutionModeView mode={executionMode} projectId={projectId} />')
  })

  it('gates the back-path on projectId so no link or fetch is built from `undefined`', () => {
    expect(executionView).toContain('{projectId ? (')
    expect(executionView).toContain('useFetch(projectId ? `/api/projects/${projectId}` : null)')
    expect(codeOnly(executionView)).not.toContain('/projects/undefined')
    expect(executionView).toContain('href="/projects"')
  })
})
