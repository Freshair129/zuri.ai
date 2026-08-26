---
domain: identity
feature: FR-102
module: identity
source: v2-native
---

# FR-102 — SoT data-plane service-account authentication

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Implemented locally; production Supabase migration is a gate |
| **Date** | 2026-08-24 |
| **Relates to** | ADR-047, ADR-046, FR-100, FR-094 |

## Contract

### FR-102 — Tenant-bound data-plane key

When a request to `POST /api/platform/sot/decisions` or
`GET /api/platform/sot/decisions/export` presents an `Authorization: Bearer
sdpk_...` header naming an active `SotDataPlaneKey`, the server shall resolve a
service-account viewer scoped to exactly that key's `tenantId`, distinct from
any Person-based viewer and never carrying installation-operator authority. A
request naming a tenantId other than the key's bound tenant shall be refused.
An absent, malformed, unknown or revoked key shall not authenticate; the
request falls through to ordinary session authentication, exactly as if no
bearer header had been presented at all. No other route accepts this header.

The raw key exists only at mint time (`scripts/mint-sot-data-plane-key.mjs`);
the server persists only its SHA-256 hash. Revocation
(`revokeSotDataPlaneKey`) takes effect on the very next request — no grace
period, unlike a browser Session.

## P0 acceptance criteria

1. A data-plane key bound to Tenant A authenticates a submit/export call made
   with `tenantId: A` and is refused for `tenantId: B`.
2. `isSotDataPlaneFor` never returns true for a Person-shaped viewer, however
   privileged (`isOperator`, `role: 'DEV'`), and `isInstallationOperator` never
   returns true for a data-plane viewer.
3. A revoked key stops authenticating on its very next use; there is no window
   where a revoked key still succeeds.
4. `listSotDecisions` (the human inbox) and `decideSotDecision` (human
   approve/reject) do not accept a data-plane key — only submit and export do.
5. The raw secret is never present in a server log, an error message, or any
   database column; only `keyHash` (SHA-256) and a short, non-reconstructing
   `keyPrefix` are stored.

## Explicit non-goals

- No Business-level scoping on the key in this slice (ADR-047 consequence 4) —
  `submitSotDecisions`/`exportSotDecisions` are themselves only Tenant-scoped
  today, so a finer-grained key would enforce a boundary the underlying
  operation does not otherwise have.
- No general-purpose API-key system for zuri-ai. The FR-019 Enterprise API's
  own session-cookie requirement is untouched; this is scoped to the two named
  SoT routes only.
- Production Supabase RLS/grant migration is written
  (`supabase/migrations/*_sot_data_plane_key.sql`) but not applied against a
  live project in this workspace — see Appendix E.
