---
doc_type: migration-verification
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Authored Marketing receiver records — verification

The owner approved the [receiver intake](../../change-requests/marketing/ZURI-GO-REPORT-RECEIVER.md) and separately approved [additive record tooling](../../change-requests/marketing/ZURI-GO-RECORD-AUTHORING.md). This C-3/HIGH slice adds a governed writer and issues planned canonical statements; it does not implement a receiver, sender, database schema or live credential.

## Reviewed candidate and issuance

Tooling commit `90b9df7dfb65550e9c18259fc817291126546887` has reviewed tree `ec3f59c4f5bfd44bcd5591b19f4b6bc30f15fce1`. Independent source review returned PASS after two findings were reproduced and fixed: provenance cache inputs and dangling-link detection. [RCA](../../../.brain/rca/authored-record-review-boundaries.md) records the evidence and prevention. The earlier export adapter failure has a separate [RCA](../../../.brain/rca/authored-record-export-shape.md). Composed verification also identified the [frozen approval link context](../../../.brain/rca/frozen-approval-link-context.md); preflight now checks those original relative targets without changing the sealed evidence.

Independent manifest review returned PASS for SHA-256 `7a5e6c9dbef8532389364214810d7c8b6f27484a6ec64ff8e122c972b294f10a`. The reviewer independently checked base/approval ancestry, versions and digests, exact statements, candidate collisions and the read-only plan. Fresh remote main remained `332b88c9277ee0995798f125f99d5343e7d493f0`. Review made no database access or source edits.

The [source manifest](record-migrations/marketing-report-receiver-20261005.manifest.json) pins that tooling base and receiver approval revision `095332c67bac9ed2bbd2cf3d5adecfba77463473`, v0.4.0. The writer generated its exact [frozen approval evidence](record-migrations/marketing-report-receiver-20261005.approval.md), canonical records, index/exports and [APPLIED receipt](record-migrations/marketing-report-receiver-20261005.receipt.json), invoking the existing add-only ID writer. No ledger/index was hand-edited.

- [FR-278](../../requirements/FR-278.md): dedicated report principal, scope and per-transaction machine authorization.
- [FR-279](../../requirements/FR-279.md): atomic immutable intake, replay, revision 1 only and source preservation.
- [FR-280](../../requirements/FR-280.md): existing human read authority, private evidence and 90-day minimum retention.
- [SDD-111](../../requirements/SDD-111.md): receiver design subject; physical append-only design and native test bindings still need review before application coding.

All four delivery cells remain `planned`; none was assigned to an existing feature. Index version changes 1 → 2 and new record wrappers use version 2; all original 539 wrappers remain version 1. Snapshot schema/proof versions retain their separate existing meaning. Composed graph initially refused the three new standalone FRs because their [readiness presentation metadata was missing](../../../.brain/rca/authored-readiness-presentation.md). The owning FEATURES source template now adds only their domain/use-case entries and regenerates its export, preserving every original feature row/membership and presentation entry. The legacy graph reader also [missed the exact plain planned cell](../../../.brain/rca/authored-planned-graph-status.md); its narrow compatibility fix retains planned classification and no delivery claim without weakening coverage checks.

## Executed checks and limitations

| Check | Result / boundary |
|---|---|
| Read-only plan / actual apply / immediate identical reapply | PASS — PLANNED → APPLIED → ALREADY_APPLIED before the subsequent presentation edit; identical reapply wrote nothing. After that legitimate export change, reapply must refuse output drift; the issuance receipt remains historical, not rewritten to match later output |
| Original corpus and pins | PASS — 539 original records/index entries and 747 original pinned metadata objects unchanged; 543 current records and 751 pins; original requirement export is an exact prefix. Feature export was unchanged at issuance; subsequent presentation generation adds only the three new standalone entries |
| Post-presentation export and drift guard | PASS — FEATURES SHA-256 `a653f708f70ba7e1eb157752f51f5675f592003606b331617f1cf28b346710c4`; all old feature/membership text and readiness entries preserved. Read-only reapply plan refuses `applied migration output drift: docs/FEATURES.md`, as required after later source edits |
| `npm run docs:migration:test` | PASS — 73 tests, 0 failure/skip, before and after issuance; real writer uses synthetic Git/filesystem fixtures, not user databases |
| Focused source snapshot/verifier unit suites | PASS — 32 tests, 0 failure/skip, on the reviewed tooling; historical proofs and mixed authored/imported provenance are covered |
| Full-size snapshot qualification | PASS — serialized run verifies 277 FR / 46 features within unchanged 20-second budget (case 14.995 seconds). Earlier concurrent run had 31 PASS / 1 timing failure; its failure log is retained. Resource contention is a hypothesis, not a confirmed root cause |
| Composed planned/retired graph projection tests | PASS — 9/9 on regenerated output; new authored FRs are planned, not ready and receive zero delivery credit, while old retirement/denominator behavior remains covered |
| Full governance before issuance | PASS — registry/inventory/identity, graph/views and strict preflight; baseline accepted debt remains |
| Full governance after issuance | PASS — final `npm run govern` exit 0 with 543 canonical records, 751 pins, 96 generated views, fresh graph and strict preflight; accepted baseline debt remains. The earlier missing-readiness and planned-status failures were retained/documented and resolved before publication |
| Independent post-issuance review | PASS — composed tree `f579325fef7e7c619b2e068b8e15d06fd9f5c0c0`: reviewer independently verified preservation, issued record/manifest/receipt hashes, deliberate presentation drift, registry check and planned/zero-credit projection; final governance exit subsequently completed |
| Receiver/sender runtime and physical design | NOT_RUN / OPEN — no application route/auth/Prisma/schema implementation; no existing database, credential, user data or deployment changed |

Private logs and preservation receipts stay under the operator checkout's `.local/postgres-local/`; canonical issuance evidence above contains only documentation metadata/digests. The active parent checkout/runtime is untouched. No merge is performed by record issuance.

Final remote-main recheck: `3506129ffc1feb93773d2110901e248609f80f7c` advances the earlier issuance-time `332b88c9` through PM workflow documentation/guard PR #631. Read-only fetch/range inspection confirms its ledger still has 747 pins and none of these four candidates; registry/schema/Marketing/Identity files were not changed by that range. This branch's tests/governance remain evidence for its own reviewed composition; integration/retesting against the newer main is NOT_RUN and remains a pre-merge check. No main merge/rebase or active-checkout movement was performed.

Version diff 0 → 0.1.0: records reviewed additive tooling, exact governed issuance, preservation, tests and remaining physical/application gates. Application package and database versions do not change.
