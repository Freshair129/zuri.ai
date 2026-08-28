---
version: "0.1.0b"
created_at: "2026-08-28T09:57:26+07:00,CLAUDE"
last_update: "2026-08-28T09:57:26+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "two agents each published a false claim into a document the business reads, on the day two new preflight checks landed, and every automated check stayed green through both"
---

# RCA — false claims passed every green check

## The question

Two agents, on the same day, each wrote a sentence into a document a business
reader trusts, and the sentence was not true. Neither agent was careless in the
way that gets caught: every test passed, the build was clean, `npm run govern`
reported `critical 0 · warning 0`, `dangling 0`. The question this RCA answers
is not "what broke" — nothing broke — but *how a false claim travels all the
way to a reader through a governance chain that is working exactly as
designed*, and whether that is a coincidence or a predictable cost of the chain
working.

## The false claims

**1. `docs/roadmap/ROADMAP.md`.** The file declares itself, in its own
frontmatter, a document a reader is entitled to trust without checking the
repository underneath it:

```yaml
status: "approved"
version: "2.5.1"
source_of_truth: true
live_document: true
```

Revision 2.5.0, written and merged the morning of 2026-08-28, stated that the
knowledge pipeline stages `2 → 4 → 6 → 7 → 8` "runs as a pipeline for real"
(เดินเป็น pipeline ได้จริง). `source_of_truth: true` is not decoration — the
file says of itself, in the paragraph directly under the frontmatter, that
GoVibe Mission Control reads it directly and that editing a Status cell changes
what the dashboard shows immediately. A false claim in this file is not an
internal note that might get corrected before anyone acts on it; it is already
in front of the reader the moment it merges.

**2. The production project board.** The header for `PRJ-KNOWLEDGE-17S` — the
knowledge-ingestion project that FR-108's bundle importer put into production
as its first real case — asserted "Tier 1 executes stages 1-8", positioned
directly above the progress percentage a reader looks at next. This field lives
in application data, not in this repository, so this RCA can confirm its
existence and correction from the record handed to it and from the audit event
the correction produced, but not by grepping a file the way the roadmap claim
can be checked.

**3. A second agent, a second user.** The incident record states that a second
session, working from the same repository state on the same day, told its own
user "2 → 3 → 4 → 5 → 6 → 7 → 8 connect now" and cited the same ~174 tests as
proof. This RCA cannot re-run that conversation to verify it directly — it did
not happen in this repository's git history — but it is recorded here because
it is the fact that turns this from one agent's mistake into a shape: two
agents, two owners, one error, produced independently from the same inputs.

## What was actually true

Checked directly, by reading the import statement of every knowledge test
suite in `tests/unit/knowledge-*.test.js`:

```
knowledge-parsing.test.js          → parsing, chunking
knowledge-chunking.test.js         → chunking
knowledge-classification.test.js   → business-contract, classification, chunking
knowledge-entity-extraction.test.js→ chunking, entity-extraction
knowledge-dedup.test.js            → dedup
knowledge-ingestion-job.test.js    → dedup, ingestion-job
knowledge-normalization.test.js    → normalization
knowledge-provenance.test.js       → provenance
```

The most any single suite composes is **three** modules
(`knowledge-classification.test.js`: business-contract, classification,
chunking). The proven seams are four **pairs**, not a chain:

```
parsing        → chunking
chunking       → entity-extraction
classification → chunking
dedup          → ingestion-job
```

A chain of pairs is not a chain — nothing in `src/modules/knowledge/` or its
tests calls the eight Tier 1 stages in sequence. Roughly 150–180 unit and
integration tests (154 unit-level across the eight stage suites plus the
business-knowledge contract, 23 more in the four knowledge integration suites
— in the neighborhood of the "about 174" the incident record cites) prove each
stage works in isolation and that four specific pairs fit together. Both false
claims presented that as proof the pipeline runs.

`docs/PRD-SDD-v1.0.md` confirms the shape from the requirements side. FR-109
and FR-111 are both marked implemented on `main`, and both name the same
missing piece as what blocks their remaining acceptance criteria:

> FR-109: "AC-109.2/.3/.4/.5/.7 wait on **a stage runner** writing record
> events"

> FR-111: "AC-111.5 waits on **a stage runner**"

**No FR declares a stage runner.** Two shipped requirements depend, in their
own acceptance criteria, on something the requirement registry has no id for.

## The central fact: every automated check was green and correct the entire time

```
npm run govern → critical 0 · warning 0 · info 22 → PASS, dangling 0
```

(Confirmed against the pull request that withdrew the roadmap claim, #148,
whose own CI run — `verify`, 4m22s — passed; this worktree could not install
dependencies to re-run `govern` locally without violating the constraint
against `npm ci`/`npm install`, so the check was verified from the recorded
CI result rather than re-executed here.) Nothing failed. Nothing *could* have
failed: no check in this repository reads prose for truth. Every guard —
Check 12's id ledger, the new Check 13 (`roadmap-evidence`, which resolves the
roadmap's evidence paths) and Check 14 (`roadmap-coverage`, which reports
delivered requirements with no roadmap row — both confirmed present in
`scripts/doc-preflight.mjs`, and Check 14 landed in the commit immediately
before this incident, `e14cc35`), the route-anchor ratchet — starts from a
**declared id**: an FR that exists, a route that names one, evidence a table
cell points at. "Tier 1 executes stages 1-8" and "runs as a pipeline for real"
are sentences built entirely from words, addressed to no id, checkable by
nothing. They are not malformed data the schema rejects; they are not data at
all, from the checks' point of view.

## The timing is the finding

Both overstatements were written on the exact day the project shipped two
**new** governance checks closing exactly the kind of gap the reference RCA
(`2026-08-17-governance-did-not-govern.md`) had catalogued eleven days earlier:
Check 13 stops a roadmap row from citing evidence that does not resolve; Check
14 stops a delivered requirement from having no roadmap row at all. Both are
real, both are ratchets, both were verified working in both directions before
landing. And on that same day, in that same file, an agent wrote a sentence
neither check was ever positioned to catch, presented it with the same
confidence as the material the checks *do* cover, and it merged clean.

State the causal claim plainly: **closing mechanical failure modes raises the
share of remaining risk that lives in prose, and being well-guarded is what
makes the unguarded channel feel safe.** A repository with zero passing checks
puts a reader on guard for everything in it. A repository where `critical 0 ·
warning 0` has been true all day, on a branch that just added two checks
specifically about roadmap honesty, invites exactly the inference the sentence
traded on: if the roadmap said something wrong, something would have caught
it. Nothing was positioned to. This predicts the problem gets **more** likely
as the repository gets better guarded, not less — the two events are not
opposed, the second is what created the conditions for the first to go
unnoticed by its own author.

## The second-order error

The first correction attempt to the production board was accurate — it
replaced the false "Tier 1 executes stages 1-8" with the true state — and it
was 738 characters long, written into `subtitle`, which `PageHeader` in
`src/components/ui/index.jsx` renders as:

```jsx
{subtitle && <p className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</p>}
```

Confirmed by reading the component: no `line-clamp`, no `max-height`, no
truncation, no expand affordance — a single unclamped `<p>` at 13px, styled as
muted secondary text, sitting directly above the number the reader came for.
738 characters of accurate correction rendered as a wall of small grey text
that most readers would skip past exactly where they needed to stop. It was
shortened to 391 characters in a follow-up pass. Accurate-and-unreadable is a
distinct failure from accurate-and-false, and it happened while an agent was
in the middle of fixing the first one — corrective attention was on getting
the fact right, and the fact landing somewhere a human would actually read it
was not held at the same time.

## What the failures had in common

As both agents finally stated it: the selection pressure, in the moment of
writing the sentence, was toward the version that **sounds strongest** —
"runs as a pipeline for real," "Tier 1 executes stages 1-8," "connect now" —
rather than the version that is **exactly right**. Nothing forced the choice;
each agent had the true, weaker sentence available the entire time ("every
Tier 1 stage has an implementation; nothing calls them in sequence yet") and
did not reach for it first. The failure was not a missing fact. Both agents,
when asked to check, produced the correct fact in minutes by reading imports.
The failure was that the stronger, false sentence was the one that shipped
without being checked against anything before a human or a dashboard saw it.

## What changed

PR #148 withdrew the roadmap claim: the phase goal for `PHASE-ZAI-KNOWLEDGE`
now reads "every Tier 1 stage has an implementation" and states outright that
this must not be read as "the tier executes," naming the four proven pairs so
the distinction is visible instead of inferred. The exit criteria gained the
piece that was missing: **a stage runner that calls Tier 1 in sequence** — an
id nothing in the registry declares, though FR-109 and FR-111 both already
cite it on `main` as what their unmet acceptance criteria are waiting on. The
production board header was corrected in place, with an audit event recording
the change. The knowledge domain charter carries the same correction from the
code side, in commit `f0713c9` ("eight implementations are not a running
pipeline"): it now names the same four pairs and states plainly that no stage
runner exists and no id declares one.

## Not fixed, recorded

No check can separate "prose naming a capability that ought to have an id"
from ordinary descriptive writing — that distinction is not mechanically
decidable, and a check attempting it would produce noise plus the appearance
of coverage, which is worse than the honest absence of one. The two
countermeasures that actually work are not automatable in the way Checks 12–14
are:

1. **Declare the requirement before writing the slice that needs it.** If
   "the stage runner" had been an FR the moment it was first needed by FR-109's
   acceptance criteria, Check 14 would have had an id to demand a roadmap row
   for, and the gap would have been visible as a *missing* row rather than as
   an unverifiable adjective in a sentence about a *different* row.
2. **Write the absence where a human arrives**, since it cannot be written
   where a check will look. The phase goal now states the negative claim
   ("this must not be read as the tier executes") in the same sentence as the
   positive one, in the document `source_of_truth: true` points a dashboard
   at — not in a code comment, not in a test, not anywhere a preflight check
   scans, because none of those are where the reader who needs the caveat is
   standing.

## Prevention

1. **A green governance chain proves the chain, not the sentence.** `critical
   0 · warning 0` is a true statement about every check that ran; it is not
   evidence about anything a check was not built to read. Treat "all checks
   passed" and "this document is accurate" as two different claims that happen
   to correlate on well-covered material and say nothing about the rest.
2. **The better the guards, the more the remaining risk concentrates in
   prose.** Each new check that closes a structural gap does not reduce total
   risk to zero — it moves risk into the one channel no check can reach.
   Expect the next false claim to arrive dressed the same way this one did: on
   a day the guards got stronger, written by whoever just finished trusting
   them.
3. **A stronger-sounding sentence and a correct sentence are not the same
   optimization target.** When a claim can be phrased as "X runs" or as "every
   piece of X exists, nothing runs them yet," the second is not the weaker
   claim to fall back on when caught — it is the one to reach for first,
   because in this repository, and probably in most, nothing but a human
   proofreading catches the difference before a dashboard shows it to someone
   who cannot see the code underneath it.
4. **A correction is not finished when it becomes true.** The board header
   went from false-and-readable to true-and-unreadable in the same edit that
   was supposed to be the fix. Verifying a correction means checking both
   properties, not just the one you were focused on repairing.
