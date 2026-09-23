// @req ADR-101 D1, FR-270 — the 4DX weekly cadence has no Cycle model and no
// Business.timezone column; every weekly row (a Key Result check-in now, a
// commitment or WIG session in Phase 3) keys to this fixed Asia/Bangkok
// Monday 00:00 instead of a modeled, per-Business timezone.
// @tested tests/unit/fr268-week.test.js
//
// Bangkok never observes DST — a fixed UTC+7 year-round — which is what makes
// the millisecond-shift approach below an exact computation rather than an
// approximation that would need a real timezone database for a DST transition.

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

/**
 * The Monday 00:00 (Asia/Bangkok) of the week containing `now`, as a UTC
 * Date instant. Pure: no clock read unless `now` is omitted.
 */
export function weekStartFor(now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(t)) throw new Error('weekStartFor: now must be a valid date')
  // Shift into Bangkok wall-clock time, expressed using UTC field accessors —
  // getUTCDay/setUTCDate/setUTCHours never re-apply the host's own timezone,
  // so the shifted instant's UTC fields ARE the Bangkok wall-clock fields.
  const shifted = new Date(t + BANGKOK_OFFSET_MS)
  const dow = shifted.getUTCDay() // 0=Sun .. 6=Sat, in the shifted frame
  const daysSinceMonday = (dow + 6) % 7 // Mon->0, Tue->1, ... Sun->6
  shifted.setUTCDate(shifted.getUTCDate() - daysSinceMonday)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - BANGKOK_OFFSET_MS) // back to the real UTC instant
}
