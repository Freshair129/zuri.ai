---
version: "0.1.0b"
created_at: "2026-08-17T06:05:00+07:00,CLAUDE"
last_update: "2026-08-17T06:05:00+07:00,CLAUDE"
status: "open"
superseded_by: null
attributes:
  domain: "test-harness"
  doc_type: "root-cause-analysis"
  scope: "six e2e workers queueing behind one dev server — parallelism that bought nondeterminism and no speed"
---

# Incident — the flaky gate fired for real, and it was not the change under test

**Status: RESOLVED 2026-08-17.** Root cause measured, not inferred: the suite ran
six workers against a single Next dev server, so they queued rather than
parallelised. Fixed with `workers: 1`, which costs two seconds.

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

## The measurement that settled it

The flakiness would not reproduce on an idle machine, so the first step was to
**reproduce it deliberately** — eight CPU burners alongside the suite. Full
suite, `--retries=0`, 12-core machine:

| machine | workers | result | wall clock |
|---|---|---|---|
| idle | 6 (default) | 43 passed | **154s** |
| idle | **1** | 43 passed | **156s** |
| loaded | 6 (default) | **1 FAILED** | 264s |
| loaded | **1** | 43 passed | 275s |

The decisive row is the second. **Two seconds between six workers and one, on an
idle machine.** Six-way parallelism was buying 1.3%, which means the workers were
never running in parallel in any useful sense — `webServer` starts one Next dev
server and all six queue behind it. Under load that queue grows past the 10s
`expect` budget, and the suite reports compile-and-queue latency as a failure.

Parallelism here was not buying speed. It was buying nondeterminism.

That reframes the earlier symptoms: the three "unrelated" specs that flaked were
not three problems, and the two that survived the warm-up were not a separate
mystery. They were whichever tests happened to be at the back of the queue.

## Fix

`workers: 1` in `playwright.config.js`, with the table above recorded beside it
and the number to beat (154s) written down, so raising it later requires
re-measuring rather than guessing.

The warm-up project is kept. It was not sufficient alone — that was the honest
finding at the time — but it removes cold compilation from inside the tests,
which is worth having independently of the queue.

Proven end to end: `npm run test:e2e` — the real gate command, with
`--fail-on-flaky` and the retry-labelling still enabled — run under the **same**
synthetic load that had just failed it: exit 0, 43 passed, zero flaky, 245s.

## What was never needed

Two remedies were on the shortlist and neither was used.

**Warming dynamic routes.** `fr040` hits `/projects/[id]/…`, which the warm-up
cannot reach without a real id, and that looked like the obvious next step. It
was not the cause — that spec failed because it was at the back of a queue, not
because its route was cold.

**Raising `expect.timeout` from 10s.** This was third on the list precisely
because it is the move that makes a red gate green without changing anything
real. It stayed unused, and should stay unused: 10s is a fine budget for an
assertion once the thing being asserted is not waiting behind five other
workers.

## What must not happen

Raising `expect.timeout` until it goes green, or dropping `--fail-on-flaky`.
Both restore the exact property the gate was built to remove: a degrading suite
that reports success.

Nor should `workers` be raised back without re-measuring. The number to beat is
154s, and it is written in the config next to the table. A future change might
genuinely make the workers independent — a dev server per worker, or a
production build instead of `next dev` — and then parallelism would buy
something. Until someone measures that, it does not.

## The general lesson

**Reproduce before diagnosing, even when reproducing means building the
conditions yourself.** The flakiness did not appear on an idle machine, so the
first real step was eight CPU burners — not a fix, not a theory, a reproduction.
Everything before that in this document was inference, and one of the inferences
(cold compilation) was half wrong.

And the finding that mattered was not the failure. It was the **two seconds**
between six workers and one on an idle machine — a number nobody would have
looked at while chasing a failure, and the number that explained everything.
