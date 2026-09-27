'use client'

// Marketing Insights (S6) — <Sparkline> and <MetricChart>. Hand-drawn SVG,
// following the repo convention (no chart library, contract §7). A missing day
// breaks the line; it is never drawn as zero. Series differ by dash pattern
// as well as colour.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (R-18, D-04)
// @tested tests/unit/marketing/insights/insights-ui.test.js

import { lineSegments, formatMetricValue, reasonText } from './insights-format'

const SERIES = [
  { key: 'value', label: 'รวม', color: 'var(--brand-dark)', dash: undefined, width: 2.25 },
  { key: 'organic', label: 'ออร์แกนิก', color: 'var(--brand)', dash: '5 3', width: 1.75 },
  { key: 'paid', label: 'โฆษณา', color: 'var(--status-info)', dash: '2 3', width: 1.75 },
]

export function Sparkline({ values = [], label }) {
  const segments = lineSegments(values, { width: 100, height: 28 })
  if (segments.length === 0) {
    return <p className="mt-2 text-[10px] text-muted" aria-label={`${label}: ไม่มีข้อมูลสำหรับกราฟ`}>ไม่มีข้อมูลสำหรับกราฟ</p>
  }
  return (
    <svg className="mt-2 h-7 w-full" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={`${label}: แนวโน้มรายวัน`}>
      {segments.map((points, index) => (
        <polyline key={index} points={points} fill="none" stroke="var(--brand-dark)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

export function MetricChart({ title, points = [], unit = null, reasonCode = null, exportHref = null }) {
  const present = SERIES.filter((series) => points.some((point) => typeof point[series.key] === 'number'))
  const all = present.flatMap((series) => points.map((point) => point[series.key])).filter((value) => typeof value === 'number')
  const max = all.length ? Math.max(...all) : 0
  const width = 600
  const height = 180
  return (
    <section className="card p-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold">{title}</h3>
        {exportHref && (
          <a className="btn btn-secondary text-[11px]" href={exportHref} download>ส่งออก CSV</a>
        )}
      </div>
      {present.length === 0 ? (
        <div className="mt-2 grid min-h-32 place-items-center rounded-xl border border-dashed border-[var(--border-default)] p-6 text-center text-[11px] text-muted" role="status">
          {reasonText(reasonCode || 'NOT_SYNCED')}
        </div>
      ) : (
        <>
          <svg className="mt-2 h-44 w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${title}: กราฟรายวัน ${points[0]?.date ?? ''} ถึง ${points[points.length - 1]?.date ?? ''}`}>
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="var(--border-subtle)" strokeDasharray="3 3" />
            ))}
            {present.map((series) => lineSegments(points.map((point) => point[series.key]), { width, height, max }).map((segment, index) => (
              <polyline key={`${series.key}-${index}`} points={segment} fill="none" stroke={series.color} strokeWidth={series.width} strokeDasharray={series.dash} vectorEffect="non-scaling-stroke" />
            )))}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>{points[0]?.date}</span>
            <span>สูงสุด {formatMetricValue(max, unit) ?? '—'}</span>
            <span>{points[points.length - 1]?.date}</span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-3 text-[10px]" aria-label="คำอธิบายเส้นกราฟ">
            {present.map((series) => (
              <li key={series.key} className="inline-flex items-center gap-1">
                <svg width="18" height="6" aria-hidden><line x1="0" x2="18" y1="3" y2="3" stroke={series.color} strokeWidth="2" strokeDasharray={series.dash} /></svg>
                {series.label}
              </li>
            ))}
          </ul>
          {reasonCode && <p className="mt-1 text-[10px] text-muted" role="status">{reasonText(reasonCode)}</p>}
        </>
      )}
      <details className="mt-2 text-[10px]">
        <summary className="cursor-pointer text-muted">ดูเป็นตาราง</summary>
        <table className="mt-1 w-full text-left">
          <thead><tr><th>วันที่</th><th>ออร์แกนิก</th><th>โฆษณา</th><th>รวม</th><th>สถานะ</th></tr></thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <td>{point.date}</td>
                <td>{formatMetricValue(point.organic, unit) ?? '—'}</td>
                <td>{formatMetricValue(point.paid, unit) ?? '—'}</td>
                <td>{formatMetricValue(point.value, unit) ?? '—'}</td>
                <td>{point.quality === 'OBSERVED' ? '' : reasonText(point.quality)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
