---
version: "0.1.0b"
created_at: "2026-09-06T23:00:00+07:00,RWANG,fe0558ec"
last_update: "2026-09-06T23:00:00+07:00,RWANG"
status: beta
attributes:
  domain: marketing
  doc_type: rca
---

# Content migration version collision during main integration

## Symptom

The full Server suite reports two failures in migration-version-uniqueness.test.js.

## Evidence

Both Prisma and Supabase enumerate `20260906230000_inventory_domain` and
`20260906230000_marketing_content`. The published main branch owns Inventory;
the Marketing migrations have never been applied to production in this task.

## Root Cause

Independent branches allocated the same timestamp. Git merges distinct filenames,
while migration receipts use the timestamp as identity.

## Why the issue escaped detection

The branches individually had unique versions; schema drift checks ensure columns
have DDL but do not check receipt identity. The full merged-tree uniqueness test
caught the collision before publication.

## Proposed prevention

Preserve published Inventory identity. Move only the unpublished Content migration
to `20260906234000` in both stores, update its policy test filename, and run the
existing uniqueness/policy tests plus the full suite. SQL contents remain unchanged.
No deployed receipt is edited. This is part of the approved monorepo reconciliation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Record merged migration identity collision and bounded correction | See git history | RWANG |
