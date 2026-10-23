---
id: ZAI:LINE-PRODUCT-FACTS-PROPOSAL-20261023
doc_type: interface-contract-proposal
status: proposed
version: "0.1.0"
date: "2026-10-23"
source_revision: "0903287f75c455a5cbefeb0c1dba195df0034b97"
relations:
  - type: relates_to
    target: ZAI:FR-234
  - type: relates_to
    target: ZAI:FR-132
  - type: relates_to
    target: ZAI:FR-180
  - type: relates_to
    target: ZAI:FR-253
  - type: relates_to
    target: ZAI:ADR-106
---

# LINE agent: stock availability and published sell-price facts

## Status, audience and scope

The owner selected stock availability and product prices as the first fact
family on 2026-10-23. This is a **proposed contract for review**, not approval
of new caller rights, a canonical requirement migration, an implemented API,
or permission to publish operational data. Audience: Inventory, Commerce,
Identity, Agent and Conversation Runtime maintainers. The inspected source
revision is pinned above; [the application record](../../../reports/gap-analysis-2026-10-23/application-fixes.md)
separates delivered code from these missing contracts.

The candidate handles one resolved SKU/variant, one Business and one LINE
account per request; a price request supplies one positive integer quantity
in its base unit. It reads;
it does not reserve stock, create an order, calculate a new quotation, apply a
promotion, convert units, traverse MSP/GKS relations or promise delivery.
The selected price operation retrieves an already published sell price.
[FR-132](../../requirements/FR-132.md)'s future tiered quotation remains a
separate declared requirement, currently blocked on FR-131 and intent recognition,
with its existing authorization and calculation rules; this proposal neither
replaces it nor adds a price opt-in prerequisite.

## Existing authority and observed gaps

| Concern | Existing source | Observed boundary at the inspected revision |
|---|---|---|
| Inventory ownership | [Inventory charter](../../domains/inventory/CHARTER.md), [FR-180](../../features/FEAT-025/requirements/FR-180.md) | Inventory owns Products, movements and reservations; ATP is ledger less live commitments and quote holds. Existing readers require a staff viewer. |
| Price ownership and publication | [Commerce charter](../../domains/commerce/CHARTER.md), [ADR-098](../../decisions/ADR-098-COMMERCE-PRICING-RULES-AND-KNOWLEDGE-PUBLICATION.md), [FR-253](../../requirements/FR-253.md), [FR-047](../../requirements/FR-047.md) | Commerce owns pricing; Knowledge receives the allow-listed publication. Approval of a rule alone does not publish it. Admission can return `NOT_VERIFIED`; production activation is not established. |
| Identity and account | [FR-052](../../requirements/FR-052.md), [LINE binding resolver](../../../apps/server/src/modules/agent/line-binding-resolver.js), [AuthContext](../../../apps/server/src/modules/agent/auth-context.js) | Server resolves destination/account scope. Private memory authorization is not an ERP grant; null Customer Business and missing-audience defaults cannot establish stock permission. |
| Context and execution | [FR-234](../../features/FEAT-037/requirements/FR-234.md), [SDD-100](../../requirements/SDD-100.md), [ADR-106](../../decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md) | Core owns authoritative reads. Generic RECORD composition exists, without a typed fact producer or certified record-only answer verifier. |

Inventory remains `DOM-INVENTORY` / `TD-INVENTORY`; Commerce remains
`DOM-COMMERCE` / `TD-COMMERCE`. Identity owns principal/binding validation;
Core composes owner-authorized projections. Runtime owns execution, not the
underlying records. These are references to existing ownership, not new owners.

## Proposed request and authorization boundary

Untrusted request input is an exact normalized public product selector, a
`facets` selector, and quantity/unit only when price is requested. `facets` is
a nonempty unique subset of the two literals `availability` and `price`, with
at most two entries. A price facet requires a positive safe-integer quantity
in the product's base unit; availability-only requests omit quantity. Unknown
facets, extra scope fields and invalid quantities are rejected before reading.
Ambiguous selectors or missing required price quantity produce a clarification,
never a guessed SKU. Core resolves internal product/variant identity under
the persisted job's Tenant, Business and active LINE-account binding. A code
or external identifier is a lookup attribute, not a primary key or scope grant.
The model cannot supply a viewer, principal, Business, policy or source reference.

For the **new operational stock projection**, the proposed default is OFF.
An explicit, versioned Business/account policy would allow specific SKUs and
availability fields; exact counts remain excluded in this first candidate.
Availability is independent of the requested quantity: it discloses only
whether eligible ATP is positive or zero. Do not return quantity sufficiency,
threshold comparisons or quantity-dependent availability errors, which would
let repeated queries reconstruct the excluded count. Price selection alone
uses the requested quantity and must not depend on stock sufficiency.
No current policy store, configuration route or signer workflow is claimed.
Enabling this projection needs a reviewed canonical addition/migration and
owner authorization under the existing authority ladder. BusinessAgentConfig,
memory `READ`, a service credential and `prepare.authorized` are insufficient.
Never construct a staff viewer for a Customer to reuse the current ATP reader.

The proposed stock caller must have a verified, active ChannelIdentity, a
known non-erased Customer bound to exactly the resolved Business, and an
explicit persisted DIRECT audience. A null Customer Business, missing audience,
group thread, revoked mapping or scope mismatch denies the operational request.
An explicit staff use case retains its staff surface and is outside this
customer projection. Revalidate binding and applicable policy before release;
a revocation or rebind produces no outbound fact payload.

Published price authorization follows FR-047/FR-253 and, for its separate
quotation behavior, FR-132. There is **no new price policy gate** here. The
existing Knowledge path can continue under its own authority; a stock denial
must not be concealed by substituting that path inside a denied stock request.
For a combined request, any caller authorization denial returns an empty bundle,
as FR-234 requires. Authorized source unavailability is different: an allowed
stock result plus an unavailable price can be marked PARTIAL without inventing
the price. External errors do not distinguish a foreign SKU from a missing SKU.

Price-only requests use the existing price authorization, never evaluate the
stock release policy and never call the Inventory reader. Stock-only requests
never call the price reader. A stock-only or combined request with stock policy
OFF is denied with an empty payload; it does not silently downgrade to price-only.
Only requested, authorized facets appear in the result. READY means all requested
facets are usable; PARTIAL requires both requested and exactly one unavailable;
UNAVAILABLE means none usable. A denial is externally UNAVAILABLE with no product
or facet payload, while its specific reason remains private Core metadata.
For aggregation, `ATP_POSITIVE`, `ATP_ZERO` and `NOT_MEASURED` are usable
availability answers; `NOT_MEASURED` states only that no quantity is measured,
not that stock exists. `PUBLISHED` is a usable price. Facet `UNAVAILABLE` is
unusable. READY therefore means the requested facts/statuses were resolved,
not that stock is positive or the requested quantity is fulfillable.

## Proposed bounded result

This is an internal Core DTO candidate, not a registered Runtime operation.
The customer projection contains only the following allow-list. Text is bounded
and escaped by the renderer; this first version returns at most one product.

| Field | Proposed semantics |
|---|---|
| `schema` | Literal `line-product-facts.v1`; unpublished candidate name. |
| `status` | `READY`, `PARTIAL`, `UNAVAILABLE` or `CLARIFY`; denial carries no product/facet payload. |
| `product` | Public SKU code, display name, public variant label if present, and base-unit label. No internal UUID or foreign aliases. |
| `facets` | The validated requested subset; unrequested facet objects and owner reads are absent. |
| `requestedQuantity` | Present only when price was requested: positive safe integer in the resolved base unit; no inferred conversion or bundle expansion. |
| `availability.state` | `ATP_POSITIVE`, `ATP_ZERO`, `NOT_MEASURED` or `UNAVAILABLE`. The first two disclose only positive versus zero eligible ATP, independently of requested quantity; neither says the requested quantity can be fulfilled. |
| `availability.basis` | `BUSINESS_ATP` only for an eligible, consistently observed source. No warehouse/lot allocation claim. |
| `availability.observedFrom`, `observedTo` | Actual owner-reader observation window, not a fabricated commit timestamp or freshness SLA. |
| `price.state` | `PUBLISHED` or `UNAVAILABLE`; no source-denial details in the customer payload. |
| `price.unitAmountMinor`, `currency` | Nonnegative safe-integer satang and literal `THB`, only from the validated FR-253 producer lineage. Zero is a valid published price, not a missing-value sentinel. |
| `price.quantity`, `unit` | Exact published quantity and matching base unit. They must equal the request; a row is not an open-ended tier. |
| `price.taxTreatment` | `UNKNOWN` at present; this source does not establish VAT inclusion/exclusion. The renderer must say so. |
| `price.observedFrom`, `observedTo` | Actual publication/currentness read window, independent of the stock read. |

Internal Core metadata binds execution/authority version, opaque scope and
product references, allowed fields, policy version when applicable, publication
lineage and result digest. It does not enter the customer DTO or model prompt.
Reject unknown fields, extra products, invalid enums, unsafe integers and
unbounded strings. Proposed bounds are 128 Unicode code points for SKU/unit
labels and 256 for display/variant labels; no raw source text field is allowed.
These limits are candidate interface choices, not assertions about current data.

## Stock source semantics and limitations

The [ATP reader](../../../apps/server/src/modules/inventory/application/inventory-atp-service.js)
returns `available`, with internal on-hand, committed and quote-hold breakdowns.
The [calculation](../../../apps/server/src/modules/inventory/domain/inventory-wip.js)
ignores expired/inactive reservations and clamps negative ATP to zero.
Tracked quantities are integers; untracked/service quantities are null, not zero.
Neither the breakdown nor exact ATP counts enter this customer projection.

The current reader totals the Business and reads ledger and reservations in
parallel. It supplies no coherent snapshot guarantee, observation timestamp,
location-specific ATP or lot-expiry filtering. Lot issue has separate expiry
rules; ATP alone cannot mean "ready to ship". The first candidate therefore
allows a positive/zero ATP status only for ACTIVE, TRACKED products with
`trackingMode: NONE`, after the owning reader establishes a consistent boundary.
LOT, SERIAL, PHASE_OUT, unknown lifecycle or unresolved units return
`UNAVAILABLE`; untracked/service products return `NOT_MEASURED`. Lifecycle and
tracking eligibility must be read explicitly, not inferred from the ATP DTO,
which currently omits some of those fields.

No positive customer stock answer is certified by today's reader alone.
Read through the owner on each turn; do not invent a TTL or fall back to memory,
GKS, historical stock, on-hand alone or a cached earlier answer. Separate price
and stock observations do not become a single atomic snapshot. A successful
read does not reserve inventory or guarantee it remains available after reading.

## Price source semantics and limitations

Use only the customer-safe publication produced by
[FR-253's projection](../../../apps/server/src/modules/commerce/domain/pricing-catalog-projection.js)
through its governed admission and Knowledge-read path. The
[currentness guard](../../../apps/server/src/modules/commerce/pricing-publication.js)
checks effective approved rules and calculation lineage; it is necessary but
does not prove publication acceptance or caller permission. `NOT_VERIFIED`,
revoked, stale, superseded or unbound publications return `UNAVAILABLE`.

The producer binds `productExternalId` to its internal product and emits an
exact quantity and THB sell price. Validate that producer and its lineage in
Core before mapping to the selected internal SKU. A generic `PriceListEntry`
does not prove an internal product ID, currency, tax treatment or tier range.
Do not decode arbitrary external IDs as trusted UUIDs, interpolate a price tier
or round a request to another quantity. Recover satang only when the validated
producer value has an exact safe-integer minor-unit representation; otherwise
refuse it rather than silently rounding an arbitrary floating-point value.

The POS catalog's manually entered price, previous sales, supplier/inventory
cost, margin, unpublished calculations and default rules are not substitutes.
No promotion/discount or VAT assumption is inferred. Filenames, catalog paths,
internal UUIDs, provenance IDs, rule hashes and cost-side calculations remain
private even when the sell price is publishable.

## Answering, audit and Runtime boundary

The proposed first answer uses a deterministic formatter over the validated
DTO. Bind each number to its SKU, requested quantity, unit and field; test the
rendered response, not just membership in a bag of allowed numbers. State ATP
limitations and unknown tax treatment explicitly. With no allowed usable facts,
return a deterministic unavailable/clarification response. Do not call a model
merely to turn missing facts into an answer. Existing general Knowledge answers
remain a separate path, without fabricated operational figures.

This candidate does not certify record-only model calls. Before enabling those,
the consumer needs field-aware verification and fallback under FR-234/SDD-100.
Each actual model invocation still has exactly one canonical ContextReceipt;
a deterministic reply has no model invocation and no fabricated ContextReceipt.
A proposed content-free fact-read audit entry belongs to Core's product audit/
trace boundary, not a developer task ledger. Its schema/persistence are not yet
implemented. Keep execution/scope/policy/source bindings and result digest;
omit raw Customer/LINE identifiers and fact values. Do not relabel it as a
MemoryReceipt, WorkToolReceipt or ContextReceipt.

The [published Runtime v1 schema](../../../services/conversation-runtime/contracts/v1/operation.schema.json)
has no product-fact operation. Do not smuggle new authority or payload fields
through `prepare`, memory or Work tools. Any Runtime consumer needs a reviewed,
explicitly versioned contract amendment and matching Core/Runtime qualification
under [the service boundary](../../services/conversation-runtime/SERVICE.md).
Returning text preserves the existing transport owner; Core does not gain a
LINE Reply API path. This proposal changes no operation schema or deployment.

## Acceptance cases for a later reviewed implementation

| Case | Required candidate outcome |
|---|---|
| Stock-only or combined: stock policy OFF; foreign/missing Business; unknown/erased Customer; null audience; revoked/rebound identity | No fact payload, no private reader bypass, no model invocation or delivery of previously read facts. Price-only retains its existing price authorization instead of these proposed stock-specific prerequisites. |
| Ambiguous SKU, variant or unit | Clarify without guessing; no cross-SKU/cross-Business lookup leak. |
| ATP positive but LOT expired, SERIAL, PHASE_OUT or inconsistent read | No customer ATP assertion; do not substitute the ledger total. |
| Negative raw ATP, expired quote hold, untracked product | Owner calculation remains authoritative; zero ATP versus not-measured stays distinct. |
| Repeated quantities, binary-search probes or price tiers at unchanged source state | Same availability status for every quantity; no sufficiency flag, exact count or quantity-dependent stock error. Price availability does not test inventory quantity. |
| Missing exact price quantity, `NOT_VERIFIED`, stale/revoked publication or invalid lineage | Price unavailable; no interpolation, cost fallback or guessed tax. |
| Integer/precision overflow, stock count swapped for price, mismatched SKU/quantity/unit | Reject before rendering; no numeric-only answer-verifier shortcut. |
| Both facets authorized, one source unavailable | PARTIAL only for the allowed usable facet; qualify the missing facet. |
| Price-only with stock policy OFF; stock-only; combined with stock policy OFF | Price-only follows existing price authority with no stock read; stock-only has no price read; denied combined requests return no product/facets, without automatic downgrade. |
| Cost/provenance/extra field in owner result or malicious label | Allow-list/escape before rendering; no raw owner object or source text reaches the customer. |
| Deterministic answer; source or policy changes before release | No fake model receipt; revalidate or refuse; no order, reservation or publication writes. |
| Old Runtime or unsupported operation version | Fail closed; no silent v1 extension or direct Runtime database access. |

## Review decisions and impact

The proposed defaults are coarse positive/zero ATP independent of quantity, explicit DIRECT
Business-bound stock callers, stock release OFF until separately authorized,
read-through observation without an invented freshness SLA, exact published
THB price and deterministic first answers. Approval of this document would
approve the design choices only; stock rights/canonical additions, publication
acceptance, the consistent Inventory reader, audit schema and any Runtime
amendment still need their explicit source/contract changes before activation.
FR-132's existing quotation authorization remains unchanged.

This explanatory intake is indexed from the change-request entrypoint and
FR-234 follow-up. No canonical row, identity, FEAT membership, domain charter,
application code, schema, caller grant or external service is changed.
Version 0.1.0 establishes the selected family's reviewable contract; tests in
the matrix are future acceptance criteria, not claims of executed behavior.
