# PM review R2 — progress calculators

Reviewed: `src/modules/project-manager/progress/strategies.js`, `progress/rollup.js`,
`application/progress-service.js`, the execution-view bodies that render next to these
numbers (`views/execution/mode-bodies.jsx`, `ExecutionModeView.jsx`), the validation
boundary (`src/lib/validation/entities.js`, `import/plan-schema.js`,
`import/plan-import-service.js`), and the tests (`tests/unit/strategies.test.js`,
`tests/unit/rollup.test.js`, `tests/integration/project-core.test.js`).

## Findings

### F1 — Rounding defeats the BR-006 gate cap: a workstream with an open required gate can display 100%
- **Where**: `src/modules/project-manager/progress/strategies.js:54` (taskWeight), `:252` (milestoneReadiness), `:363` (expansionReadiness), interacting with `clampPercent` at `:18-21`
- **Worked example**: TASK_WEIGHT workstream, items = [DONE weight 2499, IN_PROGRESS weight 1], gates = [{required: true, status: 'OPEN'}].
  - `percent = 2499/2500 × 100 = 99.96`
  - Cap check is `openReleaseGates.length > 0 && percent >= 100` → `99.96 >= 100` is **false**, so no cap and no warning.
  - `clampPercent(99.96)` = `Math.round(999.6)/10` = **100.0**.
  - The workstream displays **100%** with `evidence.openRequiredGates: 1` and zero warnings. BR-006 says an unpassed required gate caps progress at 99% with a warning; the entire point of the cap is that "100%" is never shown while a required gate is open. Any raw percent in **[99.95, 100)** hits this window.
  - Correct output: ≤ 99.9 (or 99 with the cap warning).
- **Corollary at project level**: `rollupProject` has no gate awareness and rounds again. Workstreams [99% (gate-capped), weight 1] and [100%, weight 199] → `(99×1 + 100×199)/200 = 99.995` → clamped to **100.0** on the project page and the business card, while a required gate is open. The 99-cap the workstream fought for is erased one level up by rounding.
- **Evidence**: `tests/unit/strategies.test.js:49-55` tests the cap only at exactly 100% ("caps at 99 when required gate open at 100%"). Nothing covers the 99.95–100 window; nothing covers rollup rounding across the cap. **None.**
- **Severity**: HIGH (wrong number shown to a user — "100%" with an unpassed required gate)
- **Declared requirement it violates**: BR-006 ("Required gate ที่ยังไม่ผ่าน cap progress ที่ 99% พร้อม warning")

### F2 — Sales Pipeline page computes its own weighted value including CANCELLED deals, disagreeing with the calculator on the same screen
- **Where**: `src/modules/project-manager/views/execution/mode-bodies.jsx:125-133` (SalesPipeline totals) vs `progress/strategies.js:129-146` (weightedPipeline uses `activeItems`, which excludes CANCELLED)
- **Worked example**: deals A (DONE, 100,000), B (IN_PROGRESS, 50,000, p=0.5), C (**CANCELLED**, 80,000, p=0.4). The workstream list API (`project-service.js:218-233 listWorkstreams`) filters `deletedAt` but **not status**, so C reaches the view.
  - Calculator (drives the percent and the Explain panel): `totalPipelineValue = 150,000`, `weightedValue = 100,000 + 25,000 = 125,000`.
  - View cards, same screen, directly below the ProgressExplain: `Pipeline value = 230,000`, `Weighted value = 100,000 + 25,000 + 80,000×0.4 = 157,000`.
  - Same figure ("weighted value"), two computations, **125,000 vs 157,000** — off by whatever value dead deals carry, unbounded. The cancelled deal also renders as a live card in the Discovery column.
- **Evidence**: none — `mode-bodies.jsx` is `@tested tests/e2e/smoke.spec.js` only, which does not assert these totals; no unit test compares the view's reduce against the calculator's evidence.
- **Severity**: HIGH (this is precisely "a number a page would disagree with"; the two disagreeing numbers are inches apart on one screen)
- **Declared requirement it violates**: FR-010 (strategy + evidence is the progress contract) and the CLAUDE.md progress rule; same defect class as the FR-063 CANCELLED precedent

### F3 — Operations Board SLA attainment card includes CANCELLED items; calculator excludes them
- **Where**: `src/modules/project-manager/views/execution/mode-bodies.jsx:273-275` (sums over all `workstream.items`) vs `progress/strategies.js:281,299-307` (slaScore sums over `activeItems` only)
- **Worked example**: active CHECKLIST_ITEM (DONE, metrics `{slaMet: 9, slaTotal: 10}`) + CANCELLED item (metrics `{slaMet: 0, slaTotal: 10}`).
  - View card: `9/20` = **45%** SLA attainment.
  - Calculator: `slaAttainment = 9/10 = 0.9`, completion `1.0` → percent = **95%**, evidence `slaMet: 9, slaTotal: 10`.
  - The page shows "SLA attainment 45%" beneath a 95% progress bar whose Explain panel says slaMet 9 / slaTotal 10. The "Process items" count on the same row also includes cancelled items while `evidence.itemCount` does not.
- **Evidence**: none (smoke e2e only)
- **Severity**: HIGH (wrong number shown to a user, disagreeing with the calculator's evidence on the same screen)
- **Declared requirement it violates**: FR-010 / CLAUDE.md progress rule

### F4 — Work-item weight accepts zero and negative values at every boundary; a negative weight silently produces 100% with open work
- **Where**: `src/lib/validation/entities.js:218` (`weight: z.number().default(1)` — no `.positive()`/`.nonnegative()`, unlike `progressWeight` at `:191` and milestone weight at `:235`); `import/plan-schema.js:41` (item) and `:55` (milestone — the intake path bypasses `zMilestoneInput` entirely, `plan-import-service.js:335` writes `m.weight ?? 1` straight to the DB); `components/WorkItemModal.jsx:91` (no `min` attribute, vs the probability field at `:97` which has `min="0" max="1"`)
- **Worked example**: TASK_WEIGHT items = [DONE weight 5, IN_PROGRESS weight −3].
  - `planned = 5 + (−3) = 2`, `completed = 5` → `percent = 250` → `clampPercent` → **100.0%**, no warning, while item B is visibly IN_PROGRESS on the board below.
  - With a required OPEN gate the branch fires and emits the **false** warning "All weight complete but 1 required gate(s) not passed" — the weight is not complete.
  - Via plan import, a negative **milestone** weight does the same to MILESTONE_READINESS (`doneWeight/totalWeight` can exceed 1).
- **Evidence**: `tests/unit/strategies.test.js:43-47` covers all-zero weights (denominator warning) only; nothing covers negative weight, and no validation-layer test asserts weight ≥ 0.
- **Severity**: MEDIUM (needs bad input, but all three intake surfaces accept it, and the clamp then hides it — the exact "clamping hides a genuinely out-of-range input" failure)
- **Declared requirement it violates**: none — undeclared behaviour (BR-005's weighted roll-up presumes non-negative weights but no rule or validator states it)

### F5 — Impossible metric data (validated > total, slaMet > slaTotal) is clamped to 100 with no warning
- **Where**: `src/modules/project-manager/progress/strategies.js:107` (recordValidation) and `:306-311` (slaScore); metrics come from free-form `metricDataJson` — `validatePlanSemantics` (`import/plan-schema.js:205-208`) checks metric **key names** only, never values, and the API/UI write arbitrary numbers
- **Worked example**: one dataset with `{recordsTotal: 1000, validated: 1200}` → `percent = 120` → clamped to **100.0%**, zero warnings. The number is impossible (more records validated than exist), which means the source data is corrupt — and the surface reports a confident, green 100% instead of flagging it. Same shape: `{slaMet: 12, slaTotal: 10}` → signal 1.2 silently inflates the SLA blend.
- Contrast: the same function already warns for the *low* anomaly (`missing recordsTotal`), and weightedPipeline's over-target clamp is a **declared** behaviour with a test (`strategies.test.js:129-135`); the over-total case here is undeclared and unwarned. A calculator whose contract is `{percent, evidence, warnings}` returning a materially-corrupt number with `warnings: []` is the "silently-partial number" the contract exists to prevent.
- **Evidence**: none for validated > total or slaMet > slaTotal
- **Severity**: MEDIUM
- **Declared requirement it violates**: FR-010 (warnings are part of the declared output contract); otherwise undeclared behaviour

### F6 — Double/triple rounding through the rollup chain
- **Where**: `progress/strategies.js:20` (round to 0.1 per workstream) → `rollup.js:26` (round again per project) → `rollup.js:53` (round a third time per business)
- **Worked example**: P1 = one workstream raw 50.05% → stored 50.1; P2 = 0%. Business card: `(50.1 + 0)/2 = 25.05` → **25.1%**; the flat single-pass average the comment at `rollup.js:34-37` promises ("algebraically identical to one flat weighted average") gives `(50.05 + 0)/2 = 25.025` → **25.0**. The equivalence test (`rollup.test.js:47-60`) passes only because its inputs are already round numbers.
- **Evidence**: `tests/unit/rollup.test.js:47-60` (does not exercise rounding boundaries)
- **Severity**: LOW on its own (±0.1 drift) — but it is the mechanism that powers F1's corollary, so fixing F1 should fix the order of clamp/cap here too
- **Declared requirement it violates**: none — undeclared behaviour (the in-file equivalence claim is the thing contradicted)

### F7 — Hand-copied satisfied-gate list in three places instead of `SATISFIED_GATE_STATUSES`
- **Where**: `application/progress-service.js:116`, `src/app/(pm)/overview/page.jsx:332`, `src/modules/business/application/business-home-read-model.js:32` — all hard-code `['PASSED', 'WAIVED']`; the canonical derived subset `SATISFIED_GATE_STATUSES` exists in `src/lib/validation/enums.js:75` precisely so this is imported, per the 2026-08-17 RCA note beside it
- **Worked example**: none today — the three copies currently equal the canonical set, so no number is wrong yet. But this is byte-for-byte the shape that produced the CANCELLED bug: add a new satisfied status (e.g. `NOT_APPLICABLE`) to `GATE_STATUSES` + the filter, and the group card / overview KPI / attention queue count that gate as open while the calculators (which import the subset, `strategies.js:8,16`) treat it as passed — openRequiredGates disagreeing across surfaces.
- **Evidence**: none tests this equivalence
- **Severity**: LOW (no wrong number today; guaranteed divergence on the first enum change)
- **Declared requirement it violates**: SDD-002 / the enums-single-source rule in CLAUDE.md

## Checked and found sound

- **rollupProject / rollupBusiness zero and empty denominators** — both refuse with a warning and return 0, never NaN (`rollup.js:16-23, 43-50`); tested (`rollup.test.js:15-25, 62-72`).
- **taskWeight CANCELLED exclusion** — cancelled items leave both numerator and denominator (`activeItems`), tested (`strategies.test.js:33-41`). The `DONE` set's extra `'COMPLETED'` entry is dead (not in `WORK_STATUSES`) and harmless as a superset.
- **weightedPipeline scope predicate matches the SalesPipeline view's predicate** (`subtype === 'DEAL' || numericValue != null`) — the disagreement in F2 is status filtering only, not scope. Missing probability warns per deal and counts at 0; probability is validated 0–1 at every boundary (`entities.js:220`, `plan-schema.js:43`, modal `min/max`), and the view's `probability × 100` display matches.
- **weightedPipeline over-target clamp to 100** — declared and tested behaviour (`strategies.test.js:129-135`).
- **kpiAttainment** — zero-weight KPI sum refuses with warning; target ≤ 0 and down-direction actual = 0 both warn while counting 0, so the dilution is visible; per-KPI attainment is capped at 1 before weighting. CampaignControl renders the calculator's evidence rather than recomputing — the right pattern (contrast F2/F3).
- **milestoneReadiness** — `MILESTONE_STATUSES` has no CANCELLED and the model has no `deletedAt`, so the missing active-filter on milestones cannot silently drop rows today; MISSED counting as not-done in the denominator reads as intended. BLOCKED gate warning fires independently of the cap.
- **slaScore signal blend** — incidents/backlog are evidence-only by design; the completion-only fallback warns.
- **progressCache** — written on every recompute, read by nothing (`grep progressCache` in `src/` shows only the two writes and the comment). SDD-005 holds.
- **computeProjectProgress vs summarizeLoadedProject** — same workstream scope (`deletedAt: null, status ≠ ARCHIVED`), same calculators, same rollup; the project page, overview row and portfolio card cannot disagree with each other (F1's rounding window aside).
- **rollupBusiness weighting** — projects carry their own workstream weight sum, so the flat-average identity holds structurally (up to F6's rounding); a zero-weight project is excluded from the average rather than treated as weight 1.
- **hydrateBundle** — deleted items filtered before the calculators, JSON parse failures degrade to `{}` (feeding the `missing recordsTotal` warning path rather than throwing).

## Uncertain

- **`nextMilestone` includes MISSED milestones** (`progress-service.js:117-118`): `m.status !== 'DONE' && m.targetAt` means a long-past MISSED milestone is permanently the business card's "next milestone" (list is ordered `targetAt asc`). Whether MISSED should be surfaced as "next" or excluded is a product call — no FR states it. Not a percent, so left out of the findings proper.
- **Project-level `openRequiredGates` counts workstream-scoped gates too** (`project.gates` includes every gate row since `Gate.projectId` is always set). All current surfaces (portfolio card, overview KPI, business-home read model) count the same way, so nothing disagrees today — but the count's intended scope (project-only vs all) is undeclared.
- **kpiAttainment negative actuals**: `Math.min(1, actual/target)` admits negative attainment for an 'up' KPI (metrics are unvalidated JSON), which silently drags the weighted average before the final clamp floors it at 0. Only reachable with corrupt metrics; same family as F5 but with no plausible real input identified.
- **A workstream PATCHed to `status: 'ARCHIVED'` without deletion** (allowed by `zWorkstreamUpdate`) is excluded from the project rollup but still listed with its own progress in execution views. Both surfaces are internally consistent; whether a status-archived-but-not-deleted workstream should appear at all is undeclared.
