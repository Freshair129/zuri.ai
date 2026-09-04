---
version: "0.1.0b"
created_at: "2026-09-04T09:00:00+07:00,Claude Code"
last_update: "2026-09-04T09:00:00+07:00,Claude Code"
status: "declared"
superseded_by: null
domain: identity
feature: FR-144
module: identity
source: v2-native
attributes:
  domain: "identity"
  doc_type: "feature-specification"
  scope: "FR-144 Business-scoped edge device credential — mint, list, revoke and the request resolver"
---

# FR-144 — Edge device credential (`EdgeDeviceCredential`)

| Field | Value |
|-------|-------|
| **Requirement** | FR-144 (identity) |
| **Feature** | FEAT-017 (with FR-143) |
| **Decision lineage** | ADR-059 D2 — applies ADR-041 D3; reuses ADR-047 D2's separation reasoning |
| **Design** | SDD-085 · **Security** SEC-025 |
| **Status** | Declared 2026-09-04; implementation lanes in flight |

## Intent

The Zuri Edge Device needs to prove, on an outbound request, *which device at which
Business* is calling. Nothing existing answers that question:

| Existing | Answers | Why it is not this |
|---|---|---|
| `ApiAccessKey` (FR-106) | which **Tenant's** Enterprise API caller | Tenant-bound; a device key that satisfied it would widen intake across every Business in the Tenant |
| `PluginSession` (FR-123) | which installed **plugin's user** | public-client OAuth shape, PKCE, refresh — a headless daemon has no browser and no user |
| Session (FR-094) | which **Person** | a device is not a Person, and a device credential must never satisfy an operator or owner check |

So FR-144 is a third family. That is the ADR-047 D2 reasoning applied again: a leaked
credential must not satisfy a check it was never issued for.

It also replaces something worse than nothing. `/platform/integrations`'s Edge tab
generates `tok_edge_` / `sec_edge_` strings **in the browser**, and no server has ever
stored them — a pairing control that has always been decorative, presented as a
security boundary.

## Contract

### Model — `EdgeDeviceCredential` (identity owns it)

```
id, tenantId, businessId, deviceId, label,
keyHash @unique, keyPrefix, status @default("ACTIVE"),
createdAt, revokedAt, revokeReason, lastUsedAt, version
```

Relations to `Tenant` and `Business`; `@@index([businessId, status])` (the resolver's
candidate lookup and the list) and `@@index([businessId, deviceId])`.

- `keyHash` is **SHA-256 of the raw key**. There is no reversible storage, no reveal
  route and no recovery: a lost key is re-minted and the old one revoked.
- `keyPrefix` is display-only (`edgk_` plus a short leading fragment), enough to tell
  two rows apart in a list and useless as a credential.

### Routes — `/api/platform/edge-devices/credentials` (identity owns them)

Authority: **OWNER of the Business** (`ownsBusiness`) or an installation operator.
A Business the caller does not own is refused with the same **404** a nonexistent
Business receives.

| Route | Request | Response |
|---|---|---|
| `POST /api/platform/edge-devices/credentials` | `{ businessId, deviceId, label }` | `201 { credential, key }` — `key` is the raw `edgk_…` value and appears **exactly once, here** |
| `GET /api/platform/edge-devices/credentials?businessId=` | — | `200 { credentials: [...] }` — metadata only: `id, deviceId, label, keyPrefix, status, createdAt, lastUsedAt, revokedAt` |
| `DELETE /api/platform/edge-devices/credentials/[id]` | optional `{ reason }` | `200 { credential }` with `status=REVOKED`, `revokedAt`, `revokeReason` |

Mint and revoke each write one `EDGE_DEVICE_CREDENTIAL` audit event through
`recordAudit` — never carrying the raw key or the hash.

### Resolver — `resolveEdgeDeviceContext(request)`

Turns `Authorization: Bearer edgk_…` into
`{ deviceId, businessId, tenantId, credentialId }`, touching `lastUsedAt` on success,
or refuses with a single generic **401**. Missing header, malformed value, unknown
key, revoked key and a key of another family are **indistinguishable in the
response** — the FR-106 non-oracle property, kept.

It is the authority for the FR-143 device routes, and is additionally accepted by the
FR-141 heartbeat `POST`: the device context supplies `businessId`, and a `businessId`
in the payload must match it or be absent. That closes FR-141's recorded open item,
"device-scoped credential".

The FR-106 `api-access-auth.js` discipline is the template to copy — same hashing,
same fall-through-vs-throw shape, same silence about why a key failed.

### UI — `/platform/integrations`, Edge tab

Delete the client-side fake generator (`page.jsx` ~180-205). In its place: a mint form
(`deviceId`, `label`), the raw key shown once with a copy control and an explicit "this
will not be shown again", the credential list, and revoke.

## Acceptance criteria

- **AC-144.1** — Mint by a Business OWNER returns the raw key exactly once; a
  subsequent `GET` of the same credential never contains it, and the stored row holds
  only the SHA-256 hash and the display prefix.
- **AC-144.2** — Mint, list and revoke against a Business the caller does not own
  return the same 404 as a nonexistent Business — no 403, no field, no timing tell.
- **AC-144.3** — `resolveEdgeDeviceContext` returns the context for an ACTIVE
  credential and `401` for each of: no header, non-Bearer, non-`edgk_` prefix, unknown
  key, revoked key. The five 401 bodies are identical.
- **AC-144.4** — A successful resolution updates `lastUsedAt`; a failed one writes
  nothing.
- **AC-144.5** — Revocation takes effect immediately: the next device request with
  that key is 401.
- **AC-144.6** — Mint and revoke each record exactly one `EDGE_DEVICE_CREDENTIAL`
  audit event, and no audit payload, log line or response anywhere contains the raw
  key or the hash.
- **AC-144.7** — The heartbeat `POST` accepts the credential and derives `businessId`
  from it; a payload `businessId` naming a different Business is rejected, and an
  absent one is filled from the context.
- **AC-144.8** — An `EdgeDeviceCredential` never satisfies `isOperator`,
  `ownsBusiness`, `isApiAccessFor` or any session predicate.
- **AC-144.9** — The `/platform/integrations` Edge tab contains no client-generated
  key or secret; every credential shown corresponds to a stored row.

## Gates left open

- **Production migration NOT applied in this wave — gate open.** The
  `EdgeDeviceCredential` migration is written under `supabase/migrations/` following
  `20260830120000_plugin_auth.sql` exactly (CREATE TABLE IF NOT EXISTS, indexes,
  ENABLE + FORCE RLS, the `zuri_app_runtime_all` policy, REVOKE ALL FROM public/anon/
  authenticated/service_role, COMMENT) and reviewed; applying it to production is a
  separate owner-instructed step.
- Key rotation as a distinct operation is not declared — rotation is mint-then-revoke,
  and no requirement here promises a grace window.
