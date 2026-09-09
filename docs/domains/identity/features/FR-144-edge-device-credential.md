---
version: "0.2.0b"
created_at: "2026-09-04T09:00:00+07:00,Claude Code"
last_update: "2026-09-08T19:41:52+07:00,RWANG"
status: "beta"
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

## Browser and QR pairing — owner-approved 2026-09-08

The owner selected a simple flow: Desktop **Connect Zuri** opens the browser;
a QR of the same approval URL supports using a phone. The owner signs in, selects
one Business they may govern and confirms the displayed device/check code.
Desktop receives the result automatically. No JSON file, manual key copy or
password sent to Desktop is required.

This approval covers pairing and truthful connection status. The broader supervised
worker/package proposal remains a distinct implementation slice; pairing success
must never advertise worker readiness or enable LINE ingress.

Protocol (all JSON, no-store):
- POST /api/edge/pairing/start: bounded device ID/label; returns a five-minute
  request, random device polling secret and browser approval URL.
- POST /api/edge/pairing/approve: authenticated browser only, same-origin check;
  inspect lists only governable Businesses; approve/deny consumes the approval
  decision once. Verify a matching short code on Desktop and browser.
- POST /api/edge/pairing/poll: the initiating Desktop's polling secret only.
  On approval, re-resolve the approver's Business authority and mint the existing
  edgk credential transactionally. Return it to this device exactly once.
  Browser never receives the key. Concurrent polls cannot mint twice.
- Device cancel uses the same private polling channel. Expired, cancelled,
  rejected or consumed requests never mint another credential.

The QR carries a high-entropy browser token in a URL fragment, not a credential
or device polling secret. Fragment stays out of request URLs/referrers. Login
returns only to the fixed /edge/pair page; its tab retains the temporary browser
token in sessionStorage and clears it on terminal state. No arbitrary return URL.

Pending requests are bounded, process-local five-minute capabilities; hashes only
for polling/browser secrets. Restart or another replica loses the pending request
and requires a new request. This release targets the current single Node server;
it does not claim multi-replica continuity. Rate limits and a global capacity cap
bound unauthenticated creation; forwarded addresses alone are not trusted protection.
No key is minted before redemption, and no raw key is retained for replay.
A lost redemption response is visibly unrecoverable: re-pair and revoke the prior
credential in the existing management surface; never claim delivery or silently retry mint.
Terminal expiry or server refusal releases the pending Desktop view so Connect can
start a new request directly; transient transport errors offer an explicit status retry.

Desktop validates the configured server origin (HTTPS or explicit loopback dev),
disables HTTP redirects, and bounds requests. Deployment supplies the default
server URL; advanced settings can change it explicitly. The initiating request's
secret and resulting credential remain in Rust, never status DTOs or logs.
Windows stores the device credential protected with user-bound DPAPI. Native status
failures are visible. JSON import remains an advanced compatibility path and accepts
the real apiBaseUrl export. Paired means identity configured; connection verification
and worker readiness remain separate.

Acceptance: real services/routes prove owner/foreign Business refusal, approval,
denial, expiry, cancellation, single redemption under concurrency, revocation of
authority before redemption, rate/capacity limits and absence of keys in browser
responses. Browser tests cover login return and mobile approval. Rust tests cover
origin checks, actual import parser, redacted DTOs, protected storage and QR URL
contents. Desktop frontend polling/failure tests use an explicit mock native bridge;
they do not prove installed Tauri transport or a physical phone scan. No real device
key or LINE message in tests.

## Contract

### Local implementation evidence — 2026-09-08

Approved pairing slice implemented on `codex/edge-desktop-runtime-fix`, based on
`b17e7258`. Desktop version **0.2.0 -> 0.2.1**; this feature note **0.1.0b ->
0.2.0b**; Desktop runtime proposal **1.0.0b -> 1.2.0b**. No schema change.

| Check | Local result |
|---|---|
| Server full unit/integration suite | 4,174 passed, 15 skipped; 506 files passed, 5 skipped |
| Edge Node suite | 913 passed, 3 skipped; typecheck and build passed |
| Native Windows Rust | 6 tests passed, including DPAPI round-trip/tamper refusal and atomic file replacement; release build passed |
| Focused browser suite | 8 passed including warm-up, Desktop frontend error/expiry handling, actual Server approval/denial and ordinary login regression |
| Final browser token cleanup | 2 approval/denial tests passed again after terminal sessionStorage cleanup; mobile viewport 390 x 844 |
| Server production build | Passed compilation, lint/type checks and static generation |

Server browser acceptance uses an isolated seeded database and real HTTP handlers,
credential mint, owner login and authenticated heartbeat. Desktop frontend tests use
a mock native bridge and do not prove physical-phone scanning or installed WebView IPC.
Native unit tests run on Windows but are not a full native-to-Server acceptance run.
Full repository E2E and hosted CI were not run in this task.

Windows artifact: `apps/edge/src-tauri/target/release/zuri-edge-device.exe`,
15,471,616 bytes, SHA-256
`36c18ed8d9bd645a4e0629a2457b8d0949a7bc26038beb2b57adefa1596cd8b2`.
Its default Server origin matches the observed production `PUBLIC_BASE_URL`:
`https://unspirited-expostulatory-angila.ngrok-free.dev`. The artifact requires the
new Server routes before use; it is a control-shell exe, not an installer or bundled
compute worker. It has not been installed, published or paired with production.

Initial full-suite failures identified a missing OpenAPI inventory update, the
FR-144 digest review required by the ID ledger, and two fixture dependency-resolution
failures caused by nested dependency junctions. The route inventory/counts were
updated, the official ledger `--review FR-144` command recorded the same-subject
approval, and this worktree now has independently installed Server dependencies.
The final full suite above passed without weakening those checks. Two baseline JSX
delimiter corrections needed for compilation are documented in the linked RCA.

Production rollout, actual installed-device handover, worker supervision/package,
LINE webhook repair and the existing manual-release tag selection issue are outside
this pairing acceptance. No live credential, database migration, LINE message,
commit, push or deployment was performed. Governance results are generated in
`docs/.preflight-report.json`; the new Edge runtime note remains outside the historical
Edge import manifest, so canonical FR-144 carries this evidence rather than claiming
the historical Edge graph indexes the new note.

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

- ~~Production migration NOT applied in this wave.~~ **Closed 2026-09-04**:
  `20260904090000_edge_device_credential_and_extraction_job` was dry-run in a
  rolled-back transaction and then applied to production on the owner's instruction,
  and its version is recorded in `supabase_migrations.schema_migrations`.
  `EdgeDeviceCredential` exists there with forced RLS, one `zuri_app_runtime_all`
  policy, SELECT/INSERT/UPDATE/DELETE for `zuri_app_runtime` only, the unique
  `keyHash` index and both scope indexes, and no grant to anon, authenticated,
  service_role or PUBLIC. No credential has been minted on production yet — pairing a
  device is an operator step, and the raw key it issues is shown exactly once.
- Key rotation as a distinct operation is not declared — rotation is mint-then-revoke,
  and no requirement here promises a grace window.
