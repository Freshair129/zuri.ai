// Marketing Insights (S6) — report windows. Pure: the clock is a parameter.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (rows R-11 history coverage and D-03 window semantics)
// @tested tests/unit/marketing/insights/report-window.test.js
//
// Semantics (implementation decision D-03, pending review):
// - `from` and `to` are calendar dates in Asia/Bangkok and BOTH are inclusive.
// - The default is the 28 complete days ending yesterday; today is a partial
//   day and is excluded from the default.
// - An explicit `to` of today is allowed, but today counts as incomplete
//   coverage, so no window total claims to include it.
// - The comparison window is the same number of days immediately before
//   `from`. A 28-day report therefore needs 56 days of coverage.

export const REPORT_TIMEZONE = 'Asia/Bangkok'
export const DEFAULT_WINDOW_DAYS = 28
// Covers the 7/28/90 presets named in contract §10 Q2 with a small margin.
// Larger requests are refused, not silently truncated.
export const MAX_WINDOW_DAYS = 93

const DAY_MS = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export class ReportWindowError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReportWindowError'
    this.code = 'INVALID_WINDOW'
    this.status = 400
  }
}

/** Epoch-day number for a YYYY-MM-DD string, or null when not a real date. */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null
  return ms / DAY_MS
}

export function formatEpochDay(epochDay) {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10)
}

export function addDays(isoDate, days) {
  const epochDay = parseIsoDate(isoDate)
  if (epochDay === null) throw new ReportWindowError(`invalid date: ${isoDate}`)
  return formatEpochDay(epochDay + days)
}

/** The calendar date in Asia/Bangkok for an instant. */
export function bangkokDate(instant) {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) throw new ReportWindowError('invalid instant')
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function enumerateDays(from, to) {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  if (start === null || end === null || end < start) return []
  const days = []
  for (let day = start; day <= end; day += 1) days.push(formatEpochDay(day))
  return days
}

/**
 * Resolve the requested window against the clock.
 * @returns {{ from, to, days, today, includesPartialDay, previous: { from, to, days } }}
 */
export function resolveReportWindow({ from = null, to = null } = {}, { now = new Date() } = {}) {
  const today = bangkokDate(typeof now === 'function' ? now() : now)
  const todayEpoch = parseIsoDate(today)

  if ((from && !to) || (!from && to)) {
    throw new ReportWindowError('from and to must be supplied together')
  }

  let fromEpoch
  let toEpoch
  if (!from && !to) {
    toEpoch = todayEpoch - 1
    fromEpoch = toEpoch - (DEFAULT_WINDOW_DAYS - 1)
  } else {
    fromEpoch = parseIsoDate(from)
    toEpoch = parseIsoDate(to)
    if (fromEpoch === null) throw new ReportWindowError('from must be a YYYY-MM-DD calendar date')
    if (toEpoch === null) throw new ReportWindowError('to must be a YYYY-MM-DD calendar date')
    if (toEpoch < fromEpoch) throw new ReportWindowError('to must not be before from')
    if (toEpoch > todayEpoch) throw new ReportWindowError('to must not be in the future (Asia/Bangkok)')
  }

  const days = toEpoch - fromEpoch + 1
  if (days > MAX_WINDOW_DAYS) {
    throw new ReportWindowError(`window must be at most ${MAX_WINDOW_DAYS} days`)
  }

  const previousTo = fromEpoch - 1
  const previousFrom = previousTo - (days - 1)
  return {
    from: formatEpochDay(fromEpoch),
    to: formatEpochDay(toEpoch),
    days,
    today,
    timezone: REPORT_TIMEZONE,
    inclusive: 'BOTH',
    includesPartialDay: toEpoch === todayEpoch,
    previous: { from: formatEpochDay(previousFrom), to: formatEpochDay(previousTo), days },
  }
}
