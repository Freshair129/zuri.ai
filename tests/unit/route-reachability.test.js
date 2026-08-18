import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRouteEntries } from '@/components/layouts/CommandPalette'
import { DOMAINS } from '@/config/domains'

// @req FR-001, FR-006, FR-012 — a page route that no navigation points at is
// not a delivered surface: it is reachable only by typing the URL.
// @spec SDD-019, ADR-012, ADR-008 §D6
// @tested tests/unit/route-reachability.test.js
//
// Three routes reached production with zero inbound links from anywhere in the
// application — `/workspaces` (the whole FR-001 Space CRUD surface),
// `/projects/{id}/milestones`, and `/projects/{id}/import` (the whole
// FR-012/FR-018 intake path, which only the e2e suite ever opened, via
// `page.goto`). Governance did not catch it: `npm run govern` checks requirement
// ids, charters and route anchors, and has no notion of reachability. This file
// is that notion, scoped to the surfaces where the gap actually happened.

const ROOT = process.cwd()
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const PROJECT_ROUTES = resolve(ROOT, 'src/app/(pm)/projects/[projectId]')
const projectTabs = src('src/modules/project-manager/components/ProjectTabs.jsx')
const workViewTabs = src('src/modules/project-manager/components/WorkViewTabs.jsx')
const inventoryPage = src('src/app/(pm)/projects/[projectId]/inventory/page.jsx')
const projectsPage = src('src/app/(pm)/projects/page.jsx')

// Every navigation source that can carry a user into a Project sub-route. The
// two tab bars, plus the two pages that link sideways: Inventory drills into
// All Work / Repositories / Team / Files, and Project detail opens each
// Workstream's execution-mode view.
const PROJECT_NAV_SOURCES = [
  projectTabs,
  workViewTabs,
  inventoryPage,
  src('src/app/(pm)/projects/[projectId]/page.jsx'),
]

/**
 * A link into `/projects/{id}/<route>` — either a leaf (closing backtick) or a
 * prefix of a deeper path, as `/execution/${slug}` is.
 */
function linksTo(route) {
  return PROJECT_NAV_SOURCES.some(
    (source) => source.includes(`/${route}\``) || source.includes(`/${route}/`),
  )
}

/** Directory names under `/projects/[projectId]`, i.e. its real sub-routes. */
function projectSubRoutes() {
  return readdirSync(PROJECT_ROUTES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
    .map((entry) => entry.name)
}

describe('project sub-route reachability', () => {
  it('finds the sub-routes on disk', () => {
    // A guard on the guard: if this ever returns nothing, the loop below would
    // pass vacuously and stop protecting anything.
    expect(projectSubRoutes().length).toBeGreaterThan(5)
  })

  it.each(projectSubRoutes())('links to /projects/{id}/%s from a navigation component', (route) => {
    expect(linksTo(route), `no nav component links to /projects/{id}/${route}`).toBe(true)
  })
})

describe('Work sub-view tabs are two-way', () => {
  // A tab whose destination does not itself render the tab bar is a one-way
  // door: arriving removes every route back to its siblings. `/timeline` was
  // one before `/milestones` joined it.
  const workViewHrefs = [...workViewTabs.matchAll(/projects\/\$\{projectId\}\/(\w[\w-]*)`/g)].map((m) => m[1])

  it('declares more than one sub-view', () => {
    expect(workViewHrefs.length).toBeGreaterThan(3)
  })

  it.each(workViewHrefs)('renders WorkViewTabs on the /%s destination', (route) => {
    const page = src(`src/app/(pm)/projects/[projectId]/${route}/page.jsx`)
    expect(page).toContain('<WorkViewTabs projectId={projectId} />')
  })
})

describe('Space list reachability', () => {
  // ADR-008 §D6 and SITEMAP-DOMAIN-NAV §6 keep Space out of the Development
  // sidebar ("a resource, not a Development capability") and FR-034 keeps it out
  // of the breadcrumb. Both decisions stand — which is exactly why the list
  // needs an entry point somewhere else, and had none.
  it('stays out of the sidebar and the palette-visible domain registry', () => {
    for (const domain of DOMAINS) {
      expect(domain.sub.map((item) => item.path)).not.toContain('/workspaces')
    }
  })

  it('is reachable by search', () => {
    expect(buildRouteEntries(DOMAINS.map((d) => d.key)).map((e) => e.path)).toContain('/workspaces')
  })

  it('is reachable by browsing, from the resource list whose rows carry a Space', () => {
    expect(projectsPage).toContain('href="/workspaces"')
  })
})

describe('in-shell CTAs stay in the shell', () => {
  // `/` is the marketing Landing (FR-056), not Business Routing. Two empty-state
  // CTAs labelled "Choose Business" pointed at it, ejecting the user out of the
  // shell to reach a selector that lives at `/businesses` (FR-044).
  const CTA_PAGES = [
    'src/app/(pm)/overview/page.jsx',
    'src/modules/people/components/PeopleDirectory.jsx',
  ]

  it.each(CTA_PAGES)('%s sends "Choose Business" to Business Routing', (page) => {
    const body = src(page)
    expect(body).toContain('Choose Business')
    expect(body).toContain('href="/businesses"')
    expect(body).not.toContain('href="/" className="btn btn-primary">Choose Business')
  })
})
