---
version: "0.1.0b"
created_at: "2026-09-04T09:00:00+07:00,Claude Code"
last_update: "2026-09-04T09:00:00+07:00,Claude Code"
status: "declared"
superseded_by: null
domain: asset-management
feature: FR-143
module: asset-management
source: v2-native
attributes:
  domain: "asset-management"
  doc_type: "feature-specification"
  scope: "FR-143 edge-executed asset evidence extraction — job lifecycle, lease, device routes and provider selection"
---

# FR-143 — Edge-executed asset evidence extraction

| Field | Value |
|-------|-------|
| **Requirement** | FR-143 (asset-management) |
| **Feature** | FEAT-017 (with FR-144) |
| **Decision lineage** | ADR-059 — amends ADR-056 D4, applies ADR-041 D3 |
| **Design** | SDD-085 · **Security** SEC-025 · **Rule kept** BR-025 |
| **Status** | Declared 2026-09-04; implementation lanes in flight |

## Intent

FR-138 extraction runs against OpenAI's Responses API with a **platform** key.
FR-143 adds a second execution site — the customer's own Zuri Edge Device — without
adding a second meaning: the device produces the same `zCandidate` object, written
through the same path, audited as the same event, reviewed on the same surface. Only
the transport changes.

The design is **pull-based** because it has to be. The device is behind NAT on a
customer LAN, and since ADR-058 the cloud app itself may be a container on a VPS or
on-premise behind ngrok. Any push design needs a cloud-held address or secret for the
device, which ADR-041 D3 forbids. So the cloud queues; the device claims.

## Contract

### Job model — `AssetExtractionJob` (asset-management owns it)

```
id, tenantId, businessId, evidenceId, status @default("QUEUED"),
claimedByDeviceId, claimedAt, leaseExpiresAt, attempts @default(0),
lastError, resultJson @default("{}"), provider, model,
createdAt, updatedAt, version
```

Relation to `AssetEvidence`; `@@index([businessId, status, createdAt])` (the claim
query) and `@@index([evidenceId, status])` (the "one job per evidence" guard and the
console poll).

**Lifecycle.** `QUEUED → CLAIMED → COMPLETED | FAILED`, plus `CANCELLED` from either
non-terminal state, plus lease expiry `CLAIMED → QUEUED`. At most one non-terminal
job exists per `AssetEvidence` at a time. Lease is **10 minutes** from claim.

### Cloud routes (session viewer)

| Route | Behavior |
|---|---|
| `POST /api/assets/evidence/[id]/extract` | Provider selection per ADR-059 D5. `openai` → FR-138 unchanged (synchronous candidate). `edge` → creates one QUEUED job, `202 { job }`. A non-terminal job already exists → returns it rather than queueing a second. |
| `GET /api/assets/evidence/[id]/extraction-job` | Latest job for the evidence, for the review surface to poll. Owner or visible viewer of the Business; 404-shaped otherwise. |

### Device routes (`resolveEdgeDeviceContext`, FR-144)

All four take `Authorization: Bearer edgk_…` and no session.

| Route | Request | Response |
|---|---|---|
| `POST /api/edge/extraction-jobs/claim` | `{}` (device identity comes from the credential) | `200 { job }` — oldest QUEUED job of the credential's Business, now CLAIMED with a 10-minute lease — or `204` when nothing is queued |
| `GET /api/edge/extraction-jobs/[id]/evidence` | — | evidence bytes, `Content-Type` from the `FileAsset` MIME, **only** while the job is CLAIMED by this device and the lease is live; `404`-shaped otherwise. Never a bucket URL, signed link or storage credential |
| `POST /api/edge/extraction-jobs/[id]/complete` | `{ candidate, model }` | `200 { job }`. `candidate` validated with the shared `zCandidate` schema; invalid → `400` and the job goes FAILED with the validation reason |
| `POST /api/edge/extraction-jobs/[id]/fail` | `{ reason }` | `200 { job }`, status FAILED, `lastError = reason` |

`complete` and `fail` are idempotent per job `version`; a COMPLETED job is never
re-claimed and never re-completed.

### Result write

Success writes through the **same** path as `extractAssetEvidence`:
`AssetEvidence.extractionJson`, evidence status `EXTRACTED`, one
`ASSET_EVIDENCE_EXTRACTED` audit event carrying `provider: 'edge'`, the `model` the
device reported and the `deviceId`. **Extraction creates a candidate, never a review
and never an approval — BR-025 stands.**

### Shared schema

The `zCandidate` shape currently local to
`src/modules/asset-management/infrastructure/openai-asset-evidence-extractor.js` moves
to a shared module both adapters import, so the two providers validate identically by
construction rather than by discipline (SDD-085).

### Provider selection (ADR-059 D5)

`ZURI_ASSET_EVIDENCE_PROVIDER` = `openai` | `edge`. Explicit value wins. Unset →
`edge` when no `OPENAI_API_KEY` is configured **and** the Business has at least one
ACTIVE `EdgeDeviceCredential`, else `openai`.

### UI

Evidence review surface shows the job state in Thai with a refresh control:

| State | Copy |
|---|---|
| QUEUED | รอ Edge Device รับงาน |
| CLAIMED | Edge Device `<id>` กำลังประมวลผล |
| COMPLETED | เสร็จแล้ว |
| FAILED | ล้มเหลว: `<reason>` |

## Acceptance criteria

- **AC-143.1** — With `ZURI_ASSET_EVIDENCE_PROVIDER=edge`, `POST .../extract` returns
  `202` and exactly one QUEUED `AssetExtractionJob` for the evidence; a second call
  while that job is non-terminal returns the same job and creates no second row.
- **AC-143.2** — With the variable unset, no `OPENAI_API_KEY` and one ACTIVE
  credential for the Business, the route selects `edge`; with an `OPENAI_API_KEY`
  present it selects `openai`; an explicit value overrides both.
- **AC-143.3** — `claim` returns the **oldest** QUEUED job of the credential's
  Business only, sets `status=CLAIMED`, `claimedByDeviceId`, `claimedAt` and
  `leaseExpiresAt = now + 10m`, increments `attempts`, and returns `204` when the
  queue is empty.
- **AC-143.4** — A device presenting a credential for Business A never claims,
  downloads or completes a job of Business B; the refusal is 404-shaped.
- **AC-143.5** — `GET .../evidence` serves the bytes with the `FileAsset` MIME to the
  lease-holding device, and refuses once the job is not CLAIMED by that device or the
  lease has passed. No response on any route contains a bucket URL, signed link or
  storage credential.
- **AC-143.6** — A CLAIMED job whose `leaseExpiresAt` has passed is claimable again
  and returns to QUEUED; the original device's late `complete` on that job does not
  overwrite the second device's result.
- **AC-143.7** — `complete` with a valid candidate writes `extractionJson`, sets
  evidence status `EXTRACTED` and records one `ASSET_EVIDENCE_EXTRACTED` audit event
  with provider `edge`, the reported model and the device id. Repeating the identical
  `complete` writes no second candidate and no second audit event.
- **AC-143.8** — `complete` with a candidate the shared `zCandidate` schema rejects
  returns `400`, leaves `extractionJson` untouched and moves the job to FAILED with
  the reason recorded.
- **AC-143.9** — No path in this requirement sets a review or approval state on the
  evidence (BR-025).
- **AC-143.10** — `contracts/edge-extraction-job.schema.json` validates the job,
  claim, complete and fail payloads the routes actually produce and accept, and
  `scripts/edge-extraction-poller.mjs` completes a job end to end against a running
  cloud with its default stub extractor, logging no key material.

## Gates left open

- ~~Production migration NOT applied in this wave.~~ **Closed 2026-09-04**:
  `20260904090000_edge_device_credential_and_extraction_job` was dry-run in a
  rolled-back transaction and then applied to production on the owner's instruction,
  and its version is recorded in `supabase_migrations.schema_migrations`.
  `AssetExtractionJob` exists there with forced RLS, one `zuri_app_runtime_all`
  policy, SELECT/INSERT/UPDATE/DELETE for `zuri_app_runtime` only, both declared
  indexes, and no grant to anon, authenticated, service_role or PUBLIC. The table is
  empty: nothing queues a job until a device is paired.
- The edge **runtime** — the daemon that runs the local model — lives in the
  `zuri-edge-device` repository (ADR-059 D6). This repository ships the contract and
  the reference poller only. **The round trip is now proven end to end** (2026-09-04):
  against a local Ollama daemon running a Thai document-OCR vision model, a device
  claimed a queued job, fetched the evidence bytes through this application, read a
  Thai/English receipt and posted a candidate carrying all nine printed fields. The
  evidence reached `EXTRACTED` with provider `edge`, the model recorded on the job, and
  one `ASSET_EVIDENCE_EXTRACTED` audit event naming the device. The run found a real
  defect on the device side — a model that answered with a label-keyed `fields` map had
  every reading discarded, and the job completed with zero fields rather than failing —
  fixed in `zuri-edge-device` PR #21. This repository needed no change: the four device
  routes, the lease, the schema validation and the audit write all behaved as declared.
  Two branches remain unexercised by that run and are only covered by tests: the
  managed-blob storage path (the smoke fixture used a `LOCAL_FILE` evidence asset, so no
  Supabase object was fetched) and the retry ladder.
- Cancellation authority (who may cancel a CLAIMED job, and whether that revokes a
  live lease) is deliberately unanswered by ADR-059; implement conservatively
  (owner-only, no lease revocation) or leave CANCELLED unreachable from the UI.
