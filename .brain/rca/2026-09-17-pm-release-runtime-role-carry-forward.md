---
title: PM release runtime database role carry-forward
version: "0.1.0b"
created_at: "2026-09-17T01:36:00+07:00,RWANG,release c07cfaba"
last_update: "2026-09-17T01:36:00+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: platform-control
  doc_type: root-cause-analysis
  scope: Production role evidence required before Phase B writes
---

# Runtime role differs from the intended RLS boundary

## Symptom

The existing production application connection uses `postgres` with
`rolbypassrls=true`. Catalog inspection shows the intended `zuri_app_runtime`
policies and grants, but this does not establish that application queries are
subject to that role's row-level security.

## Evidence

The read-only release preflight on 2026-09-17 observed the running revision
`e8fc84bd80813965f9c9b1ecf61091ffa60bf4ec`, before promotion of
`c07cfaba8eedb53f677e313977a1e2344fb5c8c5`:

- A connection inside the web container using its existing `DATABASE_URL`
  returned current/session user `postgres` and `rolbypassrls=true`.
- Metadata inspection through the existing direct connection found all 2355
  expected columns and the 5 protected-table RLS/policy/grant/index/FK shapes.
- `SET LOCAL ROLE zuri_app_runtime` in a read-only transaction was refused
  with 42501. The separately configured runtime URL probe returned XX000 and
  remains unverified. Neither refusal was bypassed.
- The release diff contains no Prisma or migration changes. Environment,
  mount and topology comparison passed. No credentials, roles, grants,
  schema or data were changed by these probes.

Sanitized operator receipts are `release-preflight.md`, `db-readonly.json`,
`db-runtime-role-attempt.json` and `configured-runtime-role.json` in the
20260917 release QA packet. No credential values or connection URLs belong
in this repository.

## Root cause

The active application connection authenticates as a role that bypasses RLS.
Creating policies and grants for another role does not change the connection's
identity. The historical reason this credential was selected is not established
by this investigation; neither a code regression nor a new credential failure
is inferred.

## Why the issue escaped detection

Schema/catalog checks, positive health requests and isolated authorization
tests prove different boundaries. They do not independently prove the identity
of the live application's database connection. Earlier historical detection
and approval decisions were not fully audited here.

## Proposed prevention

Before Phase B production writes, document and review a least-privilege
connection rollout. Test the actual configured runtime identity and effective
cross-tenant/cross-Business behavior, preserve rollback credentials securely,
and require that evidence in the release gate. Do not silently switch
credentials, grant roles or weaken assertions to make the gate pass.

The Phase A/repair image release carries this pre-existing P1 forward under
the user's image-deployment authorization, with the same connection/topology
and no additional activation. This is a root integration decision, not a new
owner approval or a claim of production security readiness. Remediation is
not implemented by this document.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Record observed runtime identity, limits and Phase B release prerequisite without changing credentials or grants | c07cfaba | RWANG |
