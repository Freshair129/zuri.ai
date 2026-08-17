---
version: "0.1.0b"
created_at: "2026-08-18T12:00:00+07:00,ATHER"
last_update: "2026-08-18T16:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "integration"
  doc_type: "architecture-decision"
  scope: "Platform Integration management UI and secret-manager provisioning boundary"
---

# ADR-032 — Integration and Secret Manager management UI

**Status:** Candidate specification with the approved metadata-only implementation slice; live Supabase migration and production provisioning remain gated

## Context

The repository has the Integration Platform runtime contracts and persistence
metadata for FR-074. The approved implementation adds a user-facing Integration
page, a metadata-only `GET`/`POST` route and a production runtime adapter, while
the Supabase migration and first secret provisioning remain operator gates. The
existing Platform Settings page is a local demo utility surface and must not
become a place where production secrets are stored.

The missing surface is an administration capability, not a new business domain.
It must let an authorized owner inspect and manage Business-scoped connection
metadata while keeping raw secret material inside the approved external manager.

## Decisions

### D1 — Integration is a Platform sub-domain

The UI surface is placed under the existing Platform domain:

```text
Platform
  └── Integrations
      └── /platform/integrations
```

It is not a new Tier-2 business domain and it does not create a second domain
registry. The selected Business remains the ambient scope; the server recomputes
the trusted Business authority for every request.

### D2 — Use Supabase Vault with a private resolver

Phase 1 uses Supabase Vault in the existing Supabase project with logical
separation in the private `vault`/`zuri_core` schemas. The page manages the
existing `IntegrationProvider`, `IntegrationConnection` and
`IntegrationCredential` metadata only:

| UI area | Allowed data | Never returned or persisted here |
|---|---|---|
| Connection | provider, model metadata, fixed purpose, role, status, Business scope, health/version/expiry status | secret material, provider key, full secret path |
| Secret status | masked reference label, version, expiry and configured/missing state | secret value, authorization header, connection URL with embedded secret |
| Secret setup | raw value is entered in the Supabase Dashboard Vault UI; this page accepts only `supabase-vault:<uuid>` | request echo, browser storage, Prisma row, audit payload or log |

The runtime `SecretManagerPort` remains read-only. A private
`SECURITY DEFINER` resolver reads `vault.decrypted_secrets` and returns plaintext
only to `zuri_line_runtime`; the app and `zuri_line_smartgift_ro` roles receive no
direct Vault view grant. A future write path may introduce a separate
`SecretManagerProvisionPort`, but it is not part of this UI slice.

### D3 — Authorization follows existing trusted Business ownership

The first implementation is owner-only through the existing Platform and trusted
viewer boundary. A caller may list or mutate only connections for a Business in
the server-derived `ownedBusinessIds`; a client-supplied `businessId`, tenant id
or connection id is never an authority input. A future dedicated operator role
requires a separate requirement and viewer-contract decision.

The implemented metadata create is audited with a redacted summary. Secret
material and PII are excluded from the audit event. Promotion, rotation and
revocation remain separate operator work until their CAS/provisioner contracts
are implemented.

### D4 — UI cannot activate public LINE

The page may create metadata and show redacted readiness state. It may not
activate a LINE binding, enable routing, send a canary or claim
`ACCEPTED_BY_LINE`. FR-053/054/055 and the controlled operator path remain the
only activation boundary.

### D5 — Route and server operation contract

The first implementation exposes only the two metadata operations below. The
remaining lifecycle routes stay design-only until their separate ports and tests
exist:

| Method | Proposed path | Contract |
|---|---|---|
| GET | `/api/platform/integrations` | Implemented: return only authorized Business-scoped connection metadata and secret status |
| POST | `/api/platform/integrations` | Implemented: create draft metadata with fixed `purpose=PHASE1_LINE_LLM`; accepts only an opaque Vault reference |
| PATCH | `/api/platform/integrations/[id]` | Update non-secret metadata with trusted scope and optimistic version check |
| POST | `/api/platform/integrations/[id]/secret` | Write-only provision/replace through `SecretManagerProvisionPort`; return version/expiry only |
| POST | `/api/platform/integrations/[id]/rotate` | Start an audited rotate flow; never return the old or new value |
| POST | `/api/platform/integrations/[id]/revoke` | Revoke through the manager, purge runtime cache and record a redacted receipt |
| POST | `/api/platform/integrations/[id]/promote` | CAS promotion/demotion only; does not enable LINE routing |

There is no `GET` operation that returns secret material and no browser-side
secret-manager client.

### D6 — Role boundary

`anon`, `authenticated`, `service_role`, `zuri_line_smartgift_ro` and the web
browser do not receive Vault plaintext. The production login role may
`SET LOCAL ROLE zuri_line_runtime` for the resolver function only; the resolver
rechecks the exact Tenant/Business, active primary connection and active
credential before reading the Vault view.

## Acceptance gates for FR-075

| Gate | Required proof |
|---|---|
| Navigation | Platform → Integrations is represented in the sitemap and route contract; no new Tier-2 business domain is created |
| Scope | Owner of Business A cannot list, mutate or infer Business B connections; client ids cannot widen scope |
| Redaction | UI/API/audit/log snapshots contain metadata only; secret write responses contain version/expiry, never material |
| Provisioning | Supabase Vault migration, resolver role and first secret reference are applied and verified; no raw value enters Zuri |
| Lifecycle | Implemented create/list metadata are redacted and audited; promotion, rotate and revoke remain explicit follow-up gates |
| Activation boundary | UI cannot enable routing, send LINE or replace the signed canary/operator gate |
| UX | Loading, empty, error, stale/expired, rotation and manager-unavailable states are explicit and keyboard/WCAG 2.2 AA compliant |

## Out of scope

- Applying the Supabase migration to a live project and provisioning the first production Vault secret.
- Storing raw secrets in Zuri, Prisma, browser storage, logs or generated docs.
- Production authentication provider selection; the existing trusted viewer/session
  contract remains the prerequisite.
- Public LINE activation, canary execution, provider golden evaluation or rollback
  authorization.
- Adding Ollama to the UI's production provider list; Ollama remains local/test/eval only.

## Related documents

- [ADR-031 — Phase 1 runtime connection cut-over](ADR-031-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md)
- [FR-075 — Integration and Secret Manager management UI](../domains/integration/features/FR-075-integration-secret-management-ui.md)
- [FR-074 implementation plan](../roadmap/PLAN-FR-074-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md)
- [FR-075 implementation plan](../roadmap/PLAN-FR-075-INTEGRATION-SECRET-MANAGEMENT-UI.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Proposed Platform Integrations UI, write-only secret provisioning boundary and non-activation contract | working-tree | ATHER |
| 0.2.0b | 2026-08-18 | candidate | Select Supabase Vault, add private resolver role boundary, and truth-sync the implemented metadata-only UI/API slice | working-tree | ATHER |
