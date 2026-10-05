import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const { useScope, useFetch } = vi.hoisted(() => ({ useScope: vi.fn(), useFetch: vi.fn() }))
vi.mock('@/components/ui', () => ({
  Card: ({ children }) => children,
  PageHeader: ({ title }) => title,
  SectionTitle: ({ children }) => children,
  StatusPill: ({ status }) => status,
  EmptyState: ({ title, hint }) => `${title} ${hint}`,
  ErrorState: ({ title, detail }) => `${title} ${detail}`,
}))
vi.mock('@/context/ScopeContext', () => ({ useScope }))
vi.mock('@/modules/project-manager/components/useApi', () => ({ useFetch }))

const { default: Dashboard } = await import('@/modules/marketing/components/LineSalesExecutiveDashboard')

describe('executive LINE sales dashboard UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useScope.mockReturnValue({ shell: { activeBusiness: { name: 'Zuri Shop' } } })
    useFetch.mockReturnValue({
      loading: false,
      error: null,
      reload: vi.fn(),
      data: {
        state: 'PARTIAL',
        generatedAt: '2026-10-05T02:00:00.000Z',
        window: { from: '2026-09-28', to: '2026-10-04', toExclusive: '2026-10-05', timeZone: 'Asia/Bangkok' },
        sections: {
          commerce: { state: 'UNAVAILABLE', verifiedNet: null, refunded: null, pending: null, orders: null, source: { state: 'UNAVAILABLE', reasonCode: 'VERIFIED_REVENUE_UNAVAILABLE' } },
          followUp: { state: 'UNAVAILABLE', summary: null, observedAt: null, source: { state: 'UNAVAILABLE', reasonCode: 'SALES_TASK_HEALTH_UNAVAILABLE' } },
          paidMedia: { state: 'UNAVAILABLE', reasonCode: 'PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE', metrics: { spend: null, impressions: null, clicks: null, abTestResults: null, roas: null } },
          leadAttribution: { state: 'UNAVAILABLE', reasonCode: 'LEAD_ATTRIBUTION_SOURCE_UNAVAILABLE', metrics: { aiReplies: null, answeredConversations: null, leadHandoffs: null, leads: null, readiness: null, permissionToCall: null } },
          callOutcomes: { state: 'UNAVAILABLE', reasonCode: 'CALL_OUTCOMES_SOURCE_UNAVAILABLE', metrics: { attempts: null, outcomes: null } },
        },
      },
    })
  })

  it('renders missing sources as unavailable and avoids zero-valued placeholders', () => {
    const html = renderToStaticMarkup(createElement(Dashboard, { businessId: 'business-1' }))

    expect(html).toContain('ภาพรวมการขายสำหรับผู้บริหาร')
    expect(html).toContain('Ads และ A/B Test')
    expect(html).toContain('AI chatbot ตอบและส่งต่อ Lead')
    expect(html).toContain('ขั้นตอนการขายผ่าน LINE OA')
    expect(html).toContain('ยังไม่มีข้อมูลที่ยืนยันได้')
    expect(html).toContain('ยังไม่มีแหล่งสถิติ Ads และ A/B Test ที่อนุมัติและตรวจสอบได้')
    expect(html).toContain('ยังไม่มีสถิติ AI chatbot, Lead lifecycle และหลักฐานเชื่อมกับ Ads ที่ยืนยันได้')
    expect(html).toContain('ระบบรุ่นนี้ยังไม่เก็บ snapshot รายสัปดาห์')
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain('—')
    expect(html).not.toContain('>0<')
  })
})
