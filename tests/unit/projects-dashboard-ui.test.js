// @req FR-086 — the Development Dashboard surface: the KPI band, the Top-5
// panel and the enriched list, plus the editing path FR-087/FR-088 need.
// @spec ADR-036, ADR-037, SDD-047, NFR-008
// @tested tests/unit/projects-dashboard-ui.test.js
//
// These are source assertions in the style the rest of this suite uses. They
// exist to pin the decisions that are cheap to undo by accident — the fallback
// ordering ADR-036 D3 forbids, the two counts ADR-037 D4 keeps apart, and the
// one-request rule SDD-047 exists for.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROJECT_PRIORITIES, PROJECT_STATUSES, PROJECT_STATUS_HIGHLIGHTS, WORK_STATUSES } from '@/lib/validation/enums'
import { zProjectInput } from '@/lib/validation/entities'

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const page = src('src/app/(pm)/projects/page.jsx')
const modal = src('src/modules/project-manager/components/ProjectModal.jsx')
const projectService = src('src/modules/project-manager/application/project-service.js')

/** Strip comments before asserting a string is ABSENT, or the prose explaining
 *  why it is absent trips the assertion and the only way to pass is to delete
 *  the reasoning. */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('Projects Dashboard surface', () => {
  it('is titled Dashboard and leaves "Overview" to Business Home', () => {
    expect(page).toContain('title="Dashboard"')
    // ADR-036 D1 / FR-060: `/overview` is the other surface, and the word is
    // reserved for it. A heading here would give the product two.
    expect(codeOnly(page)).not.toMatch(/title="Overview"/)
  })

  it('reads the band and the rows from one request, so the halves cannot disagree', () => {
    // SDD-047. A second fetch is how the counts and the list end up describing
    // different populations of the same page.
    expect(page).toContain('/api/projects/overview?')
    expect(page.match(/useFetch\(/g) || []).toHaveLength(1)
  })

  it('never orders the Top 5 by target date when no priority is set', () => {
    // ADR-036 D3 — the one substitution the design forbids: five projects under
    // a "Priority" heading that actually mean "soonest deadline" is a wrong
    // answer the reader cannot detect.
    const panel = page.slice(page.indexOf('function TopPriority'), page.indexOf('function ProjectsDashboardInner'))
    expect(panel).toContain("state !== 'READY'")
    expect(panel).toContain('Nothing to rank')
    expect(codeOnly(panel)).not.toContain('targetAt')
    expect(codeOnly(panel)).not.toContain('sort')
  })

  it('keeps the team count and the headcount as two figures', () => {
    // ADR-037 D4 — a Team can be attached with nobody assigned, and a person can
    // be assigned while belonging to no Team. Neither is derivable from the other.
    expect(page).toContain('data.counts.teams.onProjects')
    expect(page).toContain('data.counts.people.withWorkAssigned')
    expect(page).toContain('People with work assigned')
  })

  it('discloses the statuses the band does not highlight instead of dropping them', () => {
    // ADR-036 Consequences: PROJECT_STATUSES has five values and the ask names
    // three (PLANNED, ACTIVE, DONE — ON_HOLD and ARCHIVED are the remainder);
    // WORK_STATUSES has seven and the ask names two (IN_PROGRESS, DONE). A band
    // whose parts do not sum to the list beneath it teaches the reader to
    // distrust every figure.
    expect(PROJECT_STATUSES.length).toBeGreaterThan(3)
    expect(WORK_STATUSES.length).toBeGreaterThan(2)
    const card = page.slice(page.indexOf('function CountCard'), page.indexOf('const PRIORITY_TONE'))
    expect(card).toContain('otherTotal')
    expect(card).toContain('aria-expanded={open}')
    // The remainder is computed from the enum, never from a hand-written list —
    // a literal would silently stop covering a status added later.
    expect(card).toContain('statuses.filter((status) => !highlight.includes(status))')
  })

  it("highlights PLANNED, ACTIVE and DONE for Projects — the three ADR-036 names", () => {
    // Regression: the band used to highlight only ACTIVE and DONE, which
    // silently folded PLANNED projects into "Other" (invisible until expanded)
    // even though ADR-036 names PLANNED as one of the three highlighted
    // statuses. ON_HOLD and ARCHIVED are the intended remainder.
    //
    // This is the actual behaviour: the runtime value of the single named
    // subset (PROJECT_STATUS_HIGHLIGHTS, src/lib/validation/enums.js) that the
    // page's KPI band renders with, not a string match against a literal —
    // CLAUDE.md forbids hand-copying an enum's members at the call site, so
    // the page imports this constant rather than spelling the three out itself.
    expect(PROJECT_STATUS_HIGHLIGHTS).toEqual(['PLANNED', 'ACTIVE', 'DONE'])
    // Every highlighted status is a real PROJECT_STATUSES member, so the band
    // and the "Other" remainder it computes from PROJECT_STATUSES can never
    // disagree about what a status even is.
    for (const status of PROJECT_STATUS_HIGHLIGHTS) expect(PROJECT_STATUSES).toContain(status)

    expect(page).toContain('PROJECT_STATUS_HIGHLIGHTS')
    const dashboard = page.slice(page.indexOf('function ProjectsDashboardInner'))
    const projectsCard = dashboard.slice(dashboard.indexOf('label="Projects"'), dashboard.indexOf('label="Work items"'))
    // Wired to the imported constant, not re-spelled out as a literal here.
    expect(projectsCard).toContain('highlight={PROJECT_STATUS_HIGHLIGHTS}')
    expect(codeOnly(projectsCard)).not.toContain("highlight={['PLANNED'")
  })

  it('renders every requested column, and unset as unset', () => {
    for (const label of ['Code', 'Project', 'Size', 'Space', 'Streams', 'Status', 'Progress', 'Target', 'PIC', 'Priority']) {
      expect(page, `column ${label}`).toContain(`label: '${label}'`)
    }
    // ADR-036 D4 — never a guessed name; ADR-036 D3 — never a guessed rank.
    expect(page).toContain('p.pic?.displayName ||')
    expect(page).toContain('<PriorityCell value={p.priority} />')
  })

  it('prints the progress number beside the bar, through the shared formatter', () => {
    // NFR-008: a bar alone cannot be read aloud or compared precisely.
    // The number goes through `formatProgressPercent` rather than an inline
    // `Math.round(...)` — the same underlying percent used to read "58%" here
    // and "58.3%" on the Project page and `/overview`, three render sites
    // apart, because each one rounded for itself (CLAUDE.md: "Never report a
    // number a page would disagree with").
    expect(page).toContain('<ProgressBar percent={p.progress?.percent || 0}')
    expect(page).toContain('formatProgressPercent(p.progress?.percent || 0)')
    expect(codeOnly(page)).not.toMatch(/Math\.round\(p\.progress\?\.\s*percent/)
  })

  it('carries the New project action, which the Topbar no longer duplicates', () => {
    expect(page).toContain('href="/projects/new"')
    expect(src('src/components/layouts/Topbar.jsx')).not.toContain('/projects/new')
  })

  it('states priority as a word, not as colour alone', () => {
    // WCAG `color-not-only`: the level has to survive greyscale and a screen reader.
    const cell = page.slice(page.indexOf('function PriorityCell'), page.indexOf('function TopPriority'))
    expect(cell).toContain('titleCase(value)')
  })
})

describe('the editing path FR-087 and FR-088 need', () => {
  it('accepts both fields at the boundary, and lets them be cleared', () => {
    // `nullish`, not `optional`: an explicit null is how a value is unset, and
    // the service distinguishes that from a key simply absent from the patch.
    expect(zProjectInput.parse({ workspaceId: 'w1', name: 'n', priority: null, picPersonId: null }).priority).toBeNull()
    expect(zProjectInput.parse({ workspaceId: 'w1', name: 'n' }).priority).toBeUndefined()
    expect(() => zProjectInput.parse({ workspaceId: 'w1', name: 'n', priority: 'URGENT' })).toThrow()
  })

  it('distinguishes an absent key from an explicit null on update', () => {
    // `??` here would conflate the two and make unsetting impossible.
    expect(projectService).toContain('priority: data.priority === undefined ? existing.priority : data.priority')
    expect(projectService).toContain('picPersonId: data.picPersonId === undefined ? existing.picPersonId : data.picPersonId')
  })

  it('offers both fields in the modal, sourced from the enum and the project team', () => {
    // A column nobody can fill is a column that teaches the page is broken.
    expect(modal).toContain('PROJECT_PRIORITIES.map')
    expect(modal).toContain("label=\"PIC\"")
    expect(modal).toContain('<option value="">Unset</option>')
    // Candidates come from the Project's own team, not every Person in the
    // tenant — that read leak is `.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md`.
    expect(modal).toContain('/team`')
    expect(modal).not.toContain('/api/people')
  })

  it('sends empty as null so "Unset" actually clears', () => {
    expect(modal).toContain('priority: form.priority || null')
    expect(modal).toContain('picPersonId: form.picPersonId || null')
  })

  it('offers exactly the declared priority levels', () => {
    expect(PROJECT_PRIORITIES).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
  })
})
