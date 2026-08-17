---
domain: integration
feature: FR-075
module: integration
source: v2-native
version: "0.2.0b"
created_at: "2026-08-18T12:00:00+07:00,ATHER"
last_update: "2026-08-18T16:00:00+07:00,ATHER"
status: "candidate"
---

# FR-075 — Integration and Secret Manager management UI

## Rationale

FR-074 has a runtime connection selector and provider-neutral secret resolution.
The approved slice adds a safe Platform surface for Business-scoped metadata,
while Supabase Vault remains the only production plaintext store.

## Contract

Add a Platform sub-domain at `/platform/integrations` for authorized owners. The
surface is Business-scoped and manages the existing Integration Platform records:

- provider/model metadata;
- fixed `purpose=PHASE1_LINE_LLM`;
- `ACTIVE`/`PENDING`/`REVOKED` status and `PRIMARY`/secondary role;
- masked secret reference, version, expiry and configured/missing state;
- metadata create/list with explicit loading, empty and error states.

The UI never displays or stores raw secret material. Operators create the value
in Supabase Dashboard → Vault and paste only `supabase-vault:<uuid>` into the
metadata form. The runtime reads it through the private `zuri_line_runtime`
resolver; no browser route reads `vault.decrypted_secrets`.

## Acceptance criteria

### AC-075.1 — Platform placement

The sitemap and navigation contract place Integrations under Platform. It is not
a new Tier-2 business domain and does not change the existing business domain
allow-list.

### AC-075.2 — Trusted scope

The server derives the selected Business from the trusted viewer and rejects
client-selected tenant, business or connection authority. An owner of Business A
cannot list, read status for, mutate or promote a Business B connection.

### AC-075.3 — Metadata-only read model

List/detail responses contain only authorized provider, model, purpose, role,
status, masked reference label, version, expiry and health fields. They contain
no raw secret, provider key, authorization header or full secret-bearing URL.

### AC-075.4 — Vault-only secret lifecycle

The implemented form accepts an opaque Vault reference only. Supabase Vault
stores the plaintext; Zuri persists only the reference and returns only redacted
status plus version/expiry. Missing or unavailable resolver capability fails
closed. Write/rotate/revoke operations remain a separate follow-up port.

### AC-075.5 — Connection lifecycle safety

Metadata writes are audited and idempotent. Promotion uses the FR-074 CAS path
and database uniqueness invariant. The UI exposes ambiguity, expiry, stale
version and manager errors without guessing or silently falling back.

### AC-075.6 — Activation separation

No UI action activates a LINE binding, enables routing, calls LINE or produces an
`ACCEPTED_BY_LINE` claim. FR-053/054/055 and their operator evidence remain the
activation gate.

### AC-075.7 — Explicit UX states

The page defines loading, empty, unauthorized, manager unavailable, expired,
rotation in progress, conflict and success states. It is keyboard accessible and
meets the existing NFR-008 WCAG 2.2 AA baseline.

## Implemented and deferred server operations

The first two operations are implemented; lifecycle operations remain deferred:

| Method | Path | Secret rule |
|---|---|---|
| GET | `/api/platform/integrations` | implemented; metadata/status only |
| POST | `/api/platform/integrations` | implemented; opaque Vault reference only |
| PATCH | `/api/platform/integrations/[id]` | version/CAS guarded metadata |
| POST | `/api/platform/integrations/[id]/secret` | write-only through external manager |
| POST | `/api/platform/integrations/[id]/rotate` | no old/new material returned |
| POST | `/api/platform/integrations/[id]/revoke` | purge runtime cache and audit |
| POST | `/api/platform/integrations/[id]/promote` | connection state only; no routing activation |

## Dependencies

- FR-038/FR-061/FR-062 for trusted Platform visibility and Business ownership;
- FR-074, NFR-015, SEC-015 and ADR-031 for connection and secret runtime boundaries;
- SEC-003/SEC-008 for audit and trusted viewer/session authorization;
- ADR-032 for the UI and provisioning decision;
- Supabase production migration application, Vault secret provisioning and live
  isolation/canary evidence before production traffic.

## Out of scope

- Browser-side raw secret entry or raw secret persistence;
- LINE activation/canary or provider golden evaluation;
- Ollama production usage;
- a new role or cross-Business operator authority.

## Delivery state

Implemented locally: Platform page, trusted metadata API/service, Supabase Vault
runtime adapter and private resolver migration artifact. The migration has not
been applied to a live Supabase project in this repository, and no production
Vault secret or LINE canary is claimed.
