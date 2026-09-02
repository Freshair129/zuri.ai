---
version: "0.1.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-02T10:30:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "architecture-decision"
  scope: "Evidence storage, AI extraction, spreadsheet and LINE intake boundary"
---

# ADR-056 — Asset Evidence Cloud and Extraction Boundary

## Status

**Status:** Accepted as beta for implementation by the owner on 2026-09-02.

## Context

ADR-055 established Asset Management as the writer of physical-asset intake truth,
`FileAsset` as the writer of file-content identity, zuri-cli as the LINE transport,
and Finance/Procurement as separate authorities. The foundation intentionally stopped
before cloud files, OCR/Vision, workbook execution and LINE attachment handoff.

The next slice must process sensitive receipts and payment proofs while preserving
offline-first authority, Business isolation, provider substitutability and a human
decision boundary.

## Decision

### D1 — One canonical intake writer

All surfaces converge on `AssetIntakeEnvelope` and one Asset application service.
Adapters may normalize input but may not write Asset tables directly. `AssetIntake`
stores a normalized-envelope snapshot, validation snapshot and status so a later
registration transaction can consume reviewed input without reconstructing it from
provider state.

### D2 — FileAsset owns content identity; AssetEvidence owns meaning

Uploads use the file-management service to create a `MANAGED_BLOB` `FileAsset` with
server-calculated SHA-256. Asset Management stores role, extraction and review metadata
in `AssetEvidence`. It never duplicates bytes or changes `FileAsset` semantics.

### D3 — Provider-neutral private object port

Application code depends on `put`, `get` and `remove` operations over an opaque object
reference. The first adapter targets Supabase Storage using a server-only service key
and a private existing bucket. The adapter does not mint public URLs. Object paths are
append-only and content-addressed; upsert is disabled.

Local unit/integration tests use an in-memory port. Absence or failure of the configured
cloud adapter returns an explicit unavailable result and creates no successful metadata
record.

### D4 — Content is verified before provider invocation

The server authorizes scope before reading multipart bytes, limits files to 20 MiB,
allow-lists PDF/JPEG/PNG/WebP, compares MIME declaration with magic bytes, calculates
SHA-256, and rejects unsupported or spoofed content. Filename and extension alone are
not evidence of content type.

### D5 — Extraction is candidate evidence

The extraction port accepts authorized bytes plus MIME/name and returns a versioned
candidate schema. The OpenAI adapter uses the Responses API, structured JSON output and
`store: false`. It retains provider/model/response identity and field-level confidence
plus page/anchor/bounding-box provenance when supplied. It does not return an approval
or mutate intake status beyond `NEEDS_REVIEW`.

Human review stores a separate correction/decision record referencing the immutable
candidate. Only a trusted reviewer can mark an evidence record reviewed.

### D6 — Two distinct Business-scoped capabilities

Business owners retain both capabilities. Explicit RoleBindings may grant:

- `asset.intake.write` through role `ASSET_RECEIVER`;
- `asset.evidence.review` through role `ASSET_REVIEWER`.

Read visibility is not write authority. Every mutation evaluates the exact Business.

### D7 — Excel and Google Sheets are bounded adapters

The Excel workbook contains `Assets`, `Evidence`, `ProcurementRefs` and `Lookups` sheets
whose enums come from the canonical validation registry. Import is preview-first and
reports sheet/row/cell issues. Evidence bytes are never embedded; rows carry opaque
`FileAsset` IDs.

Google Sheets input is a one-way trusted snapshot contract: spreadsheet ID, revision,
range and a bounded array of rows are hashed server-side and converted by the same row
adapter. It does not implement Google OAuth, polling, two-way sync or last-writer-wins.
Export is a normal `.xlsx` that Google Sheets can import.

### D8 — LINE transport stays outside Asset Management

zuri-cli verifies LINE signatures, fetches bytes and uploads them through the trusted
file path. zuri-ai accepts only a server-bound transport identity, source correlation
and opaque active `FileAsset` IDs. It rejects body-supplied Tenant/Business authority,
LINE access tokens, reply tokens and arbitrary attachment URLs.

### D9 — Idempotency binds correlation to payload hash

`businessId + sourceChannel + sourceCorrelationId` identifies one intake occurrence.
Replaying the same normalized payload returns the existing draft; presenting a different
payload under the same key returns a conflict. Upload objects use content-derived unique
paths and are never overwritten.

### D10 — This slice stops before registration

The highest successful intake status is `READY_FOR_REGISTRATION`. Creating a
`RegisteredAsset`, assigning an Asset ID, transferring custody, Procurement mutation,
Finance approval or journal posting requires a later documented and test-first change.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Store receipt bytes in AssetEvidence/SQLite | duplicates FileAsset ownership and inflates the authoritative DB |
| Give the browser a Supabase service key | leaks installation-wide storage authority |
| Let OCR create/register assets directly | model output is probabilistic evidence, not authority |
| Make Google Sheets the register | breaks single writer, audit and offline-first recovery |
| Fetch LINE bytes inside zuri-ai | duplicates the transport/secret boundary already owned by zuri-cli |
| Add a second Asset intake schema for spreadsheets | permits surfaces to drift and creates multiple writers |
| Implement full lifecycle in this slice | expands risk beyond the evidence/review problem approved by the owner |

## Consequences

Positive:

- sensitive file and AI integrations remain replaceable and server-confined;
- every channel gets identical deterministic validation;
- source evidence, model candidate and human correction are independently auditable;
- provider outages cannot silently create an accepted intake.

Costs:

- cloud runtime needs a private bucket and server credentials;
- reviewer roles and evidence status must be operated explicitly;
- Google Sheets remains snapshot-based until a separate OAuth/sync decision;
- registration is still a subsequent feature.

## Verification

- storage-port tests cover headers, private opaque refs, no upsert, get/remove and
  failure mapping;
- upload policy tests cover size, magic bytes, hash and storage/metadata cleanup;
- extraction tests cover image/PDF input, structured output, `store: false`, timeout,
  schema refusal and no provider secret disclosure;
- intake tests cover idempotency, file scope/status, PR/PO/payment/lot rules and status;
- RBAC tests cover owner/receiver/reviewer and cross-Business denial;
- Excel/Sheet/LINE tests prove convergence and forbidden authority fields;
- full repository verification passes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Accepted provider-neutral cloud evidence, candidate extraction, human review and bounded intake adapters | working-tree | RWANG |
