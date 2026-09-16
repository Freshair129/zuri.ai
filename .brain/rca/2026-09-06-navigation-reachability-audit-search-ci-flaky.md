# navigation-reachability Platform search flakes on `/audit`

Status: fix applied on the best-supported mechanism found by code inspection;
the exact CI failure could not be forced to reproduce locally despite repeated,
escalating attempts — stated plainly rather than overclaimed.

## Symptom

GitHub Actions run 34038251951, job `e2e` (101500249270), PR #262 head
`ea6cda49`. Playwright reported 0 failed, 1 flaky:
`tests/e2e/navigation-reachability.spec.js:122` "search covers Platform, which
it previously could not reach at all". First attempt timed out at 10000ms on
`expect(locator).toHaveURL(expected)`:

```
Expected pattern: /\/audit$/
Received string:  "http://localhost:3100/overview"
```

The retry passed in 10.9s. `scripts/assert-tests-ran.mjs --fail-on-flaky` then
failed the job by design. The same suite passed cleanly on the merge commit
`57d816b2` (run 34039065176). PR #262 touched governance/architecture
documentation only — nothing in navigation, search, or the Platform routes.

## Evidence gathered

- **The URL never moved.** `Received string` is `/overview`, the page the test
  navigated to two lines earlier — not a different, wrong route. Whatever the
  click-and-Enter sequence did, it did not change the browser's address bar at
  all within the 10s budget. Next.js's App Router intentionally defers the
  history/URL update on a client-side `router.push` until it has the target
  route's RSC payload — so a URL still sitting at `/overview` after 10s means
  the palette's `router.push('/audit')` fired but the fetch for `/audit`'s
  payload had not resolved, not that the wrong entry was clicked.
- **Both attempts were slow, not just the first.** The retry that passed took
  10.9s — an order of magnitude slower than a warm client-side navigation on
  this codebase (1.2–3s measured locally, repeatedly, both idle and loaded).
  That rules out "one contaminated render"; something made this specific
  navigation generically slow in that run, on both tries.
- **`/audit` is warmed only once, anonymously, at the very start of the run.**
  `tests/e2e/warmup.setup.js` sends a plain, unauthenticated
  `request.get('/audit', ...)` for every route in its list — `/audit` is on
  it — before any spec runs.
- **This test is the first *authenticated* visit to `/audit` in the whole
  suite.** `grep` across `tests/e2e/*.spec.js` for a navigation to `/audit`
  finds exactly two: this test, and `smoke.spec.js:82` ("audit log keeps the
  installation-wide operator boundary"). Playwright runs spec files in
  filename order by default, and `navigation-reachability.spec.js` sorts
  before `smoke.spec.js` — so by the time this test runs, no earlier test in
  the suite has ever logged in and rendered `/audit`. In the CI log, warmup
  finished at 14:14:38 and this test ran at 14:26:22 — roughly 12 minutes
  later, with dozens of other routes compiled by the many specs in between.
- **Next.js dev's on-demand-entries cache is configured to dispose a compiled
  route after exactly this kind of gap.** Read directly from the installed
  package (`node_modules/next/dist/esm/server/config-shared.js`):
  `maxInactiveAge: 60 * 1000` (60s), `pagesBufferLength: 5`. The disposal
  function (`on-demand-entry-handler.js`) marks any entry `dispose = true`
  once `Date.now() - lastActiveTime > maxInactiveAge`, provided it isn't the
  page currently being viewed. Nothing in `next.config.js` overrode either
  default before this fix. `warmup.setup.js`'s own comment states the premise
  plainly — "so no test is the one that pays for a cold compile" — but that
  premise silently expires 60 seconds after the warm-up touches a route that
  nothing else revisits soon after.

## What was NOT established

Repeated attempts to force the exact failure locally did not reproduce it:

- 166 repeated runs of the spec (`--repeat-each 15`) on an idle, already-warm
  `.next`: 0 failures, all sub-2s.
- A fresh `.next`, this same spec run alone under 21 concurrent CPU-burning
  background processes (28-core machine): 0 failures.
- A fresh `.next`, the *entire* local e2e suite run once in real file order
  (matching CI's actual sequencing) under the same CPU load: 0 failures, and
  the audit-search test ran in 3.2s.
- Direct manual probing of the dev server's on-demand-entries disposal via
  timed `curl` requests — warming `/audit`, generating churn across a dozen
  other routes, waiting 75s idle past the documented 60s `maxInactiveAge` —
  never once reproduced a slow re-compile of `/audit` on this machine.

The most likely explanation for the non-reproduction is environmental: GitHub
Actions' Windows runners are far more CPU-constrained (2 cores) than this
28-core development machine, and disposal-then-recompile races are exactly the
kind of timing-sensitive behavior that a synthetic CPU load on a wide, fast
machine does not reliably recreate. That is a plausible account, not a proven
one. Per the standard this repository already set in
`.brain/rca/2026-09-06-fr077-containment-ci-flaky.md`: prior similar symptoms
are not proof of this instance's cause, and a plausible mechanism confirmed by
reading the framework's own source is not the same as having watched it happen
in this run.

## Fix applied

`next.config.js` now sets:

```js
onDemandEntries: {
  maxInactiveAge: 60 * 60 * 1000, // 1 hour, was Next's default 60s
  pagesBufferLength: 200,          // was Next's default 5; app has 61 pages
},
```

This is a change to the framework's dev-server module-retention policy, not to
any Playwright timeout or retry setting — `playwright.config.js` is untouched.
It makes the actual behavior of `next dev` match the guarantee
`warmup.setup.js` already claims to provide: once a route is compiled, it
stays compiled for the life of a long-running suite (or an ordinary local dev
session), instead of quietly falling back out of cache after a minute of not
being revisited. `pagesBufferLength: 200` is set well above the app's current
61 page routes so buffer-size churn cannot evict an entry either.

This does not touch `next build`/`next start` — `onDemandEntries` is a dev-only
mechanism and has no effect in production.

## Verification

- `npm run govern` — 0 critical, 0 warning.
- `npm test` — 456 files / 3884 tests passed, 4/14 intentionally skipped.
- `npm run build` — clean.
- `npm run test:e2e`, fresh `.next` — 100 passed, 4 skipped, 0 flaky.
- `navigation-reachability.spec.js --repeat-each 10`, fresh `.next` (separate
  run) — 111/111 passed.

## Prevention

If a similarly-shaped "Timed out waiting for toHaveURL, nothing to do with the
changed code" flake recurs on a route this pattern doesn't cover (e.g. one
touched only via a redirect, or one added after this fix without being added
to `warmup.setup.js`'s `ROUTES` list), do not raise the Playwright `expect`
timeout or the retry count — check first whether the failing route is a first
authenticated visit late in file order, the same way this one was found via
`grep` across `tests/e2e/*.spec.js`.
