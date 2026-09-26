'use client'

// Marketing Insights (S6) — <InsightsLayout>: brand + asset selector, date
// range, Overview / Results / Content tabs (contract §7). Selection lives in
// the URL through `onSelectionChange` (the page owns the router), so date
// changes refetch without a full reload and links stay shareable; the server
// re-authorizes every request.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (D-03, R-10, R-18)
// @tested tests/unit/marketing/insights/insights-ui.test.js

import { useEffect, useRef, useState } from 'react'
import { addDays } from '../domain/report-window'
import { InsightsOverview, InsightsResults, InsightsContent } from './InsightsViews'
import { BRAND_LABELS, INSIGHTS_TABS, insightsApiPath, insightsSearch, reasonText } from './insights-format'
import { loadInsightsTab, acceptsResponse } from './insights-loader'

const PRESETS = [
  { days: 7, label: '7 วัน' },
  { days: 28, label: '28 วัน' },
  { days: 90, label: '90 วัน' },
]

function FreshnessNote({ meta }) {
  if (!meta?.snapshot) return null
  const { snapshot, window } = meta
  const stateText = { COMPLETE: 'ครบถ้วน', PARTIAL: 'ไม่ครบ', NOT_SYNCED: 'ยังไม่ซิงก์' }[snapshot.state] ?? snapshot.state
  return (
    <p className="text-[10px] text-muted" role="note">
      ช่วง {window.from} ถึง {window.to} (Asia/Bangkok รวมทั้งสองวัน{window.includesPartialDay ? ' · วันนี้ยังไม่ครบวัน' : ''})
      · ซิงก์ถึง {snapshot.coveredUntil ?? '—'} · สถานะ {stateText}
      {meta.asset ? ` · เพจ ${meta.asset.displayName}` : ''}
    </p>
  )
}

export function InsightsBody({ result, selection, onSelectionChange, resultsHref, exportHref }) {
  if (!result) return null
  if (result.tab === 'overview') return <InsightsOverview summary={result.summary.data} resultsHref={resultsHref} />
  if (result.tab === 'results') {
    return (
      <>
        {Object.entries(result.errors).map(([metricKey, code]) => (
          <p key={metricKey} className="text-[10px] text-muted" role="status">{metricKey}: {reasonText(code)}</p>
        ))}
        <InsightsResults series={result.series} exportHref={exportHref} />
      </>
    )
  }
  return (
    <InsightsContent
      content={result.content}
      type={selection.type}
      onTypeChange={(type) => onSelectionChange({ ...selection, type })}
      viewsSeries={result.viewsSeries}
    />
  )
}

export default function InsightsLayout({ selection, brands = [], today, load, apiBase, onSelectionChange, basePath }) {
  const [state, setState] = useState({ status: selection.brand ? 'loading' : 'idle', result: null, error: null })
  const latest = useRef(selection)
  latest.current = selection

  useEffect(() => {
    if (!selection.brand || typeof load !== 'function' || !apiBase) return undefined
    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'loading', error: null }))
    loadInsightsTab({ tab: selection.tab, selection, load, apiBase, signal: controller.signal })
      .then((result) => {
        // A slow answer for an older brand/date/tab never overwrites the page.
        if (acceptsResponse(latest.current, result)) setState({ status: 'ready', result, error: null })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', result: null, error: error?.code || 'ERROR' })
      })
    return () => controller.abort()
  }, [selection.brand, selection.asset, selection.from, selection.to, selection.tab, selection.type]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch) => onSelectionChange?.({ ...selection, ...patch })
  const meta = state.result?.summary?.meta ?? state.result?.content?.meta ?? Object.values(state.result?.series ?? {})[0]?.meta ?? null
  const assets = meta?.assets ?? []
  const resultsHref = basePath ? (metricKey) => `${basePath}?${insightsSearch({ ...selection, tab: 'results' })}#metric-${metricKey}` : null
  const exportHref = apiBase ? (metricKey, snapshot) => insightsApiPath('export', selection, { apiBase, metricKey, snapshot }) : null

  return (
    <section className="grid gap-3" aria-label="Insights">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1 text-[10px] font-semibold">
          แบรนด์
          <select className="input" value={selection.brand ?? ''} onChange={(event) => update({ brand: event.target.value || null, asset: null })}>
            <option value="">เลือกแบรนด์</option>
            {brands.map((slug) => <option key={slug} value={slug}>{BRAND_LABELS[slug] ?? slug}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[10px] font-semibold">
          เพจ
          <select className="input" value={selection.asset ?? meta?.asset?.assetId ?? ''} disabled={assets.length === 0} onChange={(event) => update({ asset: event.target.value || null })}>
            {assets.length === 0 && <option value="">—</option>}
            {assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.displayName}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ช่วงวันที่">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              className="btn btn-secondary text-[11px]"
              onClick={() => (preset.days === 28 || !today
                ? update({ from: null, to: null })
                : update({ from: addDays(today, -preset.days), to: addDays(today, -1) }))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-[10px] font-semibold">
          ตั้งแต่
          <input className="input" type="date" value={selection.from ?? ''} max={today} onChange={(event) => update({ from: event.target.value || null })} />
        </label>
        <label className="grid gap-1 text-[10px] font-semibold">
          ถึง
          <input className="input" type="date" value={selection.to ?? ''} max={today} onChange={(event) => update({ to: event.target.value || null })} />
        </label>
      </div>

      <nav className="flex gap-2" aria-label="มุมมอง Insights">
        {INSIGHTS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn text-[11px] ${selection.tab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            aria-current={selection.tab === tab.key ? 'page' : undefined}
            onClick={() => update({ tab: tab.key })}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {state.status === 'idle' && <p className="card p-4 text-[11px] text-muted" role="status">เลือกแบรนด์เพื่อดู Insights</p>}
      {state.status === 'loading' && <p className="card p-4 text-[11px] text-muted" role="status">กำลังโหลดข้อมูล…</p>}
      {state.status === 'error' && <p className="card p-4 text-[11px]" role="alert" style={{ color: 'var(--status-danger)' }}>{reasonText(state.error)}</p>}
      {state.status === 'ready' && (
        <>
          <FreshnessNote meta={meta} />
          <InsightsBody result={state.result} selection={selection} onSelectionChange={onSelectionChange} resultsHref={resultsHref} exportHref={exportHref} />
        </>
      )}
    </section>
  )
}
