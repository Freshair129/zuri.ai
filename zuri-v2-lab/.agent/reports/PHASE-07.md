# Phase 07 — Hardening

**Status: PASS**

## Runs executed
- `npm run build` — PASS (16 routes; only fix needed was a Suspense boundary around `useSearchParams` on /projects).
- `npm test` (Vitest) — **75/75 pass** (8 files: unit ids/strategies/rollup/plan-schema + integration scope-isolation/project-core/plan-import/backup).
- `npx playwright test` — **20/20 pass**: overview, workspaces, projects list + detail, all-work filters, dependencies, milestones & gates, timeline, audit, backup, command palette (Ctrl+K → navigate), all seven execution views (heading + seeded workstream + Explain), progress-evidence reveal, plan-import dry-run rejection, mobile-viewport horizontal-overflow check.
- Responsive checks: shell collapses at ≤768px (narrow sidebar, wrapped selectors, single-column grids); overflow test asserts no horizontal page scroll at 375px.
- Empty/error states: every view has EmptyState with guidance; ErrorState with retry; API errors surface as messages, Zod issues enumerated.
- Keyboard: palette fully keyboard-driven (Ctrl+K, arrows, Enter, Esc); focus outline on inputs; aria-labels/aria-current/role=progressbar/alert throughout.
- Data reset/seed: `npm run db:seed` (idempotent — verified double-run) and `npm run db:reset`.

## Environment note (documented workaround)
The Playwright 1.49 chromium (rev 1148) download stalled on this machine's network; `playwright.config.js` falls back to a locally installed ms-playwright chromium build (`chromium-1228`) via `executablePath` when the pinned build is absent. On a machine with normal CDN access, `npx playwright install chromium` restores default behavior automatically.

## Docs written
- `zuri-v2-lab/README.md` (user quick start)
- `zuri-v2-lab/docs/ARCHITECTURE-NOTES.md`
- `zuri-v2-lab/docs/DB-MIGRATION-NOTES.md` (SQLite → Postgres)
- `zuri-v2-lab/docs/ZURI-INTEGRATION-ASSESSMENT.md` (v1 module vs v2 foundation)
- `zuri-v2-lab/AGENTS.md` (repo-local agent rules)

## Known issues
- No drag-and-drop on boards (status selects instead).
- IBM Plex Sans Thai is referenced with system-font fallback, not bundled (fully offline either way).
- `infrastructure/` layer folded into application services (see ARCHITECTURE-NOTES trade-offs).

## Next
FINAL report with acceptance matrix.
