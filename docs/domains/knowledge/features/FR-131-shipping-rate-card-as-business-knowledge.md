---
domain: knowledge
feature: FR-131
module: knowledge
source: v2-native
version: "0.1.0b"
status: "declared"
---

# FR-131 — Shipping rate card as governed business knowledge

## Intent

A Business that quotes freight needs its rate card to be a fact the system
knows, dated and signed, rather than a grid somebody last touched. CR-005
supplies a real rate matrix — four Member tiers across two warehouses, two
shipping methods and four category types, each cell a THB/CBM rate and a
THB/kg rate, with a density switch at 400 kg/CBM — and proposes to hold it in
a new Prisma model whose only temporal column is `updatedAt`.

The matrix is right. The store is already here, and it is not Prisma.

## What CR-005 got right

Recorded first, because a note that lists only refusals reads as a rejection
and this is not one.

1. **The matrix shape is correct and complete.** Tier × warehouse × method ×
   category, with a CBM rate and a kg rate per cell and a qualifying CBM and
   weight minimum per tier, is the shape of the source sheets. Nothing here
   changes it.
2. **The density switch is a real rule and belongs with the rates**, not in
   calling code. A quotation engine that has to remember to apply it is one
   that will eventually forget.
3. **`workspaceId` is not a tenant-isolation break.** The review recorded that
   and it stands. The scoping is still wrong, for an unrelated reason — see
   *Scope* below.
4. **The rate sheets are the source of truth and they are documents.** CR-005
   cites two of them by filename. That is exactly the input this repository
   already has an intake for, and it is the reason the accepted shape is the
   one below rather than a hand-edited table.

## Where the rates go

`zuri_core.business_knowledge` — the FR-047 curated projection, Tenant- and
Business-scoped under forced row-level security behind a `SET LOCAL ROLE`
login (SDD-026), and the thing a LINE turn already reads through
`createPostgresBusinessKnowledgeReader`.

Every column a rate card needs is already on it:

| What a rate card needs | Column that already holds it |
|---|---|
| which Business, which Tenant | `business_id`, `tenant_id` |
| when this rate took effect | `as_of` |
| that it was approved before it became readable | `approved_at`, plus FR-129's `PipelineGateDecision` for *who* |
| the sheet the numbers came from | `source_ref`, `source_sha256` |
| superseded by a newer sheet | `is_active` |
| the THB/CBM rate | `sell_price` with `unit` and `currency` |
| the THB/kg rate, tier minima, density threshold | `specification` (jsonb) |
| what kind of fact this row is | `knowledge_type` — **currently pinned to `'PRODUCT'`** |

The last row is the whole cost of this requirement, and SDD-077 is about it.

## What is refused, and what stands in its place

### `ShippingRateMatrix` as a Prisma model — refused

Two reasons, and the second is the one that cannot be worked around.

**It would be a second store for one Business's published prices.** Product
prices already live in `business_knowledge` with an effective date, an
approval, a source hash and an FR-129 signature. A rate card beside them
carrying only `updatedAt` cannot answer the question a quotation raises the
moment it is disputed: *what rate was in effect when we quoted this?* SDD-077
states this as the schema decision.

**No chartered domain may own it.** This is checkable rather than
stylistic. `knowledge` — the domain a rate card belongs to by authority —
owns no Prisma models by design and has held that boundary through
FR-109…FR-119, including when a seventeen-stage pipeline was registered
without adding one. `market-intelligence` explicitly reserves commercial
state for a "Commerce authority" that has no charter in this repository, and
a `src/modules/<m>` no charter claims is a preflight CRITICAL. So the Prisma
route does not begin with a migration; it begins with a new domain charter
nobody has proposed.

### The editable settings grid (CR-005 §3.B.1) — refused

Not on effort. A grid an administrator may retype produces a rate with no
effective date, no signature and no source document — and CR-005's own §4.1
invariant, that a margin floor "must always be enforced", is unenforceable
against a rate whose provenance is a text field somebody edited.

What stands in its place is the intake already built for this input:

```text
supplier rate sheet (image/pdf)
  → SMARTGIFT_DOCUMENT_INTAKE            document-intake-contract.js
  → DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1   the FR-071 execution ledger
  → APPROVED PipelineGateDecision        FR-129 — a named person signs
  → DPS-PUBLISH                          rows become readable
```

A rate change is therefore a publication with a reviewer, which is what
CR-005 §4 needs and what a grid cannot give it.

The back-office **read** surface is not refused and is not declared here: a
page that shows the active card, its `as_of` and the run that published it is
a reasonable thing to want and needs its own FR, because a route implementing
no declared requirement is a preflight CRITICAL and
`docs/.route-anchor-baseline.json` is empty and may only shrink.

### The route `/platform/workspaces/[id]/settings/shipping` — refused

It is not this repository's URL shape. Routes under `(pm)` are flat and
scope-implicit: the current Tenant and Business come from `ScopeContext`, not
from the path. There is exactly one `settings` route in the app (`/settings`,
which is FR-020's add-a-second-business page), `platform/` has no `workspaces`
child, and `/workspaces/[workspaceId]` has no settings child. Any surface for
this is Business-scoped through `ScopeContext`.

### Scope — `(tenant_id, business_id)`, not `workspaceId`

The review recorded `workspaceId` as a settled false alarm on the grounds that
"`Project` is workspace-scoped identically". That comparison does not hold:
`Project` carries its own `businessId` **beside** `workspaceId` under FR-043
("direct Business owner plus Development Space context"), and
`Workspace.tenantId` and `Workspace.businessId` are both nullable, since a
Workspace may be `PORTFOLIO`-scoped and have neither.

But the decisive objection is functional rather than structural. A LINE turn
resolves `{tenantId, businessId}` from its server-owned binding (FR-052) and
never holds a `workspaceId` at all. A rate keyed by workspace is unreadable
from the only surface that needs to quote it.

So the review's conclusion — *not a tenant-isolation break* — stands, and the
scoping is still wrong. Those are two different findings and only the first
was checked.

## What FR-131 declares

> A Business's logistics rate matrix is published as `business_knowledge` rows
> under a second `knowledge_type`, entering through the existing document
> intake and the FR-129 approval gate, scoped `(tenant_id, business_id)`, sell
> side only. No Prisma model, no new domain, no settings write path.

## What is still missing, stated plainly

FR-131 is **declared and unbuilt**, and unlike FR-129 it does need a
migration. The honest list:

- `knowledge_type text not null check (knowledge_type = 'PRODUCT')` in the DDL.
- `knowledge_type: z.literal('PRODUCT')` in `business-contract.js`.
- `contract_version` check-constrained to `'1.0.0'` in both places, so a second
  record kind cannot be introduced without versioning the contract.
- `registeredPredicate` in `postgres-business-knowledge.js` filters on **no**
  `knowledge_type`, so widening the constraint before a typed query exists
  makes `product_search` return rate rows as products. This is SDD-077 and it
  is the reason the four changes above are one decision rather than four.
- `PUBLIC_BUSINESS_KNOWLEDGE_FIELDS` has no `approved_by`; *who* approved is
  answerable only through the FR-129 gate decision on the publishing run, not
  from the row. That is adequate and it is not the same as being on the row.

And one product decision, which blocks the rest: **whether a supplier's rate
sheet is the Business's own knowledge or needs a per-supplier scope.** The
table has no supplier column. If SmartGift resells two forwarders' rates, one
of them is currently unrepresentable, and adding a column to a projection
under forced RLS is not a small change made late.

## Boundary — sell side only

FR-047 excludes "PII, cost, margin, invoice, unrestricted SQL and local paths"
from this projection by name. What a customer is charged is the same class of
fact as `sell_price`, which is already here. The cost basis behind CR-005
§4.1's margin floor is not, and must not arrive here by being adjacent to
something that may. FR-132 (c) states the other half of that boundary.
