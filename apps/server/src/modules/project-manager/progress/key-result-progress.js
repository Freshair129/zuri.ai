import { clampPercent } from './strategies'

// @req FR-268, SDD-107 — Key Result progress, expected-progress-by-now, and
// status. Pure functions: input is pre-loaded data, output is a plain value —
// no I/O, no clock read unless `now` is passed, no randomness. Mirrors the
// selfhost prototype's krProgress/computeKrStatus thresholds (retired as a
// running service, kept as the starting point for these — ADR-101 D5).
// @tested tests/unit/fr268-key-result-progress.test.js

/**
 * A Key Result's progress toward its target, on the same 0-100 scale as
 * BusinessGoal.progress (clampPercent), never the 0-1 scale.
 *
 * `target === baseline` is refused at write time (FR-271 Measurable), so this
 * treats it defensively rather than dividing by zero: 100 once `current` has
 * reached `baseline` (there is nowhere further to go on a flat target), 0
 * otherwise.
 */
export function keyResultProgress({ baseline, target, direction }, current) {
  const b = Number(baseline)
  const t = Number(target)
  const c = Number(current)
  if (!Number.isFinite(b) || !Number.isFinite(t) || !Number.isFinite(c)) return 0
  const span = direction === 'DOWN' ? b - t : t - b
  if (span === 0) return c === b ? 100 : 0
  const covered = direction === 'DOWN' ? b - c : c - b
  return clampPercent((covered / span) * 100)
}

/**
 * How much progress "should" exist by `now`, given the Key Result's own
 * [startAt, dueAt] window — falling back to the parent goal's window when the
 * Key Result declares neither, and returning `null` (never a fabricated 0 or
 * 100) when no window is knowable at all, the same honesty pattern FR-070's
 * roadmap read model uses for a field it cannot compute.
 */
export function expectedProgress({ startAt, dueAt }, now = Date.now()) {
  const start = startAt ? new Date(startAt).getTime() : null
  const due = dueAt ? new Date(dueAt).getTime() : null
  const t = now instanceof Date ? now.getTime() : Number(now)
  if (due === null || !Number.isFinite(due)) return null
  const effectiveStart = start !== null && Number.isFinite(start) ? start : due // no start known: assume due-only, i.e. fully expected only at/after due
  if (due <= effectiveStart) return t >= due ? 100 : 0
  return clampPercent(((t - effectiveStart) / (due - effectiveStart)) * 100)
}

export const KEY_RESULT_STATUS = { OK: 'OK', WARN: 'WARN', BAD: 'BAD' }

// Thresholds named so a test (and a later BR, if the owner wants one tuned)
// can reference the same constants this function branches on, rather than a
// magic number appearing in both places and risking silent drift.
export const KEY_RESULT_OK_GAP_POINTS = 12
export const KEY_RESULT_WARN_GAP_POINTS = 30
export const KEY_RESULT_LOW_CONFIDENCE = 2 // <= this bumps OK to WARN
export const KEY_RESULT_CRITICAL_CONFIDENCE = 1 // <= this forces BAD regardless of progress

/**
 * OK/WARN/BAD from how far actual progress trails expected progress, then
 * lets a low confidence make a gap look worse than the raw numbers alone say —
 * confidence is the owner's own signal that a number in good standing today
 * may not hold, and this function is the one place that signal is allowed to
 * move the status.
 *
 * `expected === null` (no due date on the Key Result or its goal) means gap
 * cannot be computed — status is decided by confidence alone, never treated
 * as "on track" by default.
 */
export function keyResultStatus(progress, expected, confidence) {
  const conf = Number(confidence)
  if (Number.isFinite(conf) && conf <= KEY_RESULT_CRITICAL_CONFIDENCE) return KEY_RESULT_STATUS.BAD

  let status
  if (expected === null) {
    status = Number.isFinite(conf) && conf <= KEY_RESULT_LOW_CONFIDENCE ? KEY_RESULT_STATUS.WARN : KEY_RESULT_STATUS.OK
  } else {
    const gap = expected - progress
    status = gap <= KEY_RESULT_OK_GAP_POINTS
      ? KEY_RESULT_STATUS.OK
      : gap <= KEY_RESULT_WARN_GAP_POINTS
        ? KEY_RESULT_STATUS.WARN
        : KEY_RESULT_STATUS.BAD
    if (status === KEY_RESULT_STATUS.OK && Number.isFinite(conf) && conf <= KEY_RESULT_LOW_CONFIDENCE) {
      status = KEY_RESULT_STATUS.WARN
    }
  }
  return status
}
