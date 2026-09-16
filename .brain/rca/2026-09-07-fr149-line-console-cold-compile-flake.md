# FR-149 LINE server console e2e — recurring near-10s timeout

## Symptom

`tests/e2e/fr149-line-server-console.spec.js` ("LINE account onboarding persists and
activation requires an explicit handoff") flaked four separate times on GitHub
Actions CI across one session's work on PR #267, always the same shape:
`expect(page.getByRole('heading', { name: tag })).toBeVisible()` timing out at
exactly 10000ms, immediately after clicking the account-creation submit button
(`เชื่อมต่อ LINE Official Account ทันที`). Each failing attempt took 15–26s total, and
every failure passed on immediate retry. `main`'s own CI has passed this same test
on other runs.

## Evidence

- The click handler between the assertion and the button (`handleConnectAccount` in
  `src/modules/line-oa-studio/ui/LineStudioEdgeConnection.jsx`) does, in order: a real
  `POST /api/line-oa/connections`, a real `POST /api/line-oa/accounts`, then (inside
  `run()`) a `GET /api/line-oa/accounts` re-fetch before the account card — and the
  heading under test — render.
- The three handlers involved (`src/app/api/line-oa/connections/route.js`,
  `src/app/api/line-oa/accounts/route.js`, and their application-layer services in
  `src/modules/integration/application/line-server-provisioning-service.js` and
  `src/modules/line-oa-studio/application/line-oa-account-service.js`) do a bounded
  number of Prisma calls per request, all inside SQLite transactions against the
  e2e run's own isolated database. No unbounded loop, missing index, or N+1 pattern
  was found that scales with anything this test creates (the account list `describe()`
  step in `line-oa-account-service.js` does have a sequential per-row loop over
  `bindingStatus`, but every account created in this suite has no `bindingCode`, so
  that loop short-circuits before any query and does not scale with account count).
- `tests/e2e/playwright.config.js` runs the suite against `next dev` (not a production
  build), with `workers: 1`, and the file itself documents an already-diagnosed class
  of flake from this: a route module compiles on its *first* HTTP request in dev mode,
  and if that first request happens inside a test's `expect` budget rather than during
  the dedicated `warmup.setup.js` step, the compile cost is reported as a test failure.
  The config's own comment: "if cold-compile flakes reappear, the fix is a warm-up
  step, not re-hiding them behind a silent retry."
- `tests/e2e/warmup.setup.js` warms every page route in the domain registry, including
  `/line-oa`, and one example API route (`/api/auth/signup`, with a comment describing
  exactly this failure mode for a POST-only handler). It did **not** warm
  `/api/line-oa/connections` or `/api/line-oa/accounts` — the two route modules this
  spec is the first (alphabetically, and with `workers: 1` that is the real run order)
  to ever request. No other e2e spec file touches `/api/line-oa/connections` or
  `/api/line-oa/accounts` before this one runs.
- Reproduction: with the two routes *not* warmed, a first-touch request pays the dev
  compile cost inline. With them added to `warmup.setup.js` (this change), 11
  consecutive local runs (`--repeat-each 10 --retries=0`) passed; the first post-warmup
  run took 6.4s (well under the 10s `expect` budget that was failing in CI) and
  subsequent runs 2.0–2.5s, down from the reported 15–26s failing attempts.

## Root Cause

Two Next.js dev-mode route modules this spec is the first to touch
(`/api/line-oa/connections`, `/api/line-oa/accounts`) were missing from the e2e
warm-up list. Their first-request compile cost was paid inside the test's `expect`
budget rather than during warm-up, matching the exact flake class this repository's
own `playwright.config.js` and `warmup.setup.js` already document and defend
against for page routes and one other API route. On a loaded CI runner the stacked
compile cost of two route modules plus the client re-fetch occasionally exceeded the
fixed 10s `expect` timeout; on a faster or less loaded local machine it consistently
finished under 10s, which matches the reported "flaky only on CI, passes locally
every time" pattern.

This is not a defect in the account-creation route handlers' own logic — profiled
independently (warm), the full three-request round trip completes in ~1–2s.

## Why the issue escaped detection

- `tests/unit/e2e-warmup.test.js` only cross-checks `warmup.setup.js` against the
  page-route domain registry (`@/config/domains`); it has no equivalent check for API
  route handlers, so a new POST-only API route silently starts out unwarmed.
- The LINE OA Studio console (FR-146/FR-149) is comparatively new and
  `fr149-line-server-console.spec.js` is the only spec in the suite that exercises
  `/api/line-oa/connections`, so the gap was invisible until this spec happened to run
  under CI load.
- The four occurrences were spread across one PR's CI runs and each disappeared on
  retry, so nothing about a single run pointed at the missing warm-up entry; only
  cross-referencing the recurring exact-10000ms boundary against this repo's own
  documented cold-compile flake class (in `playwright.config.js`'s history) surfaced it.

## Fix

Added `/api/line-oa/connections`, `/api/line-oa/accounts`, `/api/line-oa/accounts/warmup`,
and `/api/line-oa/accounts/warmup/jobs` to `tests/e2e/warmup.setup.js`, following the
same pattern already used there for `/api/auth/signup` and for dynamic page routes
(`/projects/warmup/...`) — a GET against a POST-only or `[id]`-parameterized route still
compiles the module; `failOnStatusCode: false` tolerates the resulting 404/405/400.

No application code, retry policy, or `expect` timeout changed.

## Verification

- `npx vitest run tests/unit/e2e-warmup.test.js` — passes (the added entries are
  additional API routes, not page routes, so the domain-registry cross-check is
  unaffected).
- `npx playwright test tests/e2e/fr149-line-server-console.spec.js --repeat-each 10 --retries=0`
  — 11/11 passed (1 warm-up run + 10 repeats), first post-warmup run 6.4s, remaining
  runs 2.0–2.5s.
- Full verification bar (`npm test`, `npm run build`, `npm run govern`,
  `npm run test:e2e`) run separately before merge; see PR for results.

## What landed instead — the fix generalised (2026-09-07 evening)

The four hand-added entries this note describes are **not** in the change that
merged; only this note is. While it sat open, the same shape was diagnosed
across three consecutive CI runs of one unrelated commit and turned out to be
general rather than LINE-specific: `warmup.setup.js`'s hand-written list named
**7 of the 199** route-handler modules under `src/app`, so *whichever* handler
a spec reached first paid its compile inside an assertion. fr149 was simply the
instance someone diagnosed first.

PR #285 replaced the hand list with `tests/e2e/warmup-routes.js`, which derives
the plan from the filesystem — every `page.*` and `route.*`, with `(group)`
dropped, `[param]` → `warmup`, `@slot`/`_private` skipped — and warms
discovered handlers with `OPTIONS`, which compiles the module without running
any userland function. `warmupPlan()` already resolves all four routes below to
`OPTIONS`, so re-adding them by hand would have been redundant *and* a small
regression: a hand-listed entry is fetched with `GET`, which executes the
handler.

  /api/line-oa/connections · /api/line-oa/accounts
  /api/line-oa/accounts/warmup · /api/line-oa/accounts/warmup/jobs

The diagnosis in this note stands unchanged and is what made the general case
recognisable — it is kept for that reason. See
`.brain/rca/2026-09-07-e2e-warmup-covered-80-of-287-modules.md` for the
generalisation, and note its rule: a route is warm from the commit that adds
it, not from the commit after it flakes.
