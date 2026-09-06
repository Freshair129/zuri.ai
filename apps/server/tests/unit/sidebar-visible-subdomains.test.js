// @req FR-039 — sidebar exposes the active Business domain's sub-domains.
// @spec SDD-018, ADR-011, SITEMAP-V2-DOMAIN-NAV §3
// @tested tests/unit/sidebar-visible-subdomains.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'

const sidebar = readFileSync(resolve(process.cwd(), 'src/components/layouts/Sidebar.jsx'), 'utf8')

describe('sidebar sub-domain visibility', () => {
  it('keeps the desktop sidebar expanded without a hover interaction', () => {
    expect(sidebar).toContain('w-64 shrink-0')
    expect(sidebar).not.toContain('useState')
    expect(sidebar).not.toContain('onMouseEnter')
    expect(sidebar).not.toContain('onMouseLeave')
  })

  it('uses icon-only presentation only at the mobile breakpoint', () => {
    expect(sidebar).toContain('max-md:opacity-0')
  })

  // @req FR-060, FR-086 — the heading stays static; the first Development entry
  // points at `/projects`, since `/overview` became the Business Home Dashboard.
  // Its label became `Dashboard` on 2026-08-19 (ADR-036 D1); the *path* is the
  // load-bearing half of this assertion and did not move — `/projects` is a
  // route key (AGENTS.md §18).
  it('keeps the domain heading static and roots the Development sidebar at /projects', () => {
    const development = DOMAINS.find((domain) => domain.key === 'projects')
    expect(development.sub[0]).toMatchObject({ label: 'Dashboard', path: '/projects' })
    const businessHome = DOMAINS.find((domain) => domain.key === 'business-home')
    expect(businessHome.sub[0]).toMatchObject({ label: 'Dashboard', path: '/overview' })
    expect(sidebar).not.toContain('<Link href={domain.basePath || domain.sub[0].path}')
    expect(sidebar).toContain('<div className="flex h-14 shrink-0 items-center')
  })
})
