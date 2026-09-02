'use client'

import React, { useState } from 'react'
import { TrendingUp, Bell, ShieldCheck, Tag, BarChart3, AlertCircle, RefreshCw } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'

// @req FR-092 — the console surface over translated `MarketObservation` state. Every
//   number and row on this page comes from `GET /api/market/observations` for the
//   Business the shell has open; there are no fixtures left in this file.
// @spec SDD-049, BR-001, SEC-001, ADR-038
// @tested tests/unit/market-intelligence/market-observations-route.test.js,
//   tests/unit/market-intelligence/market-observation-feed.test.js,
//   tests/integration/market-intelligence-observation-feed.test.js,
//   tests/unit/market-intelligence/market-translations-route.test.js
//
// The "แปลข้อมูลจากแหล่งภายนอก" (translate external data) button below calls the FR-092
// production trigger, `POST /api/market/translations`. It renders only for a viewer who
// OWNS the active Business — the same `viewer.ownedBusinessIds` check
// overview/page.jsx and customer/conversations/page.jsx already use, never the global
// `viewer.role` label (an OWNER-elsewhere/MEMBER-here viewer must not see a control the
// server would refuse anyway; see FR-059's authorization RCA). The route would 404 the
// write regardless, but a control that always renders a denial is worse than one that
// only appears where it can succeed.
//
// This component previously held two `useState` fixture arrays and made no request at
// all, while ADR-038's truthful-navigation rule had already opened the nav entry — so a
// business owner could read invented prices as delivered capability. The fix is not a
// nicer mock: the page now shows exactly what the domain has recorded, including
// nothing.
//
// The test files named above cover the data contract this component renders, not the
// component itself. There is no React rendering harness in this repository, so the
// honest claim is the narrow one: what is proved is the route, the authorization and
// the row shape — not the JSX.
//
// **Watch rules are not implemented.** `WatchRule` is a candidate concept in the
// market-intelligence charter with no persisted model, no service and no route. The
// panel below therefore states that, and carries no control a person could press — a
// disabled-looking button that opens a modal over nothing is the same lie in a quieter
// voice.

const numberFormat = new Intl.NumberFormat('th-TH')

function formatPrice(price, currency) {
  if (price === null || price === undefined) return null
  return `${numberFormat.format(price)}${currency ? ` ${currency}` : ''}`
}

function formatObservedAt(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

function KpiCard({ label, value, hint, icon: Icon, iconClass, valueClass }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-2">
      <div className="flex items-center justify-between text-gray-500">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${iconClass}`} />
      </div>
      <div className={`text-2xl font-bold ${valueClass || 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500">{hint}</div>
    </div>
  )
}

function Notice({ tone = 'muted', title, detail }) {
  const tones = {
    muted: 'border-gray-100 bg-white text-gray-600',
    error: 'border-red-100 bg-red-50 text-red-700',
  }
  return (
    <div className={`rounded-xl border p-6 text-center text-sm shadow-sm ${tones[tone]}`}>
      <p className="font-semibold">{title}</p>
      {detail && <p className="mt-1 text-xs opacity-80">{detail}</p>}
    </div>
  )
}

/**
 * The FR-092 production translation trigger, rendered only for the Business's owner
 * (see the file-header note on why this gates on ownership, not the global role).
 * `onTranslated` is the observations feed's own `reload`, so a successful run shows up
 * on this page immediately rather than waiting for the next navigation.
 */
function TranslateButton({ businessId, onTranslated }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const body = await api('/api/market/translations', { method: 'POST', body: { businessId } })
      setResult(body)
      await onTranslated()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg bg-[#E8820C] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#d1750a] disabled:opacity-60"
        disabled={running}
        onClick={run}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
        {running ? 'กำลังแปลข้อมูล…' : 'แปลข้อมูลจากแหล่งภายนอก'}
      </button>
      {result && (
        <p className="text-[11px] text-gray-500">
          แปลใหม่ {result.translated} รายการ · ไม่มีการเปลี่ยนแปลง {result.unchanged} รายการ
          {result.failed?.length > 0 ? ` · ล้มเหลว ${result.failed.length} รายการ` : ''}
        </p>
      )}
      {result?.failed?.length > 0 && (
        <ul className="max-w-xs text-right text-[10px] text-[var(--danger,#b42318)]">
          {result.failed.slice(0, 3).map((item) => (
            <li key={item.rawRecordId}>{item.rawRecordId}: {item.reason}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-[11px] text-[var(--danger,#b42318)]">แปลข้อมูลไม่สำเร็จ: {error}</p>}
    </div>
  )
}

export default function MarketDashboard() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  const businessLabel = scope.shell.activeBusiness
    ? `${scope.shell.activeBusiness.code} · ${scope.shell.activeBusiness.name}`
    : null

  // `useFetch(null)` performs no request, so a shell with no Business selected asks the
  // server nothing rather than asking it a question with a missing scope.
  const { data, loading, error, reload } = useFetch(
    businessId ? `/api/market/observations?businessId=${encodeURIComponent(businessId)}` : null,
    [businessId],
  )
  // @req FR-092 — the translate button is gated on this viewer's per-Business OWNER
  // grant, the same `/api/viewer` contract and `ownedBusinessIds` check
  // overview/page.jsx and customer/conversations/page.jsx already use — never
  // `viewer.data?.role`, which is a global per-principal label true for an OWNER of a
  // different Business who is only a MEMBER here.
  const viewer = useFetch('/api/viewer')
  const isOwner = Boolean(businessId && viewer.data?.ownedBusinessIds?.includes(businessId))

  const observations = data?.observations ?? []
  const counts = data?.counts ?? null
  const resolved = counts?.byResolutionStatus?.RESOLVED ?? 0
  const unresolved = counts?.byResolutionStatus?.UNRESOLVED ?? 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-[#FDE8D0] text-[#E8820C]">
              <TrendingUp className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold text-gray-900">Market Intelligence</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            ข้อมูลตลาดภายนอกที่แปลและบันทึกไว้แล้ว พร้อมที่มาของแหล่งข้อมูล
            {businessLabel ? ` — ธุรกิจ: ${businessLabel}` : ''}
          </p>
        </div>
        {isOwner && <TranslateButton businessId={businessId} onTranslated={reload} />}
      </div>

      {!businessId && (
        <Notice
          title="ยังไม่ได้เลือกธุรกิจ"
          detail="เลือกธุรกิจจากแถบด้านบนก่อน ระบบจึงจะแสดงข้อมูลตลาดของธุรกิจนั้นได้"
        />
      )}

      {businessId && loading && <LoadingCard />}

      {businessId && error && (
        <Notice tone="error" title="โหลดข้อมูลตลาดไม่สำเร็จ" detail={error} />
      )}

      {businessId && !loading && !error && (
        <>
          {/* KPI Cards — every figure is counted from the rows below, not asserted */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard
              label="รายการที่สังเกตได้"
              value={counts?.observations ?? 0}
              hint={data?.truncated ? `แสดงล่าสุด ${data.limit} รายการ` : 'ในขอบเขตธุรกิจนี้'}
              icon={Tag}
              iconClass="text-blue-500"
            />
            <KpiCard
              label="แหล่งข้อมูล"
              value={counts?.providers ?? 0}
              hint="จำนวนผู้ให้ข้อมูลที่ปรากฏในรายการนี้"
              icon={BarChart3}
              iconClass="text-[#E8820C]"
            />
            <KpiCard
              label="ระบุสินค้าได้แล้ว"
              value={resolved}
              hint="จับคู่กับสินค้าใน Knowledge ได้"
              icon={ShieldCheck}
              iconClass="text-emerald-500"
              valueClass="text-emerald-600"
            />
            <KpiCard
              label="ยังระบุสินค้าไม่ได้"
              value={unresolved}
              hint="ยังไม่จับคู่ — ถือเป็นสถานะปกติ ไม่ใช่ข้อผิดพลาด"
              icon={AlertCircle}
              iconClass="text-amber-500"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: the observations themselves */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#E8820C]" />
                  รายการตลาดที่แปลแล้ว (ล่าสุดก่อน)
                </h2>
              </div>

              {observations.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm font-semibold text-gray-700">ยังไม่มีข้อมูลตลาดสำหรับธุรกิจนี้</p>
                  <p className="mt-1 text-xs text-gray-500">
                    ข้อมูลจะปรากฏที่นี่เมื่อมีการแปลบันทึกดิบจากการเชื่อมต่อภายนอกเป็น Market Observation แล้ว
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {observations.map((obs) => {
                    const price = formatPrice(obs.price, obs.currency)
                    const observedAt = formatObservedAt(obs.observedAt)
                    return (
                      <div key={obs.id} className="p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm break-words">
                              {obs.title || obs.externalId}
                            </span>
                            {obs.resolutionStatus !== 'RESOLVED' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">
                                {obs.resolutionStatus === 'PARTIAL' ? 'ระบุได้บางส่วน' : 'ยังไม่ระบุสินค้า'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                            <span>แหล่ง: {obs.provider}</span>
                            <span>•</span>
                            <span>ประเภท: {obs.observationType}</span>
                            {obs.condition && (
                              <>
                                <span>•</span>
                                <span>สภาพ: {obs.condition}</span>
                              </>
                            )}
                            {obs.seller && (
                              <>
                                <span>•</span>
                                <span>ผู้ขาย: {obs.seller}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-base font-bold text-gray-900">
                            {price || <span className="text-xs font-normal text-gray-400">ไม่มีข้อมูลราคา</span>}
                          </div>
                          <div className="text-xs text-gray-400">{observedAt || '—'}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right: watch rules — declared unbuilt, with nothing to press */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-gray-400" />
                  กฎเฝ้าติดตาม (Watch Rules)
                </h2>
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  ยังไม่เปิดใช้งาน
                </span>
              </div>
              <div className="p-4 text-xs text-gray-500 space-y-2">
                <p>ยังไม่มีการจัดเก็บกฎเฝ้าติดตามในระบบ จึงยังตั้งกฎหรือรับการแจ้งเตือนไม่ได้</p>
                <p>ส่วนนี้จะเปิดใช้งานเมื่อมีการส่งมอบโมเดลและบริการของ Watch Rule ตามข้อกำหนดที่ประกาศไว้แล้ว</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
