'use client'

// @req FR-237 — the Knowledge (GKS) slot's LINE knowledge-gap report: counts,
//   product locators (where extractable) and last-seen times only for the
//   selected Business — the question text stays in CRM and is never fetched
//   or rendered here.
// @spec ADR-090 D7
// @tested tests/unit/knowledge-gap-report-ui.test.js
import { useCallback, useEffect, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'

function messageFrom(error) {
  return error?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
}

async function jsonRequest(url) {
  const response = await fetch(url)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

function GapRow({ gap }) {
  return (
    <Card className="mb-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {gap.locatorAvailable ? gap.productLocator.join(', ') : 'ไม่ทราบสินค้า (ไม่มี locator)'}
        </span>
        <span className="text-[11px] text-muted">พบ {gap.count} ครั้ง</span>
      </div>
      <p className="text-[11px] text-muted">
        เห็นล่าสุด: {gap.lastSeenAt ? new Date(gap.lastSeenAt).toLocaleString('th-TH') : '—'}
      </p>
    </Card>
  )
}

export default function KnowledgeGapReport() {
  const scope = useScope()
  const businessId = scope?.shell?.activeBusiness?.id
  const [gaps, setGaps] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!businessId) return
    setLoading(true); setError('')
    try {
      const data = await jsonRequest(`/api/knowledge/gap-report?businessId=${encodeURIComponent(businessId)}`)
      setGaps(data?.businesses?.[0]?.gaps ?? [])
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { void reload() }, [reload])

  if (!businessId) {
    return <Card>เลือก Business ก่อนเพื่อดูรายงานช่องว่างความรู้</Card>
  }

  return (
    <div>
      <SectionTitle caption="คำถามที่ตอบไม่ได้ (NO_EVIDENCE) — แสดงเฉพาะจำนวน สินค้าที่เกี่ยวข้อง (ถ้าทราบ) และเวลาล่าสุด ไม่มีข้อความคำถาม">
        ช่องว่างความรู้ ({gaps.length})
      </SectionTitle>
      {loading && <p className="text-[12px] text-muted">กำลังโหลด…</p>}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {!loading && gaps.length === 0 && <Card>ยังไม่พบช่องว่างความรู้สำหรับ Business นี้</Card>}
      {gaps.map((gap, index) => (
        <GapRow key={`${gap.locatorAvailable ? gap.productLocator.join(',') : 'unspecified'}-${index}`} gap={gap} />
      ))}
    </div>
  )
}
