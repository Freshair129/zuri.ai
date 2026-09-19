---
id: ZAI:RCA-2026-09-17-PHASE-B-PRICING-RECOVERY
title: Preserve Pricing recovery semantics while composing Phase B
version: "0.1.1b"
status: beta
created_at: "2026-09-17T14:53:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T14:53:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: HIGH
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:FR-253
---

# Phase B / Pricing recovery composition

## Symptom

Composing approved Phase B W2 commit 052821a7 with published main 892f23f3
produces overlapping recovery, schema and API inventory changes. A mechanical
choice of either side would omit one family's recovery protections.

## Evidence

Main introduces PricingRuleSet and PricingCalculation, pricingRecovery and
pricingRuleRestoreRows. The web importer sorts the self-referencing rule-set
chain before insertion and reverses that order for deletion. W2 introduces a
shared validateSnapshotRecovery function and an offline INSERT-only hook. Its
existing shared validator has no pricingRecovery entry, and the hook selects
normalized archive rows but otherwise uses raw table order. Both sources passed
their separate checks; the new composition has not yet passed its own gates.

## Root cause

The independently authored recovery paths have different knowledge of the
complete snapshot family. The new shared W2 validator and offline insertion
hook predate the Pricing validator and its self-reference ordering.

## Why it escaped detection

The W2 proof target has 175 application models and predates the two Pricing
models. Pricing's web restore tests cannot exercise the later offline W2 hook.

## Correction and prevention

Preserve both published families and their source validators. Compose the
Pricing validator into the shared validation result, use its normalized rule
order in offline insertion, retain the web importer's Pricing deletion order,
and continue excluding all six PM families from web replacement. Regenerate
the PostgreSQL schema and re-freeze the complete 177-model inventory from the
composed canonical schema. Prove malformed Pricing refusal and out-of-order
derived-rule recovery, then rerun composed governance, tests and actual CLI
proof before release. Existing root local evidence remains attached to 052821a7.

The upstream usage-clock fixture correction and its RCA supersede this branch's
equivalent local fixture fix; neither alters production time behavior. Published
FR-253/ADR-098 ledger entries are retained through the sanctioned ledger gate.

## Validation

Composed local PASS: 48 recovery regression tests and the actual isolated
PostgreSQL CLI proof (22 positive plus 15 adversarial cases). The proof restores
all six PM families plus PricingRuleSet and PricingCalculation, verifies exact
rows after child-first input normalization, and rejects malformed Pricing
hashes, cycles and foreign-scope references. Thirteen source/dependency hashes
remain unchanged across the proof. The 177-model inventory and both schema
adapters passed independent static review. Evidence:
phase-b-integrated-recovery-tests-final.log and
phase-b-integrated-final-cli-proof.json. Full composed application tests,
build, browser, hosted CI and production gates remain separate. No production
schema or runtime was changed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | beta | Record composed 177-model inventory review and isolated recovery proof | 052821a7 + 892f23f3 | RWANG |
| 0.1.0b | 2026-09-17 | beta | Record source-proven recovery composition and narrow preservation plan | 052821a7 | RWANG |
