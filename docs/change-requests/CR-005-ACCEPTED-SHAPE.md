---
doc_type: intake-note
status: active
version: "1.0.0"
updated_at: "2026-08-30"
---

# CR-005 — the shape this repository will accept

**Status:** Active
**Version:** 1.0.0

A companion to
`CR-005-SHIPPING-RATE-MATRIX-AND-OMNICHANNEL-AGENT-CONNECTORS.md`, written the
way `CR-003-ACCEPTED-SHAPE.md` was: **next to the document, not inside it.**
CR-005's text stays as its author wrote it. This file says what of it this
repository will take, in what shape, and what it has instead of the parts it
refuses.

The short version: **your matrix is right, your intent is right, and two of
your five deliverables are already built.** Two requirements have been
declared out of CR-005 — **FR-131** (the rate card) and **FR-132** (the
quotation on LINE) — with one design decision, **SDD-077**. Between them they
add **one migration, no Prisma model, no new route and no credential**.

## What CR-005 got right

Recorded first, because a reply that lists only refusals reads as a rejection
and this is not one.

1. **The rate matrix shape is correct and complete.** Four Member tiers ×
   warehouse × shipping method × category, each cell a THB/CBM rate and a
   THB/kg rate, with a qualifying CBM and weight minimum per tier. Nothing
   here changes it.
2. **The density switch is a real rule and belongs with the rates.** A
   quotation engine that has to remember to apply it is one that will
   eventually forget.
3. **Quoting inside the LINE conversation is the correct surface**, and it is
   the one this product is built around.
4. **Both §4 invariants are the right two** — round up to the nearest 10 THB,
   and enforce a margin floor before anything leaves. Both are kept. Only the
   *visibility* of the second changes; see FR-132 (c).
5. **The rate sheets are the source of truth, and they are documents.** You
   cite two of them by filename. That is precisely the input this repository
   already has a governed intake for, and it is why the accepted shape is a
   published projection rather than a hand-edited table.
6. **`ShippingRateMatrix` on `workspaceId` is not a tenant-isolation break.**
   The review checked that and it stands. The scoping is still wrong, for a
   different reason — see below. That is a second finding, not a reversal of
   the first.

## What is refused, and what stands in its place

### `AgentConnectorConfig` — refused entirely; nothing replaces it

The review told you the plaintext `channelSecret` / `channelToken` should
become a `secretRef` the way `IntegrationCredential` holds one. **That was the
right instinct pointed at the wrong repository.** The columns are not
converted. They are deleted, and no `secretRef` takes their place, because
there is nothing here for a LINE channel secret to do.

Under **BR-011** this repository is not the LINE edge. `zuri.command-agent`
owns signature verification and the Reply API; the webhook here receives a
batch that has already been verified and normalized. The repository says so
in its own code — `connection-health.js` notes that a CHANNEL connection does
not need a channel secret because "under BR-011 the LINE channel secret
belongs to zuri-cli". A `secretRef` here would be a vault entry nothing reads.

What the webhook *does* authenticate already exists and is a different
mechanism: a binding-scoped bearer, HMAC-SHA256'd with a server-held pepper
and matched against `credential_hash` and `external_channel_id_hash` on an
`ACTIVE`, in-date row of `zuri_core.line_channel_binding` (FR-052, FR-097). A
hash, never material.

Everything else in your model already has a home:

| CR-005 field | What already holds it |
|---|---|
| `businessId` | `IntegrationConnection.businessId`, with `tenantId` beside it |
| `connectorType` | `IntegrationProvider.code` — `LINE_OA` |
| `status` | `IntegrationConnection.status` |
| `webhookUrl` | `IntegrationConnection.metadataJson` |
| `channelSecret`, `channelToken` | nothing here; the transport holds a hash |

### `/api/connectors/line-oa/[businessId]` — refused, **and so is the converter**

The review refused the endpoint as the second write path BR-009 and SDD-009
forbid, and said the behaviour is reachable "through the existing webhook plus
a converter."

Half of that is right. The endpoint is refused. But **the converter is also
already there**: `normalizeLineWebhookEvent` has converted LINE events onto
the FR-081 ingestion envelope since that requirement landed, and the live
route calls it on every event in the batch. So there is no converter to write:

```text
zuri.command-agent          signature verification, Reply API   (BR-011)
  → POST /api/agent/line-webhook                                 (FR-028)
  → normalizeLineWebhookEvent → createIngestionEnvelope          (FR-081)
  → handleAgentTurn → ingestLineMessage                          (FR-023)
  → reply text returned to the transport, never sent             (FR-050)
```

**What FR-132 adds is one descriptor** in the Gate E read-only tool registry
(`src/modules/agent/tools.js`), which today pre-loads three. It registers
cleanly because `register` refuses anything whose `readOnly` is not `true`,
and a quotation computes and writes nothing.

Your Flex Message is not refused — it is the transport's rendering of the
answer this repository returns. FR-128 already keeps that boundary for the
Daily Sales Brief.

### `ShippingRateMatrix` as a Prisma model — refused; `business_knowledge` instead

This is the part most worth reading, because it is where the proposal shrank.

`zuri_core.business_knowledge` already exists. It is Tenant- and
Business-scoped under forced row-level security behind a `SET LOCAL ROLE`
login, it is what a LINE turn already reads through, and it already carries
every column a rate card needs:

| What a rate card needs | Column already there |
|---|---|
| which Business, which Tenant | `business_id`, `tenant_id` |
| when this rate took effect | `as_of` |
| approved before it became readable | `approved_at` (+ FR-129's gate decision for *who*) |
| the sheet the numbers came from | `source_ref`, `source_sha256` |
| superseded by a newer sheet | `is_active` |
| the THB/CBM rate | `sell_price`, with `unit` and `currency` |
| THB/kg rate, tier minima, density threshold | `specification` (jsonb) |
| what kind of fact this row is | `knowledge_type` — pinned to `'PRODUCT'` today |

Two reasons your model is refused, and the second cannot be worked around.

**It would be a second store for one Business's published prices.** Product
prices are already in that table with an effective date, an approval and a
source hash. A rate card beside them carrying only `updatedAt` cannot answer
the question a quotation raises the moment it is disputed: *what rate was in
effect when we quoted this?*

**No chartered domain may own it.** `knowledge` — the domain a rate card
belongs to by authority — owns no Prisma models by design and has kept that
boundary through FR-109…FR-119. `market-intelligence` reserves commercial
state for a "Commerce authority" that has no charter in this repository, and a
`src/modules/<m>` that no charter claims is a preflight CRITICAL. The Prisma
route does not start with a migration; it starts with a domain charter nobody
has proposed.

### The editable settings grid (§3.B.1) — refused, on provenance not effort

A grid an administrator may retype produces a rate with no effective date, no
signature and no source document. Your own §4.1 — that a margin floor "must
always be enforced" — is not enforceable against a rate whose provenance is a
field somebody edited.

What stands in its place is the intake this repository already built for
exactly your input, because your rate sheets are supplier documents:

```text
supplier rate sheet (image/pdf)
  → SMARTGIFT_DOCUMENT_INTAKE            staging contract, accepts image sources
  → DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1   the FR-071 execution ledger
  → APPROVED PipelineGateDecision        FR-129 — a named person signs
  → DPS-PUBLISH                          rows become readable
```

A rate change becomes a publication with a reviewer. A back-office page that
*reads* the active card, its `as_of` and the run that published it is a
reasonable want and is not refused — it needs its own FR, because a route
implementing no declared requirement is a preflight CRITICAL.

### `/platform/workspaces/[id]/settings/shipping` — refused as a URL shape

Routes here are flat and scope-implicit: the current Tenant and Business come
from `ScopeContext`, not from the path. There is one `settings` route in the
whole app, `platform/` has no `workspaces` child, and
`/workspaces/[workspaceId]` has no settings child. Any surface for this is
Business-scoped through `ScopeContext`.

### `workspaceId` — the settled question, and the one that was not asked

The review recorded `workspaceId` as fine because "`Project` is
workspace-scoped identically". That comparison does not hold: `Project`
carries its own `businessId` **beside** `workspaceId` under FR-043, and
`Workspace.tenantId` and `Workspace.businessId` are both nullable, since a
Workspace may be `PORTFOLIO`-scoped and have neither.

The decisive objection is functional, though. **A LINE turn resolves
`{tenantId, businessId}` from its binding and never holds a `workspaceId`.** A
rate keyed by workspace is unreadable from the one surface that needs to quote
it. So the review's conclusion — not a tenant-isolation break — stands, and
the scoping is still wrong. Two findings; only the first had been checked.

### `smartgift_calculate_ladder_quote` — declarable here, but not the surface you described

The useful correction first: **this repository is already an MCP server.**
`/api/mcp` serves nine tools today (`project_manager.*`, `data_pipeline.*`),
three of whose descriptions name SmartGift. So an MCP tool here is not
somebody else's contract to review — unlike `msp_vault_resolve`, which this
repository *calls* on MSP and therefore cannot declare.

But it is not the surface your §3.B.3 describes. The MCP transport is
viewer-authenticated back-office access; the registry a LINE turn binds is the
separate in-process Gate E one. They share no code. "An agent quoting during a
buyer discussion" is the second, and that is FR-132. An MCP tool is a separate
want, needs its own id, and if taken should be named `shipping.ladder_quote` —
every existing tool is `namespace.verb`, and one Business's name inside a
multi-tenant tool contract is wrong for the second Business that uses it.

### Your §4 invariants — both kept, one made invisible

Rounding up to the nearest 10 THB is part of the quoted number and belongs in
the reply.

The margin floor does not travel with it. FR-047 excludes cost and margin from
what the LINE surface may read, so the floor is a test applied before the
number is returned, never a field in the payload. A quotation that displayed
its own floor would breach that exclusion in the one place a customer is
reading. The floor decides *whether* a quote is returned; what comes back is a
price.

## What FR-131 and FR-132 declare

> **FR-131** — a Business's logistics rate matrix is published as
> `business_knowledge` rows under a second `knowledge_type`, entering through
> the existing document intake and the FR-129 approval gate, scoped
> `(tenant_id, business_id)`, sell side only. No Prisma model, no new domain,
> no settings write path.
>
> **FR-132** — a customer asking for a price in an existing LINE conversation
> gets a tiered quotation in the reply, produced by one Gate E read-only tool
> reached through the existing webhook and returned to the sole transport
> owner. No route, no model, no converter, no credential.

Full statements are in `docs/PRD-SDD-v1.0.md`. The design notes are
`docs/domains/knowledge/features/FR-131-shipping-rate-card-as-business-knowledge.md`
and `docs/domains/agent/features/FR-132-line-ladder-quotation-tool.md`; the
schema decision is SDD-077.

## What this actually costs, and one defect it would create

Unlike CR-003, this is not free. FR-131 needs a migration, and SDD-077 exists
because the widening is **one decision in four places**:

- the DDL check `knowledge_type = 'PRODUCT'`;
- `z.literal('PRODUCT')` in `business-contract.js`;
- a `contract_version` that is no longer `'1.0.0'`, checked in both;
- **a fourth registered query that names the type.**

That last one is not tidiness. `registeredPredicate` constrains `tenant_id`,
`business_id`, `sensitivity` and `is_active` — and **no `knowledge_type` at
all**. Today that is safe by accident, because there is only one kind. Widen
the constraint without a typed query and `product_search` starts returning
rate rows as products, and `product_compare` on two rate codes returns them as
products too — a wrong answer delivered on the LINE surface with nothing
anywhere reporting a problem.

## What is still missing, stated plainly

Both requirements are **declared and unbuilt**, and each is blocked on
something specific rather than on effort:

- **FR-131** — the four changes above, plus a product decision nobody has
  made: whether a supplier's rate sheet is the Business's own knowledge or
  needs a per-supplier scope. `business_knowledge` has no supplier column, so
  a second forwarder's rates are currently unrepresentable.
- **FR-132** — blocked on FR-131 (nothing to price against) and on intent
  recognition, which is undeclared: `docs/domains/agent/intent-pipeline.md` is
  `Status: Draft — not implemented`. Whether "ขอใบเสนอราคา" reaches a tool
  through a model-selected call or a deterministic matcher is an unmade
  decision — a model-selected tool inherits the model's failure modes on a
  surface that quotes prices; a matcher does not, and answers fewer phrasings.
- The ladder calculator itself — density switch, tier qualification, rounding,
  floor — is pure, testable, and not written.

## If you want to take this further

The route is `CLAUDE.md` → *Adding a feature*, and `README.md` in this folder
states it for CRs specifically. Nothing about arriving as a CR shortens it.

But note what CR-005 cost once it was checked against the tree: **two
requirements, one design decision, one migration, no Prisma model, no route,
no credential** — because your endpoint, your converter, your connector record
and your rate store were four things this repository had already built, and
the one genuinely new thing was the shape of your matrix.
