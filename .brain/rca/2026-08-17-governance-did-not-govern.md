---
version: "0.1.0b"
created_at: "2026-08-17T00:40:00+07:00,CLAUDE"
last_update: "2026-08-17T00:40:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "the doc-before-code rule was a convention in a markdown file, not a gate"
---

# RCA — nothing forced doc-before-code

## The question

The owner asked, before adding a new domain: *is there governance that actually
**forces** documentation before code?* `CLAUDE.md` says so plainly, under a
heading that promises exactly this:

> **Adding a feature — why you cannot "just write code"**
> Nothing stops you typing code. What the guards stop is **landing** code the
> system cannot account for — every gate below is a preflight/CI failure, not a
> convention.

The answer is no. Every clause of that paragraph was false, in three independent
ways. Each one alone is enough to defeat the rule; all three were present.

## Cause 1 — nothing ran the guards

```
.github/workflows        does not exist
.git/hooks               no active hook (samples only)
core.hooksPath           unset
package.json lifecycle   postinstall = prisma generate   (nothing else)
```

`docs:preflight` and `docs:check` were commands a person had to remember to
type. There is no CI in this repository, so the sentence "every gate below is a
preflight/**CI** failure" referred to CI that does not exist.

Every merge in this session passed the governance chain because **I chose to run
it**, not because anything required it. That is not a gate; it is a habit, and it
leaves with whoever had it.

## Cause 2 — preflight reported CRITICALs and exited 0

`scripts/doc-preflight.mjs:408`:

```js
if (process.argv.includes('--strict') && report.summary.critical > 0) process.exit(1)
```

`package.json` ran it **without** `--strict`:

```
"docs:preflight": "node scripts/doc-preflight.mjs"
```

So even when the guard fired, the command succeeded. Measured directly:

```
critical 1 · warning 0 → CRITICAL
EXIT (no --strict) = 0
EXIT (--strict)    = 1
```

This had already happened in front of me earlier the same day: preflight printed
`critical 2 → CRITICAL` and the chained command carried straight on to the next
step. I read the output and acted on it — a script or an agent reading the exit
code would not have.

## Cause 3 — the guards only fire on code that opts in

This is the deepest one, and it is the same shape as the drift RCA from the day
before: *generated guarantees consistency with the generator, not with the
world.*

Every existing check keys off an **annotation**. `@req FR-999` naming an
undeclared id is a CRITICAL — but a file naming **nothing** produces no finding,
because there is nothing to check. Unannotated code is not wrong; it is invisible.

Proven by experiment. A new page with no `@req`, no FR, no note, no test:

```
$ npm run docs:preflight
critical 0 · warning 0 · info 13 → PASS

$ npm run docs:graph && npm run docs:preflight && npm run docs:check
critical 0 · warning 0 · info 13 → PASS
doc-graph is up to date
```

The orphan even landed **in the graph**, wearing an ownership edge that made it
look accounted for:

```json
{ "id": "route:page:/business-home", "type": "route",
  "path": "src/app/(pm)/business-home/page.jsx" }
edges: [{ "from": "route:page:/business-home", "to": "domain:project-manager",
          "type": "owned_by", "source": "charter-glob" }]
```

The `owned_by` edge comes from a charter path glob, so it attaches to any file in
the lane whether or not it means anything. A reader glancing at the graph sees a
route with an owner and no complaint anywhere.

This is not a rare corner. **47 of 97 routes carry no requirement anchor** — the
condition is the repository's normal state, which is precisely why nothing
noticed it.

## Why it survived this long

The three causes hide each other. Anyone testing cause 3 by running preflight
sees `PASS` and concludes the code is fine. Anyone worried about cause 2 observes
that preflight *has* a strict mode and assumes it is used. Anyone assuming cause
1 is handled sees a governance chain documented in `CLAUDE.md` in imperative
language and reasonably believes it runs somewhere.

The documentation was also actively misleading rather than merely silent: it
described the enforcement as existing, in bold, under a heading that answers the
exact question. A rule stated confidently enough stops being audited.

## Fix

**Cause 2 — make the guard fail.**
`docs:preflight` now runs with `--strict`. The non-failing form is kept as
`docs:preflight:report` for when you want the findings without the exit code.

**Cause 1 — make something run it.**
Added `.github/workflows/governance.yml`: `npm ci` → `npm test` → `npm run build`
→ `npm run govern`, plus a separate job for the **full** e2e suite. A final step
fails if `govern` rewrote any committed generated file, so a branch cannot ship a
stale graph. Also added `npm run govern` as the single chain — `docs:graph &&
docs:check && docs:preflight` in the order the checks actually require, since two
preflight checks read the graph and are wrong against a stale one.

**Cause 3 — make silence visible, without a 47-route retrofit.**
New preflight check: a route whose code file implements no declared requirement
is an **unanchored route**. Because 46 such routes predate the check, it is a
**ratchet**: `docs/.route-anchor-baseline.json` records the accepted debt, and
any orphan *not* in that list is a CRITICAL. The baseline may only shrink — a
route that becomes anchored is reported so the entry gets removed, and the check
says in its own message that widening the baseline to silence a new route is the
one thing you must not do.

Verified in both directions:

```
clean tree          critical 0 · info 14 → PASS      govern EXIT=0
with a new orphan   critical 1 → CRITICAL            govern EXIT=1
                    [CRITICAL] route-anchor: 1 route(s) implement no
                    declared requirement — src/app/(pm)/business-home/page.jsx
```

## Not fixed, recorded

- **`npm test` can exit 0 having run nothing.** `npx vitest run -t "NO_MATCH"`
  returns **exit 0** with `116 skipped (116) · 792 skipped (792)`. CI runs
  `npm test` with no `-t`, so the pipeline is not exposed, but the harness can
  report success having executed zero tests. (The related claim about
  `npm run test:e2e` exiting 0 on a port collision did **not** reproduce —
  Playwright 1.49.1 exits 1 there, and on a non-matching grep, and on a
  non-existent spec path.)
- **The `owned_by` charter-glob edge implies accountability it does not
  establish.** It attaches to every file under a lane's path glob. Worth
  distinguishing "in this lane" from "accounted for" in the graph vocabulary.
- **CI itself is unverified.** GitHub Actions cannot be executed from here. Every
  command the workflow runs has been run locally and passes; the workflow's
  behaviour on the runner has not been observed and should be watched on its
  first pull request.

## Prevention

1. **A guard that cannot fail the build is a report, not a guard.** Check the
   exit code, not the output, before believing any check enforces anything.
2. **Enforcement claims in documentation must name the mechanism that enforces
   them.** "This is a CI failure" is a testable statement — test it.
3. **Opt-in guards miss exactly the code that most needs catching**, because the
   author who skips the FR also skips the annotation. Guards over *absence* need
   a ratchet and a baseline; guards over *presence* are easy and insufficient.
4. **When adopting a rule for a repository, add its enforcement in the same
   change.** ADR-025's lane rules got real guards on day one. The
   doc-before-code rule never did, and nobody noticed for as long as someone
   diligent kept running the commands by hand.
