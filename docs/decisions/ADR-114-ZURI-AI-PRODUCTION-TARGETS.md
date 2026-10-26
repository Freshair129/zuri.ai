---
id: ZAI:ADR-114
title: Zuri AI production database targets
version: "0.1.0"
status: accepted
created_at: "2026-10-26"
last_update: "2026-10-26"
author: Codex
approval_scope: production-database-target-documentation
approved_on: "2026-10-26"
approved_by: User instruction in this session
superseded_by: null
attributes:
  doc_type: architecture-decision
  domain: platform-control
  scope: "Distinguish the self-hosted PostgreSQL and cloud Supabase production targets without selecting, connecting, migrating, or deploying either target"
relations:
  - type: relates_to
    target: ZAI:ADR-018
  - type: relates_to
    target: ZAI:ADR-058
  - type: relates_to
    target: ZAI:ADR-104
  - type: relates_to
    target: ZAI:ADR-112
---

# ADR-114 — Zuri AI production database targets

**Status:** Accepted on 2026-10-26. This record clarifies target classification and does not authorize production access or changes.

## Context

The architecture and deployment records describe PostgreSQL in different scopes. ADR-058 records Supabase as the production data store in its deployment context while its container decision allows PostgreSQL selected by `DATABASE_URL`. ADR-018 defines controls for the named cloud Supabase project, and ADR-104 governs its production migration lineage. ADR-112 records the isolated primary-checkout development database.

The product owner confirms that Zuri has two distinct production database targets: self-hosted PostgreSQL and cloud Supabase. Self-hosted PostgreSQL is not inherently a development or UAT target. No shared data, replication, synchronization, or dual-write behavior between these targets is assumed.

## Decision

1. Classify self-hosted PostgreSQL and cloud Supabase as separate production database targets. Hosting location alone does not determine whether a PostgreSQL target is development, UAT, or production.
2. Identify both the target and the environment when documenting or planning a production database operation. Naming a target does not authorize access or a change.
3. Keep the existing target-specific controls in force. ADR-018 continues to govern the cloud Supabase tenant and access boundary; ADR-104 continues to govern the Supabase migration lineage and apply gates; ADR-058 continues to govern the accepted Docker Compose and ngrok deployment path; ADR-112 continues to govern the named primary-checkout development stack.
4. Do not infer shared data, replication, synchronization, failover, or dual writes between the two production targets. This decision adopts no cross-target data behavior.
5. This documentation decision does not authorize connecting to either production target, using credentials, copying data, applying migrations, or deploying an application.

## Alternatives and consequences

- Treating cloud Supabase as the only possible production database would conflict with the product owner's confirmed self-hosted PostgreSQL target. The architecture summary now distinguishes both.
- Classifying every self-hosted PostgreSQL instance as development or UAT would conflate hosting location with environment. The environment must be stated separately.
- Assuming the two targets share data or synchronize would create an undocumented data contract. No such contract is adopted here; a future cross-target behavior requires its own reviewed decision.

## Verification

This record is reconciled against ADR-018, ADR-058, ADR-104, ADR-112, the architecture summary, and the data-flow atlas. Repository governance checks validate document metadata and views. No production database was accessed, and no production migration, deployment, or runtime behavior was tested by this documentation change.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0 | 2026-10-26 | accepted | Distinguishes self-hosted PostgreSQL and cloud Supabase as separate production targets without implying cross-target data behavior or authorizing operations | uncommitted | Codex |
