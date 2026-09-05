---
version: "0.2.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-04T09:39:36+07:00,RWANG"
status: "beta"
superseded_by: null
domain: asset-management
attributes:
  domain: "asset-management"
  doc_type: "feature-specification"
  scope: "FR-137..140 evidence, review, workbook/snapshot and LINE intake"
---

# FR-137..140 — Asset Evidence Intake Execution

## Feature map

| ID | Subject | Outcome |
|---|---|---|
| FR-137 | Cloud evidence and immutable FileAsset | authorized users upload verified Asset photos, receipt/payment evidence and warranty evidence to private managed storage |
| FR-138 | OCR/Vision extraction and human review | provider output is reconstructable candidate evidence and a reviewer saves separate corrections |
| FR-139 | Asset Excel/Google Sheets import-export | canonical rows preview through one validator and export without becoming a second source of truth |
| FR-140 | Trusted LINE OA/LIFF handoff | zuri-cli hands opaque staged FileAsset IDs to the same draft writer without sharing LINE secrets |

## Actors and capabilities

| Actor | Capability | Explicitly cannot |
|---|---|---|
| Business owner | upload, draft, review and export in owned Business | reach another Business |
| Asset receiver | `asset.intake.write` in assigned Business | review/approve model candidates unless separately granted |
| Asset reviewer | `asset.evidence.review` in assigned Business | derive authority from evidence content or change Procurement/Finance |
| zuri-cli transport | authenticated server-bound handoff | choose Tenant/Business from message body or register an asset |
| OCR/Vision provider | return candidate fields/provenance | approve, review or set ready state |

## Detailed user stories

### US-137.1 — Upload Asset photo, receipt/payment or warranty evidence

As an Asset receiver, I want to attach a physical Asset photo, receipt/payment
evidence and an available warranty document so that the received item and its
supporting transaction evidence are preserved before data extraction.

Acceptance:

1. The server resolves session, visible Business, Asset domain and write authority
   before reading the file body.
2. JPEG, PNG, WebP and PDF up to 20 MiB are accepted only when magic bytes agree with
   the declared MIME.
3. SHA-256 is calculated server-side and the object is stored privately without
   overwrite.
4. The response exposes stable FileAsset metadata and hash, not object credentials,
   raw blob reference or a public URL.
5. Storage failure creates no successful FileAsset. Metadata failure triggers a
   best-effort object removal and reports failure.
6. Unsupported, empty, oversized or spoofed content is rejected deterministically.
7. Evidence meaning is explicit: `ASSET_PHOTO`, `PAYMENT_PROOF` and `WARRANTY`
   are role values, never inferred from filename or upload order.
8. A procurement-origin intake requires `ASSET_PHOTO` and `PAYMENT_PROOF`.
   `WARRANTY` is required only when a warranty document exists for the Asset.

States: idle, selecting, uploading, uploaded, invalid-file, unauthorized,
provider-unavailable and retryable-failure.

### US-137.2 — Save an idempotent draft

As an Asset receiver, I want to save incomplete work safely so that LINE or browser
evidence can be assembled over several actions.

Acceptance:

1. The writer accepts one strict `AssetIntakeEnvelope` and server-trusted Business.
2. Every referenced FileAsset must be active, non-deleted and owned by that Business.
3. Normalized envelope and deterministic validation snapshots are persisted.
4. A same source correlation plus same payload hash returns the existing intake.
5. A same source correlation plus different payload hash returns conflict and changes
   nothing.
6. Invalid/incomplete data may remain `DRAFT` or `NEEDS_REVIEW`; it cannot claim ready.
7. A valid envelope whose evidence is reviewed becomes `READY_FOR_REGISTRATION`.
8. Every create/status/review mutation emits append-only audit evidence.

### US-138.1 — Extract candidate fields

As an Asset receiver, I want OCR/Vision to propose receipt/payment fields so that I
do not retype every value.

Acceptance:

1. Only active same-Business evidence may be read and sent to the provider.
2. Images use an image input and PDFs use a file input; the request is bounded and
   uses `store: false` plus strict structured JSON.
3. The provider response is validated again locally before persistence.
4. Candidate fields retain field path, value, confidence and file/page/anchor/bounds
   provenance when available.
5. Provider/model/response/schema identity is retained; credentials and raw bytes are
   absent from logs, audit payloads and client responses.
6. Provider timeout, malformed output or refusal yields an explicit failure and never
   marks evidence reviewed.

### US-138.2 — Review and correct extraction

As an Asset reviewer, I want to compare candidate values with the original evidence
and record corrections so that later registration uses accountable human decisions.

Acceptance:

1. The reviewer sees candidate value/confidence/provenance and an evidence reference.
2. Corrections are stored separately with reviewer person/time and decision.
3. The original provider response is not overwritten.
4. Only `ACCEPT` or `CORRECT` makes evidence `REVIEWED`; `REJECT` makes it
   `REJECTED` and prevents ready status.
5. A receiver without review permission and a reviewer from another Business receive
   a non-enumerating denial.
6. Re-review appends a versioned review entry rather than deleting history.

### US-139.1 — Download and import the Asset workbook

As an Asset officer, I want a Thai/English Excel template so that bulk intake has
clear required fields and dropdowns.

Acceptance:

1. Workbook sheets are `อ่านก่อน (Read Me)`, `Assets`, `Evidence`,
   `ProcurementRefs` and `Lookups`.
2. Required columns are visibly marked; enum dropdowns derive from canonical schemas.
3. Evidence uses opaque FileAsset IDs; binary content and credentials are never embedded.
4. Import caps rows, rejects renamed/missing headers, reports sheet/row/column issues and
   performs no hidden persistence.
5. Each valid Asset row becomes the same canonical envelope used by REST/LINE.
6. Formula/rich-text cells resolve to a displayed scalar only and cannot execute code.

### US-139.2 — Import a Google Sheets snapshot

As an Asset officer, I want to send a controlled Sheet range snapshot so that teams
can prepare rows collaboratively without making the Sheet authoritative.

Acceptance:

1. Input includes Business, spreadsheet ID, revision, range and at most 500 rows.
2. Server computes a canonical snapshot hash and reports it with preview results.
3. Rows use the exact same column adapter and envelope validator as Excel.
4. No Sheet polling, mutation, two-way merge or silent apply occurs.
5. Reusing spreadsheet/revision/range with different row content is detected by hash.

### US-139.3 — Export reviewed intake data

As an auditor or Asset officer, I want a Google Sheets-ready `.xlsx` snapshot so that
I can reconcile current drafts without making the file a parallel register.

Acceptance:

1. Export requires Business read visibility and Asset-domain grant.
2. It returns bounded active intake rows with status, stable IDs, evidence IDs, typed
   procurement refs and normalized business fields.
3. It excludes object refs, provider keys, raw payment bytes and unnecessary PII.
4. The workbook declares export time/schema and `zuri-ai` as authority.

### US-140.1 — Continue a LINE evidence draft

As a LINE user, I want evidence sent to the Business OA to continue in the Asset draft
so that mobile capture enters the same validation path.

Acceptance:

1. zuri-cli verifies LINE transport and uploads bytes before calling the handoff.
2. The handoff provides binding/correlation/message-group metadata and opaque
   FileAsset IDs only.
3. zuri-ai resolves Tenant/Business from server-owned binding; body Tenant/Business,
   attachment URL, channel secret/access token and reply token are forbidden.
4. FileAsset scope/status and replay hash are checked before draft persistence.
5. Multi-message replay returns the existing draft rather than duplicating it.
6. A handoff may remain incomplete; it never bypasses PR/PO/payment/lot/human gates.

## Validation-to-status decision

| Condition | Intake status |
|---|---|
| parse/scope/file reference invalid | request rejected; no new successful draft |
| canonical envelope has deterministic issues | `DRAFT` |
| provider candidate exists and required review is incomplete | `NEEDS_REVIEW` |
| required evidence rejected | `NEEDS_REVIEW` |
| deterministic validation passes and all evidence is reviewed | `READY_FOR_REGISTRATION` |

`READY_FOR_REGISTRATION` is an intake readiness statement only. It does not create a
`RegisteredAsset` or assert Procurement/Finance acceptance.

## Low-fidelity receiving wireframe

```text
┌ Assets / Receiving ──────────────────────────────────────────────────────┐
│ Business: [server-selected]      Draft: DRAFT / NEEDS_REVIEW / READY    │
├ 1 Evidence ────────────────────────┬ 2 OCR candidate ────────────────────┤
│ [Asset photo]      ASSET_PHOTO      │ Vendor        [candidate]  92%      │
│ [Receipt/payment]  PAYMENT_PROOF    │ Total         [candidate]  88%      │
│ [Warranty]         WARRANTY optional│ PO / PR       [candidate]  71%      │
│ [Upload each] [Run payment OCR]     │ [Review each evidence item]         │
├ 3 Asset data ──────────────────────┴─────────────────────────────────────┤
│ Name · Category · Qty · Serial · PR · PO · Lot · Expiry                │
│ Accountable · Custodian · Users · Department · Location · Project      │
│ Acquisition amount · residual · useful life · depreciation preview     │
├ Validation ─────────────────────────────────────────────────────────────┤
│ ✕ PAYMENT_PROOF_REQUIRED     ✓ LOT_VALID     ! HUMAN_REVIEW_REQUIRED   │
│ [Save draft]                         [Prepare for registration]          │
└─────────────────────────────────────────────────────────────────────────┘
```

Mobile stacks Evidence → Candidate → Data → Validation. Status and errors use text
and icons, not color alone. Keyboard focus follows visual order and upload/review
buttons have explicit accessible names.

## Trace and tests

Expected implementation:

- `modules/asset-management/application/*`
- `modules/asset-management/import/*`
- `modules/asset-management/infrastructure/*`
- `platform/storage/*`
- Asset API routes and `/assets/receiving`
- file-management and RBAC registry extensions

Expected proof:

- storage/content-policy, OpenAI adapter and RBAC unit tests;
- intake/evidence review and workbook conversion integration tests;
- route/OpenAPI/LINE/snapshot contract tests;
- receiving navigation/UI/E2E tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-04 | beta | Added role-keyed Asset photo, receipt/payment and conditional warranty evidence with per-item review | working-tree | RWANG |
| 0.1.0b | 2026-09-02 | beta | Defined FR-137..140 actors, detailed stories, acceptance states, readiness rules and receiving wireframe | working-tree | RWANG |
