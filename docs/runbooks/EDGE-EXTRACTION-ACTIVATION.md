---
version: "0.1.0b"
created_at: "2026-09-04T07:20:00+07:00,CLAUDE"
last_update: "2026-09-04T07:20:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "runbook"
  scope: "Operator procedure to mint an edge device credential, install and run the reference poller, switch a Business to edge-executed extraction, verify a job end to end, and revoke a credential"
---

# Edge-Executed Evidence Extraction Activation Runbook

## Purpose and stop condition

This runbook activates FR-143 (edge extraction job lane) and FR-144 (edge
device credential) for one Business: minting a device credential, running the
reference poller against it, and confirming one `AssetExtractionJob` completes
through to an `AssetEvidence` candidate the same way the OpenAI path does
(BR-025 — extraction always yields a candidate, never an approval). It does not
cover installing or configuring the local model daemon on the Zuri Edge Device
itself (ADR-041 D6) — that lives in the `zuri-edge-device` repository.

Never print the raw `edgk_…` device key anywhere but the one mint response and
the device's own local environment. Never write it into a terminal transcript,
issue, PR, log line, or activation receipt. If a key is suspected exposed,
revoke it immediately (§6) and mint a replacement.

## 1. Mint a device credential

As a Business OWNER (or installation operator), sign in to the console and
open `/platform/integrations` → **Edge** tab.

1. Enter the `deviceId` the physical device will identify itself as (a stable,
   human-readable string — e.g. `edge-bkk-warehouse-01`) and a `label`.
2. Submit the mint form. The raw key (`edgk_…`) is shown **exactly once**,
   with an explicit "will not be shown again" notice and a copy button.
   Copy it now into the device's own secret store; it cannot be retrieved
   again — minting a new credential is the only recovery if it is lost.
3. Confirm the credential now appears in the list with `status: ACTIVE`, a
   `keyPrefix` (not the full key), and no `lastUsedAt` yet.

Equivalently, from an authenticated operator session:

```powershell
curl -s -X POST https://<host>/api/platform/edge-devices/credentials `
  -H "content-type: application/json" `
  -d '{"businessId":"<business-id>","deviceId":"edge-bkk-warehouse-01","label":"Warehouse 01"}'
```

Record only the credential `id`, `deviceId` and `keyPrefix` in any activation
report — never the `key` field from the response body.

## 2. Install the credential on the device

On the Zuri Edge Device (or a machine standing in for it during activation),
set the two required environment variables. Never commit these to a file that
is version-controlled or shared:

```bash
export ZURI_CLOUD_BASE_URL="https://<your-ngrok-or-vps-host>"
export ZURI_EDGE_DEVICE_KEY="edgk_...."   # the raw key from step 1, once
```

`ZURI_CLOUD_BASE_URL` must be reachable from the device — the ngrok tunnel or
VPS origin from ADR-058, not a bare `localhost`. The device initiates every
call; the cloud never calls the device (ADR-041 D3).

## 3. Run the reference poller

The reference poller (`scripts/edge-extraction-poller.mjs`, ADR-059 D6) is the
default stub that proves the wire contract end to end; the `zuri-edge-device`
repository swaps in a real `extractCandidate` hook that calls its local
model. From this repository's checkout on the device (or a machine reachable
from the cloud host during activation):

```bash
node scripts/edge-extraction-poller.mjs
```

Expected console output: `[edge-poller] claimed job …` while a job is queued,
`[edge-poller] completed job …` once it posts a candidate back, and otherwise
silence between polls (default every 5 seconds — set `ZURI_EDGE_POLL_MS` to
change it). The device key is never printed by the poller (SEC-025); if a log
line ever shows one, stop and treat the key as exposed (see §6).

Stop the poller with `Ctrl+C` — it exits cleanly on `SIGINT`, finishing any
job already in flight before returning control.

## 4. Switch the Business to edge extraction

`ZURI_ASSET_EVIDENCE_PROVIDER` selects the extraction path platform-wide; an
explicit value always wins over the automatic default:

- `edge` — every `POST /api/assets/evidence/{id}/extract` call for this
  deployment queues an `AssetExtractionJob` instead of calling OpenAI
  synchronously.
- `openai` — unchanged FR-138 behavior.
- unset — resolves to `edge` only when **both** hold: no `OPENAI_API_KEY` is
  configured, and the calling Business has at least one `ACTIVE`
  `EdgeDeviceCredential` (from §1). Otherwise it resolves to `openai`.

For an activation where OpenAI is being retired for this Business, set
`ZURI_ASSET_EVIDENCE_PROVIDER=edge` explicitly rather than relying on the
automatic default, so the path does not silently flip back to `openai` if a
key is later added to the environment for an unrelated reason.

## 5. Verify one job end to end

1. In the console, open an Asset evidence item awaiting extraction and trigger
   extraction (or `POST /api/assets/evidence/{id}/extract`). Confirm the
   response is `202 { job }` with `status: "QUEUED"`.
2. The evidence review surface shows the Thai job state and a refresh control:
   - `QUEUED` → "รอ Edge Device รับงาน"
   - `CLAIMED` → "Edge Device `<id>` กำลังประมวลผล"
   - `COMPLETED` → "เสร็จแล้ว"
   - `FAILED` → "ล้มเหลว: `<reason>`"
3. With the poller running (§3), confirm the state advances
   `QUEUED → CLAIMED → COMPLETED` within one lease window (10 minutes; in
   practice, one poll interval plus extraction time).
4. Confirm the `AssetEvidence` now carries `status: EXTRACTED` and an
   `extractionJson` candidate — never an approved or reviewed state (BR-025).
   `GET /api/assets/evidence/{id}/extraction-job` returns the completed job
   with `provider: "edge"` and the `model` string the device reported.
5. Confirm the audit trail recorded `ASSET_EVIDENCE_EXTRACTED` with
   `payload.provider: "edge"`, the reporting `deviceId`, and the `jobId` — and
   that neither the audit payload nor any response body anywhere in this flow
   contains the raw device key, a bucket URL, a signed link, or a storage
   credential (SEC-025, ADR-041 D3).
6. As a negative check, confirm a device credential minted for a different
   Business cannot claim, download, or complete this job — the device routes
   must refuse with the same 404-shaped response used for a nonexistent job.

## 6. Revoke a credential

Revoke immediately on device retirement, credential rotation, or suspected
exposure:

```powershell
curl -s -X DELETE https://<host>/api/platform/edge-devices/credentials/<credential-id> `
  -H "content-type: application/json" `
  -d '{"reason":"device retired"}'
```

Confirm the credential list now shows `status: REVOKED` with `revokedAt` and
`revokeReason` set. A revoked key is refused by `resolveEdgeDeviceContext`
with the same generic 401 used for an unknown or malformed key — the resolver
never distinguishes "revoked" from "never existed" to a caller presenting it.
Any job the device had claimed keeps running its lease to expiry and returns
to `QUEUED` for another device to pick up; revocation does not cancel a job in
flight.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-04 | beta | Initial activation runbook for FR-143/FR-144 edge-executed extraction: mint, install, run the reference poller, switch provider, verify end to end, revoke | working-tree | Claude Code |
