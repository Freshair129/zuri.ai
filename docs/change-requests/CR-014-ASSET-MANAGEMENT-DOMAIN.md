---
doc_type: change-request
id: CR-014
status: foundation-implemented
version: "1.3.0"
created_at: "2026-09-01T00:00:00+07:00"
updated_at: "2026-09-02T08:00:00+07:00"
owner: "Boss"
impacted_domains:
  - asset-management
  - platform-control
  - identity
  - project-manager
proposed_domains: []
---

# CR-014 — Asset Management Domain Product Requirements (PRD)

## 1. Change summary

Add a first-class `asset-management` Product Domain to Zuri for receiving and
inspecting equipment, issuing a company Asset ID, maintaining the asset register,
assigning custody, transferring assets, recording maintenance, performing
stocktakes and disposing of physical assets.

The domain runs inside the existing Zuri modular monolith and uses the existing
Business context, identity, authorization, audit and deployment. Its initial route
key is `assets`; this proposal does not create `assets.zuri.ai`.

The accepted architecture boundary is recorded by
[`ADR-055`](../decisions/ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md).
The cross-cutting delivery envelope is
[`ZV2-CR-009`](../changes/ZV2-CR-009-ASSET-MANAGEMENT-DOMAIN.md).

The Phase 2-frozen local foundation has now passed its documentation/test-first gate
and is implemented. This does not promote the later receiving/register/custody,
maintenance, stocktake or disposal mutations, nor any external provider adapter.

## 2. Problem

Zuri has no authoritative record for durable company equipment after procurement
receipt. A Goods Received Note can establish that ordered goods arrived, but it
cannot answer the operational questions that follow:

- Which physical unit was accepted, and with what inspection evidence?
- What Asset ID and serial number identify it?
- Which Business, Branch, location and custodian are responsible for it?
- Is it available, assigned, under repair, missing or disposed?
- What custody, transfer, maintenance and stocktake history exists?
- Can an auditor prove who changed each lifecycle state and when?

Putting the complete lifecycle under Procurement would make Procurement own records
it does not operate after receipt. Putting it under Platform would treat Business
equipment as system configuration. Putting it under People would make the custodian
own the asset truth. A separate DNS application would duplicate Zuri's security and
scope boundaries before there is an independent operational reason to do so.

## 3. Product requirements baseline (PRD)

This section is the product baseline requested before wireframing and implementation.
The `AM-PRD-*` labels below are local acceptance-clause labels for this proposal;
they are not global Zuri `FR-*`, `NFR-*`, `BR-*`, `SEC-*` or `SDD-*` IDs. Phase 3
must allocate the immutable global IDs before product code is written.

### 3.1 Product goal

Give a Business one trustworthy operational register for each durable physical unit
from acceptance through disposal, with enough identity, custody and event evidence to
answer who has it, where it is, what condition it is in and how it reached that state.

The MVP succeeds when an authorized receiver can turn an accepted equipment unit into
a searchable company asset, hand it to a custodian and later prove the complete
transition history without using a spreadsheet as a parallel authority.

### 3.2 Primary users and jobs

| User | Primary job | Required outcome |
|---|---|---|
| Receiver / asset officer | Match delivered equipment to a receipt reference and inspect each unit | Every accepted/rejected unit has evidence and a deterministic result |
| Asset registrar | Issue the company Asset ID and complete the register | One physical unit maps to one stable, searchable record |
| Custodian manager | Assign, return and transfer custody | Current custody and immutable history agree |
| Employee / custodian | Acknowledge possession or return when policy requires it | The user sees only the assets and actions allowed by Business scope |
| Auditor / approver | Review lifecycle events and exceptions | Actor, time, reason and before/after state are reconstructable |
| System operator | Maintain authorization and investigate failures | No Business data is exposed through operator-only controls |

### 3.3 MVP workflows

**Receive and inspect**

1. The receiver selects or enters a procurement receipt reference.
2. Each physical unit is captured separately with serial number, category, brand,
   model, condition, quantity unit and evidence.
3. The receiver records checklist results and submits the inspection.
4. An authorized decision either accepts, rejects or quarantines the unit.
5. An accepted unit becomes eligible for registration; a rejected/quarantined unit
   cannot silently enter the active register.

**Register and label**

1. The registrar reviews accepted intake data.
2. The system issues one Business-scoped Asset ID without reusing a previous code.
3. The registrar completes ownership, location, warranty and acquisition references.
4. The system persists the `RegisteredAsset` and a creation event atomically.
5. The label encodes a lookup-safe identifier; scanning it still requires normal
   viewer authorization.

**Assign and transfer custody**

1. An authorized user selects an active asset and a valid custodian/location.
2. The system validates Business visibility and the requested transition.
3. Assignment, return or transfer closes the preceding custody interval and appends
   the next interval atomically.
4. The current view and history must reconcile after refresh and offline restart.

### 3.4 Functional acceptance clauses

| Local clause | Requirement | Acceptance evidence expected in Phase 3/4 |
|---|---|---|
| AM-PRD-001 | The system records receiving intake per physical unit and preserves the external procurement reference without owning the PO/GRN | Unit + integration tests for intake, missing reference and cross-Business rejection |
| AM-PRD-002 | The system records an inspection checklist, notes and evidence before an approval decision | Unit tests for validation plus an E2E inspection flow |
| AM-PRD-003 | Only an authorized role may accept, reject or quarantine an inspection; the decision is immutable evidence | Authorization matrix and failed-mutation tests |
| AM-PRD-004 | Acceptance and registration issue one unique Business-scoped Asset ID under concurrent requests | Repository/integration concurrency test and unique constraint proof |
| AM-PRD-005 | Authorized users can list and find a `RegisteredAsset` by Asset ID or serial number without leaking another Business | Read-model, repository-scope and E2E search tests |
| AM-PRD-006 | An active asset can be assigned, returned and transferred only through valid lifecycle transitions | Domain transition table tests |
| AM-PRD-007 | Every custody change closes the previous interval and appends history; history is never overwritten | Transactional repository tests |
| AM-PRD-008 | Meaningful lifecycle mutations emit the repository-standard audit evidence with actor, scope, reason and correlation | Integration tests against the existing audit seam |
| AM-PRD-009 | QR/barcode payloads identify an asset lookup but never grant access or bypass viewer resolution | Security and unauthenticated-route tests |
| AM-PRD-010 | Reads and writes fail closed when viewer, Business membership, permission or entity scope cannot be proven | Route/application authorization tests |
| AM-PRD-011 | Existing `FileAsset` behavior, schema meaning and ownership remain unchanged | Schema-contract and regression tests |
| AM-PRD-012 | A recoverable local repository remains the default runtime; external connectors are adapters rather than hidden authorities | Restart/reload and adapter-boundary tests |

### 3.5 Minimum data contract

The Phase 2 survey may refine names, but it must preserve these meanings:

| Data group | Minimum fields / references |
|---|---|
| Identity | internal UUID, Business ID, stable Asset ID, optional supplier serial number |
| Classification | category, asset type, brand, model and description |
| Acquisition reference | supplier/PO/GRN/invoice references as external references, received date |
| Physical state | lifecycle status, condition, current location, optional branch |
| Custody | current custodian reference, start time, acknowledgement state, immutable history |
| Financial handoff | acquisition value/currency and downstream accounting reference only; no MVP depreciation authority |
| Evidence | inspection result, notes, attachment references, actor, timestamps and correlation ID |
| Label | versioned lookup payload derived from non-secret stable identity |

Serial number is not universally present or unique. Asset ID issuance must therefore
not depend on it, and duplicate-serial handling must be explicit rather than silently
merging records.

### 3.6 Quality, security and operational constraints

- Business isolation and fail-closed authorization apply to every query and mutation.
- Meaningful writes are transactional and auditable; partial asset/history state is
  not an acceptable result.
- Asset ID issuance is deterministic enough to retry safely and safe under
  concurrency.
- The register remains usable in the repository's offline-first local runtime; later
  provider integrations cannot become an undeclared source of truth.
- Search and list views use pagination/limits and expose truncation instead of
  silently presenting partial results as complete.
- The first implementation slice introduces no public unauthenticated asset lookup.
- Attachments use an explicit reference contract and do not overload `FileAsset`.
- UI controls have accessible names, keyboard operation and non-color-only status
  communication.

### 3.7 Product success signals

The first operational pilot should measure:

- accepted units registered without spreadsheet re-entry;
- time from inspection acceptance to issued Asset ID;
- duplicate Asset ID count (target: zero);
- assets with unknown current custodian/location;
- custody transfers with complete before/after evidence;
- rejected cross-Business or unauthorized access attempts;
- register/search requests that return within the Phase 3 performance budget.

Numeric targets require a real pilot baseline and owner sign-off in Phase 3; this PRD
does not invent thresholds before that evidence exists.

### 3.8 Out of scope for the MVP

- authoritative accounting depreciation books, capitalization, journals and tax
  posting; a deterministic Asset-owned review candidate is included;
- vendor/PO/GRN authoring or procurement returns;
- predictive maintenance, IoT telemetry or device remote management;
- public anonymous QR pages;
- automatic migration from spreadsheets, `FileAsset` or Project Inventory;
- a separate deployment, database or `assets.zuri.ai` host;
- the custom visual theme and detailed wireframes, which follow this PRD and the
  Phase 2 UI/design-system survey.

### 3.9 Expanded evidence, reference and temporal requirements

The owner expanded the accepted product intent after the initial lifecycle PRD:

- intake must accept images, PDFs, e-receipts, receipts and payment slips from Web,
  REST, Excel/CSV, Google Sheet, Agent/MCP and LINE OA/LIFF;
- payment proof is mandatory at procurement-origin Submit;
- every procurement-origin asset must carry both PR and PO typed references, with
  line/GRN/invoice/supplier references preserved where present;
- expiry-controlled categories require `lotId` and expiry date;
- accountable person, custodian, actual users, owning/operating department and
  physical location must be independent temporal histories;
- Project use is an Asset-owned allocation projected read-only into Project
  Inventory, not a transfer of ownership;
- depreciation is a deterministic review candidate with Finance remaining the
  accounting authority.

The local foundation implements the common envelope, validation, schema and preview.
Actual LINE binary fetch, OCR/Vision invocation, live Sheet synchronization,
Procurement lookup and Finance posting require adapters/authorities not currently
present in the repository and cannot be reported as live.

### 3.10 Proposed information architecture

```text
Asset Management
├── Dashboard
├── Receiving & Inspection
├── Asset Register
├── Assignment & Transfer
├── Maintenance
├── Stocktake
├── Disposal
└── Reports
```

Target routes are scope-free, following the existing Business-context contract:

```text
/assets
/assets/receiving
/assets/register
/assets/transfers
/assets/maintenance
/assets/stocktakes
/assets/disposals
/assets/reports
```

## 4. Ownership proposal

| Concern | Authority |
|---|---|
| Supplier, Purchase Request, Purchase Order, GRN and procurement return | Commerce / Procurement |
| Physical inspection, Asset ID, register, custody, transfer, maintenance, stocktake and disposal | Asset Management |
| Person, Membership and workforce status | HR / People / Identity authority already established by the repository |
| Viewer, session, Business visibility, permission and global audit infrastructure | Platform / Identity |
| Authoritative capitalization, depreciation and journals | Future Accounting / Finance authority |

Asset Management consumes references through explicit contracts. It does not write
another domain's tables.

## 5. Identity and naming constraints

- Product domain ID: `DOM-ASSET-MANAGEMENT`
- Technical owner ID: `TD-ASSET-MANAGEMENT`
- Route key: `assets`
- Physical asset aggregate: `RegisteredAsset`
- Internal identity: UUID
- Human reference: stable Asset ID/code
- Supplier serial number, PO number, invoice number and QR payload are not primary keys

The repository already has `FileAsset`, which means managed file content. This
proposal must not rename, reuse or repurpose that model for physical equipment.

## 6. MVP proposal

The first implementation slice includes:

1. Business-visible Asset Management navigation and guarded routes.
2. Equipment receiving/inspection.
3. Approval and concurrency-safe Asset ID issuance.
4. Asset register list, detail and search by Asset ID/serial number.
5. Custody assignment and transfer with immutable history.
6. AuditEvent entries for meaningful lifecycle transitions.
7. QR/barcode label representation that remains an identifier, not an authorization credential.
8. Multi-surface intake validation with required payment evidence and PR/PO refs.
9. Lot/expiry, temporal responsibility/location and Project allocation contracts.
10. Deterministic straight-line depreciation preview for Finance review only.

Maintenance, stocktake, disposal, accounting integration and external Procurement/HR
connectors land only when their own implementation requirements are declared.

## 7. Delivery request

Execute the work through four ordered phases:

1. Enumerate repository document/code/test structure.
2. Inspect the relevant domain, schema, authorization, audit and UI seams.
3. Update source-of-truth documents and write executable tests before implementation.
4. Implement code, turn the new tests green and run the complete verification chain.

Before step 3 starts, the Phase 2 impact report must propose the exact document tree,
label every candidate file as `ADD`, `UPDATE`, `GENERATE` or `NO CHANGE`, identify
its authority and rationale, and receive owner acceptance. This keeps the team from
writing duplicate PRD, UX or architecture sources before their ownership is agreed.

The detailed gate and evidence contract is
[`PLAN-ASSET-MANAGEMENT-4-PHASES.md`](../roadmap/PLAN-ASSET-MANAGEMENT-4-PHASES.md).

## 8. Acceptance of this proposal

Accepted for the architecture and planning boundary on 2026-09-01. Acceptance does
not declare a runtime FR, create a module, add a route or authorize a schema migration.
Those actions remain gated by Phase 3 requirements and tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.2.0 | 2026-09-01 | accepted-as-architecture-boundary | Added multi-surface evidence, PR/PO/payment/lot, temporal ownership/location/Project allocation and depreciation-candidate requirements with explicit adapter gates | working-tree | Codex |
| 1.1.0 | 2026-09-01 | accepted-as-architecture-boundary | Added the documentation-structure proposal and owner-acceptance gate before Phase 3 writing | working-tree | Codex |
| 1.0.0 | 2026-09-01 | accepted-as-architecture-boundary | Proposed the Asset Management peer domain and handed the accepted boundary to ADR-055 and ZV2-CR-009 | working-tree | Codex |
