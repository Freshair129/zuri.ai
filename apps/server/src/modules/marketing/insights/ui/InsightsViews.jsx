'use client'

// Marketing Insights (S6) — <InsightsOverview>, <InsightsResults>,
// <InsightsContent> and their parts (contract §7). Presentational only: they
// render the query-service DTOs and never compute a measurement themselves.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (R-04, R-10, R-18)
// @tested tests/unit/marketing/insights/insights-ui.test.js

import { OVERVIEW_CARDS, DAILY_METRICS } from '../domain/metric-catalog'
import { CONTENT_TYPE_FILTERS } from '../domain/content-report'
import { MetricChart, Sparkline } from './InsightsCharts'
import { formatChange, formatCount, formatMetricValue, metricReason, reasonText } from './insights-format'

const CARD_TITLES = { views: 'การมองเห็น', follows: 'ผู้ติดตาม', visits: 'การเข้าชม', interactions: 'การมีส่วนร่วม', video: 'วิดีโอ', conversions: 'Conversions' }
const TYPE_LABELS = { all: 'ทั้งหมด', post: 'โพสต์', story: 'สตอรี่', reel: 'รีล', live: 'ไลฟ์' }
const FORMAT_LABELS = { photo: 'รูปภาพ', video: 'วิดีโอ', text: 'ข้อความ', link: 'ลิงก์', unknown: 'ไม่ระบุ' }
const BREAKDOWN_TITLES = { published: 'จำนวนที่เผยแพร่', views: 'ยอดการมองเห็น', interactions: 'การมีส่วนร่วม' }

function ValueOrReason({ value, unit, reasonCode, state, className = 'text-lg font-bold' }) {
  const text = formatMetricValue(value, unit)
  if (text !== null) return <p className={className}>{text}</p>
  return <p className="text-[11px] font-semibold text-muted" role="status">{reasonText(metricReason({ state, reasonCode }))}</p>
}

function Change({ changePct, changeReasonCode }) {
  const text = formatChange(changePct)
  if (text !== null) {
    const tone = changePct > 0 ? 'var(--status-success)' : changePct < 0 ? 'var(--status-danger)' : 'var(--text-secondary)'
    return <p className="text-[10px]" style={{ color: tone }}>{text} เทียบช่วงก่อนหน้า</p>
  }
  return <p className="text-[10px] text-muted">% เปลี่ยนแปลง: {reasonText(changeReasonCode)}</p>
}

export function MetricCard({ cardKey, items = [], placeholder = null, resultsHref = null }) {
  const title = CARD_TITLES[cardKey] ?? cardKey
  if (placeholder) {
    return (
      <article className="card p-4" aria-label={title}>
        <p className="text-[10px] font-semibold text-muted">{title}</p>
        <p className="mt-1 text-[11px] font-semibold" role="status">{reasonText(placeholder)}</p>
        <p className="mt-1 text-[10px] text-muted">ไม่มีการนับยอดขายหรือลีดจากโมดูลนี้</p>
      </article>
    )
  }
  const [primary, ...secondary] = items
  if (!primary) return null
  return (
    <article className="card p-4" aria-label={title}>
      <p className="text-[10px] font-semibold text-muted">{title} · {primary.labelTh}</p>
      <ValueOrReason value={primary.total} unit={primary.unit} reasonCode={primary.reasonCode} state={primary.state} />
      <Change changePct={primary.changePct} changeReasonCode={primary.changeReasonCode} />
      <Sparkline values={primary.series.map((point) => point.value)} label={primary.labelTh} />
      {secondary.length > 0 && (
        <dl className="mt-2 grid gap-1 text-[10px]">
          {secondary.map((item) => (
            <div key={item.metricKey} className="flex justify-between gap-2">
              <dt className="text-muted">{item.labelTh}</dt>
              <dd>{formatMetricValue(item.total, item.unit) ?? reasonText(metricReason(item))}</dd>
            </div>
          ))}
        </dl>
      )}
      {resultsHref && <a className="mt-2 inline-block text-[10px] font-semibold underline" href={resultsHref(primary.metricKey)}>ดูผลลัพธ์</a>}
    </article>
  )
}

export function InsightsOverview({ summary = [], resultsHref = null }) {
  const byKey = new Map(summary.map((item) => [item.metricKey, item]))
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {OVERVIEW_CARDS.map((card) => (
        <MetricCard
          key={card.cardKey}
          cardKey={card.cardKey}
          placeholder={card.placeholder ?? null}
          items={card.metricKeys.map((key) => byKey.get(key)).filter(Boolean)}
          resultsHref={resultsHref}
        />
      ))}
    </div>
  )
}

/** `series` maps metricKey → the metric DTO `{ data, meta }`. */
export function InsightsResults({ series = {}, exportHref = null }) {
  return (
    <div className="grid gap-3">
      {DAILY_METRICS.filter((definition) => series[definition.metricKey]).map((definition) => {
        const { data, meta } = series[definition.metricKey]
        return (
          <MetricChart
            key={definition.metricKey}
            title={definition.labelTh}
            points={data}
            unit={data.find((point) => point.unit)?.unit ?? null}
            reasonCode={meta?.reasonCode ?? null}
            exportHref={exportHref ? exportHref(definition.metricKey, meta?.snapshot?.snapshotId ?? null) : null}
          />
        )
      })}
    </div>
  )
}

export function ContentTypeFilter({ value = 'all', onChange }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="ประเภทคอนเทนต์">
      {CONTENT_TYPE_FILTERS.map((type) => (
        <button
          key={type}
          type="button"
          className={`btn text-[11px] ${type === value ? 'btn-primary' : 'btn-secondary'}`}
          aria-pressed={type === value}
          onClick={() => onChange?.(type)}
        >
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  )
}

export function OrganicPaidChart({ points = [], reasonCode = null }) {
  return <MetricChart title="ยอดการมองเห็น: ออร์แกนิกเทียบโฆษณา" points={points} unit="count" reasonCode={reasonCode} />
}

export function TopContentList({ rows = [] }) {
  if (rows.length === 0) return <p className="card p-4 text-[11px] text-muted" role="status">ไม่มีคอนเทนต์ที่เผยแพร่ในช่วงนี้</p>
  return (
    <ol className="grid gap-2" aria-label="คอนเทนต์ยอดนิยมตามยอดการมองเห็น">
      {rows.map((row) => (
        <li key={row.contentId} className="card flex items-center gap-3 p-3">
          <span className="w-6 text-center text-xs font-bold">{row.rank}</span>
          {row.thumbnailUrl
            // eslint-disable-next-line @next/next/no-img-element -- allow-listed provider CDN, not proxied
            ? <img src={row.thumbnailUrl} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
            : <span className="grid h-12 w-12 place-items-center rounded bg-[var(--bg-subtle)] text-[9px] text-muted">ไม่มีภาพ</span>}
          <div className="min-w-0 flex-1 text-[11px]">
            <p className="text-muted">{row.publishedAt.slice(0, 10)} · {TYPE_LABELS[row.contentType] ?? 'ไม่ระบุ'} · {FORMAT_LABELS[row.format] ?? 'ไม่ระบุ'}</p>
            <p>
              มองเห็น {formatCount(row.views) ?? '—'} · รีแอคชัน {formatCount(row.reactions) ?? '—'} · คอมเมนต์ {formatCount(row.comments) ?? '—'} · แชร์ {formatCount(row.shares) ?? '—'}
            </p>
          </div>
          {row.permalink && <a className="text-[10px] font-semibold underline" href={row.permalink} target="_blank" rel="noopener noreferrer">ดูบน Facebook</a>}
        </li>
      ))}
    </ol>
  )
}

export function FormatBreakdown({ byFormat = [] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {byFormat.map((panel) => (
        <section key={panel.metric} className="card p-4" aria-label={BREAKDOWN_TITLES[panel.metric]}>
          <h4 className="text-xs font-bold">{BREAKDOWN_TITLES[panel.metric]} ตามรูปแบบ</h4>
          {panel.breakdown.length === 0
            ? <p className="mt-2 text-[11px] text-muted" role="status">ไม่มีคอนเทนต์ในช่วงนี้</p>
            : (
              <dl className="mt-2 grid gap-1 text-[11px]">
                {panel.breakdown.map((row) => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <dt>{FORMAT_LABELS[row.label] ?? row.label}</dt>
                    <dd className="text-right">
                      {formatCount(row.value) ?? reasonText(row.reasonCode)}
                      <span className="block text-[10px] text-muted">{formatChange(row.changePct) ?? reasonText(row.changeReasonCode)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
        </section>
      ))}
    </div>
  )
}

const SUMMARY_LABELS = { views: 'ยอดการมองเห็น', threeSecViews: 'ดูวิดีโอ 3 วินาที', interactions: 'การมีส่วนร่วม', watchTime: 'เวลาในการรับชม', organicViews: 'มองเห็นแบบออร์แกนิก', paidViews: 'มองเห็นจากโฆษณา' }

export function InsightsContent({ content, type = 'all', onTypeChange, viewsSeries = null }) {
  const { data, meta } = content
  return (
    <div className="grid gap-3">
      <ContentTypeFilter value={type} onChange={onTypeChange} />
      <p className="text-[10px] text-muted" role="note">
        คอนเทนต์ที่เผยแพร่ในช่วงที่เลือก ({meta.itemCount} รายการ) · ตัวเลขเป็นยอดสะสมตลอดอายุโพสต์ ณ เวลาซิงก์ล่าสุด ไม่ใช่ยอดที่เกิดเฉพาะในช่วงนี้
      </p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(SUMMARY_LABELS).map(([field, label]) => (
          <div key={field} className="card p-3">
            <p className="text-[10px] text-muted">{label}</p>
            {field === 'watchTime'
              ? <p className="text-[11px] text-muted" role="status">{data.summary[field] === null ? reasonText(meta.summaryQuality?.[field]?.reasonCode) : 'หน่วยยังไม่ยืนยัน'}</p>
              : <ValueOrReason value={data.summary[field]} unit="count" reasonCode={meta.summaryQuality?.[field]?.reasonCode} className="text-sm font-bold" />}
          </div>
        ))}
      </div>
      {viewsSeries && <OrganicPaidChart points={viewsSeries.data} reasonCode={viewsSeries.meta?.reasonCode ?? null} />}
      <TopContentList rows={data.topContent} />
      <FormatBreakdown byFormat={data.byFormat} />
    </div>
  )
}
