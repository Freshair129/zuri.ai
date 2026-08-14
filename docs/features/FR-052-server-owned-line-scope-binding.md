---
feature: FR-052
module: project-manager
source: v2-native
version: "0.1.2b"
created_at: "2026-08-14T04:53:45+07:00,ATHER"
last_update: "2026-08-14T09:17:00+07:00,ATHER"
status: "beta"
---

# FR-052 — Server-owned LINE scope binding

**Risk:** HIGH
**Decision:** ADR-018
**Change envelope:** ZV2-CR-004

## Rationale

`tenantId` and `businessId` supplied by the forwarding client cannot be authorization evidence.
When Phase 1 is enabled, the webhook accepts a binding UUID, LINE destination and binding-scoped
bearer only. The server hashes destination and credential with a secret pepper, resolves an active
binding, and takes Tenant/Business scope exclusively from that database row.

The database login has no base-table grants. Each query starts a short transaction and uses
`SET LOCAL ROLE zuri_line_smartgift_ro`; forced RLS and the binding resolver must both pass. A
mismatch or unavailable database fails before message persistence or model work.

## Delivery state

The request boundary, binding resolver and role-scoped query wrapper are implemented. Production
now contains the reserved binding, verified as `PENDING` with null destination/credential hashes.
Activation still requires a dedicated runtime login secret, destination/credential hashes and a
negative/positive LINE canary.

Runtime login provisioning accepts the exact project Postgres owner connection string directly;
it does not depend on a persistent Supabase CLI login. The one-time operator wrapper generates and
rotates a dedicated login secret, stores its runtime URL in Windows Credential Manager, then proves
base-table denial, forced-RLS scoped inventory and mutation denial. It writes the credential before
the live probe so an operator can recover the newly rotated secret if the probe itself fails; the
binding remains `PENDING` and no LINE traffic is enabled by this step.

## Verification

- `tests/unit/line-binding-resolver.test.js`
- `tests/unit/phase1-business-agent-runtime.test.js`
- `tests/unit/phase1-runtime-login-probe.test.js`
- `tests/integration/agent-webhook-route.test.js`

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Local binding authority and scoped runtime implemented; activation remains PENDING | working-tree | ATHER |
| 0.1.1b | 2026-08-14 | beta | Binding reserved remotely and verified credential-free; activation remains PENDING | working-tree | ATHER |
| 0.1.2b | 2026-08-14 | beta | Added connection-string runtime login rotation, OS credential storage and live fail-closed probe; activation remains PENDING | working-tree | ATHER |
