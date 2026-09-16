'use client'

// @req FR-248, FR-249 — the operator's route and action usage breakdown: total
// count, the last-90-days per-person split, and a note that older usage
// survives only as an aggregate (ADR-095 D2, D3).
// @spec ADR-095 D2, D3; NFR-008
// @tested tests/unit/usage-events-view.test.js

import { useCallback, useEffect, useState } from 'react'
import { Card, DataTable, EmptyState } from '@/components/ui'

function Table({ rows, targetLabel }) {
  return (
    <DataTable
      rowKey={(r) => r.target}
      empty={<EmptyState title="ยังไม่มีข้อมูล" hint="ยังไม่มีใครใช้งานส่วนนี้ตั้งแต่เริ่มเก็บ" />}
      columns={[
        { key: 'target', label: targetLabel, render: (r) => <code className="text-[11px] font-semibold">{r.target}</code> },
        { key: 'totalCount', label: 'รวมทั้งหมด', render: (r) => <b>{r.totalCount.toLocaleString()}</b> },
        { key: 'recentCount', label: '90 วันล่าสุด', render: (r) => r.recentCount.toLocaleString() },
        {
          key: 'byPerson', label: 'แยกตามคน (90 วันล่าสุด)',
          render: (r) => r.byPerson.length ? (
            <span className="flex flex-wrap gap-1">
              {r.byPerson.slice(0, 5).map((p) => (
                <span key={p.personId} className="pill" title={`${p.count} ครั้ง`}>{p.label} <b>{p.count}</b></span>
              ))}
              {r.byPerson.length > 5 && <span className="text-muted">+{r.byPerson.length - 5} คน</span>}
            </span>
          ) : <span className="text-muted">เกิน 90 วัน — เหลือแค่ยอดรวม</span>,
        },
      ]}
      rows={rows}
    />
  )
}

export default function UsageBreakdownView({ initialBreakdown = null, fetcher = globalThis.fetch }) {
  const [data, setData] = useState(initialBreakdown)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetcher('/api/platform/usage-events', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'โหลดข้อมูล usage ไม่สำเร็จ')
      setData(body)
      setError('')
    } catch (failure) {
      setError(failure.message)
      setData((prior) => prior ?? { pageViews: [], actions: [] })
    }
  }, [fetcher])

  useEffect(() => {
    if (initialBreakdown === null) load()
  }, [initialBreakdown, load])

  return (
    <div className="space-y-6" data-testid="usage-breakdown-view">
      <p className="text-xs text-muted">
        เก็บทั้งระดับหน้า (route) และปุ่ม/การกระทำ (action) แยกตามคน — ข้อมูลดิบที่ผูกกับคนเก็บ 90 วัน
        หลังจากนั้นเหลือแค่ยอดรวมรายวันไม่ผูกคน (ADR-095 D3) ระดับ action เป็นกลไกที่ค่อยๆ ผูกเพิ่มทีละจุด
        ไม่ใช่ทุกปุ่มตั้งแต่วันแรก
      </p>
      {error && <p className="text-xs text-[var(--action-danger,#B83227)]">{error}</p>}
      <Card>
        <h3 className="mb-2 text-sm font-bold">หน้าที่เปิดบ่อย (Page views)</h3>
        {data ? <Table rows={data.pageViews} targetLabel="หน้า" /> : <EmptyState title="กำลังโหลด…" />}
      </Card>
      <Card>
        <h3 className="mb-2 text-sm font-bold">การกระทำที่ทำบ่อย (Actions)</h3>
        {data ? <Table rows={data.actions} targetLabel="action" /> : <EmptyState title="กำลังโหลด…" />}
      </Card>
    </div>
  )
}
