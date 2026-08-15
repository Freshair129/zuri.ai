# ADR-023 — Agent vault: private epistemic memory, and why it is not the doc-graph

**Status:** Proposed — awaiting owner sign-off
**Date:** 2026-08-16
**Decided by:** — (proposed by ATHER)
**Relates to:** [ADR-004](ADR-004-DOCUMENTATION-ARCHITECTURE.md) (doc architecture),
[ADR-007](ADR-007-LINE-AI-STACK-SEQUENCING.md) (knowledge projection / GKS),
[ADR-009](ADR-009-SELF-GOVERNANCE-LINEAGE-AND-IR-BOUNDARY.md) (three lanes, the IR boundary),
[ADR-018](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md) (tenant isolation), AGENTS.md §18–19

**Conforms to:** `RW-ADR-O-007` (RWANG — vault taxonomy, epistemic state, temporal lineage) at
conformance level **L1 (file)**. That document owns the vocabulary; this one records only what Zuri
does differently and why.

## Context

Three things are true at once, and together they leave a gap:

1. **Agent memory today is tool-local.** It lives in the Claude Code home directory
   (`.claude/projects/D--zuri-ai/memory/`). Codex, Gemini or any other agent working in this repo
   cannot see that a hypothesis was ever formed, so the same dead ends get re-walked and the same
   tokens get re-burnt.

2. **`docs/.doc-graph.json` cannot hold this material.** It is regenerated from a filesystem scan on
   every run and is CI-gated — by design it has no memory of previous states, no time axis, and no
   room for a claim that might be wrong. Its edges are *declarations* (`@req`, `@spec`, control-block
   lineage), not beliefs.

3. **The knowledge to be captured is about to expire.** `PHASE-V2-REPLACE` is the phase where "why
   does V1 do it this way, and does V2 still satisfy that reason" has to be answered. That reasoning
   connects a `docs/v1-inherited/` document, a screenshot, a customer conversation and a V2
   requirement — an edge no generator can derive, held today only in conversation.

The material is therefore a fourth kind of statement. GKS edges are **facts** (this customer belongs
to this business — it is in the database). doc-graph edges are **declarations** (someone wrote
`@req FR-020`). What is missing is **beliefs** — owned, dated, revisable, and frequently wrong.

`RW-ADR-O-007` defines the shape for those. This ADR adopts it and draws Zuri's boundaries.

## Decision

### D1 — Zuri implements only the private tiers; `docs/` is already the Shared Vault

`RW-ADR-O-007` D1 names three vault roles. Zuri builds **two**.

The Shared Vault role — approved requirements, architecture, decisions, contracts — is already
filled by `docs/` plus its generated `.doc-graph.json`. Creating a `.brain/<project-slug>/` beside it
would be a second registry for the same facts, which ADR-009 §D1 and the RWANG operating agreement
both forbid.

### D2 — Two private tiers, mapped onto what already exists

| RWANG role | Zuri materialisation | holds |
|---|---|---|
| Global Private Vault | `.claude/projects/D--zuri-ai/memory/` (unchanged) | per-agent, across projects: how to work here, tool-specific lessons |
| Workspace Private Vault | `<repo>/.brain/private/<agent-id>/` | per-agent, this project: hypotheses, dead ends, recovery patterns |
| Shared Vault | `docs/` + `.doc-graph.json` (unchanged) | approved truth |

These are tiers, not duplicates. The existing memory directory keeps its job; what moves into the
repo is project-scoped belief, so that every agent working in this tree has a place of its own in one
structure — which is what tool-local memory cannot provide.

### D3 — No MSP; the owner is the promotion mediator

`GV-ADR-022` routes promotion through MSP. Zuri has no MSP and takes no runtime dependency on one
(ADR-009 §D1). The mediator here is the human owner, and the promotion mechanism is the one this repo
already uses: **write an ADR, a feature note, a requirement, or a test.**

Per `RW-ADR-O-007` D6, the promoted artefact must stand on its own and **may not cite the vault as
its evidence**. The vault records only that a hypothesis graduated, and into what.

### D4 — The private subtree is gitignored, and stores references, never copies

`.brain/` already exists in this repo and is tracked: `.brain/rca/` holds ~20 committed root-cause
notes. That is *shared* episodic knowledge — findings someone already worked out and chose to
publish. It stays exactly as it is.

**`.brain/private/` is added to `.gitignore`; `.brain/rca/` is untouched.** A notebook the team reads
is not a notebook — people self-censor, and the value of writing down a half-formed thought
disappears. The split is the same one D3 draws: `.brain/private/` is where a hypothesis is worked
out, `.brain/rca/` and `docs/` are where it lands.

This also closes a data-protection hole. The strongest use case (connecting a customer conversation
to the requirement it caused) would otherwise pull LINE message content out of its tenant scope and
into a shared repository. Therefore, per `RW-ADR-O-007` invariant 8: **a vault entry references a GKS
node by id only.** Resolving it to actual content happens at read time, through the tenant-scoped
read path, or not at all (BR-001, SEC-001, ADR-018).

Consequence accepted: an un-graduated hypothesis does not survive a machine change. That is the
correct incentive — anything worth keeping goes through D3.

### D5 — Time lives in the vault, never in the doc-graph

`doc-graph.mjs` produces `supersedes` and `relates` edges but carries no timestamp on any node or
edge. It can answer *what replaced what*; it cannot answer *what we believed in June*.

Adding bitemporal fields to it would be wrong: it is derived and stateless, and knows about change
only by diffing against the last committed graph. The temporal contract of `RW-ADR-O-007` D4
(`validFrom` / `validTo` / `recordedAt` / `supersededAt`, append-only, never delete) belongs to the
hand-authored, append-only vault.

Note the alignment with AGENTS.md §18 — *"mark it superseded and leave the number burnt"* — the same
instinct one level up, but without a clock.

### D6 — Cross-repo ids are prefixed when cited, never renumbered

Zuri's ADR numbers collide with GoVibe's across `ADR-001`…`ADR-019` with entirely different meanings
(Zuri `ADR-016` is SQLite authority; GoVibe's is swappable backends). Ids are keys (§18), so the fix
is a citation namespace, exactly as ADR-005 already established `V1-` for the inherited corpus:

`Z-` Zuri · `GV-` GoVibe · `RW-` RWANG · `V1-` Zuri V1

Filenames inside each repo are unchanged. The prefix appears only when citing across repos — this
document is `Z-ADR-023` when referenced from elsewhere.

The collision is not hypothetical inside a single repo either: this ADR was first drafted as
`ADR-020`, which was already taken by `ADR-020-CONTROLLED-LINE-BINDING-ACTIVATION-AND-RECEIPT.md`
on `main`. Ids are allocated against `git ls-tree main docs/`, never against a working-tree listing,
which can lag behind concurrent branches.

### D7 — Out of scope

- **Code-symbol scanning stays out.** ADR-009 §D2 is unchanged: no GoVibe-style code semantic IR, and
  therefore no automatic symbol detection and no call-hierarchy suggestion. A vault entry may point
  at a file and a symbol *name*, authored by hand.
- **Context lineage and replay** (`context_id` / `cache_id` / `kv_id`, `GV-ADR-022`) — L3 material,
  not adopted.
- **Vault registry and stable `vault_id`** (`RW-ADR-O-007` L2) — deferred until more than one agent
  actually writes here.
- **"Symbol Link" is not available as a name** for this or any related surface: ADR-009 §D4 already
  uses it for annotation edges, and `GV-ARCH-VAULT-CONTEXT-MODEL` defines it as one of four link
  classes. The human-authored edge this ADR is about is a **Crosslink**.

## Consequences

- New: `.brain/private/<agent-id>/` and one `.gitignore` entry for it. No schema change, no new
  runtime dependency, no change to `doc-graph.mjs`, `doc-preflight.mjs`, or `.brain/rca/`.
- Zuri gains a place for reasoning that the governance IR was never able to hold, without weakening
  the guarantee that `.doc-graph.json` is fully derived.
- The `V1 → V2` "why" can be captured during cutover instead of after it.
- Cost: a second place to write, and the discipline that it is not authoritative. Mitigated by the
  read-time framing requirement — an agent reading a vault entry must be given owner, epistemic
  state, confidence and age, or the belief gets laundered into output as fact
  (`RW-ADR-O-007` Compliance).
- Zuri is the first L1 implementation of `RW-ADR-O-007`. If GoVibe later builds its own, both read
  the same specification — a wiring exercise, not a translation.
