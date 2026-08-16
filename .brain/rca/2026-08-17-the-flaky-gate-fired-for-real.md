---
version: "0.1.0b"
created_at: "2026-08-17T06:05:00+07:00,CLAUDE"
last_update: "2026-08-17T06:05:00+07:00,CLAUDE"
status: "open"
superseded_by: null
attributes:
  domain: "test-harness"
  doc_type: "root-cause-analysis"
  scope: "the e2e suite degrades under machine load; partly diagnosed, partly open"
---

# Incident — the flaky gate fired for real, and it was not the change under test

**Status: OPEN.** The warm-up below removed roughly half the flakiness. The
remainder is not yet diagnosed. This record exists so the next person starts
from evidence instead of repeating it.

## What happened

`--fail-on-flaky` (added 2026-08-17, PR #38) failed the build on the FR-062
branch: three specs passed only on retry, all with the same shape —
`Timed out 10000ms waiting for expect(locator).toHaveURL(...)` — and none of
them touching the code under change.

## First finding: it was not the change

A control run of the full suite on the **unchanged tree**, same machine, same
session, also flaked. So the branch is exonerated and the suite is not
deterministic under load.

This is the second time in one session that a control run overturned the
obvious conclusion. Both times the trap was the same: the confounder is *when*
you ran it, not *what* you ran. Caches warm, machines get loaded, and a
before/after comparison taken hours apart is not a comparison.

## Second finding: some of it is cold compile, and that part is fixed

Next.js compiles a route on its first request in dev. `webServer.url` warms
exactly one route (`/overview`); every other first navigation paid the compile
cost *inside a test*, where `toHaveURL` allows 10s.

`playwright.config.js` had already committed to the remedy in writing — "if
cold-compile flakes reappear, the fix is a warm-up step, not re-hiding them
behind a silent retry" — so: a `warmup` setup project that every spec depends
on, requesting all 25 registry routes before any test runs.

Result: **4 flaky → 2 flaky.** Real, and not enough.

The warm-up list is literal because the Playwright file is CommonJS and
`@/config/domains` pulls in ESM-only lucide-react.
`tests/unit/e2e-warmup.test.js` compares the list against the registry, so a new
sub-domain fails a unit test instead of becoming the next flake — and it also
asserts the project is actually wired as a dependency, because a warm-up nothing
depends on warms nothing.

## What is still open

Two survivors, both at ~28s on the first attempt:

- `fr040` — `getByRole('tree', {name: /work breakdown structure/i})` not visible
  in 10s. A **dynamic** route (`/projects/[id]/...`) that the warm-up cannot hit
  without a real id.
- `fr044` — expects a redirect to `/login`, still on `/overview` after 10s.
  Not obviously a compile problem; possibly session-state timing.

Leads, in order of likely value:

1. Warm dynamic routes too, using ids the seed guarantees.
2. Ask whether a 10s `expect.timeout` is the right budget for a dev server, or
   whether these assertions should await a navigation rather than poll a URL.
3. Check whether the suite is contending for the single dev server across
   workers — the first-attempt durations (~28s) suggest queueing, not compiling.

## What must not happen

Raising `expect.timeout` until it goes green, or dropping `--fail-on-flaky`.
Both restore the exact property the gate was built to remove: a degrading suite
that reports success. The gate is currently doing its job — it is telling us the
suite is not trustworthy, and it is right.
