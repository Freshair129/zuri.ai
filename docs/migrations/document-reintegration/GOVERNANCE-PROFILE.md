---
doc_type: migration-profile
version: "0.1.0"
status: approved
---

# ZAI documentation integration profile

This profile applies the owner-approved [migration contract](PROPOSAL.md) to
zuri-ai. It adopts feature-oriented navigation and individual source records from
the ZNEXT structure while preserving the existing ZAI identity and evidence rules.
It does not adopt the source repository's numeric assignments or change product
behavior. Existing decisions remain readable at their original paths and commits.

## Canonical artifacts and compatibility

| Artifact | Active source and authority | Compatibility treatment |
|---|---|---|
| FR, NFR, BR, SEC, SDD | Individual ZAI records indexed by `registry/document-registry/index.json` | PRD/SDD table remains a generated export; old subjects and ID ledger stay intact |
| FEAT | Individual ZAI feature record; explicit registry membership determines its FRs | FEATURES table remains a generated export; folder membership alone grants no ownership |
| ADR | Existing `docs/decisions/` record and its recorded lifecycle | Preserve path, original decision, alternatives, amendments and historical Git blobs |
| RSK | `docs/appendices/E-risk-matrix.md` and the existing ID ledger | Retain issued IDs; no speculative conversion to FR or AC |
| MI-RQ | `docs/domains/market-intelligence/SRS.md` and its draft lifecycle | Retain issued IDs and distinguish draft specification from runtime delivery |
| ZV2-CR | Existing `docs/changes/` records, including phase artifacts | Preserve issued change identity, acceptance, compatibility and rollback history |
| Bare CR intake | `docs/change-requests/`, under its README's proposal rules | File locator and intake status only; it does not become an issued identity |
| TASK-ZAI, PLAN, roadmap | Existing task/plan records and evidence | Delivery workflow remains separate from requirement approval |
| API, events and schemas | Existing owning domain contracts and application contracts | Add source-qualified imported mappings only after contract review |
| Domain ownership | Existing domain CHARTER and approved decisions | Domain/service/feature directories are navigation, not inferred owners |
| Edge and V1 history | Existing namespaced graph and historical source revision | Keep retirement and external-history classification; never create current ZAI evidence from a suffix match |
| ZNEXT declarations | Pinned migration inventory and original source revision | Candidate/provenance records until individually reconciled; a crosswalk is not approval |

The record structure is defined in [CANONICAL-FORMAT.md](CANONICAL-FORMAT.md).
The canonical authoring switch remains subject to P6 acceptance. During branch
preparation, changing a record requires regenerating its compatibility exports and
passing the original subject-anchor checks; generated exports are never a second
manually maintained registry.

## Identity and historical navigation

The lookup key is `(namespace, original ID)`. Add the source revision and locator
when selecting historical evidence. `ZAI`, `ZNEXT`, and `edge` remain distinct.
An ambiguous bare ID is an error, even when both source files have the same suffix.
The incoming crosswalk retains its original ZAI-to-ZNEXT direction. An approved
one-to-one inverse alias may return a ZAI canonical record only with the matching
source revisions; split, merge, retired, dropped and unreviewed mappings are not
aliases. The [compatibility contract](COMPATIBILITY.md) defines exact lookup and
canonicalization separately.

Current navigation never rewrites an old snapshot's paths, hashes, verifier
version, namespace, approval evidence or source statements. The runtime
[integration contract](INTEGRATION.md) retains the v1 reader and adds an explicit
v2 reader. There is no database migration or historical receipt rewrite.

## Lifecycle and evidence

Document approval, requirement delivery, change-request state, task state and
deployment evidence are separate facts. The migration preserves the original
state instead of translating every source field into one generic `status`.
`source-preserved` on a canonical wrapper records migration handling only; the
original registry row keeps its own approval and delivery markers.

A proposed ADR remains proposed. A CR intake remains intake. A retired rule stays
burnt. A test-path reference establishes navigation to a test, not a passing test
result. Local tests, hosted CI, release, deployment and production activation must
be reported separately. An imported ZNEXT TC or `legacy:` relation cannot mark
the current ZAI behavior implemented or live.

## Relation vocabulary

| Incoming relation | ZAI handling |
|---|---|
| `implements` | Explicit current ZAI boundary annotation; requirement evidence only after identity resolution |
| `verifies` | Direct test-to-requirement edge; never reinterpret as code-to-test `@tested` |
| `specified_by`, `decided_by` | Exact current design/decision reference; does not create implementation evidence |
| `relates_to` | Navigation only |
| `supersedes` | Preserve explicit approved lineage and original subject; never infer from crosswalk cardinality |
| Ownership, dependency, runtime and participation relations | Retain source meaning in provenance; current ownership still requires the owning ZAI contract |

Existing `@req`, `@spec`, `@tested`, document control blocks and typed link metadata
remain supported. Qualified `@trace` is an additive adapter; copying imported
annotations does not silently bind them to current requirements. Unsupported or
ambiguous relations remain findings rather than fabricated graph edges.

## Authoring and verification order

1. Find the exact qualified ID and read its parent decisions, peer contracts and
   current source. Follow the pinned crosswalk only as a navigation lead.
2. Preserve the original subject and lifecycle. A changed behavior requires its
   own reviewed requirement/decision under existing ZAI allocation rules.
3. Edit only the canonical source for that fact, regenerate compatibility exports,
   and run the original ID ledger and governance checks.
4. Inspect impact and test bindings. Run the actual scoped tests, then integration
   checks for every changed reader and generated projection.
5. Record exact revision, version diff and validation results. Merge and operational
   cutover require the separate acceptance specified in the approved plan.

Detailed unreviewed spec/code discrepancies remain in the private assessment.
Public disposition records may state a review gate and its opaque reference without
publishing private operational or security details.

## Version diff

0.0 → 0.1.0: adds the ZAI adoption profile for artifact coverage, lifecycle,
relations, authoring and historical navigation. No issued identity is reallocated.
