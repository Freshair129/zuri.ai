---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Frozen approval relative-link context

## Symptom

The exact sealed receiver approval contains nine relative Markdown links that resolve incorrectly from its evidence directory. The approved text cannot be rewritten without invalidating its digest.

## Evidence

A read-only filesystem check found 9/9 relative targets missing when resolved from `docs/migrations/document-reintegration/record-migrations/`, and 0/9 missing from the original `docs/change-requests/marketing/` directory. The preflight relative-link loop initializes every non-canonical row's context from its current directory; it has no frozen-approval source-context mapping.

## Root Cause

The new immutable approval copy retains its original source bytes, including relative locators, but the link consumer assumes relocation changes their meaning. Original v1 canonical rows already preserve source context; frozen approval evidence requires the same principle.

## Why the issue escaped detection

Synthetic approval fixtures contained no relative links. The actual approved receiver note exercises this case during composed migration verification.

## Proposed prevention

Resolve links in indexed authored approval evidence against its validated original approval path. Continue checking every target and all other documents normally; do not exempt evidence from link validation or rewrite its bytes. Verify the real nine-target set and composed governance, including independently reviewed output.
