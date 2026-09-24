// Marketing Insights (S6) — metric definitions. Pure data: no Next, Prisma,
// process.env, n8n or provider HTTP client may be imported from this folder.
//
// @spec docs/migrations/service-extraction/INSIGHTS-METRIC-COMPATIBILITY.md —
//   every provider field below is quoted from the source contract (§3) and is
//   NOT a verified live capability. `providerStatus` records what the official
//   Meta deprecated-metrics page said when it was checked on 2026-09-24.
// @tested tests/unit/marketing/insights/metric-catalog.test.js

/** Aggregation rules. Only ADDITIVE metrics may be summed across days/items. */
export const AGGREGATION = Object.freeze({
  ADDITIVE: 'ADDITIVE',
  // Unique counts (people) double count when summed across days, posts,
  // assets or organic+paid distributions. A window total needs a provider
  // aggregate for exactly that window.
  NON_ADDITIVE_UNIQUE: 'NON_ADDITIVE_UNIQUE',
  // Derived from two ADDITIVE inputs over the same grain.
  DERIVED_DIFFERENCE: 'DERIVED_DIFFERENCE',
})

export const PROVIDER_STATUS = Object.freeze({
  // The contract field is listed as deprecated by Meta; a sync writer must not
  // map it until a reviewed replacement is chosen.
  CONTRACT_FIELD_DEPRECATED: 'CONTRACT_FIELD_DEPRECATED',
  // Not on the deprecated list, but the current reference page could not be
  // read, so the field, period and permission are unverified.
  UNVERIFIED: 'UNVERIFIED',
})

const CONTRACT = 'contract.md §3 (sha256 693f92f0…)'

function metric(def) {
  return Object.freeze({ distributions: ['ORGANIC', 'PAID'], ...def })
}

/**
 * The daily Page metrics named in contract §4 (`insights_daily.metric_key`)
 * plus the one derived metric the Overview needs (net follows).
 */
export const DAILY_METRICS = Object.freeze([
  metric({
    metricKey: 'views',
    label: 'Views',
    labelTh: 'ยอดการมองเห็น',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_impressions_unique', 'post_impressions'],
    providerStatus: PROVIDER_STATUS.CONTRACT_FIELD_DEPRECATED,
    // Also: the contract lists `page_impressions_unique` for both Views and
    // Viewers. A unique count is not a views count (reconciliation row R-01).
    candidateReplacement: ['page_media_view', 'post_media_view'],
    source: CONTRACT,
  }),
  metric({
    metricKey: 'viewers',
    label: 'Viewers',
    labelTh: 'ผู้ชม (ไม่ซ้ำ)',
    unit: 'people',
    aggregation: AGGREGATION.NON_ADDITIVE_UNIQUE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_impressions_unique'],
    providerStatus: PROVIDER_STATUS.CONTRACT_FIELD_DEPRECATED,
    candidateReplacement: ['page_total_media_view_unique'],
    source: CONTRACT,
  }),
  metric({
    metricKey: 'interactions',
    label: 'Content interactions',
    labelTh: 'การมีส่วนร่วมกับคอนเทนต์',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_post_engagements'],
    providerStatus: PROVIDER_STATUS.UNVERIFIED,
    source: CONTRACT,
  }),
  metric({
    metricKey: 'three_sec_views',
    label: '3-second video views',
    labelTh: 'ยอดดูวิดีโอ 3 วินาที',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_video_views'],
    providerStatus: PROVIDER_STATUS.UNVERIFIED,
    source: CONTRACT,
  }),
  metric({
    metricKey: 'watch_time',
    label: 'Watch time',
    labelTh: 'เวลาในการรับชม',
    // The contract does not state a unit. Each observation carries its raw
    // unit; a window mixing units is refused rather than converted by guess.
    unit: 'duration',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_video_view_time'],
    providerStatus: PROVIDER_STATUS.UNVERIFIED,
    source: CONTRACT,
  }),
  metric({
    metricKey: 'visits',
    label: 'Visits',
    labelTh: 'การเข้าชมเพจ',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_views_total'],
    providerStatus: PROVIDER_STATUS.UNVERIFIED,
    distributions: [],
    source: CONTRACT,
  }),
  metric({
    metricKey: 'follows',
    label: 'Follows',
    labelTh: 'ผู้ติดตามใหม่',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_fan_adds'],
    providerStatus: PROVIDER_STATUS.CONTRACT_FIELD_DEPRECATED,
    distributions: [],
    source: CONTRACT,
  }),
  metric({
    metricKey: 'unfollows',
    label: 'Unfollows',
    labelTh: 'เลิกติดตาม',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_fan_removes'],
    providerStatus: PROVIDER_STATUS.CONTRACT_FIELD_DEPRECATED,
    distributions: [],
    source: CONTRACT,
  }),
  metric({
    metricKey: 'net_follows',
    label: 'Net follows',
    labelTh: 'ผู้ติดตามสุทธิ',
    unit: 'count',
    aggregation: AGGREGATION.DERIVED_DIFFERENCE,
    derivedFrom: ['follows', 'unfollows'],
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_fan_adds', 'page_fan_removes'],
    providerStatus: PROVIDER_STATUS.CONTRACT_FIELD_DEPRECATED,
    distributions: [],
    source: CONTRACT,
  }),
  metric({
    metricKey: 'link_clicks',
    label: 'Link clicks',
    labelTh: 'คลิกลิงก์',
    unit: 'count',
    aggregation: AGGREGATION.ADDITIVE,
    entityScope: 'PAGE',
    periodKind: 'DAY',
    contractFields: ['page_consumptions_by_consumption_type'],
    providerStatus: PROVIDER_STATUS.UNVERIFIED,
    distributions: [],
    source: CONTRACT,
  }),
])

/**
 * Overview cards (contract §7). Conversions is a labelled placeholder: no
 * attribution source exists and none may be read from Commerce to fill it.
 */
export const OVERVIEW_CARDS = Object.freeze([
  { cardKey: 'views', metricKeys: ['views', 'viewers'] },
  { cardKey: 'follows', metricKeys: ['follows', 'unfollows', 'net_follows'] },
  { cardKey: 'visits', metricKeys: ['visits', 'link_clicks'] },
  { cardKey: 'interactions', metricKeys: ['interactions'] },
  { cardKey: 'video', metricKeys: ['three_sec_views', 'watch_time'] },
  { cardKey: 'conversions', metricKeys: [], placeholder: 'CONVERSIONS_NOT_CONNECTED' },
])

const BY_KEY = new Map(DAILY_METRICS.map((item) => [item.metricKey, item]))

export const DAILY_METRIC_KEYS = Object.freeze(DAILY_METRICS.map((item) => item.metricKey))

/** Keys a sync writer stores. Derived metrics are computed, never stored. */
export const STORED_METRIC_KEYS = Object.freeze(
  DAILY_METRICS.filter((item) => item.aggregation !== AGGREGATION.DERIVED_DIFFERENCE).map((item) => item.metricKey),
)

export function getMetricDefinition(metricKey) {
  return BY_KEY.get(metricKey) ?? null
}

export function isKnownMetric(metricKey) {
  return BY_KEY.has(metricKey)
}
