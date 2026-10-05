---
status: active
superseded_by: null
version: "0.1.0"
---

# Marketing report enum key coercion

## Symptom

The new receiver candidate accepted hash-valid array values for a metric key and review gate status.

## Evidence

Independent read-only review reproduced `metric.key = ['reported_spend']` and `reportedGateStatus = ['ON_TRACK']` passing `parseMarketingReport` on canonical hash-valid envelopes.

## Root Cause

`Object.hasOwn` and property lookup coerce keys to strings. Enum membership did not first require the input to be a string.

## Why the issue escaped detection

The initial adversarial suite covered array report IDs, unknown enum values and forged fields, but omitted array values for these two lookup-based enums. Native storage tests used the valid Go fixture.

## Proposed prevention

Require string type before each lookup-based enum check and retain the two hash-valid adversarial reproductions. Independent application acceptance remains pending until review and native boundary checks pass.
