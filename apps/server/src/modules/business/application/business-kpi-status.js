import { BUSINESS_KPI_RESULT_STATUSES } from '@/lib/validation/enums'

// @req FR-269 — result status is derived from the latest measurement and is
// distinct from the KPI's persisted ACTIVE/ARCHIVED lifecycle status.
export const BUSINESS_KPI_RESULT_STATUS = Object.freeze(
  Object.fromEntries(BUSINESS_KPI_RESULT_STATUSES.map((status) => [status, status])),
)

function compareMetricValues(left, right) {
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error('Business KPI values must be finite numbers')
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** Pure FR-269 status calculator shared by Strategy and Business Home. */
export function kpiStatus(kpi, latestObservation) {
  if (!latestObservation) return BUSINESS_KPI_RESULT_STATUS.NO_SIGNAL

  const target = compareMetricValues(latestObservation.value, kpi.target)
  const warning = compareMetricValues(latestObservation.value, kpi.warningThreshold)
  if (kpi.direction === 'UP') {
    if (target >= 0) return BUSINESS_KPI_RESULT_STATUS.OK
    if (warning >= 0) return BUSINESS_KPI_RESULT_STATUS.WARN
    return BUSINESS_KPI_RESULT_STATUS.BAD
  }
  if (kpi.direction === 'DOWN') {
    if (target <= 0) return BUSINESS_KPI_RESULT_STATUS.OK
    if (warning <= 0) return BUSINESS_KPI_RESULT_STATUS.WARN
    return BUSINESS_KPI_RESULT_STATUS.BAD
  }
  throw new Error(`Unsupported Business KPI direction: ${kpi.direction}`)
}
