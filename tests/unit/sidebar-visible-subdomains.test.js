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

  it('keeps the domain heading static and exposes Overview as the first Development entry', () => {
    const development = DOMAINS.find((domain) => domain.key === 'projects')
    expect(development.sub[0]).toMatchObject({ label: 'Overview', path: '/overview' })
    expect(sidebar).not.toContain('<Link href={domain.basePath || domain.sub[0].path}')
    expect(sidebar).toContain('<div className="flex h-14 shrink-0 items-center')
  })
})
