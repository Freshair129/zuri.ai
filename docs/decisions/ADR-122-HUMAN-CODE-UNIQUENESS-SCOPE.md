---
id: ZAI:ADR-122
title: Human code uniqueness follows the owning scope; Customer.code becomes per-Tenant
version: "1.0.0"
status: accepted
created_at: "2026-11-25"
last_update: "2026-11-25"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: decision-record-plus-customer-code-tenant-composite-unique-written-migration-not-applied-no-renumbering-no-other-model
approved_on: "2026-11-25"
approved_by: "Delegated product-owner decision D-D8 (Astra, gpt-6-astra) under owner instruction 2026-11-08, relayed by the lead Claude session; this is not human approval and no other approval is claimed"
attributes:
  doc_type: architecture-decision
  domain: crm
  scope: "Rule for the uniqueness scope of human `code` columns, the inventory of every model with one, and the Customer.code review and change; no other model changes and no existing code value is rewritten"
relations:
  - type: relates_to
    target: ZAI:FR-023
  - type: relates_to
    target: ZAI:BR-001
  - type: relates_to
    target: ZAI:BR-002
  - type: relates_to
    target: ZAI:SEC-001
  - type: relates_to
    target: ZAI:ADR-057
  - type: relates_to
    target: ZAI:ADR-039
---

# ADR-122 — Human code uniqueness follows the owning scope; Customer.code becomes per-Tenant

**Status:** Accepted on 2026-11-25. It records delegated product-owner decision
D-D8 (Astra, gpt-6-astra) under owner instruction 2026-11-08, relayed by the
lead Claude session. It is not human approval. The migration this record ships
is written, not applied; applying it is an owner-only operator step (ADR-057).

## Context

BR-001 makes the Tenant the isolation boundary. 24 of the 53 models that carry a
human `code` still declare it globally unique (`code String @unique`), so one
Tenant's choice of `CUS-ACME` blocks every other Tenant from using it, and the
generated-code allocator (`uniqueHumanCode`, PR #819 retry-on-conflict) probes
the whole installation to find a free suffix. That is a cross-Tenant side
channel (a code exists somewhere) and a needless coupling. The other 29 models
already scope the code to a Tenant, a Business or a parent record.

## Decision

### D1 — Rule

The human `code` of Tenant-owned data is unique within the Tenant, or within a
narrower scope that the owning contract names. Installation-wide uniqueness
applies only to installation-level data: Portfolio, Tenant, the provider
catalogue (`IntegrationProvider`) and, until D6 decides, `Person`.

### D2 — Inventory

Global `@unique` on `code` today (24 models):

| Model | Uniqueness today | Ownership | Target scope |
|---|---|---|---|
| Portfolio | global `@unique` | Installation | stays global (installation-level) |
| Tenant | global `@unique` | Installation | stays global (installation-level) |
| LegalEntity | global `@unique` | Tenant | candidate `(tenantId, code)`; not decided here |
| Business | global `@unique` | Tenant | candidate `(tenantId, code)`; not decided here |
| Branch | global `@unique` | Tenant | candidate `(tenantId, code)`; not decided here |
| Person | global `@unique` | Installation (cross-Tenant identity) | stays global; D6 owns the Person decision |
| Workspace | global `@unique` | Tenant (or Portfolio scope) | candidate `(tenantId where present, code)`; not decided here |
| OfficeDesignRegistry | global `@unique` | Tenant | candidate `(tenantId, code)`; not decided here |
| OfficeDesignIdentity | global `@unique` | Tenant (via registry) | candidate `(registryId, code)`; not decided here |
| Project | global `@unique` | Tenant (via Business) | candidate `(businessId, code)`; not decided here |
| Team | global `@unique` | Tenant (via Business) | candidate `(businessId, code)`; not decided here |
| BusinessRoadmap | global `@unique` | Tenant (via Business) | candidate `(businessId, code)`; not decided here |
| BusinessGoal | global `@unique` | Tenant (via Business) | candidate `(businessId, code)`; not decided here |
| BusinessKeyResult | global `@unique` | Tenant (via Business) | candidate `(businessId, code)`; not decided here |
| Workstream | global `@unique` | Tenant (via Project) | candidate `(projectId, code)`; not decided here |
| WorkContainer | global `@unique` | Tenant (via Workstream) | candidate `(workstreamId, code)`; not decided here |
| WorkItem | global `@unique` | Tenant (via Workstream) | candidate `(workstreamId, code)`; not decided here |
| Milestone | global `@unique` | Tenant (via Project) | candidate `(projectId, code)`; not decided here |
| Gate | global `@unique` | Tenant (via Project) | candidate `(projectId, code)`; not decided here |
| Repository | global `@unique` | Tenant (via Business) | candidate `(businessId, code)`; not decided here |
| ProjectFile | global `@unique` | Tenant (via Project) | candidate `(projectId, code)`; not decided here |
| FileAsset | global `@unique` | Tenant | candidate `(tenantId, code)`; not decided here |
| Customer | global `@unique` | Tenant | **`(tenantId, code)`** — this change |
| IntegrationProvider | global `@unique` | Installation (provider catalogue) | stays global (installation-level) |

Already scoped (29 models, no change):

| Model | Constraint | Scope |
|---|---|---|
| ConversationSession | `(tenantId, code)` | Tenant |
| LineOaAccount | `(tenantId, code)` | Tenant |
| LineOaRichMenu | `(tenantId, code)` | Tenant |
| LineOaLiffApp | `(tenantId, code)` | Tenant |
| MarketingPlan | `(businessId, code)` | Business |
| MarketingInitiative | `(businessId, code)` | Business |
| MarketingContentBrief | `(businessId, code)` | Business |
| MarketingBroadcastIntent | `(businessId, code)` | Business |
| InventoryCategory | `(tenantId, code)` | Tenant |
| ProductFamily | `(tenantId, code)` | Tenant |
| Factory | `(tenantId, code)` | Tenant |
| ProductMaster | `(tenantId, code)` | Tenant |
| Product | `(tenantId, code)` | Tenant |
| InventoryCatalogIntake | `(tenantId, code)` | Tenant |
| ProductLot | `(productId, code)` | Parent record |
| ProductBundle | `(tenantId, code)` | Tenant |
| ProductRecipe | `(tenantId, code)` | Tenant |
| WarehouseLocation | `(tenantId, code)` | Tenant |
| CustomizationWorkOrder | `(tenantId, code)` | Tenant |
| KittingWorkOrder | `(tenantId, code)` | Tenant |
| StockReservation | `(tenantId, code)` | Tenant |
| SalesTask | `(tenantId, code)` | Tenant |
| SalesOrder | `(tenantId, code)` | Tenant |
| Payment | `(tenantId, code)` | Tenant |
| Supplier | `(tenantId, code)` | Tenant |
| PurchaseOrder | `(tenantId, code)` | Tenant |
| GoodsReceipt | `(tenantId, code)` | Tenant |
| SupplierCostSheet | `(tenantId, code)` | Tenant |
| ProjectFeature | `(projectId, code)` | Parent record |

Rows marked "candidate" are classified only. They are not approved for change
here: re-keying each needs its own lookup review, because several are resolved
by bare `code` (for example `GET /api/resolve` finds Project, Workstream,
Milestone, Gate, WorkContainer, WorkItem, Workspace and Repository with
`findUnique({ where: { code } })`) and a narrower key would change that contract.

### D3 — No renumbering, no re-keying

Existing codes are never rewritten, regenerated or reassigned. Primary keys stay
the internal UUID (BR-002); `code` stays a human label. This decision approves
only a weaker constraint on `Customer.code`.

### D4 — Customer.code review (compatibility)

- **Lookups by code.** There are none that read a Customer by code. The only
  code-keyed accesses are the two availability probes in
  `src/modules/crm/line-ingest-service.js` (`findUnique({ where: { code } })`,
  before `customer.create`). `GET /api/resolve` has no CUSTOMER type. Every other
  read goes by `id`, by `(tenantId, personId)` or by `tenantId` plus a filter,
  and code appears only as a returned/displayed field.
- **Who relied on global uniqueness.** Only those probes, which would have
  continued to see other Tenants' codes. No contract, API or Edge consumer
  resolves a Customer by code.
- **What a composite key changes.** `@@unique([tenantId, code])` is strictly
  weaker than `@unique`, so no existing row can violate it and no backfill is
  needed (the same argument as `20260819120000_scope_external_ids_by_tenant`).
  `tenantId` is required and non-null on Customer, so the composite has no
  NULL-distinct loophole. `CUS-` codes can now repeat across Tenants; anything
  that displays a code without its Tenant must not treat it as globally
  identifying (none does today).
- **Migration plan.** One written migration, applied by the owner: drop index
  `Customer_code_key`, create unique index `Customer_tenantId_code_key`. It
  contains no UPDATE, DELETE or INSERT. Rollback is the reverse, valid only
  while no two Tenants share a code.

### D5 — Allocation

The allocator probes with the composite key, so a code is only suffixed when
the same Tenant already holds it. The retry-on-conflict helper already treats a
conflict on a `code` field as retryable and needs no change.

## Out of scope

Re-keying any other model, `Person.code` (D6), any production action, renumbering
or deleting data, and changing `GET /api/resolve`.

## Consequences

- A second Tenant's first customer named like an existing one gets the plain
  code instead of a suffix.
- The 19 other candidate models keep their global constraint until each is
  reviewed under this rule.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-11-25 | Claude Sonnet 5.5 | Initial record: rule, inventory, Customer.code review and per-Tenant change (D-D8, delegated). |
