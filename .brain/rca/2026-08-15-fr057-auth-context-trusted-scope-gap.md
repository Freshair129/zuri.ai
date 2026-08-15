---
version: "0.1.0b"
created_at: "2026-08-15T08:19:00+07:00,ATHER"
last_update: "2026-08-15T08:19:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security-memory"
  doc_type: "root-cause-analysis"
  scope: "FR-057 transport receipt and persisted workspace/project authorization"
---

# RCA — FR-057 trusted transport and resource-scope gap

## Symptom

The first PR #12 implementation could authorize private MSP retrieval when
`serverScope.transportVerified` was omitted. It also copied server-supplied
Business, Workspace, and Project values into a vault key without resolving those
resources against persisted Tenant/Business ancestry.

## Evidence

- `src/modules/agent/auth-context.js` used
  `serverScope.transportVerified !== false`, making absence equivalent to proof.
- Membership was evaluated against the separate input `businessId`, while the vault
  used `serverScope.businessId`, `workspaceId`, and `projectId`.
- The original FR-057 tests used arbitrary Workspace strings and had no omitted-
  transport, cross-Business, cross-Workspace, or cross-Project denial cases.

## Root Cause

The implementation treated the internal `serverScope` object as already authorized,
but its contract only established that the model/request must not construct it. It
did not distinguish configuration provenance from a verified transport receipt or
persisted resource authorization.

## Why the issue escaped detection

Positive-path tests relied on the legacy behavior where omitted transport state
meant trusted local execution, and Workspace/Project values were tested only as
different strings producing different keys. No negative test required those values
to resolve to active, same-scope database records.

## Proposed prevention

1. Treat transport verification as explicit: only `transportVerified === true`
   permits private retrieval.
2. Resolve Business, Workspace, and Project from persistence before vault creation;
   deny mismatched, missing, archived, deleted, or cross-scope resources.
3. Evaluate Membership/Customer scope against the resolved Business, not a parallel
   caller value.
4. Add omitted-transport and cross-scope regression tests and keep the policy check
   before every memory-port call.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-15 | beta | Documented reviewer-confirmed FR-057 fail-open and scope-resolution gaps | pending | ATHER |
