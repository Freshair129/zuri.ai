---
status: active
superseded_by: null
version: "0.1.0"
---

# Candidate ratio bound exceeded the approved wire

## Symptom

The arithmetic-validation follow-up rejected an attested reported CTR of 2/1 = 2.

## Evidence

Independent review reproduced a canonical hash-valid known CTR 0.5 passing and CTR 2 failing solely on the numerator-versus-denominator cap.

## Root Cause

The implementation generalized the approved mature-cohort subset constraint to all ratio metrics. The wire defines no CTR cap. Arithmetic consistency does not grant authority to add a reported-value policy.

## Why the issue escaped detection

The initial golden fixture exports only UNKNOWN/null measurements. It did not cover accepted known values. The original foreign-read fixture also used a separate database, covering missing-object denial rather than two existing scopes.

## Proposed prevention

Keep only reviewed bounds, add positive CTR/CPL and inconsistent-ratio cases, and exercise foreign Tenant/Business records in the same native database. Retain independent review before acceptance.
