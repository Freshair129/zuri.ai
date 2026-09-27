'use client'

// @req FR-275 — Marketing Insights page. Brand, asset, dates and tab live in the URL; every
// read goes through /api/insights and is re-authorized there. Until a reporting source exists
// the routes answer INSIGHTS_NOT_CONFIGURED and the page says so instead of showing zeros.
// @spec SEC-001, SEC-008
// @tested tests/unit/marketing/insights/insights-routes.test.js

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import InsightsLayout from '@/modules/marketing/insights/ui/InsightsLayout'
import { insightsSearch, readInsightsSelection } from '@/modules/marketing/insights/ui/insights-format'
import { loadInsightsJson } from '@/modules/marketing/insights/ui/insights-page-loader'
import { bangkokDate } from '@/modules/marketing/insights/domain/report-window'

const API_BASE = '/api/insights'

function InsightsPageBody() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selection = readInsightsSelection(searchParams)
  const [brands, setBrands] = useState({ status: 'loading', list: [], code: null })

  useEffect(() => {
    const controller = new AbortController()
    loadInsightsJson(`${API_BASE}/brands`, { signal: controller.signal })
      .then((result) => setBrands({ status: 'ready', list: result.data ?? [], code: null }))
      .catch((error) => { if (!controller.signal.aborted) setBrands({ status: 'error', list: [], code: error.code }) })
    return () => controller.abort()
  }, [])

  if (brands.status === 'loading') return <p className="text-sm text-muted">กำลังโหลด…</p>
  if (brands.status === 'error') {
    return (
      <p className="card p-4 text-sm" role="status" data-testid="insights-unavailable">
        {brands.code === 'INSIGHTS_NOT_CONFIGURED'
          ? 'Insights ยังไม่เปิดใช้ในรุ่นนี้: ยังไม่มีแหล่งข้อมูลรายงาน'
          : `โหลด Insights ไม่สำเร็จ (${brands.code})`}
      </p>
    )
  }
  return (
    <InsightsLayout
      selection={selection}
      brands={brands.list}
      today={bangkokDate(new Date())}
      load={loadInsightsJson}
      apiBase={API_BASE}
      basePath={pathname}
      onSelectionChange={(next) => router.replace(`${pathname}?${insightsSearch(next)}`, { scroll: false })}
    />
  )
}

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsPageBody />
    </Suspense>
  )
}
