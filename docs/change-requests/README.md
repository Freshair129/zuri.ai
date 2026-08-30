---
doc_type: intake-note
status: active
version: "1.0.0"
updated_at: "2026-08-30"
---

# `docs/change-requests/` — intake, not governance

**Status:** Active
**Version:** 1.0.0

This directory holds **proposals**. Nothing in it is a requirement of this
product, and being here grants a document no standing beyond being readable and
version-controlled.

## `CR-` is not `FR-`, and it is not `ZV2-CR-`

| | What it is | Where it is declared | Pinned in `docs/.id-ledger.json`? |
|---|---|---|---|
| `FR-xxx` | a functional requirement — a precise behaviour this system commits to | `docs/PRD-SDD-v1.0.md` | **yes** — preflight Check 12 fails on an unpinned declared id |
| `ZV2-CR-xxx` | this project's own change records | `docs/changes/` | **yes** — a registry the ledger names, `form: document-h1` |
| `CR-xxx` | a proposal, from anywhere, in this folder | nowhere | **no** |

That last row is checkable rather than asserted. `docs/.id-ledger.json`'s
`registries` array lists six registries — `docs/PRD-SDD-v1.0.md` (FR/NFR/BR/SEC/SDD),
`docs/FEATURES.md` (FEAT), `docs/appendices/E-risk-matrix.md` (RSK),
`docs/domains/market-intelligence/SRS.md` (MI-RQ), `docs/decisions/` (ADR) and
`docs/changes/` (**ZV2-CR**). `docs/change-requests/` is not among them, and the
ledger's 430 pinned ids span exactly ten families: ADR, BR, FEAT, FR, MI-RQ,
NFR, RSK, SDD, SEC, ZV2-CR. There is no bare `CR` family, and `CR` is not in
`not_ids` or `burnt_families` either — it is simply not an id this repository
issues.

The practical consequence: **a `CR-` number is a filename, not a key.** It
carries none of the guarantees AGENTS.md §18 gives a requirement id. Two
proposals could collide on a number without any guard noticing, and nothing
downstream — TRACE.md, Appendix D, the doc graph — keys off it.

## Where CR-002…005 came from

`CR-002`, `CR-003`, `CR-004` and `CR-005` were written **directly into the
working tree of the shared primary checkout `D:\zuri-ai`** by an agent running
outside this machine's session mesh, from `O:\Org-EtohGroup\SmartGift`. They were
never committed, never gitignored, and absent from `main`.

For as long as that was true, **nothing in this repository could see them.** Not
`govern`, not `docs:preflight`, not CI, not the doc graph — every one of those
builds its input from the tracked-file list, which excludes untracked files by
construction. They were found by byte-comparing the primary's tree against
`git archive`, a method no part of this repository runs.

They are tracked now, and preflight **Check 15 (`untracked-docs`)** exists so
the next one is reported instead of discovered. Read that check's limitations in
`scripts/untracked-docs.mjs` before relying on it — in particular, it cannot fire
in CI, so a green pull request is not evidence that this class is clean.

Tracking them changes exactly one thing: they are visible. It grants them
nothing else.

## What landing one of these would take

None of CR-002…005 has been accepted. Any part of one that is to be built goes
through the ordinary route in `CLAUDE.md` → *Adding a feature*, with no shortcut
for having arrived as a CR:

1. **Declare the FR** in `docs/PRD-SDD-v1.0.md` (or a `FEAT-xxx` row in
   `docs/FEATURES.md` when the capability spans several FRs). A `@req` naming an
   undeclared id is a preflight CRITICAL.
2. **Pin the id**: `npm run docs:ids -- --write`. Declared-but-unpinned is a
   preflight CRITICAL (ADR-039, Check 12).
3. **Work in a chartered lane** — read `docs/domains/<d>/CHARTER.md` first. Note
   that every one of these CRs proposes *new* domains
   (`catalog-vault`, `pipeline-governance`, `git-explorer`, `logistics-engine`,
   `omnichannel-connectors`); a `src/modules/<m>` with no charter claiming it is
   a CRITICAL.
4. **Annotate and regenerate**: `@req` / `@spec` / `@tested`, then
   `npm run govern`.

A CR that proposes changes to systems this repository does not own — MSP, GKS,
GenesisBlockDB, `zuri-edge-device` — cannot be landed here at all. Those are
wire contracts belonging to their own repositories and their own review.

## Review findings on CR-002 (not edits to it)

These are recorded **here** rather than in `CR-002-…md`, whose text is preserved
verbatim as its author wrote it. They are relayed from a domain owner's review,
and each was then checked against this repository's own ADRs. **Two of the three
did not hold as stated**, and are restated below with what the repo actually
says. That is not a dismissal of the underlying concern — the reviewer owns
contracts that are not in this tree — but a finding that cannot be reproduced
from the repo has to be labelled as such before anyone acts on it.

### 1. `msp_vault_resolve` is API-010 here, not API-009 — the correction does not hold as stated

The review said `msp_vault_resolve` belongs to **API-009**, not API-010. Against
this repository it is the other way round, in four independent places:

- [`ADR-022`](../decisions/ADR-022-MULTI-TENANT-MSP-VAULTS.md) — "Zuri calls the
  GoVibe/MSP `msp_vault_resolve` **API-010** contract", and separately uses
  `workspacePrivateVaultId` "for **API-009** episodic reads/writes".
- [`FR-057`](../domains/agent/features/FR-057-authorized-agent-context-and-vault-resolution.md)
  — API-010 is called *before* API-009 memory access.
- The `FR-057` row in `docs/PRD-SDD-v1.0.md`, same ordering.
- `src/modules/agent/msp-vault-resolver.js`, which calls the tool named
  `msp_vault_resolve` and labels every error `API-010`.

So CR-002 §3.C is *consistent* with this repo's numbering, and adopting the
correction as written would put the two APIs the wrong way round.

**The second half of the finding does survive, in weakened form.** The claim that
the tool "does not yet exist in MSP's contract" cannot be confirmed here — MSP's
contract is not in this repository — but this repo's own status agrees it is not
landed: the PRD's FR-057 row reads "API-010 integration in progress", and ADR-022
retains legacy API-009 `scopeKey` access as an explicit compatibility mode. So
CR-002 §3.C is proposing a change to a contract that is still in flight, and that
change belongs to MSP's review, not to this repository. **That** is the finding
worth carrying forward; the API renumbering is not.

### 2. Registering bge-m3 vector spaces in GKS puts them in the wrong tier — holds in substance, wrong ADR

The review said GKS has no vector spaces by an explicit accepted decision, citing
"Stage 9's ADR". The substance is right and the citation is not.

[`ADR-050`](../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) D2 is the
decision, and its stage table says: **stage 15 is Embedding, owned by
GenesisBlockDB Tier 4.** Stage **9** is *Entity Resolution*, which is one of the
stages GKS Tier 3 does own. Alongside it,
[`ADR-042`](../decisions/ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md)
D2 places the HNSW vector index in GenesisBlockDB as lane 1 (Semantic RAG), and
D3 lists what belongs in the GKS layer above it — query planning, reranking,
verification — with no storage of any lane.

So CR-002 §3.D.1, which registers `unboxing_sensory` (1024-dim `bge-m3`) and
`product_features` **as vector spaces in GKS**, does assign to Tier 3 something
ADR-050 D2 and ADR-042 D2 both assign to Tier 4. Restated accurately: embedding
was never *excluded* from the system — it was *placed*, in Tier 4 — and moving it
up a tier reverses ADR-050 D2 row 15 and ADR-042 D2, so it needs its own ADR
superseding both.

### 3. "GKS never calls outward" — this correction does not hold here

The review said CR-002 §3.D.2 ("Dispatch compiled `query-ir.v1` requests directly
to Edge Substrate") contradicts `ADR-GKS-BOUNDARY`, because GKS never calls
outward.

**No such ADR exists in this repository.** `docs/decisions/` holds no file of
that name, no document defines that id, and before this note was written a
full-tree grep for the string returned zero hits. The ADRs that do govern the
boundary say the opposite of the stated rule:

- [`ADR-043`](../decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) D2 clause
  3: "**GKS (Tier 3)** … resolves entity identity, orchestrates RAG pipelines,
  and **generates `query-ir.v1` requests**."
- [`ADR-042`](../decisions/ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md)
  D1's topology diagram shows GKS emitting `query-ir.v1` downward into
  GenesisBlockDB.

Dispatching `query-ir.v1` downward is what GKS is *for* in these ADRs, and
CR-002's own diagram routes it in-process (Rust C-ABI NAPI), matching ADR-042 D1.

The non-crossing rule that genuinely exists in this tree runs one tier higher and
in the other direction: ADR-043 D2 clause 1 — "**Zuri-AI (Tier 1)** … never talks
directly to GenesisBlockDB or bypasses MSP governance" — reinforced by ADR-050 D3
and [`ADR-046`](../decisions/ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md)
clause 2. If the review meant a boundary document held inside the GKS repository,
it is not in this one and cannot be checked from here; it should be quoted before
anyone acts on it.

## How to reach the author of these documents

The author is an agent in a different IDE, on a different machine, with no
session registration here. **It reads files; it does not receive messages.** A
review finding that exists only in a chat transcript, a PR comment, or an agent
hand-off note will not reach it.

So findings go **in the tree, next to the document they concern** — this file is
the current instance of that. If a reply is needed in the author's own workspace,
write it as a file there rather than assuming any channel exists.

The same asymmetry is why CR-002…005 sat unseen: a filesystem was the only
channel in use, and until Check 15 this repository was not reading it.
