---
id: ZAI:IDENTIFIER-AND-CODE-SYSTEM
title: Identifier and code system
version: "0.1.0"
status: candidate
created_at: "2026-11-12"
last_update: "2026-11-12"
author: Claude Fable 5.2 (as-built description from a static review at 49b10eb3)
superseded_by: null
source_of_truth: false
attributes:
  doc_type: architecture-specification
  domain: platform
  scope: Primary keys, human codes, external-identifier mappings, URL identity and their known exceptions
relations:
  - type: references
    target: ZAI:BR-002
  - type: references
    target: ZAI:SDD-003
  - type: relates_to
    target: ZAI:ADR-029
  - type: relates_to
    target: ZAI:ADR-039
  - type: relates_to
    target: ZAI:ADR-044
  - type: relates_to
    target: ZAI:ADR-083
---

# Identifier and code system

This page describes, in one place, how records are identified in zuri-ai as the
code stands. It is a description, not a new authority: the Prisma schema
(`apps/server/prisma/schema.prisma`) decides what is persisted, BR-002 and
SDD-003 state the rule, and the ADRs linked below own their decisions. Where
the code departs from the rule, this page says so instead of smoothing it over.

Counts come from a static census of the schema and route tree at `49b10eb3`
(221 models, 372 API route files). Recount before relying on a number.

## 1. Four identifier layers

| Layer | What it is | Who reads it | Meant to last (not verified against every write path) |
|---|---|---|---|
| Internal id | The primary key. A random UUID for almost every model | Code, foreign keys, URLs | The life of the row |
| Human code | A short label such as `PRJ-CUSTOMER-DATA` or `PO-20261112-003` | People, plans, exports | The life of the row, unique inside its scope |
| External mapping | A row that ties a provider's identifier to an internal id | Integrations, importers | As long as the provider keeps its identifier |
| Document id | `FR-020`, `ADR-039`, `ZAI:…` | Documents, annotations, tests | The life of the project (ADR-039) |

The rule that binds the first three (BR-002): **an external identifier is never
a primary key.** A LINE user id, a tax id, a supplier SKU or a provider event id
is an attribute or a mapping row. `docs/DOMAIN-MODEL.md` §Identity rules states
the same rule in product vocabulary.

## 2. Primary keys

`newId()` in `apps/server/src/lib/ids.js` returns `crypto.randomUUID()`, and
most models declare `id String @id @default(uuid())`.

Fifteen models do not follow that shape. They are listed here because the rule
says "all" and the schema says otherwise:

| Model | Primary key | Why it is shaped this way | Conforms to BR-002? |
|---|---|---|---|
| `ProjectGoal` | Composite `(projectId, goalId)` | A join row | Yes — both parts are internal ids |
| `MarketingReportPolicy` | `businessId` | One policy row per Business | Yes — an internal id used as a shared key |
| `PlanImportReceipt` | `idempotencyKey` | The replay key is the identity of a receipt | Caller-supplied key. `docs/appendices/B-db-schema.md` and the ERD describe it; nothing records it as an approved exception to BR-002 |
| `NotionWebhookReceipt` | `eventId` | Duplicate deliveries collapse on insert | **No.** The key is Notion's event id |
| `KnowledgeRawArtifact`, `KnowledgeParsedArtifact`, `GenesisRag17IngestionIntent`, `GenesisRag17SourceMention`, `GenesisRag17EvidenceCursor`, `GenesisRag17Batch`, `GenesisRag17StageEvidence`, `GenesisRag17PublicationReceipt` | Deterministic `<prefix>_<hex of a hash>` (`kra_`, `kpa_`, `gii_`, `gsm_`, `grb_`; `gre_` for stage evidence; `gpr_` for the publication receipt; `gcur_` for the evidence cursor), built in `apps/server/src/platform/integrations/core/` by `genesisrag17-executor.js`, `genesisrag17-importer.js` and `genesisrag17-publication.js` | Each id is a function of its own input tuple, so the same tuple lands on the same row. Several evidence ids include the run or attempt, so a new attempt makes a new row | Internal, but not random. Not recorded as an approved exception |
| `KnowledgeChunk` | `documentId#ordinal` (`apps/server/src/modules/knowledge/chunking.js`) | A chunk is addressed by its position | Internal, derived |
| `ManagedBlobRecoveryInstallationFence`, `NotionWebhookVerificationToken` | A fixed id with no default | Singleton or sentinel rows | Internal |

`isInternalId()` in `ids.js` accepts any UUID-shaped string. Its comment says
"UUID v4-style", but the pattern does not check the version or variant nibble,
and the deterministic ids above do not pass it at all. Treat it as "looks like a
UUID", not as "is one of our primary keys".

## 3. Human codes

Fifty-three models carry a `code` column, and every one has a unique
constraint. Four patterns produce most of them; the forms that fall outside
are listed at the end of §3.2.

### 3.1 Name-derived codes

`uniqueHumanCode(prefix, name, exists)` builds `PREFIX-NAME-FRAGMENT` (the
fragment is upper-cased, at most 18 characters), then tries `-2` … `-50`, then
falls back to eight hex characters of a UUID.

Prefixes in use: `PF` portfolio, `TNT` tenant, `BUS` business, `LE` legal
entity, `BR` branch, `WS` workspace, `PRJ` project, `WST` workstream, `WC` work
container, `WI` work item, `MS` milestone, `GATE` gate, `FIL` project file and
file asset, `REP` repository, `TEAM` team, `RM` roadmap, `GOAL` goal, `KR` key
result, `PSN` person, `CUS` customer.

Several Project Manager writers accept an explicit `code` from the caller and
generate one only when it is absent (`data.code || uniqueHumanCode(…)`), so a
name-derived prefix is a default, not a guarantee of the code's shape.

### 3.2 Day-sequence codes

`<PREFIX>-YYYYMMDD-NNN`, allocated inside the creating transaction by counting
the day's rows for the Tenant and probing upward:

| Prefix | Record | Owner |
|---|---|---|
| `PO` | Purchase order | procurement |
| `GRN` | Goods receipt | procurement |
| `ORD` | Sales order | commerce |
| `PAY` | Payment | commerce |
| `TSK` | Sales task | crm |
| `CWO` | Customization work order | inventory |
| `KWO` | Kitting work order | inventory |
| `RSV` | Stock reservation | inventory |

Other generated forms exist outside these four patterns and are not catalogued
here: `S-` conversation session codes, hash-based `CIT-` (catalogue intake) and
`SCS-` (supplier cost sheet) codes, `MKT-CAM-`, `MKT-CRE-` and `BRD-` marketing
codes, and `RegisteredAsset.assetCode` (`AST-YYYY-XXXXX`, per Business), which
is a separate column from `code`.

### 3.3 Id-derived codes

A marketing plan code is `MKT-<title slug, 24 chars>-<first 8 hex of the row id>`
(`apps/server/src/modules/marketing/application/marketing-plan-service.js`).

### 3.4 Caller-supplied codes

Catalogue records (`Product`, `ProductMaster`, `ProductFamily`, categories,
locations) and `ProjectFeature` take the code from the caller or the import
envelope and validate it; nothing generates it.

### 3.5 Uniqueness scope

A code is unique only inside the scope its constraint names. The scopes differ
by family, and no rule yet says which is correct for a new model:

| Scope | Models |
|---|---|
| Installation-wide (`@unique`) — 24 | `Portfolio`, `Tenant`, `Person`, `LegalEntity`, `Business`, `Branch`, `Workspace`, `Project`, `Workstream`, `WorkContainer`, `WorkItem`, `Milestone`, `Gate`, `ProjectFile`, `FileAsset`, `Repository`, `Team`, `BusinessRoadmap`, `BusinessGoal`, `BusinessKeyResult`, `Customer`, `OfficeDesignRegistry`, `OfficeDesignIdentity`, `IntegrationProvider` |
| Per Tenant (`tenantId, code`) — 23 | LINE OA accounts, rich menus and LIFF apps; the catalogue (`InventoryCategory`, `ProductFamily`, `Factory`, `ProductMaster`, `Product`, `ProductBundle`, `ProductRecipe`, `WarehouseLocation`, `InventoryCatalogIntake`); work orders and reservations; `SalesTask`, `SalesOrder`, `Payment`; `Supplier`, `PurchaseOrder`, `GoodsReceipt`, `SupplierCostSheet`; `ConversationSession` |
| Per Business (`businessId, code`) — 4 | `MarketingPlan`, `MarketingInitiative`, `MarketingContentBrief`, `MarketingBroadcastIntent` |
| Per Product (`productId, code`) — 1 | `ProductLot` |
| Per Project (`projectId, code`) — 1 | `ProjectFeature` |

Two consequences worth knowing before adding a model:

- A name-derived code that is installation-wide means two Tenants cannot both
  own `PRJ-WEBSITE`; the second gets `PRJ-WEBSITE-2`. The code therefore leaks
  the existence of another Tenant's record by its suffix. `Customer` is
  Tenant-scoped data with an installation-wide code.
- A Tenant-scoped code must always be looked up together with its Tenant.

### 3.6 Concurrency

The name-derived and day-sequence generators read, decide, then insert. Two
creators in separate transactions can pick the same free code; the unique index
refuses the second insert, and most callers do not retry. One that does:
`ingestLineMessage` (`apps/server/src/modules/crm/line-ingest-service.js`)
retries its whole transaction on a unique or serialization conflict. The `uniqueHumanCode` fallback comment says a
UUID fragment "guarantees uniqueness" — eight hex characters make a collision
unlikely, not impossible. Until allocation is atomic or retried, a duplicate-code
failure under concurrent creates is expected behaviour, not corruption.

## 4. External identifiers

There is no single mapping table. Each table has its own scope, and choosing
the wrong one is the usual mistake:

| Table | Maps | Unique key | Scope | Use it for |
|---|---|---|---|---|
| `ExternalRef` | A customer system's id → a Project-system entity (`PROJECT`, `WORKSTREAM`, `WORK_CONTAINER`, `WORK_ITEM`, `MILESTONE`, `GATE`) | `(system, value)` | **Installation-wide** | Plan import and `/api/resolve`. Not safe for a value two Tenants can share |
| `ExternalIdentity` | A provider subject (a LINE user id) → `Person` | `(tenantId, provider, providerSubject)` | Tenant | Who a person is on a channel |
| `ChannelIdentity` | A subject on one channel account → `Person`, with `PENDING` / `ACTIVE` / `REVOKED` | `(tenantId, channel, channelAccountId, providerSubject)` | Tenant + account | Whether that person is linked and may act through that account |
| `ExternalEntityRef` | A provider record → an internal entity, through one connection | `(connectionId, entityType, externalId)` | Integration connection | Records pulled through an Integration connection |
| `ProductIdentifier` | A barcode or partner SKU → `Product` | `(tenantId, kind, value)` | Tenant | Catalogue lookups by an outside code |
| `Product.flowAccountSku` | The accounting system's SKU | `(tenantId, flowAccountSku)` | Tenant | Kept off `ExternalRef` on purpose, because two Tenants can hold the same SKU |
| `OfficeDesignIdentity` | A Visual Office entity id → a design custody UUID | `(registryId, externalId)`, and also `(registryId, kind, semanticKey)` | One registry | Office design handoff (FR-294) |
| `Conversation` | A channel thread | `(tenantId, channel, channelAccountId, externalThreadId)` | Tenant + account | Finding the conversation for an inbound event |
| `Message` | A provider message id | `(conversationId, externalMessageId)` | Conversation | De-duplicating inbound messages |
| `ConversationEvent` | A provider event id | `externalEventId`, unique per `conversationId` | Conversation | De-duplicating non-message events |

The table covers the mappings found in the review; it is not proven complete.

`ExternalRef` lookups are followed by a visibility check on the resolved
entity (`apps/server/src/app/api/resolve/route.js`,
`apps/server/src/modules/project-manager/import/plan-import-service.js`), so a
global key has not been shown to disclose another Tenant's record. The scope is
still a constraint on what may be stored there.

## 5. Scope chain

```text
Portfolio → Tenant → Business → Workspace → Project → Workstream
```

This is the conceptual chain, and each level is a UUID row. The foreign keys
are looser than the picture: a `Workspace` points at its scope through
optional, polymorphic references, and a `Project` requires `workspaceId` while
its `businessId` is optional.
`tenantId` is the isolation boundary and `businessId` the operating business;
a branch is never a Tenant (AGENTS.md §3). Many models carry `tenantId` and
`businessId` as plain columns without a Prisma relation, so the database does
not enforce that pair on every table — the owning service does.

## 6. Identity in URLs and APIs

- Route segments carry internal ids. Across the 372 route files the dynamic
  segments are `[id]` (the most common) and named ids such as
  `[executionRunId]`, `[customerId]` and `[jobId]`; the ones that are not record
  ids are `[operation]`, `[action]`, `[metricKey]` and `[sha256]`. No route uses
  a `[code]` segment.
- Two resolvers turn a code or an external reference into an internal id:
  `GET /api/resolve` for Project-system entities and
  `/api/inventory/products/resolve` for product codes, FlowAccount SKUs and
  product identifiers. Each checks the caller's visibility before returning.
- At the visibility and ownership gates FR-072 covers, a refusal is 404-shaped:
  a record the caller may not see is indistinguishable from one that does not
  exist. That is not a rule for every API; other refusals keep their own status.

## 7. Bindings owned by other decisions

- **Execution plans** (ADR-029): `planId` is `Workstream.id` and `planCode` is
  `Workstream.code`. Codes inside an import envelope are temporary references
  resolved at commit.
- **Threads** (ADR-044): the unified thread id (`th_grp_…`, `th_usr_…`) is
  issued by MSP, outside this repository. No code in `apps/server/src` or
  `services/` names that prefix; CRM keys a conversation by the channel's
  `externalThreadId` and its own `Conversation.id`. ADR-044 writes the format as
  `<prefix>_<uuid>` and its sample shows 33 hex characters without hyphens; the
  producer's exact grammar is not established here.
- **SKU and variant** (ADR-083): `Product.code` is the SKU, unique per Tenant;
  `variantKey` is unique per `ProductMaster`.
- **Document ids** (ADR-039): requirement and feature ids are pinned by subject
  in `docs/.id-ledger.json`. That system is separate from database identity and
  is already enforced by preflight Check 12.

## 8. Known gaps

| # | Gap | Kind |
|---|---|---|
| 1 | `NotionWebhookReceipt.eventId` is a provider id used as a primary key | Code; contradicts BR-002 |
| 2 | Deterministic and derived primary keys (§2) are not recorded as approved exceptions anywhere else | Owner decision |
| 3 | Code allocation is check-then-insert, and most callers do not retry on a conflict (§3.6) | Code |
| 4 | No rule says when a code is installation-wide and when it is Tenant-scoped (§3.5) | Owner decision |
| 5 | No rule says which external namespaces may live in installation-wide `ExternalRef` (§4) | Owner decision |
| 6 | The thread-id grammar in ADR-044 is ambiguous (§7) | Document |
| 7 | `isInternalId()` claims v4 and does not check it (§2) | Code |

## 9. Adding a model

1. Give it `id String @id @default(uuid())` unless replay requires a
   deterministic key. If it does, add the model to §2 with the reason.
2. If people will name it, add a `code` and decide its scope from §3.5 before
   writing the constraint. Prefer Tenant scope for Tenant-owned data.
3. Store an outside system's identifier in a mapping table from §4 whose scope
   matches how far that identifier is unique. Never store it in `id`.
4. Expose the record by its id in routes. Accept a code only through a resolver
   that checks visibility.
5. Ship the Supabase migration with the model (CLAUDE.md, schema-migration-drift).

## Version diff

0.0 → 0.1.0 (2026-11-12): first consolidated description of primary keys, code
generation and scope, external mappings and URL identity, with the exceptions
and gaps found by a static review at `49b10eb3`, then corrected after an
independent factual review. Apart from this page's own document id, it
introduces no model, requirement id or rule.
