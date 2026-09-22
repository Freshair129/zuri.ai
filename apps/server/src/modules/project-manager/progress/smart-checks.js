// @req FR-271 — the deterministic subset of SMART as a pure function. Never a
// fabricated Achievable/Relevant score: both are human judgement no
// server-side check can honestly make, and are returned as `null` — the same
// honesty pattern project-roadmap-read-model.js uses for a field it cannot
// compute rather than inventing a value.
// @tested tests/unit/fr271-smart-checks.test.js

const normalize = (s) => String(s ?? '').trim().toLowerCase()

/**
 * @param {object} input   the Key Result draft: { title, metric, unit, baseline, target, dueAt }
 * @param {object} goal    the parent goal: { title, targetAt }
 * @param {number|Date} now  injected for deterministic tests
 * @returns {{ specific: boolean, measurable: boolean, achievable: null, relevant: null, timeBound: boolean }}
 */
export function smartChecks(input, goal, now = Date.now()) {
  const title = String(input?.title ?? '').trim()
  const goalTitle = String(goal?.title ?? '').trim()
  const specific = title.length > 0 && normalize(title) !== normalize(goalTitle)

  const baseline = Number(input?.baseline)
  const target = Number(input?.target)
  const measurable =
    String(input?.metric ?? '').trim().length > 0 &&
    String(input?.unit ?? '').trim().length > 0 &&
    Number.isFinite(baseline) &&
    Number.isFinite(target) &&
    target !== baseline

  const t = now instanceof Date ? now.getTime() : Number(now)
  const due = input?.dueAt ? new Date(input.dueAt).getTime() : NaN
  const goalDue = goal?.targetAt ? new Date(goal.targetAt).getTime() : null
  const timeBound =
    Number.isFinite(due) &&
    due >= t &&
    (goalDue === null || !Number.isFinite(goalDue) || due <= goalDue)

  return { specific, measurable, achievable: null, relevant: null, timeBound }
}
