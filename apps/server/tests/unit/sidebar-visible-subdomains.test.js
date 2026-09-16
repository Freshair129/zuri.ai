// @req FR-039, FR-247 — sidebar exposes the active Business domain's six
// Projects & Work modules without inventing grants or routes.
// @spec SDD-018, ADR-011, ADR-095, SITEMAP-V2-DOMAIN-NAV §3
// @tested tests/unit/sidebar-visible-subdomains.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'
import { PM_MODULES } from '@/modules/project-manager/navigation'

const sidebar = readFileSync(resolve(process.cwd(), 'src/components/layouts/Sidebar.jsx'), 'utf8')

describe('sidebar sub-domain visibility', () => {
  it('keeps the desktop sidebar expanded without a hover interaction', () => {
    expect(sidebar).toContain('w-64 shrink-0')
    // Planned-module disclosure and the compact mobile menu are intentional
    // stateful controls; the regression boundary is hover-driven expansion.
    expect(sidebar).toContain('useState')
    expect(sidebar).not.toContain('onMouseEnter')
    expect(sidebar).not.toContain('onMouseLeave')
  })

  it('uses icon-only presentation only at the mobile breakpoint', () => {
    expect(sidebar).toContain('max-md:opacity-0')
  })

  // @req FR-060, FR-247 — the heading stays static; the first Projects & Work
  // module points at `/projects`, since `/overview` belongs to Business Home.
  it('keeps the domain heading static and renders the six Projects & Work modules', () => {
    const projects = DOMAINS.find((domain) => domain.key === 'projects')
    expect(projects.label).toBe('Projects & Work')
    expect(PM_MODULES).toHaveLength(6)
    expect(PM_MODULES.map((module) => module.label)).toEqual([
      'Project Management',
      'Work Management',
      'Delivery Design',
      'Resource Coordination',
      'Delivery Governance',
      'Agent Delivery',
    ])
    expect(projects.sub[0]).toMatchObject({ label: 'Dashboard', path: '/projects' })
    expect(projects.sub.map((item) => item.path)).toContain('/work')
    expect(projects.sub.map((item) => item.path)).toContain('/files')
    const businessHome = DOMAINS.find((domain) => domain.key === 'business-home')
    expect(businessHome.sub[0]).toMatchObject({ label: 'Dashboard', path: '/overview' })
    expect(sidebar).not.toContain('<Link href={domain.basePath || domain.sub[0].path}')
    expect(sidebar).toContain('<div className="flex h-14 shrink-0 items-center')
    expect(sidebar).toContain('PM_MODULES.map')
    expect(sidebar).toContain('data-nav-layer="logical-module"')
    expect(sidebar).toContain('data-module-status="PLANNED_MODULE"')
  })

  it('keeps planned module disclosures keyboard-operable with Escape focus return', () => {
    expect(sidebar).toContain('aria-expanded={expanded}')
    expect(sidebar).toContain('aria-controls={panelId}')
    expect(sidebar).toContain('plannedTriggerRefs.current[openPlannedId]')
    expect(sidebar).toContain("if (event.key !== 'Escape') return")
    expect(sidebar).toContain('trigger?.focus()')
    expect(sidebar).toContain('Planned — not available yet')
    expect(sidebar).not.toMatch(/<a[^>]+href=[^>]+>[^<]*(Delivery Design|Delivery Governance|Agent Delivery)/)
  })
})
