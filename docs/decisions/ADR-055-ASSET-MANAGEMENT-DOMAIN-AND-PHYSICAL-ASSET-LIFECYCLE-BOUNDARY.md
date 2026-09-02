---
version: "1.1.0"
created_at: "2026-09-01T00:00:00+07:00,Codex"
last_update: "2026-09-01T00:00:00+07:00,Codex"
status: "accepted"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "architecture-decision"
  scope: "Asset Management product-domain boundary, physical asset lifecycle, Procurement/People/Platform/Accounting ownership, navigation identity and modular-monolith runtime shape"
---

# ADR-055 — Asset Management is a first-class Zuri domain for the physical asset lifecycle

**Status:** Accepted for the architecture and documentation boundary. No runtime
module, route, model, migration or implementation requirement is authorized by this
ADR alone.

**Date:** 2026-09-01

**Decided by:** Boss (owner)

**Repository baseline surveyed:** `4306a294ada8ac002bd80dd07735361fc8d2999e`

**Relates to:** [ADR-004](ADR-004-DOCUMENTATION-ARCHITECTURE.md),
[ADR-008](ADR-008-BUSINESS-CENTRIC-SHELL-AND-SCOPE-LENS.md),
[ADR-016](ADR-016-SQLITE-AUTHORITY-AND-MANAGED-LOCAL-FILE-WORKSPACE.md),
[ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
[ADR-029](ADR-029-STABLE-IDENTITY-BINDINGS-FOR-EXECUTION-PLANS.md),
[ADR-038](ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md),
[ADR-039](ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md),
[ADR-051](ADR-051-THE-PRIMARY-CHECKOUT-IS-NOT-A-WORKING-LANE.md),
[`CR-014`](../change-requests/CR-014-ASSET-MANAGEMENT-DOMAIN.md),
[`ZV2-CR-009`](../changes/ZV2-CR-009-ASSET-MANAGEMENT-DOMAIN.md),
`docs/PRODUCT.md`, `docs/SITEMAP-DOMAIN-NAV.md`,
`docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md`, and `AGENTS.md`.

**Amends:** ADR-029 D2 and the stable product-domain catalog by adding
`DOM-ASSET-MANAGEMENT`. It does not rename or reuse an existing domain ID, route
key, requirement ID or model.

## Context

Zuri needs an operational system for receiving equipment, recording inspection
evidence, issuing company asset codes, assigning custody, transferring location or
custodian, maintaining equipment, performing stocktakes and disposing of assets.

The capability begins near Procurement but does not end there. A Procurement Goods
Received Note answers whether ordered goods arrived and whether inventory or
financial receiving should be posted. A company asset record must continue to exist
after receiving and retain custody, location, warranty, maintenance, audit, stocktake
and disposal history throughout the physical item's life.

Placing the entire capability under Commerce/Procurement would make Procurement own
records it does not operate after receipt. Placing it under Platform would treat
company equipment as system configuration. Placing it under HR / People would make
the custodian the owner of asset truth. Splitting it into a separate DNS application
would duplicate Zuri's authentication, Business context, authorization and audit
boundaries.

The repository already has a Prisma model named `FileAsset`. That model represents
managed file content and belongs to the Project Manager/file-management boundary.
Reusing or repurposing the name for physical equipment would join two unrelated
identities and is prohibited.

## Decision

### D1 — Add one first-class Product Domain: Asset Management

The stable product-domain catalog gains:

```text
DOM-ASSET-MANAGEMENT
route key: assets
display label: Asset Management / ทรัพย์สิน
technical owner: TD-ASSET-MANAGEMENT
module: src/modules/asset-management
```

Asset Management is a peer Business capability domain inside the existing Zuri
modular monolith. It uses the same deployment, origin, authenticated session,
selected Business context and audit infrastructure as the rest of Zuri.

It is not deployed at `assets.zuri.ai` in this decision. Its initial route surface
is on the existing application origin:

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

As required by the scope-free URL contract, `tenantId` and `businessId` do not
appear in the page path. They are resolved from the authorized viewer and selected
Business context.

### D2 — The lifecycle capabilities are subdomains of Asset Management

The target Tier-3 navigation is:

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

These are capabilities inside one physical-asset domain, not independent Tier-2
domains. They share one asset identity, lifecycle state machine and immutable
history.

The domain may be enabled or hidden per Business through Zuri's Business module
visibility mechanism. A disabled or unimplemented module must not render a fake
clickable surface.

### D3 — `RegisteredAsset` is the physical asset aggregate; `FileAsset` remains unchanged

The canonical physical asset aggregate is named `RegisteredAsset`.

```text
RegisteredAsset
  id              internal UUID
  code            human-readable Asset ID
  tenantId        isolation boundary
  businessId      operating Business
  branchId?       physical branch/location scope
  categoryId
  serialNumber?
  manufacturer?
  model?
  status
  receivedAt?
  registeredAt
  warrantyEndsAt?
  createdAt
  updatedAt
  deletedAt?
  version
```

The implementation may refine fields after the Phase 2 code/schema survey, but it
must preserve these identity rules:

1. `id` is the internal primary identity.
2. `code` is a stable, human-readable asset code; it is not the primary key.
3. Supplier serial numbers, PO numbers, invoice numbers and QR payloads are external or human references, never primary keys.
4. Asset code uniqueness is enforced at the Tenant/Business boundary fixed by the implementation requirement.
5. `FileAsset` is not renamed, reused or treated as a physical asset. Supporting photos/documents use an explicit reference contract rather than model-name overloading.

### D4 — Asset Management owns the post-receipt physical lifecycle

`TD-ASSET-MANAGEMENT` owns:

- `RegisteredAsset` and asset classification owned by this domain;
- equipment inspection/acceptance records and inspection evidence metadata;
- asset-code issuance and label/QR representation;
- custody assignment and transfer history;
- physical location history;
- warranty metadata needed for operations;
- maintenance cases and maintenance history;
- stocktake campaigns, observations and reconciliation outcomes;
- disposal requests, approval state and disposal outcome;
- domain read models, reports and alerts derived from these records.

Only Asset Management writes Asset Management-owned tables. Other domains consume
public application contracts/read models.

### D5 — Procurement owns purchasing and Goods Receipt; Asset Management owns registration intake

Commerce/Procurement remains the authority for:

- Supplier/Vendor identity used by purchasing;
- Purchase Request and Purchase Order;
- ordered quantities and commercial terms;
- Goods Received Note, returns and procurement issues;
- inventory or purchasing side effects of receipt.

Asset Management references an authorized Procurement receipt or accepts an
explicitly authorized non-PO intake. It records the physical inspection required to
register a durable company asset.

```text
Purchase Order / approved non-PO intake       Commerce or authorized source
                  ↓
Goods receipt reference                       Procurement authority
                  ↓
Physical inspection and acceptance            Asset Management authority
                  ↓
RegisteredAsset + asset code                   Asset Management authority
                  ↓
Custody / location / maintenance / stocktake  Asset Management authority
```

Asset Management never edits the PO, Supplier, GRN or stock movement. Procurement
never writes `RegisteredAsset` directly.

### D6 — HR / People owns people identity; Asset Management owns custody history

HR / People remains the authority for Person, Membership and workforce status.
Asset Management stores authorized references needed to answer who currently holds
an asset and who accepted a transfer.

A custodian reference does not transfer Person ownership into Asset Management. A
person leaving the Business does not delete custody history. Offboarding may request
a return/reconciliation through a public contract, but HR / People does not mutate
asset tables directly.

### D7 — Platform owns identity, authorization and global audit infrastructure

Platform/Identity remains the authority for viewer identity, authenticated sessions,
Business visibility and role/capability decisions. Asset Management must use the
established viewer and repository seams and never trust a client-supplied `tenantId`,
`businessId` or role.

Meaningful lifecycle transitions append an `AuditEvent`, including:

- inspection submitted, accepted, rejected or returned for correction;
- asset code issued;
- custodian/location changed;
- maintenance opened, completed or cancelled;
- stocktake observation and reconciliation outcome;
- disposal requested, approved, rejected or completed;
- sensitive export or label batch generated when an implementation requirement requires it.

### D8 — Accounting is downstream authority, not silently embedded in the MVP

Acquisition cost, capitalization policy, depreciation book, journal entry and tax
treatment belong to a future Accounting/Finance authority unless an accepted
requirement explicitly establishes that domain.

The MVP may store Procurement references and operational acquisition-cost snapshots
needed for display, subject to authorization and provenance. It must not claim to be
the accounting ledger, calculate authoritative book value or post depreciation
journals without a separate accepted boundary.

### D9 — Lifecycle transitions are explicit and append history

The target lifecycle includes at least:

```text
DRAFT_RECEIVING
PENDING_INSPECTION
PENDING_APPROVAL
AVAILABLE
ASSIGNED
IN_MAINTENANCE
MISSING
PENDING_DISPOSAL
DISPOSED
REJECTED
```

The exact enum is fixed by a global requirement and schema contract in the
implementation slice. A transition must be authorized, validated and audited.
History is appended; current state is not reconstructed from editable free text.

Disposed asset codes are never recycled. Deleting or deactivating a Person, Branch
or integration must not erase physical asset history.

### D10 — QR/Barcode labels are identifiers, not authorization credentials

A QR code or barcode may carry a human asset code or opaque lookup token. Possession
of the label does not grant access. The server still resolves an authenticated
viewer, selected Business and permission before returning protected asset data or
accepting a mutation.

Label generation must not embed supplier credentials, internal UUIDs where
disclosure is unnecessary, acquisition cost, employee personal data or other
sensitive payloads.

### D11 — The implementation remains offline-first and repository-mediated

The MVP uses local SQLite and the existing Prisma/repository pattern. Domain services
depend on repository interfaces so a later Postgres adapter can preserve the same
contracts. Every owned row carries the repository's required timestamps/version
fields and respects Tenant/Business isolation.

No network synchronization, microservice extraction or independent asset database
is authorized by this ADR.

### D12 — The ADR reserves architecture identity, not implementation requirement IDs

`ADR-055`, `DOM-ASSET-MANAGEMENT` and `TD-ASSET-MANAGEMENT` are the architecture
identities established by this decision.

Global `FR-*`, `FEAT-*`, `NFR-*`, `BR-*`, `SEC-*` and `SDD-*` IDs are allocated only
in Phase 3 after rebasing and enumerating the current registries/ledger. IDs are
never guessed from this ADR, reused from another subject or created as domain-local
substitutes.

Runtime changes to `src/config/domains.js`, pages, API routes, Prisma models or
application services require those declared IDs and tests first.

### D13 — Intake channels converge; evidence and extraction stay separate

Web, REST, Excel/CSV, Google Sheet, Agent/MCP and LINE OA/LIFF all produce one
strict `AssetIntakeEnvelope`. Evidence content remains in `FileAsset`; Asset owns
the evidence role, extraction candidate, human corrections and review/approval
state. OCR/Vision output is never authority.

The shared pipeline ledger is reused under distinct identities
`DPL-ASSET-REGISTER-IMPORT-V1` and `EXC-ASSET-REGISTER-IMPORT-V1`. Reusing the
knowledge-pipeline definition ID would make monitoring and replay evidence ambiguous
and is rejected.

LINE binary retrieval remains with the transport owner. zuri-ai accepts only a
trusted uploaded artifact reference; it never stores a LINE reply token or secret.

### D14 — Project use is an allocation, not Project Inventory ownership

Project Manager owns the future `ProjectAssetRequest` intent. Asset Management owns
`AssetProjectAllocation`, validates scope/availability/overlap and publishes a
read-only projection for Project Inventory. Project Inventory cannot create, assign,
transfer or dispose an asset.

This keeps ADR-034 intact: Project Inventory remains a read model rather than a
second physical inventory aggregate.

### D15 — Financial calculations are candidates until Finance accepts them

Asset Management may calculate and retain a deterministic depreciation preview from
physical acquisition facts. The candidate records method, inputs, calculation version,
period rows and reviewer state. It cannot capitalize an asset, choose an authoritative
tax/accounting book, post a journal or imply Finance approval.

Payment proof is required intake evidence, not an accounting transaction. A later
Finance contract must explicitly accept a candidate before the financial authority
changes.

## Context map

```text
                     ┌──────────────────────┐
                     │ Platform / Identity  │
                     │ viewer · RBAC · audit│
                     └──────────┬───────────┘
                                │ authorize
                                ▼
┌─────────────────┐      ┌──────────────────────┐      ┌────────────────┐
│ Commerce /      │ ref  │ Asset Management     │ ref  │ HR / People    │
│ Procurement     ├─────►│ physical lifecycle   │◄─────┤ Person/member  │
│ PO · GRN · vendor│      │ and custody history  │      │ authority      │
└─────────────────┘      └──────────┬───────────┘      └────────────────┘
                                    │ operational facts
                                    ▼
                         ┌──────────────────────┐
                         │ Accounting (future)  │
                         │ books · depreciation │
                         └──────────────────────┘
```

Business Home may project read-only asset health/attention metrics. Development/
Project Manager may reference an asset as a project resource but does not own or
mutate it.

## Consequences

- Physical assets gain one stable identity and one owner across their operational life.
- Receiving remains interoperable with Procurement without merging Procurement and Asset Management tables.
- People and Branch records can change without destroying custody/location history.
- The implementation reuses Zuri's Business context, authorization, audit, design system and deployment.
- `FileAsset` remains semantically stable and no model collision is introduced.
- Cost accepted: a first-class domain adds a charter, requirement/feature entries, navigation registration, schema ownership, repository/service seams and a broader test matrix.
- The domain bar may become wider. Responsive and command-palette tests must prove the new slot remains usable.

## Alternatives rejected

**Put the complete lifecycle under Commerce/Procurement.** Rejected because custody,
maintenance, stocktake and disposal outlive purchasing and are operated by different
roles.

**Put it under Platform/IT.** Rejected because physical assets are Business resources,
not platform configuration. The domain must also support non-IT equipment.

**Put it under HR / People.** Rejected because People owns the custodian identity, not
the asset, warranty, maintenance or disposal record.

**Create only `/operations/assets`.** Rejected for the full request because the scope
is a complete asset lifecycle rather than a small Operations screen. A receipt-only
feature could have been an Operations or Procurement subdomain, but that is not this
capability.

**Deploy `assets.zuri.ai`.** Rejected for the initial modular-monolith implementation
because it duplicates authentication/session/RBAC/deployment boundaries without an
independent scale, security, availability or ownership requirement.

**Reuse `FileAsset` or create a generic `Asset` shared by every domain.** Rejected
because `FileAsset` already means managed file content, while a generic shared-write
model would violate the single-owner domain rule.

## Implementation gate

This ADR's runtime consequence is implemented only when all four phases in
[`PLAN-ASSET-MANAGEMENT-4-PHASES.md`](../roadmap/PLAN-ASSET-MANAGEMENT-4-PHASES.md)
are complete and the final repository verification passes:

```text
npm run verify
```

The implementation branch must include generated documentation produced by
`npm run govern`; generated files are never hand-edited.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.0 | 2026-09-01 | accepted | Added convergent evidence intake, Asset-owned Project allocation/read projection and Finance-candidate boundaries after the Phase 2 survey | working-tree | Codex |
| 1.0.0 | 2026-09-01 | accepted | Declared Asset Management as a first-class Business domain, separated Procurement/People/Platform/Accounting ownership, reserved `RegisteredAsset` for physical assets and prohibited collision with `FileAsset` | working-tree | Codex |
