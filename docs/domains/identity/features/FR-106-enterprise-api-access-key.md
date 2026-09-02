---
domain: identity
feature: FR-106
module: identity
source: v2-native
---

# Enterprise API tenant token authentication (`ApiAccessKey`)

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Implemented (FR-106) |
| **Author** | Claude Fable 5 (parallel lane), authorized by Boss |
| **Created** | 2026-08-26 |
| **Requirement** | FR-106 — the SEC-006 implementing requirement |
| **Decision lineage** | ADR-047 D3 named exactly this generalization as the follow-up |

FR-019 shipped the Enterprise API (dry-run / commit / resolve / docs) with the
explicit "สิ่งที่ไม่ทำ": no token auth per tenant — MVP ran local-only behind the
session seam. SEC-006 held it in a declared-but-unenforced state. FR-106 closes
that with the FR-102 mechanism generalized, not a second one invented.

## The decisions worth recording

1. **Fall-through, not replacement.** `resolveApiAccessViewer(request)` is
   checked ahead of `resolveRequestViewer` on each FR-019 route and returns
   `null` — never throws — for anything that is not an active `apik_` key.
   Every `null` falls through to the session seam, so the browser wizard and
   every other session consumer of `/api/import/*` is untouched, and an
   invalid, revoked or missing key all end at the identical generic `401
   AUTH_REQUIRED` an unauthenticated caller has always received. That single
   property is what makes the endpoint a non-oracle: there is no response in
   which "key exists but is revoked" is distinguishable from "no such key".
2. **Tenant binding is resolved from the database, never the request.** The
   import pipeline resolves the target Business's `tenantId` from the Business
   row itself and asks `isApiAccessFor(viewer, businessTenantId)` inside the
   existing `authorizeImportTarget` seam — the one place every intake path
   already passes through (FR-065). `/api/resolve` computes the record's
   Tenant the same way. A key can therefore never widen the ExternalRef/upsert
   surface beyond its own Tenant, whatever the body or query names (SEC-001,
   BR-002), and a foreign record answers exactly as a nonexistent one.
3. **A minimal viewer, its own predicate.** The key resolves to
   `{ isApiAccess: true, tenantId, serviceAccountId }` — never `isOperator`,
   never Person-shaped — with `isApiAccessFor` beside `isSotDataPlaneFor` in
   `viewer-authority.js`, for ADR-047 D2's reason: a leaked integration
   credential must never satisfy an operator check.
4. **Mint is an authenticated authority, unlike FR-102's CLI-only mint.**
   FR-106 names Tenant owners as minters and an owner has no shell on the
   installation host, so mint/revoke are a service
   (`src/modules/identity/api-access-auth.js`) shared by an authenticated
   route pair (`POST /api/platform/api-access-keys`, `DELETE .../{id}`) and an
   operator CLI (`scripts/mint-api-access-key.mjs`). Authority is
   `isInstallationOperator` or `ownsTenant` (FR-074(b)) — per-Business
   ownership is deliberately insufficient because the key's scope is the whole
   Tenant. Authority is checked before Tenant existence, so an unauthorized
   caller learns nothing; an unknown key id and one outside the caller's
   authority refuse identically on revoke.
5. **Audited, with zero token material.** `API_ACCESS_KEY_MINTED` /
   `API_ACCESS_KEY_REVOKED` record who, which Tenant, when — never the secret,
   its hash, or even the display prefix. Refusals (bad key, cross-tenant
   probe) are deliberately **not** audited, matching every existing 401/403 in
   this codebase: an unauthenticated write channel into `AuditEvent` would let
   anyone spraying invalid keys grow the audit table at will.
6. **`/api/docs` non-loopback accepts any active key.** The contract carries
   no tenant data, and an integrator should be able to fetch the spec with the
   same credential they call the API with. Loopback stays sessionless
   (unchanged SEC-006 note in the route).

## Listing and the console panel (2026-09-02)

The original decision below — mint and revoke only, no listing — turned out to
break the loop it was meant to protect. `revokeApiAccessKey` takes a key id, and
the id was returned exactly once, in the mint response, on the same screen as
the secret nobody keeps. So a key could be created and then never withdrawn from
any surface (D2-domain-identity-22): the revoke route was authorized, audited,
tested, and unreachable.

`GET /api/platform/api-access-keys` and the panel on `/platform/users` close it,
under the same authority that mints and revokes (installation operator, or a
tenant-wide owner):

- **Metadata only.** `id`, `label`, `tenantId`, `keyPrefix`, `status`,
  `createdAt`, `revokedAt`, `lastUsedAt`. `keyHash` is never selected, and there
  is no field the secret could be rebuilt from. `keyPrefix` is returned on
  purpose: 8 characters of a 24-byte random secret, exactly enough to tell two
  keys apart in a listing — the trade FR-102 already made.
- **The raw key still exists once.** The panel renders it from the mint response
  with a copy affordance and a warning, and never re-fetches it. The view model
  (`platform-users-view.js`) rebuilds each list row field by field rather than
  spreading the payload, so a secret arriving there from a future server change
  cannot reach the DOM by being carried through.
- **Scoped by the write authority, not a weaker read one.** A key visible in the
  panel is one this caller can revoke; a caller who governs no Tenant gets an
  empty result (not a refusal) and no panel at all.

## Out of scope, on purpose

- Rotation as a single act (mint-then-revoke stays two deliberate steps).
- `/api/import/xlsx` and `/api/import/template` are the Excel intake surface
  (FR-018), not the FR-019 Enterprise API — they stay session-only.
- Rate limiting and idempotency keys (the rest of FR-019's "เฟส production"
  line) remain open.

## Evidence

`tests/unit/api-access-auth.test.js`, `tests/unit/api-access-key-routes.test.js`,
`tests/unit/mint-api-access-key-cli.test.js`,
`tests/unit/api-access-key-migration.test.js`,
`tests/integration/enterprise-api-auth.test.js` (the SDD-008 contract suite —
written against the refusal behaviour before the routes changed),
`tests/integration/fr106-api-access-key-listing.test.js` (the listing scope and
the mint → list → revoke loop, against the real database),
`tests/unit/platform-users-view.test.js`,
`tests/unit/platform-users-page-render.test.js`.
Production DDL: `supabase/migrations/20260826150000_api_access_key.sql`
(RSK-016 gate, same as FR-100/102/103).
