'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardCheck, RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { SALES_ORDER_ORIGINS } from '@/lib/validation/enums'

// @req FR-163 — the Commerce dashboard: revenue counted from verified
//   payments only (net of verified refunds), by origin and by day in the
//   Business's calendar, pending money beside it, open and completed order
//   counts — all recomputed by the server on every load.
// @req FR-162 — the entry to the orders console.
// @spec ADR-065; SEC-001
// @tested tests/e2e/fr162-commerce-orders.spec.js, tests/unit/commerce-routes.test.js

async function api(url) {
  const response = await fetch(url)
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const ORIGIN_LABEL = { CHAT: 'จากแชท (LINE)', WALK_IN: 'หน้าร้าน', ONLINE: 'ออนไลน์' }
const baht = (n) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 }).format(n ?? 0)
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const RANGES = { today: 'วันนี้', month: 'เดือนนี้', all: 'ทั้งหมด' }

function rangeQuery(range) {
  const today = dayKey(new Date())
  if (range === 'today') return `&from=${today}&to=${today}`
  if (range === 'month') return `&from=${today.slice(0, 8)}01&to=${today}`
  return ''
}

export default function CommerceDashboardPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [range, setRange] = useState('month')
  const [revenue, setRevenue] = useState(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!businessId) { setRevenue(null); return }
    setRevenue(await api(`/api/commerce/revenue?businessId=${encodeURIComponent(businessId)}${rangeQuery(range)}`))
  }, [businessId, range])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  return <div>
    <PageHeader
      eyebrow="Commerce · FEAT-023"
      title="ยอดขายและการชำระเงิน"
      subtitle={`รายได้นับจากการชำระที่ตรวจสอบแล้วเท่านั้น แยกตามที่มา${business ? ` · ${business.name}` : ''}`}
      actions={<>
        <Link className="btn btn-primary" href="/commerce/orders"><ClipboardCheck size={15} /> ออเดอร์</Link>
        <button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))}><RefreshCw size={15} /> โหลดใหม่</button>
      </>}
    />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูยอดขาย</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}

    {business && <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="ช่วงเวลา">
      {Object.entries(RANGES).map(([key, label]) => <button key={key} type="button" className={`btn px-3 py-1 text-xs ${range === key ? 'btn-primary' : ''}`} aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}
    </div>}

    {revenue && <>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Kpi label="รายได้ที่ตรวจสอบแล้ว (สุทธิ)" value={baht(revenue.verifiedNet)} meta={revenue.refunded ? `คืนเงินแล้ว ${baht(revenue.refunded)}` : 'หักคืนเงินที่ตรวจสอบแล้ว'} tone="good" />
        <Kpi label="รอตรวจสอบ" value={baht(revenue.pending.amount)} meta={`${revenue.pending.count} รายการ — ไม่นับเป็นรายได้`} tone={revenue.pending.count ? 'warn' : undefined} />
        <Kpi label="ออเดอร์ที่เปิดอยู่" value={revenue.orders.open} />
        <Kpi label="ออเดอร์เสร็จสิ้น" value={revenue.orders.completed} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle caption="CHAT = ออเดอร์ที่ผูกกับบทสนทนา (รายได้จากแชท / โฆษณา)">รายได้ตามที่มา</SectionTitle>
          <DataTable columns={[{ key: 'origin', label: 'ที่มา', render: (r) => ORIGIN_LABEL[r.origin] || r.origin }, { key: 'net', label: 'สุทธิ', render: (r) => baht(r.net) }]}
            rows={SALES_ORDER_ORIGINS.map((origin) => ({ origin, net: revenue.byOrigin[origin] ?? 0 }))} rowKey={(r) => r.origin} />
        </Card>
        <Card>
          <SectionTitle caption="วันที่ชำระ ตามปฏิทินไทย">รายได้รายวัน</SectionTitle>
          <DataTable columns={[{ key: 'day', label: 'วัน' }, { key: 'net', label: 'สุทธิ', render: (r) => baht(r.net) }]} rows={revenue.byDay.slice(-14)} rowKey={(r) => r.day} empty={<p className="text-sm text-muted">ยังไม่มีการชำระที่ตรวจสอบแล้วในช่วงนี้</p>} />
        </Card>
      </div>
    </>}
  </div>
}
