// Marketing Insights (S6) — B4: the daily sync tick. Pure: the instant is a
// parameter, and the offset is read from ICU's own timezone data rather than
// the container's TZ setting, so this returns the same instant everywhere it
// runs.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-12), contract §5 ("Cron: daily at 02:00 Asia/Bangkok")
// @tested tests/unit/marketing/insights/sync-schedule.test.js

export const SYNC_SCHEDULE_TIMEZONE = 'Asia/Bangkok'
export const SYNC_SCHEDULE_HOUR = 2
const DAY_MS = 86_400_000

function offsetMsFor(instant, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(instant)
    .find((entry) => entry.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = match[3] ? Number(match[3]) : 0
  return sign * (hours * 60 + minutes) * 60_000
}

/**
 * The next 02:00 Asia/Bangkok strictly after `instant` (an instant that lands
 * exactly on a tick counts as already passed, so the tick happening right now
 * is never returned as "next"). The lookahead is under a day, and Bangkok's
 * offset has not changed since 1920, so a single offset sample is exact.
 */
export function nextScheduledSyncTick(instant) {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) throw new Error('nextScheduledSyncTick requires a valid instant')
  const offsetMs = offsetMsFor(date, SYNC_SCHEDULE_TIMEZONE)
  const localMs = date.getTime() + offsetMs
  const localDayStart = Math.floor(localMs / DAY_MS) * DAY_MS
  const todayTickLocal = localDayStart + SYNC_SCHEDULE_HOUR * 60 * 60_000
  const nextTickLocal = localMs < todayTickLocal ? todayTickLocal : todayTickLocal + DAY_MS
  return new Date(nextTickLocal - offsetMs)
}
