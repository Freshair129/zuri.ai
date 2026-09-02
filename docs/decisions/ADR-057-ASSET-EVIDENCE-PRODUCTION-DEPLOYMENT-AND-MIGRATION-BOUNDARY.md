---
version: "0.2.0b"
created_at: "2026-09-02T12:19:45+07:00,RWANG"
last_update: "2026-09-02T12:24:44+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "architecture-decision"
  scope: "Production target identity, PostgreSQL migration lane, private storage, two-phase Vercel deployment and redacted canary evidence"
---

# ADR-057 — Asset Evidence Production Deployment and Migration Boundary

## Status

**Status:** Accepted as beta by the owner on 2026-09-02. Implementation and
production mutation may proceed only through the gates in this decision.

## Context

ADR-056 defines the provider-neutral storage and extraction boundary. CR-015
implemented and verified that boundary as a local beta. Production activation
exposed four operational facts that the local implementation gate did not need to
close:

- the current operator context has no unambiguous `zuri-ai` Vercel project;
- the current checkout has no remote Supabase link or production PostgreSQL URL;
- Asset migrations exist only in the Prisma/local lane, not the Supabase
  production migration lane;
- required provider variable names are absent from `.env.example` and the
  observable environment scopes.

Production evidence includes receipts and payment proofs. Guessing a target,
auto-creating a duplicate project or running SQLite-oriented SQL against
PostgreSQL would be a higher-severity failure than postponing activation.

## Decision

### D1 — Production target identity is a required input

Every production command must bind to an explicit Vercel team/project and
Supabase project ref. The Vercel project must be linked to
`Freshair129/zuri.ai`. A missing or mismatched target fails closed; automation
must not create a similarly named project as a fallback.

### D2 — Supabase migrations are the production PostgreSQL authority

`prisma/schema.postgres.prisma` defines the intended application model, while
reviewed SQL under `supabase/migrations/` is the production application artifact.
SQLite Prisma migrations are not applied to Supabase. The Asset migration must be
generated against and reviewed with the actual remote baseline so existing
production objects are neither recreated nor dropped.

### D3 — Asset production migrations are additive and receipt-backed

The two Asset migration versions create only the declared tables, indexes,
relations and metadata required by FR-133..140. They execute in transactions,
record the Supabase migration ledger and have post-apply inventory queries. No
down migration may drop evidence, audit or Asset data.

### D4 — Storage remains private and server-mediated

The Asset evidence bucket is private, bounded to 20 MiB and restricted to the
accepted image/PDF MIME set. Only server-side service-role credentials may call
the object API. Application responses and canary receipts retain opaque
`supabase://` references, never public URLs or credentials.

### D5 — Provider variables are explicit server contracts

The repository declares required variable names with empty/example values. Secret
values live only in Vercel Production scope or an approved local secret file.
Service-role and OpenAI keys must never use a `NEXT_PUBLIC_` prefix. Deployment
preflight checks presence and scope without reading values into logs.

### D6 — Deployment uses migrate, verify, deploy, canary, promote

The activation sequence is:

```text
target identity + backup/inventory
              ↓
additive Supabase migrations + ledger verification
              ↓
private bucket/config verification
              ↓
protected Vercel deployment from merged main SHA
              ↓
synthetic real-provider canary + runtime error scan
              ↓
production alias promotion
```

Promotion is forbidden while any preceding gate is missing or unresolved.

### D7 — Canary evidence is synthetic and redacted

The first live canary uses a generated receipt/payment-proof artifact containing
no real person, bank account, tax ID or supplier data. Logs and reports may retain
hashes, opaque IDs, document type, status, confidence bands, timings and HTTP
status codes. They may not retain document bytes, extracted field values, provider
payloads or secret material.

### D8 — Rollback separates application traffic from additive data

Vercel alias rollback stops the new application artifact. Removing provider
configuration stops new external calls. Additive database structures and migration
receipts remain in place to preserve evidence; rollback never drops production
tables as an operational shortcut.

## Alternatives rejected

| Alternative | Reason rejected |
|---|---|
| Auto-create `zuri-ai` in the currently connected Vercel team | the authenticated account may be wrong and would create a duplicate production target |
| Run `prisma migrate deploy` with the local migration lane | the current Asset SQL is SQLite-oriented and not the reviewed Supabase artifact |
| Deploy first and add secrets later | exposes an incomplete receiving surface and prevents a meaningful canary |
| Put service keys in a temporary command or committed env file | leaks durable production authority into logs/history |
| Use a real employee receipt for the first canary | unnecessary PII/payment-data exposure when synthetic evidence proves the provider path |
| Drop Asset tables on rollback | destroys evidence and violates the additive/audit boundary |

## Consequences

Benefits:

- production commands become target-specific and repeatable;
- SQLite/PostgreSQL migration semantics are no longer conflated;
- provider activation has a reversible application path and durable receipts;
- the first live proof carries no real payment or identity data.

Costs:

- activation waits for owner approval and authentication of the intended accounts;
- two additional production migration artifacts and focused tests are required;
- the database migration remains after application rollback because it is
  additive and evidence-preserving.

## Verification

- migration tests reject destructive SQL and SQLite-only types in the Supabase lane;
- migration inventory proves tables, indexes, relations and ledger receipts;
- environment-contract tests cover every configured Asset adapter variable;
- storage verification proves bucket privacy, size and MIME policy;
- canary verification proves `CANDIDATE → human review → READY_FOR_REGISTRATION`
  and refuses any direct approval/registration transition;
- Vercel build/deployment inspection and runtime error scan are retained in the
  redacted activation report.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | draft | Proposed the production target, migration, deployment and canary boundary | working-tree | RWANG |
| 0.2.0b | 2026-09-02 | beta | Owner accepted the production deployment and migration boundary | working-tree | RWANG |
