# Lane B — incomplete enum copies

**Status**: DONE

## Per copy
| File::ENUM | Verdict (exhaustive-list bug \| legitimate filter \| unclear) | What I did | Behaviour change? |
|---|---|---|---|
| `KanbanBoard.jsx::WORK_STATUSES` | exhaustive-list bug (the declared FR-063 defect) | `COLUMNS` now built as `WORK_STATUSES.map(key => ({ key, ...COLUMN_META[key] }))` — `COLUMN_META` holds presentation only (label/color/icon) with **unquoted** keys, membership/order comes from the imported enum | Yes — declared: a `CANCELLED` column now appears. Items in that status, previously invisible with no indication, now render |
| `KanbanBoard.jsx::MILESTONE_STATUSES` | false positive — coincidental literal overlap, no milestone code exists in this file | Resolved as a side effect of the WORK_STATUSES fix (the quoted `'PLANNED'`/`'IN_PROGRESS'`/`'DONE'` literals that caused the coincidental match are gone) | No |
| `mode-bodies.jsx::WORK_STATUSES` | exhaustive-list bug — `SprintBoard`'s 4-column grouping (`['PLANNED','READY']`→Backlog, etc.) never mapped `CANCELLED` to any column | Replaced the hard-coded `columns` array with `buildSprintColumns()`, which iterates `WORK_STATUSES` and buckets each value via a `SPRINT_COLUMN_LABELS` map (unquoted keys); `CANCELLED` now gets its own "Cancelled" column (grid changed `grid-cols-4`→`grid-cols-5`). Unmapped future statuses fall back to their own column instead of vanishing | Yes: a cancelled sprint work item, previously invisible on the Sprint board, now shows in a "Cancelled" column — same defect class as FR-063, same fix shape |
| `mode-bodies.jsx::ITEM_SUBTYPES`, `CONTAINER_SUBTYPES` | legitimate filter (not really a "list" at all) | Left unchanged | No. These are scattered individual `subtype === 'X'` discriminators across 7 unrelated mode-specific render functions (e.g. `i.subtype === 'DATASET'` in `MigrationMonitor`, `c.subtype === 'SPRINT'` in `SprintBoard`). The checker's literal-matching heuristic aggregates them file-wide and coincidentally clears the "3+ members" threshold, but no single site is attempting to enumerate the whole vocabulary — each mode already has its own subtype set named in `EXECUTION_MODE_CONTRACTS[mode]` in `enums.js`. Nothing is silently lost; left as accepted baseline debt |
| `MilestonesView.jsx::WORK_STATUSES` | false positive — coincidental literal overlap (no WORK_STATUSES list exists in this file at all) | Imported `MILESTONE_STATUSES`/`GATE_STATUSES` from `enums.js` and replaced the two hand-typed literal arrays (`['PLANNED','IN_PROGRESS','DONE','MISSED']`, `['OPEN','PASSED','BLOCKED','WAIVED']`) that were the source of the coincidental overlap. Both were already complete (4/4), so this is a pure derive-from-source cleanup, same order, same values | No |
| `progress-service.js::PROJECT_STATUSES`, `WORKSTREAM_STATUSES` | legitimate filter | Added `ACTIVE_PROJECT_STATUSES`/`ACTIVE_WORKSTREAM_STATUSES` to `enums.js` (`PROJECT_STATUSES.filter(s => s !== 'ARCHIVED')` etc.) and replaced `status: { not: 'ARCHIVED' }` with `status: { in: ACTIVE_* } }` in the three Prisma queries. `not: 'ARCHIVED'` and `in: [PLANNED, ACTIVE, ON_HOLD, DONE]` select an identical row set given the DB only ever holds validated enum values (Zod boundary, BR-004/SDD-002) | No — same query result set, PLANNED/ON_HOLD projects and workstreams were already included (only ARCHIVED was excluded); this makes that explicit instead of implied |
| `progress-service.js::GOAL_STATUSES` | false positive — no Goal-related code exists anywhere in this file | Resolved as a side effect of the PROJECT_STATUSES fix (the shared `ACTIVE`/`DONE`/`ARCHIVED` literals that coincidentally matched `GOAL_STATUSES` too are gone) | No |
| `strategies.js::GATE_STATUSES` | legitimate filter | Added `SATISFIED_GATE_STATUSES = GATE_STATUSES.filter(s => s === 'PASSED' \|\| s === 'WAIVED')` to `enums.js`; `GATE_SATISFIED = new Set(SATISFIED_GATE_STATUSES)` replaces the local `new Set(['PASSED','WAIVED'])` | No — same 2 values. `OPEN` and `BLOCKED` are correctly excluded by design (a gate is not yet satisfied in either status) |
| `strategies.js::WORK_STATUSES` | legitimate filter (confirmed, left alone) | None | No. `DONE`/`CANCELLED` are named terminal-status filters ("counts as complete" / "excluded from active work"), not an attempt to enumerate WORK_STATUSES; `activeItems()` deliberately keeps PLANNED/READY/IN_PROGRESS/REVIEW in every planned/completed-weight calculation — only CANCELLED and soft-deleted items are excluded. Nothing is silently lost, so per the "do not add missing values to a genuine filter" rule this stays as-is. Still flagged post-fix (DONE/CANCELLED/BLOCKED literals remain, 3 of 7) — correctly remains in the baseline as accepted debt |

## Behaviour changes, stated plainly
1. **KanbanBoard.jsx** — a WorkItem with status `CANCELLED` now renders in a new "Cancelled" column instead of disappearing from the board with no indication. This is the declared outcome of FR-063 (`docs/domains/project-manager/features/FR-063-project-board.md`).
2. **mode-bodies.jsx `SprintBoard`** — a WorkItem with status `CANCELLED` now renders in a new "Cancelled" column on the Sprint board (5 columns instead of 4) instead of disappearing. Same defect class as FR-063, same shape of fix, for the same underlying bug (a status→column map that silently dropped one value). No FR currently names this view explicitly the way FR-063 names KanbanBoard.jsx, but the missing-value behaviour was unambiguously a silent loss (an item vanishing from the only board that shows it), not a deliberate filter, so per the wave instructions ("If it is an exhaustive list that lost values ... derive it from the enum") I fixed it rather than leaving it as a filter.

No other behaviour changes. `progress-service.js` and `strategies.js` (the progress calculators) produce identical numbers before and after — verified by the unchanged pass of `tests/unit/strategies.test.js`, `tests/unit/rollup.test.js`, `tests/integration/project-core.test.js` (progress engine test), and `tests/integration/adaptive-shell.test.js`.

## Left alone, needs an owner decision
None. Every assigned entry was classified with confidence (exhaustive-list bug, legitimate filter, or coincidental false positive) and is explained above.

## Verification
- Targeted tests: `npx vitest run tests/unit/strategies.test.js tests/unit/rollup.test.js tests/integration/project-core.test.js tests/integration/adaptive-shell.test.js` → **4 test files, 54 tests, all passed**.
- `node scripts/doc-preflight.mjs` enum-copy line (final, after baseline update):
  ```
  [INFO] enum-copy: 14 hand-copied enum list(s) remain (accepted debt) — 4 of them are INCOMPLETE copies — those are the ones that silently drop a value: src/app/(pm)/projects/new/page.jsx::ITEM_SUBTYPES missing BUG/VALIDATION/RECONCILIATION/ACCOUNT/ACTIVITY/AUDIENCE/EXPERIMENT/ISSUE/SLA/APPROVAL · src/modules/project-manager/progress/strategies.js::WORK_STATUSES missing PLANNED/READY/IN_PROGRESS/REVIEW · src/modules/project-manager/views/execution/mode-bodies.jsx::CONTAINER_SUBTYPES missing EPIC/RELEASE/MIGRATION_STAGE/MIGRATION_BATCH/SALES_PIPELINE/SALES_STAGE/CAMPAIGN/CAMPAIGN_WAVE/CHANNEL/LAUNCH_PHASE/OPS_PERIOD/OPS_PROCESS · src/modules/project-manager/views/execution/mode-bodies.jsx::ITEM_SUBTYPES missing TASK/BUG/VALIDATION/RECONCILIATION/ACCOUNT/ACTIVITY/CREATIVE/AUDIENCE/EXPERIMENT/DELIVERABLE/SLA/SETUP_ACTION/APPROVAL
  ```
  Overall preflight run at the time of this check: `critical 0 · warning 0 · info 14 → PASS` (no enum-copy CRITICAL, meaning no new/un-baselined copy was introduced).
- Baseline entries removed from `docs/.enum-copy-baseline.json` (all 12 confirmed repaid by the `[INFO] enum-copy: ... baseline entr(ies) no longer copy an enum` line before I edited the baseline):
  - `src/modules/project-manager/application/progress-service.js::GOAL_STATUSES`
  - `src/modules/project-manager/application/progress-service.js::PROJECT_STATUSES`
  - `src/modules/project-manager/application/progress-service.js::WORKSTREAM_STATUSES`
  - `src/modules/project-manager/progress/strategies.js::GATE_STATUSES`
  - `src/modules/project-manager/views/KanbanBoard.jsx::MILESTONE_STATUSES`
  - `src/modules/project-manager/views/KanbanBoard.jsx::WORK_STATUSES`
  - `src/modules/project-manager/views/execution/mode-bodies.jsx::GATE_STATUSES`
  - `src/modules/project-manager/views/execution/mode-bodies.jsx::MILESTONE_STATUSES`
  - `src/modules/project-manager/views/execution/mode-bodies.jsx::WORK_STATUSES`
  - `src/modules/project-manager/views/universal/MilestonesView.jsx::GATE_STATUSES`
  - `src/modules/project-manager/views/universal/MilestonesView.jsx::MILESTONE_STATUSES`
  - `src/modules/project-manager/views/universal/MilestonesView.jsx::WORK_STATUSES`

## Files touched
- `src/modules/project-manager/views/KanbanBoard.jsx`
- `src/modules/project-manager/views/execution/mode-bodies.jsx`
- `src/modules/project-manager/views/universal/MilestonesView.jsx`
- `src/modules/project-manager/application/progress-service.js`
- `src/modules/project-manager/progress/strategies.js`
- `src/lib/validation/enums.js` (additive only — 3 new derived-subset exports: `ACTIVE_PROJECT_STATUSES`, `ACTIVE_WORKSTREAM_STATUSES`, `SATISFIED_GATE_STATUSES`; nothing existing was changed)
- `docs/.enum-copy-baseline.json` (12 repaid entries removed)

No git operations performed (no branch/commit/push/stash), per instructions.
