---
version: "1.0.0"
created_at: "2026-09-13T20:00:00+07:00,Claude Opus 5"
last_update: "2026-09-13T20:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "inventory"
  doc_type: "architecture-decision"
  scope: "catalogue (SKU) intake for the Inventory domain — one envelope that JSON, Excel and LINE all convert into, a planner that resolves every item against the catalogue before anything is created, a persisted preview whose plan hash a commit must match, an all-or-nothing commit through the existing catalogue writers, and a deterministic LINE command on the server-owned worker instead of a model tool"
---

# ADR-084 — Catalogue intake resolves before it creates

**Status:** Accepted. Implemented by FR-208, FR-209 and FR-210 (FEAT-032) in the same change.
**Date:** 2026-09-13
**Decided by:** Boss (instruction of 2026-09-13: "ทำ Json/Excel/LINE intake ที่เรียก resolve ก่อนสร้าง SKU ในบรานช์ใหม่").
**Relates to:** [ADR-083](ADR-083-SKU-GOVERNANCE-NATURE-AT-THE-MASTER-VARIANT-IDENTITY-AND-CATALOGUE-HYGIENE.md),
[ADR-061](ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md),
[ADR-056](ADR-056-ASSET-EVIDENCE-CLOUD-AND-EXTRACTION-BOUNDARY.md),
FR-154, FR-201, FR-202, FR-203, FR-204, FR-149, FR-097, BR-002, BR-009, SDD-009, SDD-091, SEC-001,
`docs/domains/inventory/CHARTER.md`.

## Context

ADR-083 consequence 4 left a contract open: *every future converter must call `resolve` before
`POST /api/inventory/products`*. The Excel and LINE converters FR-154 named have never existed,
so a catalogue still grows one hand-typed SKU at a time, and nothing that imports in bulk
exists to get resolution wrong.

Two things in the repository shape the answer.

**The intake rule is a pipeline, not a helper.** BR-009 and SDD-009 require every surface to
convert into one envelope that is validated, dry-run into a preview, and committed in one
transaction with an audit row. The Asset domain (FR-136..FR-140, ADR-056) is the working
precedent: one strict envelope, a canonical payload hash, idempotency on
`(Business, channel, correlationId)`, converters that never write. There is no shared
cross-domain intake library; each domain owns its envelope.

**LINE cannot carry a write today.** The live LINE surface for a server-owned account
(ADR-061) admits text messages only and answers them through `createServerLineAnswer`, which
reads knowledge and never writes. The agent's Gate F write registry exists and is tested, but
nothing in the runtime calls a tool from model output, and there is no confirm step in LINE.
A handoff route in the FR-140 style would have no caller on that path, which is the
"built and left unreachable" failure this repository has already recorded once (FR-193).

## Decision

### D1 — One envelope for every surface, and resolution is the planner's first question

`InventoryCatalogIntake` v1 (`schemaVersion: "1.0"`) carries `businessId`, a `source`
(`channel` REST_API / EXCEL / LINE_OA / WEB and a `correlationId`) and 1–500 `items`. An
item names a SKU (`code` and the FR-154 / FR-201 / FR-202 / FR-207 fields), its master by
`code` (with the fields to create it when it does not exist yet), and optional identifiers
(FR-203) and unit conversions (FR-204). Items are validated one by one, so a bad row is an
INVALID item in the preview instead of a rejected file.

For every valid item the planner resolves before it considers creating (BR-041):

1. every **active identifier** in the item, then
2. the **SKU code** (a merged duplicate is followed to its survivor, as `resolve` does).

If those point at two different SKUs the item is a CONFLICT. If they point at one, the item
**matches** it: identifiers and conversions the SKU lacks become additions, a code, master or
description that differs is a warning, and nothing on the existing SKU is overwritten. Only an
item that resolves to nothing is planned as a **create**, and a create still passes every
ADR-083 guard — nature at the master, variant key, lookalike, identifier collision (a retired
value still blocks) — plus the same guards across the rows of the batch itself.

### D2 — A preview is persisted, and a commit applies exactly that plan or nothing

`previewCatalogIntake` stores the normalized envelope, the plan and a `planHash` on one
`InventoryCatalogIntake` row, idempotent on `(businessId, sourceChannel, sourceCorrelationId)`:
the same payload re-previews (the plan is recomputed against today's catalogue), a different
payload under the same correlation is refused, and a committed row is returned as it is.

`commitCatalogIntake` re-plans inside one transaction and refuses when the new `planHash`
differs from the one the caller saw (`INVENTORY_CATALOG_INTAKE_PLAN_STALE`), when any item
is a CONFLICT or INVALID (`INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE`), when the preview has
expired, or when it was cancelled. It then runs every action through the existing writers —
`createProductMaster`, `createProduct`, `addUnitConversion`, `addIdentifier` — in the caller's
transaction, so each keeps its own audit row and its own refusal, and any refusal rolls the
whole batch back. There is no second write path into the catalogue.

### D3 — Excel is a converter with a Business-specific template, and it never commits

`GET /api/inventory/catalog-intakes/template` builds one `Products` sheet (header on row 2,
dropdowns from `enums.js`), a `Lookups` sheet listing this Business's categories and masters,
and a read-me. `POST /api/inventory/catalog-intakes/xlsx` converts the workbook without judging
any cell — a malformed number or a bad `BOX12=x` reaches the item schema and comes back as an
INVALID row — and returns a preview under correlation `xlsx:<sha256 of the file>`. Committing
is the same `commit` call every surface uses, from the `/inventory/catalog-intake` tab.

### D4 — LINE is a deterministic `#sku` command on the server-owned worker, not a model tool

The worker's answer port is wrapped: a direct-chat text message that starts with `#sku` is
handled by `line-catalog-command` before the model answer, and every other message goes to the
model exactly as before. The command acts only for a sender whose LINE channel identity is
**verified** (FR-097) and whose resolved viewer has Inventory write authority in the account's
Business (BR-042). For anyone else — an unverified sender, a customer, a group chat — the
message falls through to the normal answer, so the command's existence is not an oracle.

`#sku` followed by `key: value` lines (Thai or English keys, items separated by `---`) builds
the same envelope with channel `LINE_OA` and correlation `line:<account>:<event>`, and the
reply is the preview. `#sku ยืนยัน <code>` commits it, `#sku ยกเลิก <code>` cancels it; both
require the same person who previewed, and a LINE preview expires after 30 minutes.

**Why not a Gate F tool.** A tool needs a model tool-calling loop, which does not exist, and a
confirm mechanism, which does not exist either. A deterministic command needs neither: the
preview is the confirmation step, no model output reaches a write, and SDD-091's rule still
holds — the command is a thin adapter over the Inventory service with no authority of its own.
A future tool can call the same service; nothing here needs to be undone for it.

### D5 — What this does not do

No file or image intake over LINE (the native path admits text only). No Google Sheets snapshot.
No update of an existing SKU's descriptive fields from a file — a match adds identifiers and
conversions and warns about the rest. No stock movements: this is catalogue intake, not a stock
count. No new authority: preview and commit need Inventory write authority, reads need the
`inventory` domain, every refusal is the FR-072 404.

## Consequences

1. **Migration `20260913200000_inventory_catalog_intake`** creates `InventoryCatalogIntake` in
   both trees. Not applied to production by this change (ADR-057).
2. **`createProductMaster`, `createProduct`, `addIdentifier` and `addUnitConversion` accept a
   transaction client** (`inTx`, the helper the ATP service already uses). Their behaviour for
   every existing caller is unchanged.
3. **The server-owned LINE worker gains one branch.** A direct `#sku` message from an authorized,
   verified sender is answered by the command; thread memory (MSP) is not appended for it.
4. **Two ADR-083 promises are kept**: the Excel / LINE converters exist, and each calls
   resolution before it creates.
