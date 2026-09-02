---
version: "0.2.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-02T11:05:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "change-request"
  scope: "Cloud evidence, extraction review, Excel/Google Sheets snapshots and LINE handoff"
---

# CR-015 — Asset Evidence Intake Execution

## Outcome requested

Turn the Asset Management foundation into a usable receiving lane that accepts
receipt/payment evidence, creates a durable draft, proposes structured values through
OCR/Vision, supports human correction, and prepares a validated intake for later
registration. The slice ends at `READY_FOR_REGISTRATION`; it does not issue an Asset
ID, mutate Procurement, or post to Finance.

## Product problem

The current `/assets` foundation can validate a complete JSON envelope but does not
help a receiver turn real-world evidence into that envelope. Users work with phone
photos, PDFs, e-receipts, payment slips, spreadsheets and LINE attachments. Requiring
manual JSON would preserve the contract while leaving the actual receiving job
unfinished.

## Accepted execution shape

```text
Web / REST / Excel / Google Sheets snapshot / trusted LINE handoff
                              │
                              ▼
              authorize Business before parsing bytes
                              │
                              ▼
       content allow-list → magic-byte check → hash → private storage
                              │
                              ▼
          immutable FileAsset + AssetEvidence reference
                              │
                              ▼
        OCR/Vision candidate + field-level provenance/confidence
                              │
                              ▼
          human correction → deterministic envelope validation
                              │
                              ▼
                   READY_FOR_REGISTRATION
```

## Functional scope

1. Upload JPEG, PNG, WebP and PDF evidence to a private managed-object adapter.
2. Validate declared type, magic bytes and a 20 MiB request limit before persistence.
3. Persist `FileAsset` metadata only after storage succeeds; clean up the object when
   metadata persistence fails.
4. Create an idempotent `AssetIntake` draft from the canonical envelope and reference
   only active same-Business `FileAsset` rows.
5. Run an OpenAI Responses API extractor behind a provider-neutral port. Model output
   is a `CANDIDATE`, never an approval.
6. Store extractor identity, response identity, field confidence and evidence anchors;
   preserve human corrections separately from the provider response.
7. Generate an Asset-specific Excel workbook and convert uploaded workbooks through
   the same envelope validator with sheet/row/cell errors.
8. Accept a bounded Google Sheets snapshot payload and hash its spreadsheet/revision/
   range/rows. The Sheet is an intake snapshot, not a synchronized source of truth.
9. Accept a trusted LINE handoff containing opaque `FileAsset` IDs only. zuri-cli owns
   LINE signature verification and attachment-byte retrieval.
10. Export persisted draft/validated intake rows as a Google Sheets-ready `.xlsx`.

## Required controls

- Viewer/session, Business visibility, Asset-domain grant and write/review authority
  are resolved before content read, model invocation or entity disclosure.
- Private object keys contain scope identifiers and a content hash, never a service
  credential or public URL.
- Provider credentials remain server-side and are never placed in a workbook, response,
  audit payload or log.
- OpenAI requests use `store: false`; raw document bytes and payment data are not logged.
- Payment evidence remains mandatory for `PROCUREMENT_PURCHASE`; PR and PO references
  remain required by deterministic validation.
- A model, spreadsheet formula, LINE message or client-supplied Business ID grants no
  authority and cannot set `REVIEWED` or `READY_FOR_REGISTRATION` alone.

## Accepted defaults

| Concern | Default | Boundary |
|---|---|---|
| Object storage | Supabase Storage adapter | provider-neutral port; private bucket; server credential only |
| Extraction | OpenAI Responses adapter | provider-neutral extractor; structured JSON; `store: false` |
| Google Sheets | one-way snapshot | no live two-way sync; zuri-ai remains authoritative |
| LINE | zuri-cli binary handoff | zuri-ai receives trusted opaque `FileAsset` IDs, never LINE secrets |
| Delivery end | `READY_FOR_REGISTRATION` | no Asset ID, capitalization, journal or Procurement write |

## Success criteria

- An authorized receiver can upload evidence, create a draft and get a deterministic
  validation result without hand-authoring JSON.
- An authorized reviewer can see provider candidates with provenance and save explicit
  corrections without erasing the original extraction.
- The same logical row produces the same canonical envelope through Excel or Google
  Sheets snapshot intake.
- Replayed source correlations return the same intake; the same correlation with a
  different payload is rejected.
- Cross-Business evidence IDs and unauthorized review attempts fail without revealing
  whether the target exists.
- Targeted tests, full tests, build, documentation governance and E2E pass.

## Out of scope

- issuing an Asset ID or creating `RegisteredAsset`;
- accepting/rejecting procurement goods, changing PR/PO/GRN, or supplier matching;
- Finance capitalization, depreciation-book approval, journal or tax posting;
- malware scanning service, although unsupported/spoofed content is rejected and the
  storage boundary retains a quarantine-capable status;
- native Google OAuth/two-way Sheet synchronization;
- fetching LINE attachment bytes or holding LINE channel credentials in zuri-ai;
- maintenance, stocktake, transfer or disposal lifecycle mutations.

## Approval

The owner approved the proposed document and architecture defaults by replying
`approve` on 2026-09-02. This authorizes the documentation/test-first implementation
described by ADR-056 and the four-phase plan.

## Delivery state

Implemented and fully verified as a local beta. The Supabase Storage and OpenAI
adapters require server configuration, and this delivery does not claim a production
migration, a real provider request or any behavior beyond `READY_FOR_REGISTRATION`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Recorded the owner-approved cloud evidence, extraction review, workbook/snapshot and trusted LINE execution slice | working-tree | RWANG |
| 0.2.0b | 2026-09-02 | beta | Recorded local implementation and full verification while preserving deployment/provider gates | working-tree | RWANG |
