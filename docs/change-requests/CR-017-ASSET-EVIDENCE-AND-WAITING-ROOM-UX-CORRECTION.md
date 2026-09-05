---
version: "0.2.0b"
created_at: "2026-09-04T09:39:36+07:00,RWANG"
last_update: "2026-09-04T09:39:36+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "cross-domain"
  doc_type: "change-request"
  scope: "Multi-role Asset evidence capture and current-person Waiting Room profile/Home visibility"
---

# CR-017 — Asset Evidence and Waiting Room UX Correction

## Outcome requested

Correct two user-visible gaps without moving domain authority:

1. replace the single payment-proof upload on Asset Receiving with explicit physical
   asset photo, receipt/payment and warranty evidence slots; and
2. show the waiting person's own profile on Waiting Room with a route back to Home.

## Complexity and risk

- Execution level: C-2, documentation-driven implementation.
- Risk: MEDIUM — the Asset evidence vocabulary and readiness UI change, and the
  identity entry surface gains presentation of current-person data.

## Scope

### Asset Management

1. Rename step 1 to `หลักฐานภาพถ่ายและการจ่ายเงิน`.
2. Add the closed evidence role `ASSET_PHOTO`.
3. Require `ASSET_PHOTO` and `PAYMENT_PROOF` for a procurement-origin intake.
4. Present separate upload slots for:
   - physical Asset photo — required, image content only;
   - receipt/payment evidence — required, image or PDF;
   - warranty — conditional, image or PDF when a warranty document exists.
5. Preserve every uploaded FileAsset as a separate evidence entry with an explicit
   role; no filename or upload order determines meaning.
6. Keep OCR/Vision targeted at receipt/payment evidence and allow a reviewer to
   decide each attached evidence item before readiness can become
   `READY_FOR_REGISTRATION`.

### Waiting Room

1. Render only the current person's profile returned by `/api/onboarding/state`:
   display name, first/last name, email and phone when present.
2. Render an initials avatar without introducing profile-image storage.
3. Add a `กลับหน้าแรก` link to `/` in the page header.
4. Preserve the existing invitation, Workspace, profile-first and BusinessShell
   authorization boundaries.

## Non-goals

- a stored avatar/profile-image upload;
- a directory of all people waiting or an owner approval queue;
- changing Workspace/Business membership authority;
- changing private-object storage, OCR provider or file-size/MIME limits;
- making warranty mandatory for an Asset with no warranty document;
- registration, Asset ID issuance, Procurement mutation or Finance posting.

## Acceptance criteria

1. Asset Receiving cannot save a procurement-origin draft without both an Asset
   photo and receipt/payment evidence.
2. Warranty remains optional, but when attached is persisted and reviewed as
   `WARRANTY` evidence.
3. Each upload slot reports its own file and upload state; replacing one slot does
   not replace another.
4. The canonical envelope carries every evidence item with its explicit role and all
   surfaces continue to use the same validator.
5. OCR/Vision never treats an Asset photo or warranty as payment evidence by upload
   order.
6. Every attached evidence item can receive a human review decision; readiness does
   not silently ignore an unreviewed attachment.
7. Waiting Room displays only the session principal's profile and exposes no broad
   people or scope inventory.
8. Waiting Room has an accessible `กลับหน้าแรก` link whose target is `/`.
9. Focused unit/integration/E2E tests, build, documentation governance and full
   `npm run verify` pass before a pull request is opened.

## Impact

| Area | Change | Boundary retained |
|---|---|---|
| Asset validation | add `ASSET_PHOTO_REQUIRED` beside the existing payment/PR/PO gates | server-trusted Business remains authority |
| Asset Receiving UI | replace one-file state with role-keyed uploads and reviews | FileAsset still owns content identity |
| Excel/Sheet lookup | expose `ASSET_PHOTO` through the existing canonical enum | snapshot remains non-authoritative |
| Identity API | no change required | state already current-person scoped |
| Waiting Room UI | render existing profile and `/` action | no other person's profile is queried |
| Database | no migration | evidence role is stored as a validated string |

## Test-first implementation plan

1. Add RED contract tests for the new Asset role, required photo gate, role-keyed UI
   and workbook lookup.
2. Add RED Waiting Room page/E2E assertions for current-person profile and Home.
3. Implement the smallest enum, validator and UI changes required to pass.
4. Run focused tests, `npm run build`, `npm run govern`, focused E2E and
   `npm run verify`.

## Rollback

Revert the UI/enum/validator commit. Existing evidence rows remain valid strings and
no schema rollback is required. Previously created `PAYMENT_PROOF` evidence remains
readable; rollback must not delete FileAsset or AssetEvidence records.

## Approval record

The owner approved this documentation and implementation direction on 2026-09-04,
including required Asset photo and payment evidence, conditional warranty, a
current-person-only Waiting Room profile and a Home link to `/`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-04 | draft | Proposed the cross-domain UX correction and tests | working-tree | RWANG |
| 0.2.0b | 2026-09-04 | beta | Owner approved implementation under the documented boundaries | working-tree | RWANG |
