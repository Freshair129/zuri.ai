// @req FR-124 — route and component source pin the six-KPI dashboard,
// drilldown, filters, use cases, evidence disclosure, the server-side viewer
// seam and the not-found boundary.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md, NFR-008, SEC-008
// @tested tests/unit/fr124-product-readiness-ui.test.js
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'

const dashboardSource = readFileSync('src/modules/project-manager/components/ProductReadinessDashboard.jsx', 'utf8')
const summarySource = readFileSync('src/app/(pm)/platform/product-readiness/page.jsx', 'utf8')
const detailSource = readFileSync('src/app/(pm)/platform/product-readiness/[domain]/page.jsx', 'utf8')
const accessSource = readFileSync('src/modules/project-manager/application/product-readiness-access.js', 'utf8')

describe('FR-124 product readiness UI contract', () => {
  it('renders exactly six contextual KPIs and keeps methodology visible', () => {
    expect(dashboardSource.match(/<Kpi label=/g)).toHaveLength(6)
    for (const label of ['Domains', 'Features', 'Ready', 'Progress', 'Verified FRs', 'Open gaps']) {
      expect(dashboardSource).toContain(`<Kpi label="${label}"`)
    }
    expect(dashboardSource).toContain('วิธีคำนวณและขอบเขตของตัวเลข')
    expect(dashboardSource).toContain('20% declaration · 40% code · 40% tests')
  })

  it('shows every feature with readiness, progress, use case, blockers and evidence affordances', () => {
    expect(dashboardSource).toContain('ตัวอย่าง use case')
    expect(dashboardSource).toContain('พร้อมใช้งาน')
    expect(dashboardSource).toContain('ไม่พร้อมใช้งาน')
    expect(dashboardSource).toContain('Filter by readiness')
    expect(dashboardSource).toContain('requirements, blockers และ evidence')
    expect(dashboardSource).toContain('feature.progressPercent')
  })

  it('registers summary and fail-closed domain routes under Platform without moving Dashboard', () => {
    const platform = DOMAINS.find((domain) => domain.key === 'platform')
    expect(platform.sub[0]).toMatchObject({ label: 'Dashboard', path: '/settings' })
    expect(platform.sub[1]).toMatchObject({ label: 'Product Readiness', path: '/platform/product-readiness' })
    expect(summarySource).toContain('getProductReadinessSnapshot')
    expect(detailSource).toContain('getProductReadinessDomain(params.domain)')
    expect(detailSource).toContain('notFound()')
  })

  it('resolves the viewer on the server before either route renders a snapshot', () => {
    // These pages are the only server-rendered pages under (pm) that carry data
    // inline, so `BusinessShellGuard` — a client guard — cannot be the only gate:
    // it decides what to display after the payload has already been sent.
    for (const source of [summarySource, detailSource]) {
      expect(source).toContain('await requireProductReadinessViewer()')
      expect(source).not.toContain("'use client'")
    }
    // The drilldown must authorize before it answers whether a domain key
    // exists, or the not-found boundary enumerates domains for an unauthorized
    // caller.
    expect(detailSource.indexOf('await requireProductReadinessViewer()'))
      .toBeLessThan(detailSource.indexOf('getProductReadinessDomain(params.domain)'))
    expect(accessSource).toContain('resolveRequestViewer')
    expect(accessSource).toContain("redirect(decision.redirect)")
    expect(accessSource).toContain('notFound()')
  })
})
