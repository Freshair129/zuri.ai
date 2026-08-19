// @req FR-006, FR-012, FR-040, FR-068 — Project Work owns the Execution
// Roadmap and its Structure Plan, Board, Schedule, Milestones, and
// Dependency Map views; Project Import is a first-class Project resource.
// @spec SDD-019, SDD-039, ADR-012, ADR-028
// @spec NFR-008 — and the Project bar spends its slots on sections that exist:
// the three with no page behind them are disclosed behind one keyboard-operable
// control rather than interleaved with the live tabs as greyed spans.
// @tested tests/unit/project-work-route.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'

const workTabs = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/WorkViewTabs.jsx'), 'utf8')
const dependencyMapRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/dependencies/page.jsx'), 'utf8')
const milestonesRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/milestones/page.jsx'), 'utf8')
const timelineRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/timeline/page.jsx'), 'utf8')
const projectLayout = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/layout.jsx'), 'utf8')
const projectTabs = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ProjectTabs.jsx'), 'utf8')

/**
 * Slices one top-level array literal out of the source.
 *
 * The Project bar is two rows now — destinations that exist, and the sections
 * disclosed behind "More" — and the decision worth pinning is which row a
 * section is in. Asserting against the whole file could not tell those apart:
 * `toContain("label: 'Import'")` passes just as happily if Import is demoted
 * into the overflow list.
 */
function tabRow(name) {
  const declaration = projectTabs.indexOf(`const ${name} = [`)
  expect(declaration, `ProjectTabs.jsx no longer declares ${name}`).toBeGreaterThan(-1)
  const open = projectTabs.indexOf('[', declaration)
  return projectTabs.slice(open, projectTabs.indexOf('\n]', open))
}

const primaryRow = tabRow('TABS')
const overflowRow = tabRow('PLANNED')

describe('Project Work navigation boundary', () => {
  it('exposes all Work sub-views without promoting Dependency Map to a sidebar domain', () => {
    expect(workTabs).toContain("label: 'Execution Roadmap'")
    expect(workTabs).toContain("/projects/${projectId}/roadmap")
    expect(workTabs).toContain("label: 'Structure Plan'")
    expect(workTabs).toContain("label: 'Board'")
    expect(workTabs).toContain("label: 'Work Items'")
    expect(workTabs).toContain("/projects/${projectId}/all-work")
    expect(workTabs).toContain("label: 'Schedule'")
    expect(workTabs).toContain("label: 'Milestones'")
    expect(workTabs).toContain("/projects/${projectId}/milestones")
    expect(workTabs).toContain("label: 'Dependency Map'")
    expect(workTabs).toContain("/projects/${projectId}/dependencies")
    expect(workTabs).toContain("aria-current={active ? 'page' : undefined}")
  })

  // This bar and the Development sidebar render on the same screen. A label
  // shared between them names two different routes — the project-scoped view and
  // the Business-wide one — which is ambiguous to a reader and to a screen
  // reader, and Playwright strict mode fails outright on it. Every project-scoped
  // label is therefore a different word from its Business-wide half: Schedule vs
  // Timeline, Dependency Map vs Dependencies, Milestones vs Milestones & Gates.
  //
  // Derived from the live registry rather than a hard-coded list, so a new
  // Development sidebar entry that collides with a Work sub-view fails here
  // instead of shipping.
  it('never reuses a Development sidebar label for a project-scoped route', () => {
    const sidebarLabels = DOMAINS.find((domain) => domain.key === 'projects').sub.map((item) => item.label)
    const workViewLabels = [...workTabs.matchAll(/label: '([^']+)'/g)].map((match) => match[1])

    expect(workViewLabels).toHaveLength(7)
    for (const label of workViewLabels) {
      expect(sidebarLabels, `"${label}" is also a Development sidebar entry`).not.toContain(label)
    }
  })

  // The landmark is what makes those links addressable as a group at all — it is
  // how a screen-reader user, or a test, scopes to this bar rather than the
  // sidebar. `ProjectTabs` already carries "Project sections"; this is its peer.
  it('exposes the Work sub-view bar as a named navigation landmark', () => {
    expect(workTabs).toContain('<nav')
    expect(workTabs).toContain('aria-label="Project work views"')
    expect(workTabs).not.toContain('<div className="mb-4 inline-flex')
  })

  it('keeps Schedule and Milestones inside the same project Work shell', () => {
    expect(timelineRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(timelineRoute).toContain('title="Schedule"')
    expect(milestonesRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(milestonesRoute).toContain('title="Milestones & Gates"')
    expect(milestonesRoute).toContain('<MilestonesView projectId={projectId} />')
  })

  it('exposes Project Import as a first-class resource tab', () => {
    // In the primary row specifically: Import is a destination the user reaches
    // in one click, not something folded away behind a disclosure.
    expect(primaryRow).toContain("label: 'Import'")
    expect(primaryRow).toContain('/projects/${id}/import')
    expect(overflowRow).not.toContain('Import')
    expect(projectLayout).toContain("['import', ['/import']]")
  })

  it('keeps the primary row to sections that exist, and discloses the rest without dropping them', () => {
    // Every primary entry links somewhere. Three sections used to sit between
    // the live ones with nothing behind them, pushing the real destinations
    // apart in a row already wide enough to scroll.
    const keys = primaryRow.match(/key: '/g) || []
    const hrefs = primaryRow.match(/href: \(id\) =>/g) || []
    expect(keys.length).toBeGreaterThan(3)
    expect(hrefs).toHaveLength(keys.length)

    for (const planned of ['requirements', 'risks', 'resources']) {
      expect(primaryRow).not.toContain(`key: '${planned}'`)
      expect(overflowRow).toContain(`key: '${planned}'`)
    }
    // Disclosed, not deleted: the roadmap signal is the reason these were ever
    // rendered, so removing them would buy back the space by hiding it.
    expect(overflowRow).toContain("label: 'Requirements'")
    expect(overflowRow).toContain("label: 'Risks'")
    expect(overflowRow).toContain("label: 'Resources'")
    // And nothing disclosed can navigate.
    expect(overflowRow).not.toContain('href')
  })

  it('discloses them through a keyboard-operable control instead of a greyed span with a tooltip', () => {
    // A `title` is not an accessible name and never reaches a touch user, and
    // reduced opacity is not disabled semantics.
    expect(projectTabs).not.toContain('title="Coming soon"')
    expect(projectTabs).not.toMatch(/title=["{]/)
    expect(projectTabs).toContain('aria-expanded={open}')
    expect(projectTabs).toContain('aria-controls={panelId}')
    expect(projectTabs).toContain('aria-disabled="true"')
    expect(projectTabs).toMatch(/\n\s+disabled\n/)
    // Escape closes and hands focus back to the control that opened the panel.
    expect(projectTabs).toContain("if (event.key !== 'Escape') return")
    expect(projectTabs).toContain('triggerRef.current?.focus()')
    // Icon meanings stay exclusive across the nav: Flag is Milestones & Gates
    // and Network is Dependencies, so neither may be assigned to a tab here.
    // (Matched on the assignment, not the file, because the comment explaining
    // the rule names both icons.)
    expect(projectTabs).not.toMatch(/icon: (Flag|Network)\b/)
  })

  it('keeps the Dependency Map route inside the project Work shell', () => {
    expect(dependencyMapRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(dependencyMapRoute).toContain('title="Dependency Map"')
    expect(dependencyMapRoute).toContain('/api/projects/${projectId}/dependencies')
    expect(dependencyMapRoute).toContain('<LoadingCard />')
    expect(dependencyMapRoute).toContain('<ErrorState')
    expect(dependencyMapRoute).not.toContain('DependenciesView')
  })

  it('uses one canonical Project tab bar without the retired duplicate project-view rail', () => {
    expect(projectLayout).toContain('<ProjectTabs projectId={projectId} active={active} />')
    expect(projectLayout).not.toContain('aria-label="Project views"')
    expect(projectLayout).not.toContain("label: 'Dependencies'")
  })
})
