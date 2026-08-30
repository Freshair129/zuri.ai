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

## Review findings on CR-003, CR-004 and CR-005

These three ask for work **in this repository** — Prisma models, routes, UI — so
they are reviewed against what this repository already holds. Every finding was
checked against the schema or the route tree and cites where. Where a first
suspicion turned out to be wrong that is recorded too, because a review listing
only its confirmed hits hides its own error rate.

### CR-003 — `DataPipelineRun` would be a second run ledger

`IngestionRun` already exists (`prisma/schema.prisma:1559`) carrying `tenantId`,
`businessId`, `connectionId`, **`lane`**, `resourceType`, `runType`, `status`,
`startedAt`/`finishedAt` and five counters
(`fetched`/`created`/`updated`/`unchanged`/`failed`). The proposed
`DataPipelineRun` restates almost all of it under other names, and its
"multi-lane" framing is the `lane` column already there. `PipelineStep` (1354)
and `PipelineRecordEvent` (1407) carry the per-step trace, and
`/api/pipelines/runs` already serves it.

**What is genuinely new is the approval gate** — `catalogVersion`, `vaultId`,
`approvedAt`, `approvedBy`. Worth having, and they belong as fields on the
existing run or a small approval model beside it. Two run tables answering "what
happened in this pipeline" is the condition where a reader takes whichever they
find first and neither table is wrong about itself.

> **Erratum, 2026-08-30 — the gate is not new either, and there are two run
> models, not one.** The paragraph above is wrong in one clause and incomplete
> in another, and both were found by reading the schema rather than by
> re-reading this note.
>
> `PipelineGateDecision` (`prisma/schema.prisma`) has existed since FR-071 with
> `status` in `PENDING`/`APPROVED`/`REJECTED`/`WAIVED`, `decidedByPersonId`
> (CR-003's `approvedBy`), the row's own `createdAt` (its `approvedAt`),
> `required`, `reason`, `evidenceJson` and `auditEventId`. It is in the
> production DDL under `FORCE ROW LEVEL SECURITY`, `GATE_UPDATED` is already an
> accepted event type, and the `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` stage
> catalog has always carried `DPS-PUBLISH` ("Publish approved projection") and
> `DPS-ROLLBACK` ("Rollback failed or rejected run"). So "a small approval model
> beside it" would have been the second-source-of-truth defect this review
> exists to prevent, authored by the review rather than by the proposal.
>
> Separately, the comparison above names only `IngestionRun`. `PipelineRun`
> (FR-071) is the second run model and the one `PipelineGateDecision` relates
> to. They are not duplicates — `IngestionRun` is per-connection acquisition
> evidence (FR-081), `PipelineRun` is per-definition execution — but a reviewer
> who sees one and not the other cannot place a new proposal correctly.
>
> The rework is **FR-129 + SDD-075**, declaring no model, no column and no
> migration. What this repository will accept, written for CR-003's author, is
> [`CR-003-ACCEPTED-SHAPE.md`](CR-003-ACCEPTED-SHAPE.md).

### CR-004 — GitHub binding does not belong on `Business`

The proposal puts `githubRepoUrl`, `githubBranch`, `githubSyncStatus`,
`lastCommitSha`, `lastGithubSyncAt` on `Business`. That is a scope-chain entity
and this is integration state, for which a shape already exists:
`IntegrationConnection` is keyed `@@unique([tenantId, providerId,
externalAccountId])` — precisely "this tenant binds this external account at
this provider". A repo binding is that.

**BR-002 is the load-bearing reason rather than tidiness**: external ids are
never primary keys here, they map through `ExternalEntityRef`. A GitHub URL and
a commit SHA on `Business` make another system's identifiers part of a core
scope entity's shape.

The private-repo token has a home too — `IntegrationCredential` stores
**`secretRef` only** (1546), never the material.

Unstated in the proposal: `/api/webhooks/github` carries no tenant in its path
and no authentication story. A webhook that mutates tenant-scoped state needs
both before it can be written.

> **Erratum, 2026-08-30 — `Repository` already exists, and the correction above
> points at the wrong model.** The refusal was right; the replacement was not,
> and this is the second time this review has proposed a second source of truth
> while refusing one. Found the same way as the CR-003 erratum: by reading the
> schema rather than by re-reading this note.
>
> `Repository` has been in `prisma/schema.prisma` since **FR-008**, and
> **FR-073** made it owned by exactly one `Business` — carrying `provider`,
> `externalRepoId`, `ownerName`, `repoName`, `fullName`, `url`, `defaultBranch`,
> `status` and a human `code`. It is not a vestigial shape: `/api/repositories`,
> `/api/repositories/[id]`, `/api/repositories/link` and
> `/api/repositories/link/[id]` are live and viewer-scoped (`ownsBusiness` to
> write, `seesBusiness` to read), `/repositories` renders it with a provider
> dropdown **whose default option is already `github`**, and that page's
> subtitle has stated CR-004's gap since it shipped: *"Local metadata only —
> provider, name, URL, default branch. No GitHub API access in MVP."*
>
> So `githubRepoUrl` is `Repository.url` and `githubBranch` is
> `Repository.defaultBranch`, both on an entity that is already Business-owned.
> Directing CR-004's author to build the binding on `IntegrationConnection`
> would have produced a second repository record beside that one — exactly the
> defect this review exists to prevent, authored by the review for the second
> time in one night.
>
> Two further corrections to the paragraph above. **CR-004's choice of Business
> scope was right**, not wrong: FR-073 reached the same answer and SDD-037
> explains why it is forced — the viewer contract carries only Business-keyed
> grants, so nothing above Business is governable. What CR-004 got wrong was the
> *entity*, not the *scope*. And the argument against columns on `Business` has a
> second half this note missed: they would cap a Business at one repository,
> where `Repository` has always permitted many.
>
> What the review got right stands: BR-002 is the load-bearing rule (and it
> names *"GitHub id"* in its own example list), and
> `IntegrationCredential.secretRef` is where a private-repo credential belongs.
> `IntegrationConnection` is genuinely involved — it is what a webhook delivery
> resolves against, and what holds the credential — but a connection is an
> external *account*, and one connection fans out to many repositories.
>
> The rework is **FR-130 + SDD-076**, declaring no model, no column and no
> migration, and declared **blocked** on the CR-006 finding below. What this
> repository will accept, written for CR-004's author, is
> [`CR-004-ACCEPTED-SHAPE.md`](CR-004-ACCEPTED-SHAPE.md).
>
> **CR-006 is now part of this CR's premise.** It records that the repository
> CR-004 proposes to surface held customer contact lists, quotation reports and
> per-customer purchase history tracked in git on a public remote. A Files tab
> renders whatever a bound tree contains, so FR-130 has to answer what happens
> when that data is personal data zuri-ai's own FR-103/SEC-005 controls would
> never admit through the front door. Its answer is: file content is never
> persisted (SDD-076), the read is bounded by a deny-by-default path scope
> (SEC-009's shape), and the residual — that nothing here can verify whether a
> declared path holds personal data, and nowhere records an assertion that it
> does not — is a named blocker, in FR-121's sense. Remediating CR-006's instance
> does not lift it; the next bound repository has the same unverifiable property.

### CR-005 — one blocking conflict, one credential conflict, one false alarm

**Blocking: `/api/connectors/line-oa/[businessId]` would be a second LINE write
path.** `src/app/api/agent/line-webhook/route.js` already exists. BR-009 and
SDD-009 state that every intake surface converges on one envelope and that a new
surface adds a **converter**, never a second write path. The auto-quote behaviour
CR-005 wants is reachable through the existing webhook plus a converter; a second
endpoint is the thing the rule forbids by name.

**`AgentConnectorConfig.channelSecret` / `.channelToken` as plain columns
contradicts how credentials are handled here.** `IntegrationCredential` holds a
`secretRef` and nothing else; the material lives in the vault. Storing a LINE
channel secret and access token as ordinary columns puts live credentials in the
database and in every backup of it.

**`ShippingRateMatrix` carrying only `workspaceId` is fine.** I suspected it
broke tenant isolation; it does not. `Project` (518) is workspace-scoped the same
way and inherits tenant through the workspace. Recorded so the next reviewer does
not re-raise a settled question.

### Disposition

| CR | Where the work lives | State |
|---|---|---|
| CR-002 | GKS / MSP, not here | blocked on the three findings above — one of which does not hold as stated |
| CR-003 | here | **reworked and declared as FR-129 + SDD-075** — onto `PipelineRun` + the existing `PipelineGateDecision`, with no model, no column and no migration; see the erratum above and [`CR-003-ACCEPTED-SHAPE.md`](CR-003-ACCEPTED-SHAPE.md) |
| CR-004 | here | **reworked and declared as FR-130 + SDD-076** — onto the `Repository` FR-008/FR-073 already made Business-owned, with no model, no column and no migration; **declared blocked** on the CR-006 PII finding. See the erratum above and [`CR-004-ACCEPTED-SHAPE.md`](CR-004-ACCEPTED-SHAPE.md) |
| CR-005 | here | shipping matrix is workable; the LINE connector must become a converter, and credentials a `secretRef` |

None can be built before that rework, because each currently proposes a shape
this repository would have to contradict itself to accept. Each needs an FR id,
declared here, through the ledger, before any code.

**CR-003 has been through that rework** and is the worked example: it came out
as one FR (FR-129) and one SDD (SDD-075), declaring no model, no column and no
migration, because most of what it asked for was already built and one thing it
asked for was already built *and* misread by this review.

**CR-004 has now been through it too**, and produced the same result twice over:
one FR (FR-130), one SDD (SDD-076), no model, no column, no migration — because
`Repository` had been Business-owned since FR-073 and the surface rendering it
had been naming the gap in its own subtitle the whole time. It also produced the
same *review* error twice: as with CR-003, this note refused the proposal's
model correctly and then named a replacement that would have created a second
source of truth. Two for two is a pattern rather than an accident, and the
lesson is the cheap one — **read the schema before naming the alternative**, not
only before accepting the proposal.

CR-002 and CR-005 still have no id. CR-004 has one and cannot be built on it
yet: FR-130 is declared **blocked**, and the blocker (CR-006's PII finding) is a
data-protection decision rather than an engineering task.
