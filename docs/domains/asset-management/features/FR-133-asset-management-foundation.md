---
version: "1.0.0"
status: building
domain: asset-management
requirements:
  - FR-133
  - FR-134
  - FR-135
  - FR-136
feature: FR-133
bundle: FEAT-015
---

# FR-133..136 — Asset Management foundation

## Product outcome

An authorized Business user can enter Asset Management, stage a physical-asset
intake from any supported surface, validate evidence and references with one contract,
and obtain a deterministic preview for registration, responsibility, location,
Project allocation and depreciation review without granting authority to OCR,
spreadsheets, LINE payloads or absent external domains.

## User stories and acceptance criteria

### US-AM-01 — Receive equipment with evidence

As a receiver, I want to create one draft per delivered unit or controlled lot so
the registration decision is traceable to what physically arrived.

- Draft accepts Web, API, workbook/Sheet, Agent/MCP and LINE OA/LIFF as declared
  channels but normalizes them to one envelope.
- Each draft records Business, source correlation, item description/category,
  quantity and evidence references.
- Draft save may be incomplete; Submit validates the complete policy.
- A procurement-origin Submit without `PAYMENT_PROOF` is rejected with a field-level
  code and does not create Asset truth.

### US-AM-02 — Attach receipt, e-receipt, PDF and payment slip

As an asset officer, I want to attach images, PDFs, e-receipts and transfer slips so
an auditor can inspect the original source.

- Evidence references an active `FileAsset`; it does not copy the file bytes.
- Roles include receipt/invoice, payment proof, delivery, inspection, warranty and
  other supporting evidence.
- MIME/type/size policy is based on inspected metadata, not filename extension.
- Duplicate hashes/payment references are reported as conflicts, never silently
  merged.

### US-AM-03 — Review OCR/Vision candidates

As a reviewer, I want extracted vendor, date, amount, line and payment fields with
confidence so I can correct them before approval.

- Original candidate, provider/model/version, confidence and field provenance remain
  reconstructable.
- Low-confidence or conflicting fields require human confirmation.
- A model cannot set approval, viewer, Business, Person, Project or accounting state.
- Human corrections append review evidence rather than overwriting the source.

### US-AM-04 — Trace every asset to PR and PO

As Procurement/audit staff, I want a new procurement asset linked to its PR and PO,
including line references when known, so requester and ordering origin can be found.

- Approval requires at least one `PR` and one `PO` reference for
  `PROCUREMENT_PURCHASE` origin.
- `PR_LINE`, `PO_LINE`, `GRN`, `INVOICE` and `SUPPLIER` references are optional but
  preserved when supplied.
- A reference carries system, type, value and optional line value; the external
  number is never a primary key.
- Asset Management never creates or edits the external PR/PO.

### US-AM-05 — Track lot and expiry

As a compliance user, I want expiry-controlled assets tied to a lot so I can find
which units expire together.

- Categories flagged `expiryControlled` require `lotId` and `expiresOn`.
- Non-expiry categories may omit them and are not assigned synthetic lots.
- Expiry before manufacture/receipt is rejected.
- `lotId` is Business-scoped and is not the internal UUID.

### US-AM-06 — Issue and find a stable Asset ID

As a registrar, I want one stable company Asset ID per physical unit so labels and
search remain reliable.

- Asset ID is unique inside a Business and never recycled after disposal.
- Supplier serial is optional and follows an explicit duplicate policy.
- QR/barcode carries a versioned lookup identifier only and grants no access.
- Registration and creation audit evidence commit atomically when that mutation
  slice is enabled.

### US-AM-07 — Separate accountable person from actual users

As an asset manager, I want to record the accountable person, custodian and one or
more actual users because they are not always the same person.

- Each role is a temporal interval with Person reference and optional org-unit ref.
- One active `ACCOUNTABLE` interval is allowed; multiple active `USER` intervals may
  be allowed by policy.
- Closing/reassigning appends history and cannot rewrite an old interval.
- Cross-Tenant/Business Person or Membership resolution fails closed.

### US-AM-08 — Track owning department and operating department

As management, I want the primary owning department separated from the department
currently operating the asset.

- Until an Org Unit authority exists, each is a typed external reference with system,
  value and display label; no free string is promoted into a master row.
- Responsibility records may reference the applicable org unit at that time.
- Changing department does not change asset identity or erase prior responsibility.

### US-AM-09 — Track physical location over time

As an asset officer, I want to know the Branch, site, building, floor, room or area
where an asset is used.

- Location records carry an optional existing Branch plus Asset-owned physical code,
  label and effective interval.
- Only one current primary location is allowed.
- Moving closes the previous interval and appends a new interval atomically.

### US-AM-10 — Allocate an asset to a Project

As a project manager, I want to request and see equipment used by my Project without
turning Project Inventory into a second asset register.

- Project Manager owns future `ProjectAssetRequest`; Asset owns the resulting
  `AssetProjectAllocation`.
- Allocation references Project and optional Workstream, effective interval and
  quantity/share.
- Exclusive allocations cannot overlap and Project must belong to the same Business.
- Project Inventory consumes a read-only projection and exposes no Asset mutation.

### US-AM-11 — Preview depreciation

As Finance/asset staff, I want a depreciation preview from acquisition cost, residual
value, start date, useful life and method so I can review the expected schedule.

- Foundation supports deterministic straight-line preview with decimal-safe rounding.
- Accumulated depreciation never exceeds depreciable basis; book value never drops
  below residual value.
- Candidate stores inputs, calculation version and review state.
- No posting, tax-book choice or journal entry occurs without a Finance authority.

### US-AM-12 — Import/export with Excel or Google Sheet

As a data steward, I want a versioned template so bulk intake does not require
retyping.

- Canonical columns include row key, asset identity/categorization, PR/PO/lines,
  receipt/payment evidence refs, lot/expiry, responsible/user/org/location/Project
  refs and depreciation inputs.
- Import is strict validate → conflict/reconciliation preview → explicit confirmation.
- Export carries stable IDs/status and does not expose unnecessary PII or file
  credentials.
- Google Sheet uses the same columns; it is not a live source of truth.

### US-AM-13 — Continue a draft in LINE OA

As a field receiver, I want to send text and several photos/PDFs in LINE and review a
LIFF summary before Submit.

- Multiple messages correlate to one bounded draft by trusted transport/session
  binding; raw reply token or secret never enters Asset storage.
- zuri-cli fetches attachment bytes and supplies trusted uploaded artifact IDs.
- zuri-ai refuses untrusted attachment URLs or client-selected Business.
- This story remains adapter-gated until the transport binary contract exists.

### US-AM-14 — Diagnose pipeline validation

As an operator, I want each intake run to show stage, record disposition and reason so
I can replay safe work without re-uploading evidence.

- Definition is `DPL-ASSET-REGISTER-IMPORT-V1`; execution contract is
  `EXC-ASSET-REGISTER-IMPORT-V1`.
- Stable stages cover intake, evidence guard, extraction, normalization, scope/ref
  validation, reconciliation, human confirmation, approval and apply.
- Replay uses the original immutable evidence and records a new execution occurrence.

### US-AM-15 — Fail closed across Business boundaries

As a Business owner, I want another Business unable to list, inspect, assign or
allocate my assets even if it knows an ID.

- Scope is derived from the trusted viewer before entity lookup.
- Hidden domain and direct route access use the same visibility predicate.
- Denials produce no payload containing the target asset/evidence/person/project.

## Canonical intake envelope

```json
{
  "schemaVersion": "1.0",
  "source": { "channel": "WEB", "correlationId": "draft-or-message-group" },
  "businessId": "server-validated-visible-business",
  "origin": "PROCUREMENT_PURCHASE",
  "item": { "name": "Notebook", "categoryCode": "IT-NOTEBOOK", "quantity": 1 },
  "evidence": [{ "fileAssetId": "uuid", "role": "PAYMENT_PROOF" }],
  "procurementRefs": [
    { "type": "PR", "system": "ERP", "value": "PR-0001" },
    { "type": "PO", "system": "ERP", "value": "PO-0001" }
  ],
  "lot": null,
  "responsibilities": [],
  "location": null,
  "projectAllocation": null,
  "depreciation": null
}
```

Unknown keys are rejected. API callers may name a Business only as an asserted
target; the server must verify it against the trusted viewer and never trust the field
by itself.

## Low-fidelity wireframes

### Dashboard

```text
┌ Asset Management ───────────────────────────────────────────────────┐
│ [รับอุปกรณ์ใหม่] [นำเข้า Excel/Sheet] [ตรวจรายการค้าง]             │
├──────────────────────┬──────────────────────┬───────────────────────┤
│ ทรัพย์สินใช้งาน 248 │ รอตรวจหลักฐาน 12  │ ใกล้หมดอายุ 7       │
├──────────────────────┴──────────────────────┴───────────────────────┤
│ งานที่ต้องจัดการ                                                    │
│ ! ขาดหลักฐานจ่ายเงิน  4   ! OCR ความมั่นใจต่ำ 3   ! PO ไม่ตรง 2  │
├─────────────────────────────────────────────────────────────────────┤
│ ล่าสุด: Asset ID | รายการ | ผู้รับผิดชอบ | ที่ตั้ง | Project | สถานะ│
└─────────────────────────────────────────────────────────────────────┘
```

### Intake review

```text
┌ รับอุปกรณ์  1 หลักฐาน ─ 2 ตรวจข้อมูล ─ 3 ผูก PR/PO ─ 4 ยืนยัน ┐
│ หลักฐาน [ใบเสร็จ.pdf ✓] [สลิป.png ✓ บังคับ] [+ เพิ่ม]          │
│ OCR candidate        เอกสารจริง/ภาพด้านขวา                      │
│ ผู้ขาย [........]  วันที่ [..]  ยอด [........]  confidence 92% │
│ PR [PR-...] line [..]   PO [PO-...] line [..]                  │
│ Lot [....]  หมดอายุ [....] (แสดงเมื่อ category ต้องควบคุม)     │
│ ผู้รับผิดชอบ [...] ผู้ใช้งาน [+] แผนก [...] สถานที่ [...]      │
│ Project [ไม่ผูก/เลือก]  ค่าเสื่อม [ดูตัวอย่างตาราง]             │
│ [บันทึกร่าง]                                  [ตรวจสอบและส่ง]   │
└───────────────────────────────────────────────────────────────────┘
```

### Validation result

```text
┌ ตรวจสอบก่อนบันทึก ───────────┐
│ ✓ โครงสร้าง  ✓ หลักฐาน       │
│ ✓ PR/PO      ! OCR ต้องยืนยัน │
│ ✕ ซ้ำ: payment ref ...       │
│                              │
│ [กลับไปแก้] [ส่งให้ผู้อนุมัติ]│
└──────────────────────────────┘
```

Mobile collapses the evidence preview below the form, keeps errors beside their
fields, and provides a sticky Save draft / Validate action. Status is communicated by
text and icon, never color alone.

## Foundation acceptance

- Domain registry, route ownership and dashboard are locally implemented.
- One strict envelope and validation result cover every intake surface.
- Pipeline IDs/catalog are distinct and tested.
- Schema and backup contracts cover the declared Asset records.
- Focused tests prove required payment evidence, PR+PO, lot/expiry, temporal overlap,
  depreciation bounds and server-scope refusal.
- External adapters remain visibly `UNAVAILABLE`, never falsely green.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-01 | building | Declared detailed user stories, canonical envelope, validation, wireframes and foundation acceptance for FEAT-015 | working-tree | Codex |
