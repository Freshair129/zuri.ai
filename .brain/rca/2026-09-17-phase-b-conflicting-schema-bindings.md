---
id: ZAI:RCA-2026-09-17-PHASE-B-SCHEMA-BINDINGS
title: Recovery must validate every declared schema binding
version: "0.1.1b"
status: beta
created_at: "2026-09-17T15:28:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T15:28:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: HIGH
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-RECOVERY-ERASURE-DECISION
---

# Conflicting recovery schema declarations

## Symptom and evidence

The isolated 177-table actual CLI adversarial case set the nested
phaseBRecovery.targetSchemaSha256 to the obsolete 175-table digest while
retaining the correct top-level targetSchemaSha256. Recovery reported
RESTORED and inserted 23 synthetic rows. The harness halted before reusing the
database; no production resource was involved. The single-old-binding case
had correctly refused. Evidence: phase-b-integrated-cli-adversarial.json,
case "obsolete 175-model snapshot binding", 2026-09-17.

## Root cause

validatePhaseBSnapshot selected the declaration with topLevel || nested.
A valid top-level string therefore hid a conflicting nested declaration.
An empty top-level value could likewise evade its own validation. Both fields
can occur in the real protected-export artifact.

## Why it escaped detection

The original W2 schema tests covered one declaration and inventory mutation,
but did not contradict the two declaration locations. The independently
composed 175-to-177 fixture exposed the case through the actual command.

## Correction and prevention

Validate every present declaration independently against the frozen target
hash. Either invalid, empty or conflicting declaration refuses with the
existing TARGET_SCHEMA_UNVERIFIED code before insertion. Preserve agreement
and the existing optional-field contract. Add both conflict directions and
empty-declaration unit regressions; rerun the complete actual CLI proof with
fresh owned databases, retaining the original failure evidence.

## Validation

Local repair PASS: all 48 tests in the four-file recovery regression passed.
Fresh actual CLI proof passed 22 positive and 15 adversarial cases, with all
13 source/dependency hashes unchanged across the run (sourceFrozen true).
Both conflicting declaration directions refuse before insertion. Evidence:
phase-b-integrated-recovery-tests-final.log and
phase-b-integrated-final-cli-proof.json. The original failing evidence is
retained as phase-b-integrated-cli-conflicting-binding-failure.json.
This proves the isolated PostgreSQL lab only; production and hosted CI were
not exercised.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | beta | Record 48 local tests and source-frozen 22 positive plus 15 adversarial actual CLI checks passing | 052821a7 + 892f23f3 | RWANG |
| 0.1.0b | 2026-09-17 | beta | Record actual CLI proof of conflicting schema declarations and narrow fail-closed correction | 052821a7 | RWANG |
