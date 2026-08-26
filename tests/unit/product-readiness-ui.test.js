// @req FR-094 — route and component source pin the six-KPI dashboard,
// drilldown, filters, use cases, evidence disclosure and not-found boundary.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md, NFR-008
// @tested tests/unit/product-readiness-ui.test.js
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'

const dashboardSource = readFileSync('src/modules/project-manager/components/ProductReadinessDashboard.jsx', 'utf8')
const summarySource = readFileSync('src/app/(pm)/platform/product-readiness/page.jsx', 'utf8')
const detailSource = readFileSync('src/app/(pm)/platform/product-readiness/[domain]/page.jsx', 'utf8')

describe('FR-094 product readiness UI contract', () => {
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
})
