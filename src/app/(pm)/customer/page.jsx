'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Card, EmptyState, ErrorState, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

// @req FR-091 — the CRM domain's Dashboard entry, reading the same authorized
// composition as the Inbox rather than a second aggregation of its own.
// @spec SDD-049, BR-001, SDD-007
// @tested tests/unit/fr091-inbox-ui-contract.test.js, tests/e2e/fr091-conversation-inbox.spec.js
//
// Every figure on this page comes from `GET /api/crm/conversations` — the endpoint the
// Inbox already calls. A separate `/api/crm/summary` would be a second place for the
// same numbers to be computed, and therefore a second place for them to disagree with
// the list a reader can see one click away.

const RECENT_LIMIT = 6

const timeOf = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })

export default function CustomerDashboardPage() {
  const scope = useScope()
  const businessId = scope.currentBusiness?.id || ''
  const path = businessId ? `/api/crm/conversations?businessId=${encodeURIComponent(businessId)}` : null
  const inbox = useFetch(path, [businessId])

  if (!businessId) return <EmptyState title="เลือกธุรกิจก่อน" hint="CRM อ่านตาม tenant ของธุรกิจที่เปิดอยู่" />
  if (inbox.error) return <ErrorState title="โหลดข้อมูล CRM ไม่ได้" detail={inbox.error} retry={inbox.reload} />
  // See the inbox page: `loading: false` with no data is a real render, not a
  // theoretical one — the effect that starts the fetch has not run yet.
  if (inbox.loading || !inbox.data) return <LoadingCard />

  const { counts, conversations, scope: readScope } = inbox.data
  const recent = conversations.slice(0, RECENT_LIMIT)
  const activeChannels = Object.entries(counts.byChannel).filter(([, total]) => total > 0)

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="CRM"
        title="Dashboard"
        subtitle={`ขอบเขต: tenant ของ ${readScope.businessName}`}
        actions={
          <Link href="/customer/conversations" className="btn btn-primary">
            เปิด Inbox <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Kpi label="ห้องสนทนา" value={counts.conversations} meta="ทุกช่องทาง" />
        <Kpi label="ลูกค้า" value={counts.customers} meta="ที่เคยทักเข้ามา" />
        <Kpi label="ข้อความจากลูกค้า" value={counts.byDirection.INBOUND} meta="INBOUND" />
        <Kpi label="ข้อความที่ตอบออกไป" value={counts.byDirection.OUTBOUND} meta="OUTBOUND" />
      </div>

      <Card>
        <SectionTitle caption="นับจากห้องสนทนาที่แสดงในหน้านี้">ช่องทาง</SectionTitle>
        {activeChannels.length === 0 ? (
          <p className="mt-2 text-xs text-muted">ยังไม่มีข้อความจากช่องทางใดเลย</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {activeChannels.map(([channel, total]) => (
              <span key={channel} className="pill pill-planned">
                {channel} · {total}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle caption="เรียงตามข้อความล่าสุด">คุยล่าสุด</SectionTitle>
        {recent.length === 0 ? (
          <p className="mt-2 text-xs text-muted">
            ยังไม่มีข้อความจากลูกค้า — ข้อความจาก LINE OA จะปรากฏที่นี่ทันทีที่ webhook รับเข้ามา
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {recent.map((row) => (
              <li key={row.id}>
                <Link
                  href="/customer/conversations"
                  className="flex items-baseline justify-between gap-3 py-2 hover:text-[var(--brand-dark)]"
                >
                  <span className="min-w-0">
                    <span className="text-xs font-bold">{row.customer.displayName}</span>
                    <span className="ml-2 text-[11px] text-muted">{row.lastMessage?.preview || 'ยังไม่มีข้อความ'}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {row.lastMessage ? timeOf(row.lastMessage.createdAt) : timeOf(row.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
