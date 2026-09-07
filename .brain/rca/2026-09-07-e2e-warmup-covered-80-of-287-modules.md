# e2e: the warm-up list covered 80 of 287 modules

Status: root cause established from three CI runs of one commit plus a local
`next dev` probe; fix applied (the warm-up list is now derived from `src/app`);
local full-suite measurement below. The "systemic, environmental, rotating"
reading recorded earlier the same day was wrong in its conclusion and right in
its observation — it *was* rotating, because the thing rotating was which cold
module a run happened to hit first.

## Symptom

`main`'s `e2e` job was red on almost every run after the monorepo move, each
time on a different test, each time "passed on retry", each time turned into a
build failure by `scripts/assert-tests-ran.mjs --fail-on-flaky` — which is the
tool doing its job. The runs read for this note, all on 2026-09-07:

| run / job | flaky test(s) | first-attempt failure |
|---|---|---|
| 34095293937 / 101657612486 (`main` 07:24Z) | fr091 "CRM Dashboard reconciles"; smoke "dependencies view renders edges" | `apiRequestContext.get: read ECONNRESET`; `toHaveURL` 10s |
| 34106105030 / 101691466991 (PR #267) | smoke "dependencies view renders edges" | `toBeVisible` 10s |
| 34106105030 / 101700731796 (rerun) | fr040 "keeps WBS and Dependency Map…"; fr154 Inventory dashboard; marketing-campaigns "binds an approved PM receipt…" | `toBeVisible` 10s (26.7s attempt, 10.0s retry); `toContainText` 10s (15.6s / 22.8s); test timeout 60s (1.0m / 45.4s) |

None of the four tests was touched by the change under test in any of those
runs. Nothing reproduced locally, ever — the earlier note on this pattern
records fifteen idle repeats, CPU-loaded repeats and full-suite repeats.

## Evidence gathered

- **Every failing assertion sits right after the first request to a route
  handler the warm-up did not name.** Read the specs against
  `tests/e2e/warmup.setup.js`'s `ROUTES`:
  - fr040 (`tests/e2e/fr040-project-work.spec.js:17`): `/projects/[id]/structure`
    *is* warmed as a page, but the page is `'use client'` and its data comes
    from `useFetch('/api/projects/${projectId}')` and, inside `WbsCanvas`,
    `useFetch('/api/projects/${projectId}/tree')`. Neither handler is listed.
    The tree the assertion waits for cannot render until a cold handler
    compiles. This is test **#2 of the run** — the first spec after warm-up —
    which is the strongest single piece of evidence: the warm-up had just
    finished and the very next thing the suite did was compile.
  - fr154 (`tests/e2e/fr154-inventory-dashboard.spec.js:32`): the assertion is
    on the status line after `POST /api/inventory/categories`. `/inventory`
    (the page) is listed; no `/api/inventory/*` handler is.
  - marketing-campaigns (`tests/e2e/marketing-campaigns.spec.js:139`): the
    case drives `/api/platform/users/memberships`, `PATCH /api/platform/users`,
    `PATCH /api/growth/plans/[id]`, `POST /api/growth/plans/[id]/handoff`, and
    `PATCH /api/growth/campaigns/[id]` — five cold handlers in one test, which
    is why its first attempt ran into the 60s *test* timeout rather than a
    single 10s expect, and why the retry (all five now compiled) took 45s.
  - fr091's `ECONNRESET` on `page.request.get('/api/scope')` is the shape
    `tests/e2e/reconnecting-request.js` documents: the dev server dropping a
    keep-alive socket while it compiles. It was hand-fixed the same day
    (`2451d89e`, adding `/api/scope` and `/api/crm/conversations`).
  - smoke "dependencies view renders edges": `/dependencies` is listed; the
    page reads `/api/dependencies`, which is not.
- **The arithmetic.** `src/app` holds 88 `page.jsx` and 199 `route.js`
  modules. `ROUTES` held 80 URLs, of which 5 were handlers (7 after
  `2451d89e`). Each handler module compiles on its own first request; a GET to
  the page that fetches it compiles the page, not the handler.
- **It was being fixed one entry at a time.** Four commits in one day added
  handlers to the list after they flaked: PR #267 (`/audit` retention,
  `4e014b26` for `/api/growth/*`), PR #283 (LINE OA account handlers),
  `2451d89e` (`/api/scope`, `/api/crm/conversations`). With ~190 handlers still
  cold, the next spec to touch a new one was the next flake, and the list would
  have kept growing by one per red run.
- **Why "passed on retry" is the fingerprint of a compile, not of
  nondeterminism.** The retry runs against a server that has now compiled
  the module. Every retry in the table above was faster than its first
  attempt by roughly one cold compile. A product race would not be that
  regular.
- **`OPTIONS` compiles a handler without running it.** Next auto-implements
  `OPTIONS` for any route module that does not export one
  (`node_modules/next/dist/server/future/route-modules/app-route/helpers/auto-implement-methods.js`):
  it loads the module to build the `Allow` header and calls nothing in
  userland. Probed against `next dev -p 3135` in this tree:

  ```
  ○ Compiling /api/inventory/products/[id] ...
  ✓ Compiled /api/inventory/products/[id] in 819ms (119 modules)
  OPTIONS /api/inventory/products/warmup 204 in 2206ms
  GET /api/inventory/products/warmup 401 in 40ms
  ```

  No route in the tree exports `OPTIONS` or `HEAD` (grep, 2026-09-07).

## Root cause

The warm-up was a hand-maintained list of URLs, and the model behind it was
"routes the suite *navigates* to" — pages. Route handlers are separate modules
with their own first-request compile, and the list named seven of 199. Every
spec whose first action was a fetch to a handler nobody had listed yet paid
that compile inside a 10s `expect`, and on a loaded `windows-latest` runner
that is enough to miss. Which spec paid depended on file order and on which
handlers earlier specs had happened to compile — hence "rotating".

Two smaller things sat underneath and were fixed on the way here:
`next dev` evicting compiled entries after 60s idle (PR #267,
`next.config.js` `onDemandEntries`), and the keep-alive reset
(`reconnecting-request.js`). Neither explained a first-spec failure.

## Fix

- `tests/e2e/warmup-routes.js` (new) derives the warm-up plan from the
  filesystem: every `page.*` and `route.*` under `src/app`, with `(group)`
  dropped, `[param]` / `[...rest]` / `[[...rest]]` replaced by `warmup`, and
  `@slot` / `_private` skipped — the App Router's own rules. The hand list
  `ROUTES` stays, moved into the same file, for the notes on its entries and
  as the seam the unit test holds against the domain registry.
- `tests/e2e/warmup.setup.js` sends the plan: GET for pages and hand-listed
  entries (as their notes were measured), `OPTIONS` for every other handler,
  each through `reconnecting()`. 291 requests today.
- `tests/unit/e2e-warmup.test.js` proves the mapping on a fixture tree,
  checks the real tree leaves no filesystem syntax in a URL, pins GET-vs-OPTIONS,
  and names the four modules from the table above as covered without anyone
  listing them.
- The warm-up's own `test.setTimeout` is 20 min with the arithmetic in the
  file. That is a budget for compiling, not an assertion about the product;
  it cannot hide a flake because nothing under test runs inside it.

## Why not the alternatives

- **GET for handlers.** Executes 113 read handlers anonymously. Most answer
  401; a handful mint, record or append on GET (`/api/agent/heartbeat`,
  `/api/platform/api-access-keys`, `/api/platform/edge-devices/credentials`,
  `/api/plugin/auth/authorize` among the ones a grep flags). The warm-up must
  never be the thing that wrote to the database.
- **`next build && next start` for e2e.** Removes compile cost entirely and the
  config's own note names it as the day workers could go parallel. But
  `NODE_ENV=production` changes the product under test: `src/lib/db.js` refuses
  SQLite without a Postgres URL, `session-port.js` and the login cookie
  (`secure`) branch on it, `settings/page.jsx` returns null. That is a separate
  decision with its own ADR, not a warm-up fix.
- **A longer `expect` budget.** `f0d032d8` raised it to 30s the same afternoon
  with a measurement of the *warm* number for one test. With every module
  compiled up front, the cold half of that measurement no longer exists;
  whether 30s is still the right figure is a re-measurement for after this
  lands, not a reason to skip this.

## Local measurement

First full-suite run on this branch (12-core desktop, otherwise idle):

```
warmup: 291 module(s) — 99 GET, 192 OPTIONS — in 393s
  ok 1 [warmup] › warm every page and route-handler module before any spec runs (6.6m)
  4 skipped
  112 passed (10.7m)
```

0 flaky. The specs themselves took about 4 minutes once nothing compiled
inside them; on CI the same specs took 22 minutes while they did.

## CI measurement

First CI run of this plan, PR #285, run 34114907803 (windows-latest):

```
warmup: 291 module(s) — 99 GET, 192 OPTIONS — in 918s
  ok 1 [warmup] › warm every page and route-handler module before any spec runs (15.3m)
  4 skipped
  112 passed (28.2m)
```

0 flaky. 3.2s per warm-up request on the runner against 1.35s locally — the
"same per-request rate as the old list" guess in the first draft of this note
was wrong by 2.3×, and the file's comment now carries the measured figure
instead. The specs took 13 minutes after the warm-up, down from 22; the job
as a whole went from ~23.5 to 28.2 minutes, which is the compile cost moving
out of the assertions and being paid once, in the open.

The warm-up's budget is 45 minutes — 3× the measured figure — in
`test.setTimeout` in `tests/e2e/warmup.setup.js`. If it is ever exceeded, the
suite fails as one named warm-up test rather than as whichever spec came
first — which is the correct failure, and a different one from anything in
the table above.

## What this does not claim

Windows runners under concurrent load are still slower than a desktop, and a
warm page under load can still be slow. This note claims only that the
*rotating, passed-on-retry, never-reproduces-locally* pattern was the
first-request compile of an unlisted module, and that no module is unlisted
now. If a flake with that fingerprint appears again, the first question is
whether the URL it hit is in `warmupPlan()`.
