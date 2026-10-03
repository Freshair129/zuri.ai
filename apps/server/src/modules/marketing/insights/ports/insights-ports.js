// Marketing Insights (S6) — port contracts. Every value that crosses into the
// query module is parsed here, so a malformed or out-of-scope row fails
// loudly instead of rendering as a number.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (§ Ports),
//   SDD-008 (Zod at the boundary), SEC-001
// @tested tests/unit/marketing/insights/insights-ports.test.js
//
// Ports (versions are contract revisions, not FR ids):
//   InsightsRepository       v0  read models: daily observations + content items + snapshot
//   InsightBindingReadPort   v0  server-owned brand/asset bindings
//   MetaInsightsReadPort     v0  UNAVAILABLE — no existing Meta client in this repository
//   SyncRequestPort          v0  UNAVAILABLE — no sync orchestration owner assigned
//   SyncStatusReadPort       v0  UNAVAILABLE
//   ReportNotificationPort   v0  UNAVAILABLE — LINE Notify ended 2025-03-31 (EXT-1)
// None of these accepts a Graph URL, a token or any credential material.

import { z } from 'zod'
import { DAILY_METRIC_KEYS, STORED_METRIC_KEYS } from '../domain/metric-catalog'
import { ASSET_KINDS, ASSET_NAMESPACES, BRAND_SLUGS } from '../domain/brand-scope'
import { CONTENT_FORMATS, CONTENT_TYPES } from '../domain/content-report'
import { QUALITY } from '../domain/metric-series'

export const PORT_VERSION = 'insights-ports/v0'

export class InsightsError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'InsightsError'
    this.code = code
    this.status = status
  }
}

export const insightsErrors = Object.freeze({
  invalidQuery: (message) => new InsightsError('INVALID_QUERY', message, 400),
  snapshotExpired: () => new InsightsError('SNAPSHOT_EXPIRED', 'Report snapshot expired; refresh the report and export again', 409),
  // A repository row outside the requested scope is a server defect, never
  // data to filter away quietly.
  scopeMismatch: () => new InsightsError('SCOPE_MISMATCH', 'Insights repository returned a row outside the requested scope', 500),
  sourceUnavailable: (message = 'Insights read model is unavailable') => new InsightsError('SOURCE_UNAVAILABLE', message, 503),
  capabilityUnavailable: (capability, reasonCode) => Object.assign(
    new InsightsError('CAPABILITY_UNAVAILABLE', `${capability} is unavailable: ${reasonCode}`, 503),
    { capability, reasonCode },
  ),
})

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoInstant = z.string().datetime({ offset: true })
const qualityEnum = z.enum(Object.values(QUALITY).filter((value) => ![
  QUALITY.PARTIAL_DAY, QUALITY.UNIQUE_DISTRIBUTION_NOT_ADDITIVE, QUALITY.DERIVED_INPUT_MISSING,
].includes(value)))

// Counts are non-negative safe integers. Anything wider is refused, not
// rounded: a JSON number past 2^53 has already lost digits.
const metricValue = z.number().finite().nullable()

export const zAssetBinding = z.object({
  bindingId: z.string().min(1),
  brandSlug: z.enum(BRAND_SLUGS),
  tenantId: z.string().min(1),
  businessId: z.string().min(1),
  assetKind: z.enum(ASSET_KINDS),
  namespace: z.enum(Object.values(ASSET_NAMESPACES)),
  displayName: z.string().min(1).max(200),
  status: z.enum(['ACTIVE', 'REVOKED', 'UNRESOLVED_SCOPE']),
  revision: z.number().int().nonnegative(),
}).strict().superRefine((binding, ctx) => {
  if (ASSET_NAMESPACES[binding.assetKind] !== binding.namespace) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'namespace does not match assetKind' })
  }
})

export const zDailyObservation = z.object({
  assetId: z.string().min(1),
  metricKey: z.enum(STORED_METRIC_KEYS),
  date: isoDate,
  distribution: z.enum(['ALL', 'ORGANIC', 'PAID']),
  value: metricValue,
  unit: z.string().min(1).max(32),
  quality: qualityEnum,
  fetchedAt: isoInstant,
  revision: z.number().int().nonnegative(),
}).strict().superRefine((row, ctx) => {
  if (row.quality === QUALITY.OBSERVED && row.value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'an OBSERVED row needs a value' })
  }
  if (row.quality !== QUALITY.OBSERVED && row.value !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a non-observed row must not carry a value' })
  }
  if (row.value !== null && row.unit === 'count' && (!Number.isSafeInteger(row.value) || row.value < 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'count values must be non-negative safe integers' })
  }
})

export const zWindowAggregate = z.object({
  assetId: z.string().min(1),
  metricKey: z.enum(DAILY_METRIC_KEYS),
  from: isoDate,
  to: isoDate,
  value: metricValue,
  unit: z.string().min(1).max(32),
  quality: qualityEnum,
}).strict()

export const zSnapshot = z.object({
  snapshotId: z.string().min(1),
  generatedAt: isoInstant,
  // Last day fully synced for this asset; null when nothing has synced.
  coveredUntil: isoDate.nullable(),
  state: z.enum(['COMPLETE', 'PARTIAL', 'NOT_SYNCED']),
  partialReason: z.string().max(200).nullable(),
}).strict()

const zContentMetric = z.object({ value: metricValue, quality: qualityEnum }).strict()

export const zContentItem = z.object({
  contentId: z.string().min(1),
  providerPostId: z.string().min(1).max(128),
  assetId: z.string().min(1),
  contentType: z.enum([...CONTENT_TYPES, 'unknown']),
  format: z.enum([...CONTENT_FORMATS, 'unknown']),
  publishedAt: isoInstant,
  permalink: z.string().max(2048).nullable(),
  thumbnailUrl: z.string().max(2048).nullable(),
  metricPeriod: z.literal('LIFETIME_AS_OF_SYNC'),
  fetchedAt: isoInstant,
  metrics: z.record(z.string(), zContentMetric),
}).strict()

export const zDailyReadResult = z.object({
  snapshot: zSnapshot,
  observations: z.array(zDailyObservation),
  windowAggregates: z.array(zWindowAggregate).default([]),
}).strict()

export const zContentReadResult = z.object({
  snapshot: zSnapshot,
  items: z.array(zContentItem),
}).strict()

/**
 * Parse a repository answer and prove every row belongs to the asset asked
 * for. Rows are never filtered here — one foreign row fails the whole read.
 */
export function parseDailyReadResult(raw, { assetId }) {
  const parsed = zDailyReadResult.parse(raw)
  const foreign = [...parsed.observations, ...parsed.windowAggregates].some((row) => row.assetId !== assetId)
  if (foreign) throw insightsErrors.scopeMismatch()
  return parsed
}

export function parseContentReadResult(raw, { assetId }) {
  const parsed = zContentReadResult.parse(raw)
  if (parsed.items.some((item) => item.assetId !== assetId)) throw insightsErrors.scopeMismatch()
  return parsed
}

/** Shape check for an injected repository; fails at composition, not on first request. */
export function assertInsightsRepository(repository) {
  for (const method of ['readDailyObservations', 'readContentItems']) {
    if (typeof repository?.[method] !== 'function') {
      throw new Error(`InsightsRepository must implement ${method}()`)
    }
  }
  return repository
}

export function assertBindingReadPort(port) {
  if (typeof port?.listBindings !== 'function') throw new Error('InsightBindingReadPort must implement listBindings()')
  return port
}

/**
 * The honest default for every provider-facing port until its owner supplies
 * a reviewed adapter. It answers, it never pretends.
 */
export function unavailablePort(capability, reasonCode) {
  const refuse = async () => { throw insightsErrors.capabilityUnavailable(capability, reasonCode) }
  return Object.freeze({ capability, available: false, reasonCode, version: PORT_VERSION, invoke: refuse })
}

export const UNAVAILABLE_PORTS = Object.freeze({
  metaInsightsRead: unavailablePort('MetaInsightsReadPort', 'EXISTING_META_CLIENT_NOT_FOUND'),
  syncRequest: unavailablePort('SyncRequestPort', 'SYNC_ORCHESTRATION_OWNER_UNASSIGNED'),
  syncStatus: unavailablePort('SyncStatusReadPort', 'SYNC_ORCHESTRATION_OWNER_UNASSIGNED'),
  reportNotification: unavailablePort('ReportNotificationPort', 'LINE_NOTIFY_TERMINATED_NO_APPROVED_REPLACEMENT'),
})
