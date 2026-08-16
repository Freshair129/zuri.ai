---
version: "0.1.0b"
created_at: "2026-08-16T07:20:00+07:00,Claude"
last_update: "2026-08-16T07:20:00+07:00,Claude"
status: "beta"
superseded_by: null
attributes:
  domain: "governance-memory"
  doc_type: "change-request"
  scope: "per-agent private vault for hypotheses; handoff after session close"
---

# ZV2-CR-008 — Agent vault for private epistemic memory

> **Handoff CR.** The originating session was closed mid-flight because of git contention in
> this working tree. Decisions are recorded; **nothing is implemented**. Read "Git state" and
> "Problems encountered" before touching anything — several traps in this tree are not obvious.

## Goal

Give every agent working in this repo a private, append-only place to record **hypotheses** —
claims that are owned, dated, revisable and frequently wrong — separate from `docs/` and from
`docs/.doc-graph.json`, which can only hold statements that are already true.

## Why this feature exists

The request started as a code-bookmarking tool (mark a symbol, connect marks, draw a graph) and
was reframed over the design conversation into something else. That reframing is the reason the
feature is worth building, so it is recorded here rather than lost:

**1. The graph you can generate is the graph you already knew.**
`scripts/doc-graph.mjs` derives edges from `@req` / `@spec` / `@tested` annotations and document
control blocks. It can only ever surface what someone already wrote down. It will never produce
the edge *"this customer conversation is the reason BR-009 requires a dry run"* or *"this
spreadsheet the client sent is where SDD-002's shape came from"*. The value is precisely in the
edges no generator can derive — the corkboard-and-red-string model the owner described.

**2. There are four kinds of statement in this system, and only three have a home.**

| kind | example | lives in |
|---|---|---|
| **fact** | this customer belongs to this business | GKS projection (`src/modules/knowledge/`) |
| **declaration** | someone wrote `@req FR-020` | `docs/.doc-graph.json` |
| **decision** | ADR-003 says V2 replaces V1 by reuse | `docs/` |
| **belief** | *I think V1 did it this way because…* | **nowhere** |

Beliefs cannot go in the first three. `.doc-graph.json` is regenerated from a filesystem scan on
every run, is CI-gated, and has no time axis — by construction it cannot hold a claim that might
be wrong. Mixing a belief into it produces a system that states falsehoods confidently.

**3. The knowledge is expiring right now.**
`PHASE-V2-REPLACE` is the phase where *"why does V1 do it this way, and does V2 still satisfy that
reason"* has to be answered against `docs/v1-inherited/` (234 read-only docs, ADR-005). That
reasoning is currently held only in conversation. It disappears at cutover.

**4. Agent memory today cannot cross tools.**
It lives in the Claude Code home directory (`.claude/projects/D--zuri-ai/memory/`). A Codex or
Gemini session in this same repo cannot see that a hypothesis was ever formed, so the same dead
ends get re-walked. Moving the project-scoped tier into the repo fixes that — note it fixes
*structure*, not *readability*: private vaults stay per-agent on purpose (see D3 below).

**5. A refuted hypothesis is worth more than one never held.**
It is a map of a dead end. Deleting it means the next agent walks into the same wall and burns the
same tokens. This is the reason the store is append-only, and it is the same instinct AGENTS.md
§18 already applies to requirement ids (*"mark it superseded and leave the number burnt"*) — but
with a clock, which the doc-graph has never had.

## Decisions already recorded

Both are **Proposed** and need owner sign-off before any code is written.

| doc | repo | what it settles |
|---|---|---|
| `RW-ADR-O-007` | `G:\Rwang` `docs/ADR-O-007--vault-taxonomy-and-epistemic-lineage.md` | RWANG owns the vault **vocabulary**: three vault roles, epistemic state enum, deprecation reasons, bitemporal contract, link classes, one-way promotion valve, conformance levels L1/L2/L3, cross-repo id prefixes |
| `Z-ADR-023` | this repo, `docs/ADR-023-AGENT-VAULT-AND-EPISTEMIC-MEMORY.md` | what Zuri does differently: private tiers only, no MSP, gitignored `.brain/private/`, time in the vault never in the doc-graph |

Key points a reader should not have to re-derive:

- **D1 — Zuri builds two tiers, not three.** `docs/` + `.doc-graph.json` already *is* the Shared
  Vault. Adding `.brain/<project-slug>/` would be a second registry for the same facts, which
  ADR-009 §D1 forbids.
- **D2 — the two private tiers map onto things that already exist.**
  `.claude/projects/D--zuri-ai/memory/` ≈ Global Private Vault (per agent, across projects);
  `<repo>/.brain/private/<agent-id>/` ≈ Workspace Private Vault (per agent, this project). They
  are tiers, not duplicates — do not merge them.
- **D3 — private stays private.** Promotion is the crossing point, not direct reads. If one
  agent's raw hypotheses feed another agent's context, you get two biases multiplied, not shared
  knowledge. `GV-ADR-020` rejects that shape explicitly as a *hallucination amplifier*.
- **D4 — `.brain/` already exists here and is tracked** (`.brain/rca/`, ~20 committed RCA notes).
  Only `.brain/private/` gets gitignored. `.brain/rca/` is *promoted* knowledge and stays.
- **D5 — vault entries reference GKS nodes by id only, never by content.** Copying LINE message
  text into a repo-level store takes it out of tenant scope (BR-001, SEC-001, ADR-018).
- **D6 — ids are allocated from `git ls-tree main docs/`**, never from a working-tree listing.
- **D7 — out of scope and staying that way:** code-symbol scanning (ADR-009 §D2 unchanged), so no
  automatic symbol detection and no call-hierarchy suggestion; context lineage/replay; vault
  registry with stable `vault_id`.

**Naming:** "Symbol Link" is unusable. ADR-009 §D4 already uses it for annotation edges, and
`GV-ARCH-VAULT-CONTEXT-MODEL` defines it as one of four link classes. The human-authored edge this
CR is about is a **Crosslink**.

## Git state at handoff

Trees were left clean. **This section was rewritten after the concurrent session rebased underneath
it — verify with `git branch -v` before trusting it (problem 7).**

```
Zuri (D:\zuri-ai)
  main                                    4220caf   (behind origin/main by 1)
  codex/docgraph-newline-normalization    5040811   docs: add ZV2-CR-008 …  <- this CR
                                       ^- 84c33e4   fix(docs): make the doc-graph guard describe
                                                    content, not the checkout   (the normalize fix,
                                                    rebased onto origin/main and amended by the
                                                    other session; was 5e878f9)
  codex/adr-agent-vault-epistemic-memory  a044d13   docs: add ADR-023 …

RWANG (G:\Rwang)
  main                                    2d78496   (26 unstaged deletions — someone else's WIP)
  docs/adr-o-007-vault-taxonomy           e6bdb29   docs: add ADR-O-007 …
```

**The ADR branch needs a rebase before it can merge.** `a044d13` is still based on the pre-rebase
normalize commit `5e878f9`, which no longer belongs to any branch. Rebase it onto `84c33e4`; the
only real content is `ADR-023` plus a ~25-line `.doc-graph.json` delta, so regenerate rather than
resolve any artifact conflict by hand:

```
git rebase --onto 84c33e4 5e878f9 codex/adr-agent-vault-epistemic-memory
npm run docs:graph && npm run docs:preflight
```

Merge order is still normalize first, then the ADR branch. Do not rebase the ADR branch onto `main`
— see problem 4.

This CR landed on `codex/docgraph-newline-normalization` rather than the ADR branch, because the
branch was switched by the other session mid-write. Left where it is on purpose: that is the active
branch and the most likely to be read.

## Problems encountered — read before working in this tree

**1. Another session is active in this working tree.**
Untracked files appeared between two consecutive `git status` calls; `prisma/test.db` was held by
another process; and `codex/adr-agent-vault-epistemic-memory` was created and
`codex/docgraph-newline-normalization` reset by that other session *while this one was doing the
same thing*. Check `git reflog` and `git branch -v` before assuming your view of the branches is
current. Do not `reset --hard` or delete branches without checking who else is here.

**2. ADR id collision — `ADR-020` was already taken.**
This ADR was first written as `ADR-020` after `ls docs/ADR-*.md` showed nothing above 019. That
listing was wrong: `ADR-020-CONTROLLED-LINE-BINDING-ACTIVATION-AND-RECEIPT.md`, `ADR-021-…` and
`ADR-022-…` are all on `main`. Renumbered to `ADR-023` and both commits amended.
**Allocate ids with `git ls-tree --name-only main docs/`.** A working-tree listing lags behind
concurrent branches, and §18 makes a duplicated id a real defect, not a cosmetic one.

**3. `npm test` is flaky in this tree, and it is not this change.**
Full run: **519 passed, 14 files failed**. The same files pass in isolation
(`npx vitest run tests/integration/project-core.test.js` → 11/11). Cause is parallel vitest
workers against a single SQLite `test.db`, made worse by the concurrent session — the first
attempt failed outright with `EPERM … rm '\\?\D:\zuri-ai\prisma\test.db'`. Run the suite when the
tree is otherwise idle before drawing conclusions.

**4. Do not rebase the ADR branch onto `main`.**
Attempted. Regenerating `.doc-graph.json` on a `main` base produces **158 phantom changed nodes**,
because `main` lacks the canonical-LF hashing fix (`5e878f9`) and this checkout is CRLF. The ADR's
real delta is 25 lines. The graph artifact genuinely depends on that fix, so the ADR branch stacks
on it.

**5. `G:\Rwang` `main` has 26 unstaged deletions** (`orchestrator/governance/` being moved to
`orchestrator/governance_REMOVED-20260809/`, untracked). That is someone else's in-flight
refactor. `ADR-O-007` was committed on its own branch with only that one file staged. Do not
`git add -A` in that repo.

**7. The concurrent session rebased this branch mid-write.**
While this CR was being written, the other session rebased
`codex/docgraph-newline-normalization` onto `origin/main` (picking up `f49c5a6 docs: add CR-007`)
and amended the normalize commit `5e878f9` → `84c33e4`. The checked-out branch changed underneath
an in-progress edit, and the CR commit landed on a different branch than intended. Local `main` is
also **behind `origin/main`** — fetch before branching off it. Re-read `git branch -v` and
`git reflog` at the start of the next session; the "Git state" section above is a snapshot, not a
guarantee.

**6. Minor, unfixed:** `scripts/canonical-text.mjs` carries
`@spec docs/ADR-004-DOC-STRUCTURE.md`, but the real file is
`docs/ADR-004-DOCUMENTATION-ARCHITECTURE.md`. Harmless today because `doc-graph.mjs` only scans
`src/` and `prisma/` for annotations, so preflight cannot catch it. Worth correcting.

## Scope — what the next session should do

### W0 — Gate (blocking)

Owner signs off `RW-ADR-O-007` and `Z-ADR-023`, or amends them. **Nothing below starts first.**
Both are drafts of a decision, not an approved one.

### W1 — Contract

- Register the FR / BR / SDD ids in `docs/PRD-SDD-v1.0.md`. None are allocated yet — allocate per
  problem 2.
- Freeze the mark and crosslink schema against `RW-ADR-O-007` D2–D5: `epistemicState`,
  `deprecatedReason`, `version` / `validFrom` / `validTo` / `recordedAt` / `supersededAt`, plus a
  one-sentence reason on every crosslink.
- `validFrom` **stays null for a `Hypothesis`** and must never be auto-filled — a valid-time
  appearing is the signal that it graduated to `Confirmed`.

### W2 — Store

- `.brain/private/<agent-id>/` + one `.gitignore` entry for it. Do not touch `.brain/rca/`.
- Append-only writer: never delete, close the prior version with `supersededAt`.
- Drift detection by content hash — reuse `scripts/canonical-text.mjs`, which already solves the
  CRLF-vs-LF hashing trap (see `.brain/rca/2026-08-16-doc-graph-line-ending-hash-drift.md`).
  A mark whose anchor moved must surface as `drifted`, not silently point at different code.

### W3 — Read path

Three verbs, not a mirror of any UI:

- `suggest` — propose crosslinks a human might tie
- `traverse` — walk asserted edges to answer *why*, not *what*
- `audit` — find drifted anchors and stale convictions (long-held, never disconfirmed)

**Framing is mandatory on read.** An entry entering an agent's context must carry owner, epistemic
state, confidence and age. Raw content injected without that framing is how a private bias gets
laundered into output as fact (`RW-ADR-O-007` Compliance).

### W4 — Verify

`npm test` on an idle tree, `npm run build`, `npm run docs:graph`, `npm run docs:preflight`.

## Open questions for the owner

1. Sign-off on both ADRs (W0).
2. Where capture happens. The corkboard framing rules out a VS Code extension — you cannot pin a
   screenshot or a LINE thread from an editor cursor. Remaining: a panel in the Next.js console
   (needs blob storage and a viewer, roughly double the work) versus CLI + skill first. Undecided.
3. Whether `RW-ADR-O-007` should be offered back to GoVibe as a CR. Three of its clauses do not
   exist upstream: deprecation reasons (D3), null valid-time for hypotheses (D4), and conformance
   levels (D7).

## Do not

- Do not add temporal fields to `doc-graph.mjs`. It is derived and stateless by design; time lives
  in the vault.
- Do not merge `.claude/…/memory/` into `.brain/private/`. Different tiers (D2).
- Do not let a promoted artefact cite the vault as its evidence. An ADR that needs the notebook to
  stand up is not finished (`RW-ADR-O-007` Invariant 3).
- Do not commit customer content into `.brain/`. References by id only (D5).
