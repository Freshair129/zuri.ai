---
doc_type: migration-proposal
status: approved
version: "0.2.0"
---

# Documentation reintegration proposal

**Version:** 0.2.0

**Status:** Approved by the owner in this chat on 2026-09-29; implementation authorized. Merge and production cutover remain separate gates.

**Complexity:** C-3 (documentation, diagrams, then implementation)

**Risk:** HIGH (published identities, governance evidence and runtime document consumers)

## Outcome and scope

Bring the feature-oriented documentation structure and useful tooling from zuri-next
into zuri-ai, with one authoritative active specification, complete backward
navigation, and preserved historical evidence. This is a documentation and reference
system migration, including application code that consumes those references. It does
not authorize a redesign of business behavior or production deployment.

The owner requested an assessment and plan first, using Luna at max reasoning for
exploration, refactor planning, document writing and diagrams. This proposal is the
reviewable result of that preparation; the owner approved this migration contract on 2026-09-29.

## Pinned inputs

| Input | Revision | Use |
|---|---|---|
| zuri-ai origin/main | `a34ceaf79c112e02b1bcfdbf0a84122d835b002e` | Existing product, published IDs, current code/tests and governance |
| zuri-next local HEAD | `8f3fa178f05567ae2c3863896d5a99cf6fd96d49` | Candidate document structure, specification, tools and crosswalk |
| zuri-ai derivation baseline recorded by zuri-next | `9e5b104e7763975ab994171a1941c246cf172a7a` | Starting point for development-delta reconciliation |

Both remotes were fetched for this assessment. The selected zuri-next revision
contains seven committed changes beyond its fetched remote main; those changes are
included deliberately. The target is an isolated branch based on fetched zuri-ai main.
Local uncommitted work in either primary checkout is outside the migration input.

The target has 196 commits after the derivation baseline. In its `docs/` tree,
20 tracked files changed and three were added. This is a bounded development delta,
not a measurement of semantic equivalence. A file split, a merged ADR or an existing
code path does not prove that all source meaning was preserved.

## Approved migration decisions

1. **Canonical authority:** zuri-ai becomes the active write location for the
   reconciled documentation after cutover. zuri-next is a pinned provenance source
   for this migration and is not edited, deleted or archived by this work. Retiring
   its future authoring workflow is a separate owner decision.
2. **Published identity:** preserve every issued zuri-ai ID, its subject-anchor
   history and retired/burnt state. Preserve each imported original ID as provenance.
   Never assign an existing number to the different subject it denotes in zuri-next.
3. **Source-qualified resolution:** keep `ZAI` for existing identities and propose
   `ZNEXT` for imported provenance. The canonical lookup key is namespace plus original
   ID; an unqualified ambiguous lookup fails. Update schemas and tests before enabling
   this namespace. These names are approved serialization; tooling must support them before use.
4. **Reviewed mapping:** an equivalent imported record may alias one existing canonical
   record only after a subject review. A split or merge is a mapping with explicit
   dispositions, not an identity alias. Retain old aggregate requirements and their
   evidence; introduce new requirements only for approved refinements or changed meaning.
5. **One source per fact:** active content has one canonical declaration; registry tables,
   navigation, domain indexes, compatibility exports and graphs are generated projections.
   A temporary legacy-format export is permitted only if generated, versioned and covered
   by parity tests. No pair of manually maintained active registries is permitted.
6. **Historical truth:** committed approval text, old source blobs, snapshot manifests,
   hashes, verifier versions and persisted bindings keep their original interpretation.
   Current navigation may add a successor link; it must not rewrite historical evidence.
7. **No weaker gates:** retain current identity, schema, route, ownership, metadata and
   code/test checks while adding the new structure checks. Retire an old check only when
   an equivalent replacement test demonstrates the same failure is still detected.

These decisions preserve ADR-039 and AGENTS.md section 18. The new structure must be
adapted to that contract rather than importing zuri-next numbering verbatim. The
existing ADRs remain authoritative until the approved adoption record amends them.

## Authority and artifact coverage

| Family or material | Migration rule |
|---|---|
| Product, architecture, domains, services | Adopt canonical locations and metadata ownership; preserve source revision and approval state. Domain boundaries do not require matching service folders. |
| FEAT, FR, NFR, AC, SDD, TC, API, EVT, CMP | Reconcile behavior and contract meaning. Keep stable existing keys; map imported records, preserve split/merge cardinality, bind tests to actual paths and results. |
| ADR and business/security rules | Preserve original decision status, supersession chain, alternatives and approval evidence. A summarized successor cannot replace the original historical record. |
| `ZV2-CR-*` | Keep the pinned project change-record identities, phase artifacts, acceptance, compatibility and rollback history. |
| Bare `CR-*` intake proposals | Preserve as proposals with source path/revision and intake status. Their filename numbers are not issued requirement/change IDs; import does not approve them. |
| RSK and MI-RQ | Preserve issued identities and status. Define explicit family support in the adopted schema before importing or reclassifying them. |
| PLAN, TASK-ZAI, roadmap and delivery evidence | Preserve task identity, completion evidence, owner and status separately from requirement delivery and document approval. |
| Runbooks, handoffs, deployment and migration receipts | Reconcile operation paths and service ownership. Local test evidence remains distinct from hosted CI, release and production evidence. |
| Edge and legacy external references | Preserve source namespaces and revision context. Retired behavior remains historical; known external fossils stay classified rather than fabricated as current local targets. |
| Templates, prompts, plugins, harness and agent instructions | Update authoring/retrieval conventions and paths after the compatibility layer is proven. |
| Generated artifacts | Rebuild from the composed canonical inputs using one integrator. Do not concatenate conflicted generated outputs. |

The intake distinction is defined in `docs/change-requests/README.md`. Current
document metadata uses `docs/GOVERNANCE-LINK-METADATA.md`; relation vocabularies
must be mapped explicitly. In particular, navigation-only references must not turn
into implementation, verification, ownership or dependency evidence.

## Target layout

The [authority and migration diagrams](DIAGRAMS.md) show the proposed reader
boundaries and dependencies. They describe the target, not existing implementation.

```text
docs/
  product/                  product requirements and glossary
  architecture/             system design and system decision navigation
  domains/<domain>/         domain definition, contracts and generated views
  features/<feature>/       feature, individual requirements, design, verification
  services/                 deployable descriptions
  operations/               operational documents and runbook navigation
  governance/               adopted standards, procedures and migration decisions
  changes/                  pinned project change records and their history
  change-requests/          proposal intake, with no implied approval
  roadmap/                  delivery/task authority retained until explicitly mapped
  archive/                  historical material with original identity/provenance
  migrations/               controlled migration plans and acceptance reports
registry/                   domain/service metadata and reviewed source crosswalk
```

This is a target projection, not permission to move every file immediately. Preserve
old path/anchor navigation via tested compatibility routes or generated stubs where
appropriate. Historical verification reads the original Git revision, not a stub.
Do not place a duplicate declaration in a compatibility stub. Exact locations of
risk and MI requirement registers are decided in the adoption contract, not inferred
from folder names. Existing task/roadmap identities need no speculative new ID family.

## Work packages and exit criteria

| Phase | Work and outputs | Exit criteria |
|---|---|---|
| P0 — Baseline and approval | Freeze both revisions; inventory every tracked source artifact and consumer; approve this migration contract and the authority/namespace choice. Record exclusions and owners. | Every source file and declared ID has an inventory disposition. Unknown mappings remain explicit. No implementation starts before the migration contract is approved. |
| P1 — Compatibility and tests | Add source-qualified identity/locator support, reviewed crosswalk schema, ambiguity handling, old/new metadata readers and historical verifier dispatch. Write failure tests before consumer changes. | Colliding IDs cannot bind silently; old snapshots still verify against their original commit; split/merge requires explicit selection; all old guardrail tests remain effective. |
| P2 — Reconcile and complete specifications | Review the 23 changed source docs and their code/test relations; reconcile all imported source artifacts, including decisions, CRs, risks, MI requirements, task evidence and service handoffs. Add missing specification and test-contract detail from verified sources. | Each import is accepted unchanged, supplemented, historical-only, superseded, rejected or blocked with reason. Document approval and delivery are not promoted by migration. Product changes discovered here become separate approved work. |
| P3 — Canonical structure by lane | Pilot one feature with its parent and peer contracts; then migrate domain/feature lanes in dependency order. Retain one canonical active record and original history. | Per-lane content/metadata diff is reviewed; source IDs, subjects, status and source hashes reconcile; no duplicate active declaration. All required predecessors are mapped. |
| P4 — All active references and consumers | Update active markdown links/anchors, annotations, tests, fixtures, schemas, seeds, runtime readers, graph generators, selection tools, plugins and agent entry points. Materialize legacy exports only where still required. | Every inventoried consumer reads the intended identity version. Active local targets resolve; external/history exceptions are explicit. Legacy persisted evidence is unchanged and still readable. |
| P5 — Integration and validation | Compose lanes, regenerate projections, run full governance and scope-relevant code tests/builds. Compare old/new graphs semantically and review all changed authority documents. | No new critical findings or unapproved warning increase; all coverage and compatibility fixtures pass; deterministic output; historical replay and rollback tests pass; one independent review covers the exact composed revision. |
| P6 — Controlled cutover | Switch the canonical writer after acceptance; record version diff and final source/disposition manifest. Keep the old reader for the agreed compatibility period. | Owner accepts the migration evidence and rollback proof. Merge authority is explicit. Production/data migration remains a separate operation only if required and authorized. |

P2 and P3 may progress in separate approved lanes after P1; P4 can be developed
against fixtures in parallel, but no consumer switches to an incomplete canonical
tree. Reference generation and ledger integration are serialized by the integrator.

## Development reconciliation priority

The baseline delta includes changes to conversation-runtime extraction/handoff,
CRM retention and archive/erasure contracts, Phase-B recovery and schema inventory,
SCM extraction/handoff, LINE grounding runbook, and roadmap/provider deployment
documentation. Review each at its actual status: a candidate extraction decision or
rehearsal result is not production authority. Reconcile these areas before bulk
importing their corresponding specification and service descriptions.

Beyond that delta, account for the complete historical corpus, including old change
records and intake packages. The blueprint reorganizes and summarizes source content;
its crosswalk alone is not a byte-preserving archive or a complete history ledger.

For each apparent omission:

1. Enumerate declarations and inspect mapped relations, then read the current code and tests.
2. Classify it as a representation difference, a later change, historical/proposal-only
   material, or a specification item requiring owner review.
3. Supplement documentation from verified intent and evidence; do not alter behavior to
   make an imported specification appear true.
4. Keep detailed spec/code discrepancies in the private assessment or tracker. A public
   document may reference an opaque blocker without exposing sensitive details.

## Runtime and tooling scope

Concrete inspection targets include the following existing seams. The full manifest
must also enumerate their callers and tests before implementation:

- `apps/server/scripts/doc-graph.mjs`, `doc-preflight.mjs`, `doc-links.mjs`,
  `doc-identities.mjs`, `id-anchors.mjs`, `id-ledger.mjs`, `id-stability.mjs`.
- Domain-state/data-pipeline generators, monorepo/Edge graph namespaces, roadmap
  evidence and coverage, table-integrity checks and CI change/test selectors.
- `apps/server/src/modules/project-manager/application/governance-source-verifier.js`
  and snapshot, feature-binding, read-model and API consumers.
- Persisted document/requirement keys and source manifests in schemas, repositories,
  import/export and backup/restore fixtures. Do not rewrite old rows by text replacement.
- Build-time runtime projections, `scripts/build-llms-full.mjs`, package scripts,
  `.github/workflows/`, plugin contracts, templates, instructions and documentation URLs.
- zuri-next validator, view generator, impact/tests-for/readiness/packet tools and
  proposed graph schema, adapted to current namespace and historical-ID requirements.

Generated export hashes and historical Git-blob hashes are different contracts.
Never normalize or recompute a stored historical proof using the new document format.
A new verifier version reads new-format manifests; the previous verifier remains
available for historical evidence. Existing persisted IDs are preserved by default;
any unavoidable schema/data migration requires its own reviewed plan and rehearsal.

## Required verification

- Inventory: 100% of source files/declared IDs have an explicit disposition; no silent
  deletion. Count files, declared IDs, unique source IDs, mapped targets and references
  separately. A split produces more targets without increasing source coverage.
- Identity: original subjects and burnt IDs remain; test same-number/different-subject,
  aliases, ambiguous short references, collisions and one-to-many mapping refusal.
- Lifecycle: a proposed CR stays proposed, a retired ADR stays historical, and approved
  documentation alone never marks behavior implemented/live.
- Backlinks: active typed relations and old paths/anchors resolve or carry explicit
  external/historical classification; references retain their original evidentiary weight.
- Runtime: snapshot/feature-binding APIs, pagination/cursors, historical commit reads,
  manifest hashes, import/export, recovery and tenant authorization retain their contracts.
- Tooling: source and adopted target validators, deterministic generation, metadata/ID
  ledger tests, graph parity, Edge namespace tests, CI selection and corpus generation pass.
- Execution evidence: focused tests first; full governed checks and relevant app/service
  builds before merge. A successful command must execute the intended tests.
- Privacy: no private discrepancy report, local operator details, credential or source
  payload is added to tracked migration artifacts.

## Rollback

Keep the pre-migration Git revision and the reviewed mapping manifest. Until P6,
the canonical writer remains on the old format; the new reader can run in comparison
mode. Rollback changes the writer/reader selection and restores generated projections
from the pinned source. Never reset a shared checkout or rewrite repository history.
After new-format writes begin, stop writes and reconcile them before reverting; a blind
Git revert is not a data rollback. Rehearse both pre-write and post-write cases with
fixtures. Retain old verifier versions and source revisions for historical proofs.

## Roles and review

| Role | Model / effort | Responsibility |
|---|---|---|
| Explorer | Luna / max | Inventory, development delta and evidence-backed dispositions |
| Refactor agent | Luna / max | Consumer impact, compatibility design, tests and implementation packets after approval |
| Doc writer | Luna / max | Migration contract, canonical document completion and versioned diffs |
| Diagram agent | Luna / max | Architecture, authority and migration-flow diagrams aligned with the contract |
| Integrator | Current main agent | Reconcile findings, own shared generated files and exact-revision review |
| Owner | Human | Approve authority/identity decisions and completion evidence |

The initial agents only wrote external assessment artifacts. During implementation,
each writing lane gets its own branch/worktree and bounded paths; roles do not imply
permission to edit another lane's files. With four concurrent slots including the
integrator, specialist roles execute in waves.

## Version diff and current status

| Version | Change | Implementation |
|---|---|---|
| 0.2.0 | Owner approved the migration contract on 2026-09-29; implementation begins in isolated lanes | IN PROGRESS |
| 0.1.0 | Added migration scope, pinned sources, proposed identity policy, artifact coverage, phases, acceptance and rollback contract | NOT STARTED |

No new ADR/CR/FR number is allocated by this proposal. No product source code,
historical record, published ID, database, remote branch or production setting is
changed by preparing it. Approval applies to the proposed migration contract above;
findings and verification results are supplied in the accompanying local assessment.
