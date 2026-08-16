---
version: "0.1.0b"
created_at: "2026-08-16T23:55:00+07:00,CLAUDE"
last_update: "2026-08-16T23:55:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "testing"
  doc_type: "root-cause-analysis"
  scope: "npm run test:e2e can report success having executed no tests"
---

# Incident — a green exit code with zero tests executed

## Symptom

`npm run test:e2e` exits **0** without running a single test when anything else
is already listening on port 3100.

`playwright.config.js` sets `webServer.reuseExistingServer: false`, so Playwright
aborts with `http://localhost:3100/overview is already used`, prints **no test
lines at all** — and still returns a success exit code.

Observed during this session with an orphaned `next dev` process holding the
port.

## Why this is worse than a failing test

A failing test is loud and specific. This failure mode is:

- **silent** — the summary line is absent, not wrong;
- **green** — anything reading the exit status concludes the suite passed;
- **invisible to skimming** — a reader scanning for "N failed" finds nothing,
  because there is no summary at all.

Every automated consumer — CI, a wrapper script, an agent reporting "e2e green" —
is misled. In this very session it was caught only because a reviewer noticed the
output contained no test lines, not because any check fired.

It is also the exact failure that would mask the *other* e2e incident recorded in
this batch: a suite that never runs cannot reveal cross-spec interference.

## Root cause

The `webServer` startup failure is not propagated to the process exit code.
Whether that is a Playwright version behaviour, a configuration property, or
something the repository's own script should assert has not been determined —
that is the first task of any fix, and it must begin by reproducing the
condition rather than assuming a cause.

## Aggravating factor

`reuseExistingServer: false` guarantees a collision whenever a stray dev server
survives — and stray servers are routine here, since the preview tooling and
`npm run dev` both bind 3100. The setting is defensible (a reused server may have
the wrong `DATABASE_URL` and `ZURI_LOCAL_DEMO_AUTH`), but combined with a
swallowed failure it converts a common environmental hiccup into a false green.

## Recommended fix

1. Reproduce first: occupy 3100, run `npm run test:e2e`, and check `echo $?`.
2. Make a failed `webServer` start exit non-zero.
3. Add a **zero-tests-executed guard** so this whole class is caught regardless of
   cause — a run that collects nothing must fail.
4. Consider failing fast with a message naming the port and the occupying
   process, instead of a generic "already used".
5. Check whether `npm test` has the same property — can vitest exit 0 having
   collected no test files?

## Prevention

- **Exit code 0 must mean "the work ran and passed", never "the work did not
  run".** Any harness that can succeed without doing anything needs an explicit
  did-anything-happen assertion.
- **Read the summary line, not the exit code.** In this session the only
  detection signal was a human-shaped observation: *the output had no test
  lines*. That should be a machine check, not a lucky glance.
