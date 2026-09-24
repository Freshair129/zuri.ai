// Marketing Insights (S6) — presentation helpers: Thai number formatting,
// unit display, Thai state/reason copy, URL state. Pure; no React.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (D-03, R-10),
//   contract §8 (Thai number formatting, Gregorian dates)
// @tested tests/unit/marketing/insights/insights-ui.test.js

import { BRAND_SLUGS } from '../domain/brand-scope'
import { CONTENT_TYPE_FILTERS } from '../domain/content-report'

export const INSIGHTS_TABS = Object.freeze([
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'results', label: 'ผลลัพธ์' },
  { key: 'content', label: 'คอนเทนต์' },
])

export const BRAND_LABELS = Object.freeze({ infresh: 'INFRESH', glowcea: 'Glowcea', '056laos': '056 Laos' })

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 })
const decimalFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 })

export function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : null
}

/** Watch time is shown only when the stored unit is a known duration unit. */
export function formatDuration(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const seconds = unit === 'ms' ? value / 1000 : unit === 's' ? value : null
  if (seconds === null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${numberFormat.format(hours)} ชม. ${minutes} นาที`
  if (minutes > 0) return `${minutes} นาที`
  return `${decimalFormat.format(seconds)} วินาที`
}

export function formatMetricValue(value, unit) {
  if (unit === 'ms' || unit === 's') return formatDuration(value, unit)
  return formatCount(value)
}

export function formatChange(changePct) {
  if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return null
  const sign = changePct > 0 ? '+' : changePct < 0 ? '−' : ''
  return `${sign}${decimalFormat.format(Math.abs(changePct))}%`
}

// Every non-number has a reason a reader can act on. Never "0", never "-".
const REASON_TH = Object.freeze({
  NOT_SYNCED: 'ยังไม่มีข้อมูลที่ซิงก์',
  UNSUPPORTED: 'แหล่งข้อมูลไม่รองรับตัวชี้วัดนี้',
  PERMISSION_DENIED: 'ไม่มีสิทธิ์อ่านข้อมูลจากแหล่งข้อมูล',
  ERROR: 'อ่านข้อมูลไม่สำเร็จ',
  PARTIAL: 'ข้อมูลยังไม่ครบทุกวันในช่วงที่เลือก',
  INCOMPLETE_COVERAGE: 'ข้อมูลยังไม่ครบทุกวันในช่วงที่เลือก',
  NON_ADDITIVE_UNIQUE: 'ผู้ชมไม่ซ้ำรวมข้ามวันไม่ได้ ต้องใช้ยอดรวมจากแหล่งข้อมูล',
  UNIT_MISMATCH: 'หน่วยข้อมูลไม่ตรงกันในช่วงนี้',
  PRECISION_UNSAFE: 'ตัวเลขเกินความแม่นยำที่แสดงได้',
  PRIOR_INCOMPLETE: 'ช่วงก่อนหน้ายังมีข้อมูลไม่ครบ',
  PRIOR_ZERO: 'ช่วงก่อนหน้าเป็นศูนย์ จึงคำนวณ % ไม่ได้',
  CURRENT_INCOMPLETE: 'ช่วงปัจจุบันยังมีข้อมูลไม่ครบ',
  ITEM_METRIC_MISSING: 'บางคอนเทนต์ยังไม่มีค่าตัวชี้วัดนี้',
  CONVERSIONS_NOT_CONNECTED: 'ยังไม่เชื่อมข้อมูล',
  SCOPE_NOT_FOUND: 'ไม่พบแบรนด์หรือเพจนี้ หรือคุณไม่มีสิทธิ์เข้าถึง',
  SNAPSHOT_EXPIRED: 'ข้อมูลรายงานถูกอัปเดตแล้ว กรุณารีเฟรชก่อนส่งออก',
  INVALID_QUERY: 'ตัวกรองไม่ถูกต้อง',
})

export function reasonText(code) {
  return REASON_TH[code] ?? 'ไม่มีข้อมูล'
}

/**
 * The reason to show for a metric with no total. A whole-metric state
 * (never synced, unsupported, denied, failed) says more than the generic
 * "incomplete coverage" that follows from it, so it wins.
 */
export function metricReason({ state = null, reasonCode = null } = {}) {
  const decisive = ['NOT_SYNCED', 'UNSUPPORTED', 'PERMISSION_DENIED', 'ERROR']
  if (decisive.includes(state) && reasonCode !== 'UNIT_MISMATCH' && reasonCode !== 'PRECISION_UNSAFE') return state
  return reasonCode || state
}

/** Parse report selection from URL search params; invalid values are dropped, never trusted. */
export function readInsightsSelection(searchParams) {
  const get = (key) => (typeof searchParams?.get === 'function' ? searchParams.get(key) : searchParams?.[key]) ?? null
  const brand = get('brand')
  const tab = get('tab')
  const type = get('type')
  const date = /^\d{4}-\d{2}-\d{2}$/
  const from = get('from')
  const to = get('to')
  const bothDates = from && to && date.test(from) && date.test(to)
  return {
    brand: BRAND_SLUGS.includes(brand) ? brand : null,
    asset: typeof get('asset') === 'string' && get('asset').length <= 128 ? get('asset') : null,
    from: bothDates ? from : null,
    to: bothDates ? to : null,
    tab: INSIGHTS_TABS.some((item) => item.key === tab) ? tab : 'overview',
    type: CONTENT_TYPE_FILTERS.includes(type) ? type : 'all',
  }
}

/** Shareable URL state. The server re-authorizes every value on every request. */
export function insightsSearch(selection) {
  const params = new URLSearchParams()
  for (const key of ['brand', 'asset', 'from', 'to', 'tab', 'type']) {
    const value = selection[key]
    if (value && !(key === 'tab' && value === 'overview') && !(key === 'type' && value === 'all')) params.set(key, value)
  }
  return params.toString()
}

/**
 * API path for a report read. The base is supplied by the page that mounts
 * these components, because the routes are not built yet (handoff B1) and the
 * namespace is itself a proposed delta (R-11): source must not reference a
 * route that does not exist (tests/unit/api-path-reachability.test.js).
 */
export function insightsApiPath(kind, selection, { apiBase, metricKey = null, snapshot = null } = {}) {
  if (typeof apiBase !== 'string' || !apiBase.startsWith('/') || apiBase.endsWith('/')) {
    throw new Error('insightsApiPath requires an absolute apiBase without a trailing slash')
  }
  const params = new URLSearchParams()
  for (const key of ['brand', 'asset', 'from', 'to']) if (selection[key]) params.set(key, selection[key])
  if (kind === 'content' && selection.type && selection.type !== 'all') params.set('type', selection.type)
  if (snapshot) params.set('snapshot', snapshot)
  const query = params.toString()
  const encoded = metricKey ? encodeURIComponent(metricKey) : null
  const suffix = {
    summary: 'summary',
    metric: `metric/${encoded}`,
    export: `metric/${encoded}/export`,
    content: 'content',
  }[kind]
  if (!suffix) throw new Error(`unknown insights read: ${kind}`)
  return `${apiBase}/${suffix}?${query}`
}

/**
 * Key that a response must match to be applied. A slow response for brand A
 * cannot overwrite the page after the user switched to brand B.
 */
export function selectionKey(selection, kind = 'summary') {
  return [kind, selection.brand, selection.asset, selection.from, selection.to, kind === 'content' ? selection.type : ''].join('|')
}

/** SVG polyline segments; null values break the line instead of dropping to zero. */
export function lineSegments(values, { width, height, max = null, pad = 2 }) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  const top = max ?? (numbers.length ? Math.max(...numbers) : 0)
  const scaleY = (value) => (top <= 0 ? height - pad : height - pad - (value / top) * (height - pad * 2))
  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  const segments = []
  let current = []
  values.forEach((value, index) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      current.push(`${(index * stepX).toFixed(1)},${scaleY(value).toFixed(1)}`)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  })
  if (current.length) segments.push(current)
  return segments.map((points) => points.join(' '))
}
