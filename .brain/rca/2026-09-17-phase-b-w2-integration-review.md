---
id: ZAI:RCA-2026-09-17-PHASE-B-W2-INTEGRATION
title: Phase B W2 review caught incomplete transaction boundary proofs
version: "0.4.0b"
status: beta
created_at: "2026-09-17T13:15:00+07:00,RWANG,bd99651f"
last_update: "2026-09-17T14:38:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: HIGH
relations:
  - type: references
    target: ZAI:FR-252-P1
---

# W2 integration review

## Symptom and evidence

Independent Luna Max review of the uncommitted W2 draft found scope resolution
before Project locking without a post-lock recheck, unchecked PostgreSQL lock
results, and an erasure scope assertion reached after replay. Binding occurred
outside the restoration guard. The Identity wrapper also read a new `review`
property instead of preserving the approved internal `authority` object.

The first composed diagnostic suite passed 55 of 64 cases. Six new recovery
fixtures lacked Business ownership for Project creation. Three existing
archive/rollup race tests injected their competing row at the first transaction;
the added Phase B read-only preview transaction shifted that injection before
legacy preview counts. The refusal still prevented deletion, but no longer
exercised the intended commit-side guard. Governance independently rejected six
copied core enum lists with missing legal states.

## Root cause

The draft treated a pre-lock scope lookup and successful SQL execution as a
complete transaction proof. Replay and binding failures bypassed parts of that
proof. Root introduced a second internal review shape and changed preview
sequencing without composing the existing race evidence. None of these changes
has been committed, merged or deployed.

## Why this escaped the first checks

Positive-path fixtures proved data changes, but did not force missing lock rows,
hierarchy changes at locking, foreign prebound scope on replay, or failed
scope readback. The first root erasure fixture mirrored the mistaken wrapper.

## Prevention and correction within approved policy25/decision26

Require actual lock rows and recheck the hierarchy under locks. Reject foreign
initial scope before replay and restore scope around binding as well as callback
execution. Keep one reviewed authority shape and retain its digest binding.
Use a sanctioned Business-owner fixture; keep legacy preview checks before the
Phase B visibility transaction, then recheck every protected family before the
first delete. Import canonical enums. Add adversarial tests and refresh the
independent review and composed proofs before declaring W2 complete.

CRM legal-hold serialization is a pre-existing peer finding, tracked separately;
the PM change preserves its central key-destruction seam without changing peer
policy or claiming a new CRM concurrency guarantee.

## Validation

The corrected repository/erasure/Identity packet passes 50 tests across eight
files. Protected web recovery and existing archive/rollup race regressions pass
36 tests across four files. Runs overlap and must not be summed. Actual isolated
PostgreSQL adapter proof passes 13 checks. The real CLI now passes 18 checks,
including 175-table emptiness and an exact six-family roundtrip. These are local
proofs; the independent recovery review remains open until its corrections and
adversarial CLI rollback cases pass.

## Recovery boundary findings

The independent review additionally found that the recovery runner hashed
retained bytes while accepting a separately supplied parsed object, trusted a
self-consistent inventory without the approved target binding, normalized schema
bytes before comparison, omitted two GovernanceSnapshot proof bindings, and
reconciled only six export counts. Direct writes to the final backup path did
not meet the approved atomic-publication boundary. These are confirmed source
gaps against decision26, not new requested capabilities.

Actual CLI execution exposed two adapter integration defects: PostgreSQL table
privilege checks passed mixed-case relation names without identifier quoting,
and a missing error-code constant yielded an uninformative null refusal.
The temporary composed-service bundle also needed the expected named Prisma
export and application dependency lookup. Corrections allowed the 18-check
real CLI roundtrip to pass; that positive proof does not close the structural
findings above.

The root cause is treating independently correct helpers and fake adapters as
proof of the executable command's complete boundary. Prevention is to derive
the parsed snapshot from retained bytes, enforce the frozen schema binding,
reconcile all included families, validate before READY or writes, publish
atomically, and exercise the actual CLI against an isolated database with
forced insert and reconciliation failures before accepting the worker packet.

## Full-suite legacy parent regression

The composed full Server suite exposed a further compatibility defect after
the isolated positive and negative CLI proofs passed. All 13 archive/rollup
release-safety cases failed with `Tenant[29] has no valid id`; seven stocktake
backup cases and the LINE server backup case also failed or lost their original
recovery result. The underlying helper validated every existing parent row's
ID as UUID even when all six PM arrays were empty. The unrelated legacy row
therefore masked the earlier protected-family validators and refusals.

Root cause: the new PM validator widened its authority from PM records and
their referenced ancestry to every legacy parent in a complete snapshot. This
violates decision26's preservation of existing recovery behavior. The focused
fixtures contained only UUID parents; the complete suite includes existing
legacy identifiers written by unrelated features, which exposed the widening.

Correction: inspect parent identity/scope only for ancestors actually referenced
by PM records. Keep strict UUID/shape validation on all six new families and
typed scope refusals for missing or inconsistent referenced ancestors. Preserve
the original archive/rollup/stocktake/LINE assertions. Add explicit unrelated
legacy-parent fixtures for both empty and nonempty PM families and rerun the
existing backup regressions followed by the full suite. This correction remains
inside the approved recovery compatibility contract; it grants no new access.

Older portable-file, marketing and stocktake proxy fixtures also supplied no
database provider identity.
The new completeness adapter correctly refuses an unknown provider; these
fixtures must explicitly model SQLite while preserving their existing portable
file and marketing recovery assertions. Do not add an ambient provider fallback
or treat a mock count of zero as a production completeness proof.

## Closure evidence

Final correction evidence: the executable recovery normalizer now pins the
approved schema/target hashes and 175-model mapping at every adapter, runner
and facade. Export requires the existing recovery validator and refuses both
missing and failed validation. The raw-byte CRLF regression passes. Independent
W2-A/Identity/W2-B review passes; the complete Server suite passes 6066 tests
(32 skipped), optimized build and governance pass, and 32 existing browser
cases pass. Actual CLI standard 18/18 and adversarial 11/11 pass with unchanged
source bytes. These close the local W2 findings; hosted and production gates
remain separate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.0b | 2026-09-17 | beta | Record closure of executable inventory/validator boundaries and final composed verification | bd99651f | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record full-suite evidence that blanket parent UUID validation violates legacy recovery compatibility and specify referenced-ancestor correction | bd99651f | RWANG |
| 0.2.0b | 2026-09-17 | beta | Record passing repository and real CLI proofs plus independently confirmed recovery boundary gaps and their prevention | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Record source-proven W2 integration gaps before correction | bd99651f | RWANG |
