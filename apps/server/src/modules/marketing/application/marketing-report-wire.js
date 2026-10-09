// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-282 — bounded, source-preserving zuri-marketing-report/0.1 wire validation.
// @spec SDD-112, ZURI-GO-REPORT-PHYSICAL-DESIGN
import { createHash } from 'node:crypto'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/
const HASH = /^[a-f0-9]{64}$/
const CODE = /^[A-Z][A-Z0-9_]{0,79}$/
const metricUnits = { reported_spend: 'currency', reported_impressions: 'count', reported_clicks: 'count', reported_new_leads: 'count', reported_mql_entries: 'count', reported_sql_entries: 'count', reported_paid_orders: 'count', reported_net_revenue: 'currency', reported_ctr: 'ratio', reported_cpl: 'currency', reported_cpo: 'currency', reported_mature_lead_to_paid: 'ratio' }
const findings = { BLOCK: ['GATE_BLOCKED'], DATA_HOLD: ['MISSING_REVIEW_INPUTS'], LEARNING: ['LEARNING_ONLY'], FIX: ['RECHECK_REQUIRED'], ON_TRACK: [], HIGH: [], BASE: [] }
export const reportError = (status, code) => Object.assign(new Error(code), { status, code })
const requireValue = value => { if (!value) throw reportError(422, 'REPORT_INVALID') }
const string = (value, pattern) => typeof value === 'string' && pattern.test(value)
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min
const ids = values => Array.isArray(values) && values.length <= 32 && new Set(values).size === values.length && values.every(value => string(value, ID))
const codes = values => Array.isArray(values) && values.length <= 16 && new Set(values).size === values.length && values.every(value => string(value, CODE))
const revision = value => string(value, /^(0|[1-9][0-9]*)$/) && value.length <= 160
const decimal = (value, places = 4) => value === null || typeof value === 'string' && new RegExp('^-?(0|[1-9][0-9]*)(\\.[0-9]{1,' + places + '})?$').test(value) && !/^-0(?:\.0+)?$/.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER
const nonnegativeAmount = value => decimal(value) && (value === null || !value.startsWith('-'))
const count = value => value === null || string(value, /^(0|[1-9][0-9]*)$/) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
const scaled = value => {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'))
}
const date = value => {
  if (!string(value, /^\d{4}-\d{2}-\d{2}$/)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const instant = value => string(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/) && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60
const timezone = value => {
  if (typeof value !== 'string' || value.length > 64 || value !== 'UTC' && !value.includes('/')) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}
const localDate = (value, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
export const canonicalReportText = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
export const reportHash = value => createHash('sha256').update(canonicalReportText(value), 'utf8').digest('hex')

function validWindow(value, frozenAt, weekly = false) {
  requireValue(date(value.start) && date(value.endExclusive) && value.endExclusive > value.start && timezone(value.timezone) && instant(value.asOf) && Date.parse(value.asOf) <= Date.parse(frozenAt) && localDate(value.asOf, value.timezone) >= value.start)
  if (weekly) requireValue(new Date(value.start + 'T00:00:00Z').getUTCDay() === 1 && Date.parse(value.endExclusive) - Date.parse(value.start) === 7 * 86400000)
}

// Check decoded keys per object before canonical serialization can erase duplicates.
function checkTokens(text) {
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g)
  let index = 0
  const validUnicode = value => !/[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))
  const walk = depth => {
    requireValue(depth < 20)
    const token = tokens[index++]
    if (token === '{' || token === '[') {
      const end = token === '{' ? '}' : ']', keys = new Set()
      while (tokens[index] !== end) {
        if (token === '{') {
          const key = JSON.parse(tokens[index++]); requireValue(validUnicode(key) && !keys.has(key)); keys.add(key); index++
        }
        walk(depth + 1)
        if (tokens[index] === ',') index++
      }
      index++
    } else if (token?.startsWith('"')) requireValue(validUnicode(JSON.parse(token)))
  }
  walk(0)
}

export function parseMarketingReport(raw, now = new Date()) {
  const bytes = Buffer.from(raw)
  if (bytes.length > 262144) throw reportError(413, 'REPORT_LIMIT')
  let text, value
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); value = JSON.parse(text); checkTokens(text) } catch { throw reportError(422, 'REPORT_INVALID') }
  requireValue(fields(value, ['contractVersion', 'reportId', 'reportRevision', 'supersedesReportId', 'source', 'target', 'campaign', 'sourceRevision', 'window', 'frozenAt', 'payload', 'payloadHash']))
  requireValue(value.contractVersion === 'zuri-marketing-report/0.1' && string(value.reportId, UUID) && value.reportRevision === 1 && value.supersedesReportId === null && instant(value.frozenAt) && Date.parse(value.frozenAt) <= now.getTime() && string(value.payloadHash, HASH))
  const { source, target, campaign, sourceRevision, window, payload } = value
  requireValue(fields(source, ['system', 'deploymentId', 'sourceBusinessId']) && source.system === 'zuri-go' && string(source.deploymentId, ID) && string(source.sourceBusinessId, UUID))
  requireValue(fields(target, ['bindingId', 'initiativeId']) && string(target.bindingId, ID) && string(target.initiativeId, ID))
  requireValue(fields(campaign, ['sourceCampaignId', 'code', 'objective', 'lifecycle', 'currency']) && string(campaign.sourceCampaignId, UUID) && string(campaign.code, /^CAM-[0-9]{4,60}$/) && ['inventory', 'commerce', 'leads', 'awareness'].includes(campaign.objective) && ['unconfirmed', 'draft', 'queued', 'active', 'paused', 'completed', 'cancelled'].includes(campaign.lifecycle) && string(campaign.currency, /^[A-Z]{3}$/))
  requireValue(fields(sourceRevision, ['campaignRowVersion', 'stateRowVersion', 'statePayloadHash', 'businessDomainRevision', 'modelVersion']) && ['campaignRowVersion', 'stateRowVersion', 'businessDomainRevision'].every(key => revision(sourceRevision[key])) && string(sourceRevision.statePayloadHash, HASH) && string(sourceRevision.modelVersion, ID))
  requireValue(fields(window, ['start', 'endExclusive', 'timezone', 'asOf'])); validWindow(window, value.frozenAt, true)
  requireValue(fields(payload, ['context', 'measurements', 'sourceReferences', 'weeklyReviewAssertion', 'missingFieldCodes']) && codes(payload.missingFieldCodes))
  const context = payload.context
  requireValue(fields(context, ['settingsVersion', 'targets', 'releasedCap', 'committedSpend', 'definitionVersion', 'missingFieldCodes']) && integer(context.settingsVersion, 1) && fields(context.targets, ['low', 'mid', 'high']) && [...Object.values(context.targets), context.releasedCap, context.committedSpend].every(nonnegativeAmount) && string(context.definitionVersion, ID) && codes(context.missingFieldCodes))
  requireValue(Array.isArray(payload.sourceReferences) && payload.sourceReferences.length <= 32)
  let previousRef = ''
  for (const ref of payload.sourceReferences) {
    requireValue(fields(ref, ['refId', 'kind', 'sourceEntityId', 'sourceRevision', 'sanitizedHash']) && string(ref.refId, ID) && ref.refId > previousRef && ['CAMPAIGN_STATE', 'LEGACY_REVIEW', 'LEGACY_DECISION'].includes(ref.kind) && string(ref.sourceEntityId, ID) && revision(ref.sourceRevision) && (ref.sanitizedHash === null || string(ref.sanitizedHash, HASH)))
    previousRef = ref.refId
  }
  const refIds = new Set(payload.sourceReferences.map(ref => ref.refId))
  requireValue(Array.isArray(payload.measurements) && payload.measurements.length <= 100)
  let previousMetric = ''
  for (const metric of payload.measurements) {
    requireValue(fields(metric, ['key', 'value', 'unit', 'currency', 'quality', 'reasonCodes', 'scope', 'ratio', 'cohort', 'provenance']) && typeof metric.key === 'string' && Object.hasOwn(metricUnits, metric.key) && metric.unit === metricUnits[metric.key] && metric.currency === (metric.unit === 'currency' ? campaign.currency : null) && ['KNOWN', 'PARTIAL', 'UNKNOWN', 'UNAVAILABLE'].includes(metric.quality) && codes(metric.reasonCodes))
    requireValue(metric.unit === 'count' ? count(metric.value) : decimal(metric.value, metric.unit === 'ratio' ? 8 : 4))
    if (metric.quality === 'UNKNOWN' || metric.quality === 'UNAVAILABLE') requireValue(metric.value === null)
    const scope = metric.scope, provenance = metric.provenance, cohortMetric = metric.key === 'reported_mature_lead_to_paid'
    requireValue(fields(scope, ['kind', 'start', 'endExclusive', 'timezone', 'asOf', 'offer', 'channel', 'attributionState']) && scope.kind === (cohortMetric ? 'ACQUISITION_COHORT' : 'ACTIVITY') && [scope.offer, scope.channel].every(item => item === null || string(item, ID)) && ['NOT_APPLICABLE', 'UNKNOWN', 'SOURCE_REPORTED'].includes(scope.attributionState))
    validWindow(scope, value.frozenAt)
    const sortKey = metric.key + ':' + canonicalReportText(scope); requireValue(sortKey > previousMetric); previousMetric = sortKey
    requireValue(fields(provenance, ['sourceClass', 'modelVersion', 'collectionKnownAt', 'watermarkDate', 'sourceTimezone', 'timezoneState', 'sourceRefIds']) && provenance.sourceClass === 'MANUAL_REPORTED' && string(provenance.modelVersion, ID) && (provenance.collectionKnownAt === null || instant(provenance.collectionKnownAt) && Date.parse(provenance.collectionKnownAt) <= Date.parse(value.frozenAt)) && (provenance.watermarkDate === null || date(provenance.watermarkDate)) && ids(provenance.sourceRefIds) && provenance.sourceRefIds.every(id => refIds.has(id)) && ['ATTESTED', 'UNKNOWN'].includes(provenance.timezoneState))
    requireValue(provenance.timezoneState === 'UNKNOWN' ? provenance.sourceTimezone === null && metric.value === null : timezone(provenance.sourceTimezone) && provenance.sourceTimezone === scope.timezone)
    if (metric.value !== null) requireValue(provenance.collectionKnownAt !== null && provenance.sourceRefIds.length > 0)
    const ratioMetric = ['reported_ctr', 'reported_cpl', 'reported_cpo', 'reported_mature_lead_to_paid'].includes(metric.key)
    if (ratioMetric) {
      const ratio = metric.ratio
      requireValue(fields(ratio, ['numerator', 'denominator', 'numeratorUnit', 'denominatorUnit', 'formulaVersion']) && ratio.numeratorUnit === (metric.unit === 'currency' ? 'currency' : 'count') && ratio.denominatorUnit === 'count' && ratio.formulaVersion === 'reported-marketing/0.1' && (ratio.numeratorUnit === 'count' ? count(ratio.numerator) : nonnegativeAmount(ratio.numerator)) && count(ratio.denominator))
      if (metric.value !== null) {
        requireValue(ratio.numerator !== null && ratio.denominator !== null && BigInt(ratio.denominator) > 0n && !metric.value.startsWith('-'))
        const denominator = BigInt(ratio.denominator), difference = scaled(metric.value) * denominator - scaled(ratio.numerator)
        // Compare decimal integers, never binary-float aggregates. At most half
        // the approved 4/8-place rounding unit can separate the stated ratio.
        requireValue((difference < 0n ? -difference : difference) * 2n <= denominator * (metric.unit === 'currency' ? 10000n : 1n))
      }
      if (provenance.timezoneState === 'UNKNOWN') requireValue(ratio.numerator === null && ratio.denominator === null)
    } else requireValue(metric.ratio === null)
    if (cohortMetric) {
      const cohort = metric.cohort
      requireValue(fields(cohort, ['followupWindowDays', 'matureCount', 'pendingCount', 'convertedCount']) && (cohort.followupWindowDays === null || integer(cohort.followupWindowDays, 1)) && ['matureCount', 'pendingCount', 'convertedCount'].every(key => cohort[key] === null || integer(cohort[key])))
      if (cohort.convertedCount !== null) requireValue(cohort.matureCount !== null && cohort.convertedCount <= cohort.matureCount)
      if (metric.value !== null) requireValue(cohort.followupWindowDays !== null && cohort.matureCount > 0 && cohort.convertedCount !== null && metric.ratio.numerator === String(cohort.convertedCount) && metric.ratio.denominator === String(cohort.matureCount))
      if (provenance.timezoneState === 'UNKNOWN') requireValue(cohort.matureCount === null && cohort.pendingCount === null && cohort.convertedCount === null)
    } else requireValue(metric.cohort === null)
  }
  const review = payload.weeklyReviewAssertion
  if (review !== null) {
    requireValue(fields(review, ['sourceReviewId', 'recordedDate', 'settingsVersion', 'sanitizedSnapshotHash', 'reportedGateStatus', 'findingCodes', 'recommendationCodes', 'provenance', 'approvalTrust']) && string(review.sourceReviewId, ID) && date(review.recordedDate) && review.recordedDate >= window.start && review.recordedDate < window.endExclusive && review.recordedDate <= localDate(window.asOf, window.timezone) && integer(review.settingsVersion, 1) && string(review.sanitizedSnapshotHash, HASH) && typeof review.reportedGateStatus === 'string' && Object.hasOwn(findings, review.reportedGateStatus) && canonicalReportText(review.findingCodes) === canonicalReportText(findings[review.reportedGateStatus]) && Array.isArray(review.recommendationCodes) && review.recommendationCodes.length === 0 && review.provenance === 'LEGACY_REPORTED' && review.approvalTrust === 'UNVERIFIED')
    requireValue(reportHash(Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'sanitizedSnapshotHash'))) === review.sanitizedSnapshotHash)
  }
  requireValue(canonicalReportText(value) === text && reportHash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'payloadHash'))) === value.payloadHash)
  return { envelope: value, canonicalEnvelope: text }
}

export function reportCredentialHash(authorization) {
  if (!string(authorization, /^Bearer zmr_[A-Za-z0-9_-]{43}$/)) throw reportError(401, 'REPORT_UNAUTHORIZED')
  return createHash('sha256').update(authorization.slice(7), 'utf8').digest('hex')
}

export async function readMarketingReportRequest(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) throw reportError(415, 'REPORT_CONTENT_TYPE')
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw reportError(415, 'REPORT_CONTENT_ENCODING')
  const reader = request.body?.getReader(), chunks = []
  let length = 0
  if (reader) try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      length += value.byteLength
      if (length > 262144) { await reader.cancel(); throw reportError(413, 'REPORT_LIMIT') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return parseMarketingReport(Buffer.concat(chunks))
}
