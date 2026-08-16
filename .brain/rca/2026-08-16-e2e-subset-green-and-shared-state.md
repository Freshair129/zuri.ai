---
version: "0.1.0b"
created_at: "2026-08-16T23:53:00+07:00,CLAUDE"
last_update: "2026-08-16T23:53:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "testing"
  doc_type: "root-cause-analysis"
  scope: "every agent reported e2e green; the full suite was red"
---

# Incident — "e2e passes" was true for everyone and false for the suite

## Symptom

Seven agents and two adversarial gates reported the end-to-end suite green
across a multi-wave build. The orchestrator ran the **whole** suite before
opening the PR:

```
3 failed, 7 passed
```

Among the failures was `tests/e2e/fr045-files.spec.js` — **byte-identical to
HEAD**, unchanged by any task in the build.

## Root cause — two independent causes, one symptom

### 1. Everyone ran a subset

Each task ran only the specs it owned, plus perhaps one neighbour. That is
exactly what each was asked to do, and each report was honest. No individual run
was wrong; the aggregate conclusion was.

The failure mode is structural, not careless: a worker verifying its own slice
cannot observe interference it causes elsewhere, and a reviewer verifying a wave
sees only that wave's specs. Nobody's brief said *run everything*.

### 2. The new specs mutated state the old specs assert on

`tests/e2e/global-setup.js` deletes and recreates `prisma/e2e.db` **once per
run**, not per spec file. All specs then share one database and one dev server.

The new specs asserted on **global counts** (`No project · 2`,
`toHaveCount(2)`) and used **fixed artifact names**. Both break under two
conditions that occur routinely:

- another spec adds a file to the same seeded Business;
- `playwright.config.js` sets `retries: 1`, and the database is **not** reset
  between a failed attempt and its retry — so a test that fails *after* creating
  its artifacts creates them again, permanently invalidating its own counts and
  poisoning every later spec in that invocation.

The second is self-inflicted: a spec can break itself on retry with no other
spec involved.

Investigation confirmed there is no free Business to escape to — only `BUS-001`
has a Membership, so every spec is forced onto the same one, and
`PRJ-B01-TRANSFORM` is the only seeded Project.

## Diagnosis, step by step

```
fr045 alone,          --workers=1  → 2 passed
fr041 alone                        → 3 passed
fr058 + fr045,        --workers=1  → 1 failed, 2 flaky, 1 passed
fr058+fr059+fr045+fr041, default   → 3 failed, 7 passed
fr058+fr059+fr045+fr041, workers=1 → 2 failed, 2 flaky, 6 passed
```

Each spec passes alone; combinations fail; the failures move with order. That is
shared mutable state, not a code regression — and serialising did not fix it,
which ruled out worker parallelism as the cause and pointed at accumulation
within a single run.

## Fix

Unique artifact names generated **inside the test body** (so retries produce
fresh ones), and assertions scoped to those named artifacts instead of to totals:

| before | after |
|---|---|
| `getByText(/No project · 2/)` | assert the heading exists, then assert **this test's two named files** are inside that group's container |
| `expect(openLinks).toHaveCount(2)` | collect hrefs, assert the array **contains both exact URLs** |

Both replacements are stronger than what they replaced: the first proves these
files were grouped correctly rather than inferring it from an assumed baseline
of zero; the second validates both exact hrefs instead of prefix-matching one.

Verified with six consecutive full-suite runs — four at default workers, two at
`--workers=1` — all **39 passed, 0 failed, 0 flaky**, then confirmed
independently by the orchestrator.

## Prevention

1. **A wave is not verified until the full suite runs.** Subset-green is the
   default outcome of delegated work and must be closed by an explicit
   whole-suite gate before merge.
2. **A shared-database e2e spec must own its data by name, never by count.**
   `toHaveCount`, "the first card", and fixed titles are order-dependent
   assertions wearing a passing badge.
3. **Retries do not reset the database.** Any spec that creates data must be
   safe to run twice against the same database — `retries: 1` guarantees it will
   be, eventually.
4. **`flaky` is a failure.** Playwright's summary line reports it separately from
   `failed`; a report that quotes only "N passed" hides it.

## Related, still open

`smoke.spec.js`'s FR-017 project wizard creates a Project with a fixed name and
no uniqueness suffix — the same latent pattern, not yet manifesting. The FR-018
excel-intake test in the same file already suffixes with `Date.now()`, which
shows the convention existed and the new specs simply did not follow it.
