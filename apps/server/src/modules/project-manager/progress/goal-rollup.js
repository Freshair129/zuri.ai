import { clampPercent } from './strategies'

// @req SDD-107, BR-044 — a BusinessGoal's progress, once it holds a Key
// Result, is a pure mean of its Key Results' own progress — never weighted,
// unlike rollupProject's workstream weights, because a Key Result carries no
// weight field (FR-268 deliberately has none: OKR practice does not grade
// one Key Result as "worth more" than a sibling). Mirrors rollupProject's
// {percent, warnings, formula} shape (progress/rollup.js).
// @tested tests/unit/fr268-goal-rollup.test.js

/**
 * `keyResultPercents` is an array of already-computed per-Key-Result
 * progress numbers (0-100) — the caller runs keyResultProgress() on each Key
 * Result first, exactly as rollupProject's caller pre-computes each
 * workstream's percent. This function does no lookup of its own.
 */
export function rollupGoal(keyResultPercents) {
  const warnings = []
  const rows = (keyResultPercents || []).filter((p) => Number.isFinite(p))
  if (rows.length === 0) {
    warnings.push('Goal has no Key Results — progress stays manual.')
    return { percent: 0, count: 0, warnings, formula: 'mean(Key Result %)' }
  }
  const mean = rows.reduce((sum, p) => sum + p, 0) / rows.length
  return { percent: clampPercent(mean), count: rows.length, warnings, formula: 'mean(Key Result %)' }
}
