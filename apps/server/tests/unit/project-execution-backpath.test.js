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
import { moduleForProjectPath } from '@/modules/project-manager/navigation'

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const projectLayout = src('src/app/(pm)/projects/[projectId]/layout.jsx')
const executionView = src('src/modules/project-manager/views/execution/ExecutionModeView.jsx')
const projectExecutionRoute = src('src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx')
const globalExecutionRoute = src('src/app/(pm)/execution/[mode]/page.jsx')
const projectDetail = src('src/app/(pm)/projects/[projectId]/page.jsx')

/**
 * Comments in the view explain why `/projects/undefined` must never be built;
 * the `projectId` guard is what actually stops it. Strip comments before
 * asserting that string is absent, or the explanation trips the assertion and
 * the only way to pass is to delete the reasoning.
 */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('Project-local module classification', () => {
  const BASE = '/projects/p1'

  it('uses the typed module resolver instead of a substring-based layout table', () => {
    expect(projectLayout).toContain('moduleForProjectPath(pathname, projectId)')
    expect(projectLayout).not.toContain('TAB_SUFFIXES')
    expect(projectLayout).not.toContain('pathname.includes(')
  })

  it('keeps execution mode routes under Project Management', () => {
    expect(moduleForProjectPath(`${BASE}/execution/sprint`, 'p1')).toMatchObject({ id: 'module.project-management' })
    expect(moduleForProjectPath(`${BASE}/execution/b2c-campaign`, 'p1')).toMatchObject({ id: 'module.project-management' })
  })

  it('maps Work, Resource Coordination, Import, and the Project root to their owners', () => {
    for (const suffix of ['/roadmap', '/structure', '/board', '/all-work', '/timeline', '/milestones', '/dependencies']) {
      expect(moduleForProjectPath(`${BASE}${suffix}`, 'p1')).toMatchObject({ id: 'module.work-management' })
    }
    expect(moduleForProjectPath(`${BASE}/inventory`, 'p1')).toMatchObject({ id: 'module.project-management' })
    expect(moduleForProjectPath(`${BASE}/team`, 'p1')).toMatchObject({ id: 'module.resource-coordination' })
    expect(moduleForProjectPath(`${BASE}/files`, 'p1')).toMatchObject({ id: 'module.resource-coordination' })
    expect(moduleForProjectPath(`${BASE}/repositories`, 'p1')).toMatchObject({ id: 'module.resource-coordination' })
    expect(moduleForProjectPath(`${BASE}/import`, 'p1')).toMatchObject({ id: 'module.project-management' })
    expect(moduleForProjectPath(BASE, 'p1')).toMatchObject({ id: 'module.project-management' })
  })

  it('does not classify a foreign or unknown route as a Project surface', () => {
    expect(moduleForProjectPath(`${BASE}x/structure`, 'p1')).toBeNull()
    expect(moduleForProjectPath(`${BASE}/not-a-tab`, 'p1')).toBeNull()
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
