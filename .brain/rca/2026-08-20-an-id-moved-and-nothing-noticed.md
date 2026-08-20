---
version: "1.0.0"
created_at: "2026-08-20T11:20:00+07:00,CLAUDE"
last_update: "2026-08-20T11:20:00+07:00,CLAUDE"
status: "accepted"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "an already-merged requirement id was renumbered by a later branch, twice, and every check stayed green"
---

# RCA — an id moved and nothing noticed

## What happened, twice

### Event 1 — 2026-08-15, `4a86409ae` (PR #9)

A long-lived branch merged its **stale whole-file copy** of
`docs/PRD-SDD-v1.0.md` over main. In one commit:

- `FR-051` stopped meaning "Production Supabase tenant isolation…" and started
  meaning "Zuri-branded entry landing…".
- `SDD-026` stopped meaning the private `zuri_core` schema and started meaning
  the `EntryShell` landing variant.
- **Fifteen** other declared ids — `FR-052`…`FR-055`, `NFR-011`…`NFR-013`,
  `BR-012`…`BR-014`, `SDD-027`, `SDD-028`, `SEC-010`…`SEC-012` — disappeared from
  the registry entirely.
- `SEC-010`'s committed status silently regressed from "…live runtime-login
  isolation complete" back to "…live runtime-login and LINE canary pending".

For the duration, `git grep -l FR-051 -- src tests` returned **two disjoint
sets** of files: the landing set and the Supabase-isolation set. One id, two
subjects, live on main at the same commit. Code annotated `@req FR-052` cited an
id that no longer existed in the registry — a condition preflight is supposed to
call a CRITICAL.

It self-healed at `69474d419` (PR #12) only because the next merge happened to
carry the newer registry. Nothing detected any of it.

### Event 2 — 2026-08-20, `1136863cb` (PR #88)

`fdffad7a9` declared `SDD-049` = "The conversation reader is one composed read
model…" (owner `FR-091`) and merged to main.

PR #88, a long-running market-translation branch, hit an id collision on merge
and resolved it **by moving the incumbent**: the conversation-reader statement
was renumbered to `SDD-050`, and `SDD-049` was taken for "Market translation is a
ports-and-adapters seam…".

AGENTS.md §18 forbids this in as many words: *never renumber an id, never reuse
one for a different statement.* The rule is not ambiguous, and the author was not
careless in general — the branch was substantial and well-tested. The rule was
simply not enforced by anything, so it was one of the several things that a merge
conflict resolution has to get right from memory.

Consequence, found by hand: `tests/e2e/fr091-conversation-inbox.spec.js` line 3
read `// @spec SDD-049, BR-001, BR-011` — an annotation on the CRM inbox e2e test
pointing at the market-translation seam. It stayed wrong on main until
`0f10f1707`. `npm run govern` was green for the entire window.

## Why nothing caught it

Preflight has a duplicate-id guard, and it is a good one — it is what caught two
concurrent `ADR-020`s. But it answers a question about **one moment**: *do two
documents claim this id right now?*

A moved id is never a duplicate at any moment. After the move:

- the registry is well-formed, with one row per id;
- every `@req` / `@spec` / `@tested` target still resolves;
- the doc graph builds cleanly and every edge lands on a real node;
- Appendix D, TRACE, FEATURE-MAP and DOMAIN-MAP all regenerate without complaint.

Every artefact stays *internally consistent*. The only thing that changed is what
the number means — and no artefact in this repository recorded that across
revisions. There was nothing to compare against.

The deletion half of Event 1 is worse still: a guard watching only for
renumbering would have missed fifteen ids vanishing outright, which was the
larger of the two failures.

## Root cause

**The id contract was a rule about meaning, and every check was about structure.**

`AGENTS.md §18` states an invariant *across time* — "this number keeps its meaning
for the life of the project". Every existing check evaluates a *snapshot*. A rule
about time cannot be enforced by a snapshot, no matter how many snapshot checks
are added, so this was never going to be caught by tightening the existing ones.

Contributing, in both events: a long-lived branch holding a whole-file copy of a
hand-maintained registry. Git merges that file by lines; the id contract is not a
property of lines.

## The fix

`docs/.id-ledger.json` + Check 12 in `scripts/doc-preflight.mjs` — see
[ADR-039](../../docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)
for the full decision and the measurements behind it.

The short version: the ledger records the **subject anchor** of every declared id
(340 of them, across all ten families that have a declaration site, including
`MI-RQ` which nothing guarded before). Preflight fails when an anchor moves, when
a new id inherits one from its own family, when a pinned id vanishes from its
registry, when an entry that was once pinned is no longer in the ledger, when an
id is declared twice in one registry, when a burnt number is re-declared, or when
a recorded move or retirement carries no justification a human can read.

That third-from-last arm exists because of this review. Adversarial verification
of the first cut re-landed the whole incident with zero CRITICALs and a PR diff
containing no deleted line at all: delete the id's block from the ledger, run the
command the failure itself printed, and the new subject is pinned as if it were a
new id. `roster` — every id ever pinned, never pruned — is what makes a removed
entry a fact the gate can see, and the writer now refuses to re-pin one.

Replayed against real history it fires on `FR-051`, `SDD-026` and `SDD-049` — and
on nothing else. Both events above are regression tests in
`tests/unit/id-anchor-stability.test.js`.

## What it does not fix, stated so nobody discovers it later

**A prefix-preserving repurpose still slips through.** The anchor is the leading
noun phrase; editing a statement in place while keeping its opening words moves
the subject without moving the anchor. The same blindness is widest where the
leading phrase is a short label — 30 rows put fewer than 30 characters in front
of a statement over 150 — and anchoring the whole statement instead was tried,
measured, and cost more than it bought (ADR-039 §"What this does not do"). The measured alternatives were worse:
exact statement hashing fires 23 times on this history with 17 false positives,
which is a gate that gets learned as a chore. A reviewer still reads the registry
diff of any PR that touches an already-merged id.

**Ten stale citations are live on main today and this check does not repair
them.** They are a one-time human sweep, listed here so the work is tracked:

| Where | Cites | Should be |
|---|---|---|
| `docs/PRD-SDD-v1.0.md` — `NFR-015` evidence cell | `FR-074` | `FR-079` |
| `docs/PRD-SDD-v1.0.md` — `NFR-016` evidence cell | `FR-075` | `FR-080` |
| `docs/PRD-SDD-v1.0.md` — `SDD-043` third cell | `FR-074` | `FR-079` |
| `docs/PRD-SDD-v1.0.md` — `SDD-044` third cell | `FR-075` | `FR-080` |
| `docs/PRD-SDD-v1.0.md` — `SEC-015` status cell | `FR-074` | `FR-079` |
| `docs/PRD-SDD-v1.0.md` — `SEC-016` status cell | `FR-075` | `FR-080` |
| `docs/PRD-SDD-v1.0.md` §2.4 prose | `FR-075` | `FR-080` |
| `src/modules/agent/line-channel-binding.js:4` | `@req FR-051` | `FR-052` |
| `src/modules/agent/line-channel-binding.js:5` | `@spec SDD-026` | the current `SDD-026` is a different subject |
| `tests/unit/line-channel-binding.test.js:5,6,17` | `FR-051`, `SDD-026` | `FR-052` |
| `src/modules/agent/line-binding-resolver.js:5` | `@spec SDD-026` | partial mismatch, same drift |

The first seven are the residue of `af0a6f0d1` — a **correct**, deliberate,
well-reasoned renumber that rewrote 102 references across 37 files plus 8 test
filenames and 4 document names, and still missed the traces-to cells because
nothing parses them. That is the strongest argument for the check existing: care
was not the missing ingredient.

The last four are a second, previously unfound instance of the same class, from
`c7cec3d6` on 2026-08-14: `FR-051`'s original statement was split, the entry half
took the new id `FR-052`, and two files' annotations were never moved. Because
doc-graph turns any bare id in a test into a `verifies` edge,
`tests/unit/line-channel-binding.test.js` currently counts as evidence that
`FR-051` — Supabase tenant isolation — is verified, when what it tests is
`FR-052`'s binding resolution. A valid-looking edge pointing at the wrong subject
is exactly the `SDD-049` failure mode.

## Lesson

Preflight's other ratchets all encode the same idea: *make the bad change
visible, not impossible*. This one adds the missing axis — visibility **across
revisions**, not just within one. Any future rule of the form "X keeps its meaning
over time" needs a committed record of what X meant, or it is a comment.
