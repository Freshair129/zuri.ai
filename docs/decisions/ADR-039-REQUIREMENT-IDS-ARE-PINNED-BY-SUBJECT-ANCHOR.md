---
version: "1.3.0"
created_at: "2026-08-20T11:10:00+07:00,CLAUDE"
last_update: "2026-08-21T00:00:00+07:00,ATHER"
status: "accepted"
superseded_by: null
attributes:
  domain: "governance"
  doc_type: "architecture-decision"
  scope: "how the id contract in AGENTS.md §18 is enforced mechanically — what is pinned, what is free, and what a legitimate move has to say for itself"
---

# ADR-039 — Requirement ids are pinned by subject anchor

**Status:** Accepted (rev 1.3 — amended to keep the healthy id roster as report
health metadata rather than an INFO finding; rev 1.2 amended after merge to repay the stale-citation
debt and add a review-only statement digest without changing the blocking
anchor trade-off. Rev 1.1 was amended before merge after adversarial
verification: `roster`, strict equality for the inheritance arm, word-boundary
comparison, punctuation normalization, `--reword` / `--distinct`, a `declared_in`
row that must name the id, narrower retirement reading, and registry lookup by
basename. Every change is recorded in the decision it belongs to rather than
appended as an addendum, because the ADR had not merged.)

**Relates to:** AGENTS.md §18 (the id contract) · ADR-025 (the FEAT family) ·
ADR-004 (documentation architecture) ·
[.brain/rca/2026-08-20-an-id-moved-and-nothing-noticed.md](../../.brain/rca/2026-08-20-an-id-moved-and-nothing-noticed.md)

## Context

AGENTS.md §18 says an id is a key: documents may be moved, renamed, split or
merged, but ids may never be renumbered, reused for a different statement, or
recycled after a requirement is dropped. Every plan, annotation, test, generated
view and traceability row keys off those numbers.

Nothing enforced it. Preflight has a duplicate-id guard, and it works — but it
answers "do two documents claim this id **right now**", and a *moved* id is never
a duplicate at any single moment. The registry stays well-formed, every graph
edge still resolves, and the only thing that changed is what the number means.

It has happened twice.

**2026-08-20 (`1136863cb`, PR #88).** `FR-091` declared `SDD-049` — the CRM
conversation reader — and merged to main. PR #88, a long-running branch, then hit
its own id collision and resolved it by moving the **already-merged** statement
to `SDD-050` and taking `SDD-049` for its market-translation seam. `npm run
govern` was green throughout. `tests/e2e/fr091-conversation-inbox.spec.js:3` went
on reading `@spec SDD-049` for a subject it had never been written against, and
that stale reference survived on main until a human found it by hand.

**2026-08-15 (`4a86409ae`, PR #9).** The same failure five days earlier and
larger. A long-lived branch merged its stale whole-file copy of
`docs/PRD-SDD-v1.0.md` over main: `FR-051` and `SDD-026` were repurposed and
**fifteen** other declared ids vanished outright, so code annotated `@req FR-052`
cited ids that no longer existed. It self-healed only because the next merge
happened to carry the newer registry. Nothing reported either half.

Two things are worth stating plainly, because they shape the decision:

1. **The damage is never in the registry.** It is in the annotations that keep
   citing the old number. Both events left a live stale citation on main.
2. **A careful author is not enough.** `af0a6f0d1` is the *correct* handling of a
   collision — the later branch renumbered itself, rewriting 102 references
   across 37 files plus 8 test filenames and 4 document names — and it *still*
   left seven stale references behind, in the traces-to cells that nothing parses.

## Decision

**D1 — Pin the subject, not the statement.** `docs/.id-ledger.json` records, per
declared id, the **anchor**: the leading noun phrase of its statement —
everything before the first colon or dash, markdown stripped, punctuation
normalized away, lowercased, and capped at 60 characters **on a word boundary**.
`scripts/doc-preflight.mjs` Check 12 raises a **CRITICAL** when a recorded anchor
moves.

Punctuation is normalized rather than compared because it is presentation, like
the markdown: `(soft delete)` edited to `(soft-delete)` is a copy-edit, and the
first cut of this check called it a subject move and offered three remedies,
every one of which recorded the edit as the thing §18 forbids. The cap falls on a
word boundary for the same reason — 107 of 340 anchors were truncated mid-word,
so for those rows the pinned unit was arbitrary text rather than a phrase.

This was measured, not guessed, by replaying the first-parent history of
`docs/PRD-SDD-v1.0.md`:

| discriminator | fires | true | false |
|---|---|---|---|
| exact statement text | 23 | 6 | **17** |
| leading anchor, no prefix rule | 6 | 5 | 1 |
| **leading anchor + prefix tolerance** | **5** | **5** | **0** |
| a new id inheriting a recorded anchor | **3** | **3** | **0** |
| a pinned id vanishing | **15** | 15 | 0 |

The five anchor fires are exactly the incident set: `FR-051` and `SDD-026` at
`4a86409ae`, the same two restored at `69474d419`, and `SDD-049` at `1136863cb`.

Exact statement hashing was rejected on that 74% false-positive rate. In a
registry whose rows are 200-word prose edited on most doc-touching PRs, a gate
that cries wolf three times in four is learned as a chore inside a month — and
the chore has a one-command bypass indistinguishable from its legitimate use.
This repository has already paid for that lesson once, with `retries: 1`.

**D2 — No similarity metric, and two comparisons rather than one.** The tolerant
comparison — "does this id still stand for what it stood for" — is anchor
equality plus one clause: if one anchor's **words** are a prefix of the other's,
they name the same subject. Word boundaries, not a character count. The character
rule shipped first and was wrong in both directions: it demanded both anchors be
at least 24 characters, which excluded 100 of 340 ids from any tolerance at all
(widening "Snapshot backup" to "Snapshot backup and restore" fired a CRITICAL),
and it matched half-words.

The arm that asks whether a **new** id has taken over an **existing** subject
uses **strict equality** instead. A renumber copies the statement, so the anchors
are identical; a requirement split into slices is a normal edit that the tolerant
rule accused of being a renumber, with printed advice that could not clear it.
Replayed over the same history, strict equality still catches all three
inheritance events and nothing else.

There is no threshold to tune in either, and therefore nothing to "adjust" under
deadline pressure.

**D3 — Rewording is free.** The ledger stores anchors, never statements. Fixing a
typo, widening a rule, or expanding a rationale leaves no diff in it at all.

**D4 — Retirement is the always-available escape, and it costs nothing extra.**
The legitimate way to change what a number means is to *not* change it: strike
the statement through, say in the status cell why it stopped being true, leave
the number burnt, and take the next free one. `SEC-004` is the worked example —
its status flips, its anchor does not move, and Check 12 stays silent.

**D5 — A collision is resolved by the LATER declaration renumbering itself.**
Main is the published trunk. `af0a6f0d1` and the `FR-093/SDD-051` precedent are
the shape; PR #88 is the anti-pattern. `npm run docs:ids -- --abandon <ID> --to
<NEW-ID> --reason "…"` clears the ledger in one line, deliberately the cheapest
of the non-trivial paths, because it is the behaviour we want.

**D6 — A move that happens anyway must justify itself where a human reads it.**
`npm run docs:ids -- --declare <ID> --reason "<sentence>"` requires the id named
on the command line and a reason of at least 40 characters, and for the PRD
registry a `declared_in` pointer at a version-history row that preflight verifies
exists **and that names the id**. Checking only that some row carried that
version string let a repurpose be declared green against a two-day-old row about
entirely different requirements — leaving the human-readable PRD with no record
of the move at all, which is the one thing this arm exists to produce. There is no bulk `--force`. This mechanizes the one time a renumber was
handled completely here: PRD version-history row **1.79.0b** states the move and
its reasoning in prose — and it names `FR-093`/`SDD-051`, which is why "the row
must name the id" is the shape of the rule and not a new demand. Rows 99 and 100 — the `FR-074`/`FR-075` renumber — say
nothing of the kind, and seven stale citations from that renumber are still on
main today.

**D7 — Cover every family that has a declaration site.** `FR`, `NFR`, `BR`,
`SEC`, `SDD` (`docs/PRD-SDD-v1.0.md`), `FEAT` (`docs/FEATURES.md`), `RSK`
(`docs/appendices/E-risk-matrix.md`), `MI-RQ`
(`docs/domains/market-intelligence/SRS.md`), `ADR` and `ZV2-CR` (filename +
document H1). 339 ids on the day this was written.

`MI-RQ` matters most here. It is guarded by nothing today, it has **already** been
renumbered once — the family shipped as `FR-MI-*` / `DQ-MI-*` and was rewritten
with slots reassigned to different statements — and it is not in the doc graph, so
a graph-backed check would have shipped already blind to it. That is precisely how
this recurs. Check 12 therefore parses declaration sites directly and takes **no**
dependency on `docs/.doc-graph.json`. Adding a family is one row in
`scripts/id-anchors.mjs`, not a new code path.

**D8 — Deliberately excluded, each for a reason.** `AC` (two incompatible live
syntaxes, no single declaration site, no statement to anchor) · `DOM` (semantic
string keys, so the "two branches take the next free number" collision cannot
occur) · `PLAN-FR` / `TASK-FR` / `REQ-FR` (derived keys inheriting an FR number —
caught at the FR entry) · `W0`–`W9`, `G0`–`G5`, `B02`–`B04` (waves, gates,
batches: not ids, recorded in the ledger's `not_ids` so no future scanner adopts
them).

**D9 — The ledger is a witness, not a debt baseline.** It is named
`.id-ledger.json`, not `*-baseline.json`, because the five existing ratchets
record accepted debt and may only shrink, while this one grows as ids are
declared and no entry ever leaves. `history` is append-only: overwriting a
subject is a **changed line** in the PR diff, which is a stronger signal than any
of the five baselines achieves. The review rule is one sentence — *a `+` block of
new entries is routine; a `-` line, or a new history line under an id that
already had one, is the alarm.*

**`roster` is what makes "no entry ever leaves" a fact rather than a hope.** It
lists every id this ledger has ever pinned and is never pruned. Adversarial
verification found the promise above broken without it: deleting an id's block
turned the whole 2026-08-20 incident into a routine "this id is not pinned"
CRITICAL, whose own printed remedy re-pinned the **new** subject with reason
"declared" and exited 0 — a PR diff containing no deleted line anywhere. This file
is one 105 KB object keyed by id, so a merge conflict resolved by taking one side
reaches that state by accident, not only by intent. Now an id in `roster` with no
entry is its own CRITICAL, the writer refuses to re-pin it, and deleting the
roster line as well makes the laundering surface as a changed anchor line under
the id's own block — the alarm, as promised.

**D12 — Every escape is a named flag that writes a sentence.** `--write` refuses
three things and names the flag for each: an anchor that already stands for
something else (`--reword` if the subject's head word survived, `--declare` if it
did not), an id in `roster` whose entry is gone (restore it from git), and a new
id inheriting a sibling's subject (`--abandon` if it is a collision, `--distinct`
if the statements genuinely differ). Two of those three used to clear silently —
including the arm that names the destination of a renumber, which the routine
no-argument command switched off with nothing recorded anywhere.

**D13 — A rewording is not a move, and pretending it is teaches the override.**
`--reword <ID> --reason "<sentence>"` records an anchor change in one line and
asks for no revision row, because no number came to mean something else. It is
refused when the subject's **head word** changed — "market translation" to
"outbound reply delivery receipts" is not a rewording under any reading — and the
gate re-verifies that rather than trusting the label the writer stored. What
shipped first had no such path: a one-character hyphenation fix inside the anchor
window could only be repaired by a command that recorded it as "the move
AGENTS.md §18 forbids" and demanded a new PRD version row for it.

**D14 — Retirement is read narrowly, and every recorded retirement is justified.**
A row reads as retired when its statement is struck through or a status cell
*opens* with a retirement word. Reading the word anywhere in the trailing cells
made the risk matrix's Mitigation column — free prose about what to do with
legacy paths — decide that a live risk had been retired, and the remedy it printed
would have written that false retirement into the ledger permanently. In the other
direction, A6 asks **every** superseded or burnt entry for a reason of 40
characters, including a status flipped by hand; the only exemption is a retirement
that predates this ledger, which the genesis pass marks `pre_ledger` explicitly so
the exemption is a fact in the file rather than a shape a hand edit can imitate.

**D15 — The anchor remains blocking; the full statement digest is review-only.**
Each pinned entry also records a SHA-256 `statement_digest` of its canonical
full statement. If the digest changes while the subject anchor still matches,
preflight emits an **INFO** finding with the old/new digest and the files that
cite the id. It does not fail `--strict`, because the measured full-statement
alternative fired 23 times with 17 false positives. A human acknowledges an
intentional edit with `npm run docs:ids -- --review <ID> --reason "<sentence>"`;
the one-time `--review-baseline` operation only fills missing digests and refuses
to overwrite an existing one. An anchor move without a declared move remains a
CRITICAL. The digest is a review witness, not a semantic equivalence proof and
never a reason to skip the registry diff.

**D10 — No new FR.** Governance tooling has never carried one. The five existing
ratchet checks declared zero FRs between them, and `scripts/assert-tests-ran.mjs`
— added for exactly this class of failure — carries no `@req` at all. An FR is a
precise system behavior of the *product*; this is an enforcement of a governance
contract. Burning `FR-094` on a build script, in a change whose entire subject is
that keys are precious, would be the wrong lesson. The next free ids remain
`FR-094`, `NFR-019`, `BR-020`, `SEC-018`, `SDD-052`, `FEAT-010`.

**D11 — The writer is never part of `govern`.** `npm run docs:ids` is run by a
human. A writer inside the gate is a gate that silences itself: the run that
detects the drift would also erase the evidence of it.

## What this does not do

**It does not make a repurpose impossible, and it is not meant to.** The brief was
*visible, not impossible*. Nothing mechanically stops `--declare` on a real
repurpose — the same is true of all five existing ratchets, none of which invokes
git and none of whose baselines any test asserts. What stops it is that the move
is one conspicuous block in the diff carrying a written justification, under a
number the author was not supposed to touch, next to a CRITICAL that just turned
green. That is more than any existing baseline demands.

**A short leading label pins very little.** 30 of 340 ids put a label under 30
characters in front of a statement over 150 — `FR-030` pins `persistence` out of
222 characters — so for those rows the body can be replaced with the label kept
and nothing fires. Anchoring the whole statement when the label is short was
implemented and measured: it flips the derivation mid-comparison (widening
"Snapshot backup:" to "Snapshot backup and restore:" switches the rule, and the
two then cannot be compared at all) and it added a false positive over the
replayed history (`FR-012` at `4a86409ae`, a genuine rewording). Charging authors
for widening a phrase is the failure mode this design exists to avoid, so the
label wins and the blind spot is recorded — here, and at `anchor()` in
`scripts/id-anchors.mjs`.

**A prefix-preserving repurpose is invisible.** "Import authorization is decided
once, on the resolved target Workspace" edited to "Import authorization is
delegated to the calling route" moves the subject and not the anchor. This needs
no bad faith: two branches collide *because* they work in the same area, and
same-area statements share their opening words. The check is strongest against
the failure that actually happened twice — a stale registry snapshot merged by an
author not thinking about the id — and weakest against a deliberate in-place edit.
**A reviewer still reads the registry diff of any PR touching an already-merged
id.**

**Two clauses in the Market Intelligence SRS share a title.** `MI-RQ-033` and
`MI-RQ-211` are both "Confidence". Both are pinned, so nothing fires today, but a
future `MI-RQ` clause titled "Confidence" would be reported as inheriting one of
them. That is a fair signal about the SRS, not a defect in the check — but it is
recorded here so nobody discovers it as a surprise.

**The ten stale citations recorded at the merge boundary are now repaid.** Seven
registry traces-to cells (`NFR-015`, `NFR-016`, `SDD-043`, `SDD-044`, `SEC-015`,
`SEC-016` all naming `FR-074`/`FR-075` where the subject is now
`FR-079`/`FR-080`, plus §2.4 prose), and the three LINE binding annotation sites
were corrected in the follow-up cleanup. The historical mapping remains in the
RCA so the debt is not laundered into a clean-looking baseline. Deciding that a
citation is wrong still requires comparing topics, which no decidable rule does;
Check 12 reports citing files and the digest adds a review signal, but neither
pretends to judge semantic correctness.

## Consequences

- `npm run govern` gains ~1 second on a healthy tree; the blast-radius scan runs
  only once something has already fired.
- `docs/.preflight-report.json` records the healthy roster under
  `health.id-stability`; it is visible evidence that every family was checked,
  but it is not counted as an INFO finding. Only actionable review signals and
  blocking findings contribute to the summary.
- Two structural gaps close as a side effect: a **second** `| SDD-049 |` row in
  the PRD was invisible (`doc-graph.mjs` keeps the first and silently drops the
  rest, and no guard covered PRD rows) — Check 12 now reports the dropped row and
  says which statement the tree is actually using — and a family outside the doc
  graph had no coverage at all.
- A registry that is not at its recorded path is looked for by basename before
  anything is reported, and a registry that is genuinely gone is **one** finding
  about the registry rather than one per id it used to declare. Moving a document
  is free (§18); a check that charged fourteen CRITICALs for a `git mv` would be
  contradicting the contract it exists to enforce.
- `npm run docs:ids` is documented where an author will meet it — the CLAUDE.md
  toolchain block and the AGENTS.md §18 cost table — because A3 makes it mandatory
  for every future id declaration and `govern` deliberately does not run it.
- Declaring a new id costs one command, `npm run docs:ids -- --write`, and
  produces one `+` block. Over the project's life there have been 152 new-id
  declarations against 5 anchor events — a red line in this file is genuinely
  about a once-every-five-weeks occurrence, and every time it has occurred it was
  an incident.
