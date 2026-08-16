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

## Third finding: CI does not reproduce it

The same suite, same commit, on `windows-latest` in GitHub Actions: **green,
zero flaky**, 7m12s ([run](https://github.com/Freshair129/zuri.ai/actions/runs/31976784247)).
The FR-061 PR's e2e job was also green the same day, *before* the warm-up
existed.

So the nondeterminism is a property of the **local development machine under
sustained load** — hours of back-to-back builds, vitest runs and e2e runs — not
of the suite on dedicated hardware. That reorders the leads below: this is
probably resource contention, not a logic race.

It also means the gate is not currently blocking anything on CI, which is the
only place it gates a merge. Locally it is telling the truth: on a loaded
machine this suite is not trustworthy, and a developer who sees it flake should
believe it rather than re-run until green.

## What is still open

Two survivors, both at ~28s on the first attempt:

- `fr040` — `getByRole('tree', {name: /work breakdown structure/i})` not visible
  in 10s. A **dynamic** route (`/projects/[id]/...`) that the warm-up cannot hit
  without a real id.
- `fr044` — expects a redirect to `/login`, still on `/overview` after 10s.
  Not obviously a compile problem; possibly session-state timing.

Leads, reordered after the CI finding:

1. **Worker contention against the single dev server.** First-attempt durations
   were ~28s for an assertion with a 10s budget — that is queueing, not
   compiling, and it fits "only under load" exactly. Try `workers: 1` locally
   and see whether it goes away; if it does, the question is whether the default
   worker count is right for a suite sharing one dev server and one SQLite file.
2. Warm dynamic routes too, using ids the seed guarantees (`fr040` hits
   `/projects/[id]/...`, which the warm-up cannot reach).
3. Only then ask whether 10s is the right `expect.timeout` for a dev server —
   and if the answer is yes, raise it as a considered decision with a reason,
   not as a way to get green.

## What must not happen

Raising `expect.timeout` until it goes green, or dropping `--fail-on-flaky`.
Both restore the exact property the gate was built to remove: a degrading suite
that reports success. The gate is currently doing its job — it is telling us the
suite is not trustworthy, and it is right.
