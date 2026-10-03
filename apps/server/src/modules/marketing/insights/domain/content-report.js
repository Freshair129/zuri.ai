// Marketing Insights (S6) — Content tab: type filter, publish-window cohort,
// top content, by-format breakdown. Pure.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-04 content timeseries, R-05 organic/paid, R-06 stored vs response fields)
// @tested tests/unit/marketing/insights/content-report.test.js
//
// Semantics carried by every response (D-05, pending review): the cohort is
// content PUBLISHED in the window, and each item's numbers are the provider's
// lifetime values AS OF the last sync — that is what the baseline
// `content_performance` table stores. They are not "engagement that happened
// inside the window", and this module never presents them as such.

import { bangkokDate } from './report-window'
import { periodChange, safeSum } from './metric-series'

export const CONTENT_TYPES = Object.freeze(['post', 'story', 'reel', 'live'])
export const CONTENT_TYPE_FILTERS = Object.freeze(['all', ...CONTENT_TYPES])
export const CONTENT_FORMATS = Object.freeze(['photo', 'video', 'text', 'link'])
export const CONTENT_COHORT = 'PUBLISHED_IN_WINDOW'
export const CONTENT_METRIC_PERIOD = 'LIFETIME_AS_OF_SYNC'

export const SUMMARY_FIELDS = Object.freeze(['views', 'threeSecViews', 'interactions', 'watchTime', 'organicViews', 'paidViews'])
export const TOP_CONTENT_DEFAULT_LIMIT = 10
export const TOP_CONTENT_MAX_LIMIT = 50

// Link-out hosts only. Nothing here is fetched by the server.
const PERMALINK_HOSTS = ['facebook.com', 'fb.com', 'fb.watch', 'instagram.com']
const THUMBNAIL_HOSTS = ['fbcdn.net', 'facebook.com']

function hostAllowed(hostname, allowed) {
  return allowed.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

/** https URL on an allowed host, or null. Never a javascript:/data: URL. */
export function safeExternalUrl(value, allowedHosts) {
  if (typeof value !== 'string' || value.length > 2048) return null
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return hostAllowed(url.hostname.toLowerCase(), allowedHosts) ? url.toString() : null
}

export const safePermalink = (value) => safeExternalUrl(value, PERMALINK_HOSTS)
export const safeThumbnail = (value) => safeExternalUrl(value, THUMBNAIL_HOSTS)

function metricValue(item, field) {
  const cell = item.metrics?.[field]
  return cell && cell.quality === 'OBSERVED' && typeof cell.value === 'number' ? cell.value : null
}

export function filterByType(items, type = 'all') {
  if (!CONTENT_TYPE_FILTERS.includes(type)) throw new Error(`unknown content type filter: ${type}`)
  // Unknown content types stay visible under "all" and are never guessed
  // into Post/Story/Reel/Live.
  return type === 'all' ? items.slice() : items.filter((item) => item.contentType === type)
}

export function inPublishWindow(items, { from, to }) {
  return items.filter((item) => {
    const day = bangkokDate(item.publishedAt)
    return day >= from && day <= to
  })
}

/** Sum a field across items only when every item has it observed. */
export function sumField(items, field) {
  const values = items.map((item) => metricValue(item, field))
  const missing = values.filter((value) => value === null).length
  if (items.length === 0) return { value: 0, missing: 0, reasonCode: null, itemCount: 0 }
  if (missing > 0) return { value: null, missing, reasonCode: 'ITEM_METRIC_MISSING', itemCount: items.length }
  const value = safeSum(values)
  return value === null
    ? { value: null, missing: 0, reasonCode: 'PRECISION_UNSAFE', itemCount: items.length }
    : { value, missing: 0, reasonCode: null, itemCount: items.length }
}

export function summarizeContent(items) {
  const summary = {}
  const quality = {}
  for (const field of SUMMARY_FIELDS) {
    const result = sumField(items, field)
    summary[field] = result.value
    quality[field] = { missing: result.missing, reasonCode: result.reasonCode, itemCount: result.itemCount }
  }
  return { summary, quality }
}

/**
 * Rank by views (unknown last), then newest, then id — a total order, so a
 * page boundary is stable across requests over the same snapshot.
 */
export function rankTopContent(items, { limit = TOP_CONTENT_DEFAULT_LIMIT } = {}) {
  const bounded = Math.max(1, Math.min(TOP_CONTENT_MAX_LIMIT, Number.isInteger(limit) ? limit : TOP_CONTENT_DEFAULT_LIMIT))
  const sorted = items.slice().sort((a, b) => {
    const va = metricValue(a, 'views')
    const vb = metricValue(b, 'views')
    if (va === null && vb !== null) return 1
    if (vb === null && va !== null) return -1
    if (va !== vb) return vb - va
    if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1
    return a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0
  })
  return sorted.slice(0, bounded).map((item, index) => ({
    rank: index + 1,
    contentId: item.contentId,
    postId: item.providerPostId,
    contentType: item.contentType,
    format: item.format,
    permalink: safePermalink(item.permalink),
    thumbnailUrl: safeThumbnail(item.thumbnailUrl),
    publishedAt: item.publishedAt,
    views: metricValue(item, 'views'),
    reactions: metricValue(item, 'reactions'),
    comments: metricValue(item, 'comments'),
    shares: metricValue(item, 'shares'),
    fetchedAt: item.fetchedAt ?? null,
  }))
}

function formatsOf(current, previous) {
  const seen = new Set([...current, ...previous].map((item) => item.format))
  const known = CONTENT_FORMATS.filter((format) => seen.has(format))
  return seen.has('unknown') ? [...known, 'unknown'] : known
}

function breakdownEntry(label, current, previous, measure) {
  const now = measure(current)
  const before = measure(previous)
  const change = periodChange({ total: now.value, unit: 'count' }, { total: before.value, unit: 'count' })
  return {
    label,
    value: now.value,
    previousValue: before.value,
    changePct: change.changePct,
    changeReasonCode: change.changeReasonCode,
    reasonCode: now.reasonCode,
  }
}

/**
 * Published / Views / Interactions by format for the current and prior
 * publish cohorts. Published counts unique content ids, never metric rows.
 */
export function formatBreakdown(currentItems, previousItems) {
  const formats = formatsOf(currentItems, previousItems)
  const published = (items) => ({ value: new Set(items.map((item) => item.contentId)).size, reasonCode: null })
  const measures = {
    published,
    views: (items) => sumField(items, 'views'),
    interactions: (items) => sumField(items, 'interactions'),
  }
  return Object.entries(measures).map(([metric, measure]) => ({
    metric,
    breakdown: formats.map((format) => breakdownEntry(
      format,
      currentItems.filter((item) => item.format === format),
      previousItems.filter((item) => item.format === format),
      measure,
    )),
  }))
}
