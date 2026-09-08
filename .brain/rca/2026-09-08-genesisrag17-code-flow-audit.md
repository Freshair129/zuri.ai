---
version: "1.0.0b"
created_at: "2026-09-08T03:19:00+07:00,RWANG"
last_update: "2026-09-08T03:19:00+07:00,RWANG"
status: under review
attributes:
  domain: knowledge
  doc_type: root-cause-analysis
  scope: GenesisRAG17 code-flow audit; no runtime fixes
---

# GenesisRAG17 happy-path success did not establish complete conformance

## Symptom

The frozen native fixture completes all 17 stages, but ordinary temporal,
same-name/type and negated/compound text examples produce a decision-builder
exception or incorrect facts. Automatic recovery also omits work before the
Stage9 batch and between native commits and durable receipts.

## Evidence

The [full audit](../reports/GENESISRAG17-CODE-FLOW-AUDIT.md) records the exact
four heads and source line references. Fresh [actual parser-to-GKS probes](../reports/genesisrag17-audit-source-to-gks.json)
reproduce reversed-interval `ReferenceError: predicate is not defined`, an
unrecognized date becoming not_applicable, Person/Product occurrences becoming
one canonical entity, and positive .90 facts from a negated statement. Compound
text creates a spurious Person and a wrong purchase subject.

[Focused probes](../reports/genesisrag17-audit-boundary-probes.json) demonstrate
Stage8 failure reporting one input after eight chunks, refusal of the wire's
Pending/null decision response, and refusal of WARN before receipt validation.
The pointer probe injects a first-rename EPERM on synthetic files and observes
the missing target between backup and replacement. It is not a process-kill
test. Native commit recovery is traced across worker commit/state writes and
the native engine's full-payload transaction identity check.

## Root Cause

1. **Stage12 failure routing:** the invalid-order branch uses a `predicate`
   identifier scoped only to the preceding Stage11 loop. The intended HELD
   branch throws before the service persists the batch/decision/evidence.
2. **Temporal classification:** the default state is not_applicable rather than
   unmapped, and the ISO-date-only parser never preserves unsupported date
   evidence as a different state.
3. **Identity/extraction:** Stage9 groups on normalized name alone and takes the
   first semantic type. Stage8 regex and Stage10 nearest-mention selection do
   not preserve grammatical subject or all negation meanings, yet candidates
   meeting these patterns receive .90 confidence.
4. **Native recovery:** transaction identity is stable, but its expected frontier
   is recalculated on retry and intent/receipt is not persisted atomically with
   the native commit. A replay after the unrecorded commit differs under the
   same transaction ID, which the native engine rejects. The graph receipt path
   also removes its outbox before persisting the accepted response's derived
   state, leaving another crash interval that re-enters the graph commit.
5. **Pointer replacement:** the conditional fallback performs two filesystem
   renames, introducing a missing-pointer interval. In-process exception restore
   is not a process-crash recovery protocol.
6. **Tier1 recovery/metrics:** the source loop discovers work from Stage9 batches
   only; local input stages precede batch creation. The local failure wrapper
   also replaces stage-specific work counts with constants. Stage9 timing starts
   after canonical lookup, excluding that part of resolution.

## Why the issue escaped detection

The corpus has eight simple positive clauses with distinct entity types/names
and no dates. Temporal parity tests exercise helpers, not the pipeline's
invalid-order branch or unmapped routing. Crash tests run after ingestion and
the named post-native-commit hook is placed after durable receipt/outbox writes.
Stage metric checks assert nonnegative values, not independent count accuracy.
These tests validly prove their scenarios but cannot establish every stage's
failure/recovery semantics. Documentation clarified the implemented profile but
still described temporal state separation and broad recovery more strongly than
the code supports.

## Proposed prevention

Keep the existing positive fixture and add negative/ambiguous data fixtures
through the actual source extractor and decision builder. Define type conflict,
temporal unknown/NA, subject-binding, failure counters and WARN/Pending behavior
in the shared contract before fixes. Persist reproducible native transaction
intent and add recovery from the actual commit-to-receipt gap. Exercise pointer
failure inside the fallback and source process death before the batch exists.
Rerun the real native chain after fixes and add populated two-tenant retrieval
tests. Do not weaken assertions, hand-write successful evidence or relabel the
old acceptance as proof of the repaired cases.

No application code or tests were changed in this audit. The detailed scope and
proposed fixes remain reviewable in the linked report.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | under review | Record confirmed code-flow causes and acceptance coverage gaps | audited zuri 436022a7 | RWANG |
