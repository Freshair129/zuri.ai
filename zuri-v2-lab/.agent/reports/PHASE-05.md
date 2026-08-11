# Phase 05 — Progress Engine

**Status: PASS**

## Implemented
Pure deterministic calculators in `src/modules/project-manager/progress/strategies.js` (no I/O, no clock, no randomness):

- **TASK_WEIGHT** — completedWeight/plannedWeight; cancelled items excluded; open required gates cap 100→99 with warning; defect count in evidence.
- **RECORD_VALIDATION** — Σvalidated/ΣrecordsTotal across datasets; missing-metric items excluded with warning.
- **WEIGHTED_PIPELINE** — (won + Σ open value × probability) / revenueTarget; fallback to total pipeline value with warning; missing probability counted 0 with warning.
- **KPI_ATTAINMENT** — Σ(attainment × weight)/Σweight over configured KPIs; `direction:'down'` KPIs get inverted credit (linear decay to 0 at 2× target).
- **MILESTONE_READINESS** — Σ doneWeight/Σ weight; open required gates cap at 99; blocked gates warn.
- **SLA_SCORE** — mean(completion, slaAttainment); falls back to completion with warning; incidents/backlog in evidence.
- **EXPANSION_READINESS** — weighted action completion with per-dimension breakdown; go-live gates cap at 99.

All return `{percent (0–100, 1 decimal), evidence (incl. formula), warnings}`; the service layer adds `calculatedAt` and refreshes `progressCache`.

**Roll-up** (`rollup.js`): `Σ(ws% × weight)/Σ(weight)`, zero-weight and empty-list warnings.

UI: `ProgressExplain` shows the percent, formula, evidence table (incl. KPI and dimension breakdowns), and warnings — the UI can always explain where a displayed percentage came from.

## Tests run / results
`tests/unit/strategies.test.js` (27 tests) + `tests/unit/rollup.test.js` (4 tests): 0 items / partial / 100% / invalid denominator / missing metrics / blocked+open gates / determinism — **all pass**. Integration: rollup verified end-to-end (70% for 100+40 @ equal weight).

## Known issues
None.

## Decisions made
Gate capping at 99% (not hard block) keeps progress informative while signalling incompleteness; documented in evidence + warning.

## Next phase
Phase 06 — Import + backup (already implemented; tests documented there).
