---
id: ZAI:LINE-PRODUCT-FACTS-PROPOSAL-20261023
doc_type: interface-contract
status: approved
approval_scope: implementation-contract
version: "0.3.0"
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

The owner approved the 0.1.0 design on 2026-10-23, then explicitly
authorized completing the read-authorization, Core/Runtime and published-price
contracts and implementing/testing the integration in the same day's follow-up.
This 0.3.0 revision binds those implementation choices to that mandate. It does
not activate disclosure in any existing Business or change FR-132 quotations.
Audience: Inventory, Commerce, Identity, Agent and Conversation Runtime maintainers.
The frontmatter source revision describes the inspected historical baseline;
implementation starts at commit 5d79760b03e5e7f18d485588d0ae96715a476dbc.
The [verification record](../../../reports/gap-analysis-2026-10-23/application-fixes.md)
separates local/hosted evidence from live provider acceptance.

## Approval and canonical migration scope

The direct user instruction is: “ทำต่อให้ LINE agent อ่านสต็อกและราคาได้จริง
เติมสัญญาสิทธิ์อ่าน Core/Runtime และหลักฐานราคาที่เผยแพร่ให้ครบตามร่างที่อนุมัติ
แล้วเขียนโค้ดและทดสอบให้ผ่าน ใช้ Luna Max เท่านั้น”.
It authorizes the bounded contracts and implementation below, including a new
standalone canonical functional requirement through the sanctioned record
migration. Existing canonical subjects, feature membership, FR-132 and FR-253
retain their meaning. The integrator selects technical details within this
mandate and obtains independent review; no production activation is inferred.

## Bound implementation contract

- **Typed trigger:** customer text starts with `#product` followed by one
  strict JSON object. Keys are `sku`, `facets`, and `quantity`/`unit`
  only for the price facet. Example:
  `#product {"sku":"MUG-01","facets":["availability","price"],"quantity":10,"unit":"piece"}`.
  No NLP intent guessing, internal scope fields or `#sku` repurposing.
  Recognized malformed commands receive bounded deterministic clarification;
  recognized denied/unavailable requests never fall through to a model.
- **Persisted stock grant:** an Inventory-owned row keyed by trusted Tenant,
  Business, LINE account and Product, absent/disabled by default. A Business
  OWNER sets enabled state with expected-version CAS and a reason, through an
  authenticated service/route. Validate live account and product scope. Emit
  an AuditEvent for changes. No wildcard grant or price-specific new opt-in.
- **Owner reads:** the customer projector derives a verified principal from the
  durable job, not a fabricated staff Viewer. It enforces the exact
  Business-bound Customer, explicit DIRECT source and current policy described
  below. Inventory owns eligibility and the fenced ATP quantity boundary.
  Commerce resolves only an exact accepted publication and producer calculation
  matching Product, requested quantity, unit and current approved rules.
- **Publication evidence:** a currentness guard alone is insufficient. Bind the
  actual verified Knowledge publication/generation and its source receipt to
  the managed PCAT FileAsset/content hash and frozen producer rows. Reject
  NOT_VERIFIED, unpublished, revoked, stale, foreign or mismatched evidence.
  Tests must exercise the actual producer/manifest/reader contracts; a caller
  boolean such as `published: true` cannot establish acceptance.
- **Shared Core API:** `resolveLineProductFacts(job,{db,now})` returns
  `{text,binding}` for a recognized command. `binding` stays private and
  pins request, scope/authority, policy/publication/source digests. The parser
  returns null for non-product text. `revalidateLineProductFacts(job,binding,
  {db,now})` runs at final release for both worker cohorts. A changed binding,
  revoked grant/publication or changed result prevents release of old facts.
- **Runtime version:** introduce `conversation-runtime.v2` at
  `/api/internal/conversation-runtime/v2/<operation>`. Only v2 may receive
  fixed `PRODUCT_FACTS` turns. Keep v1's published schema and accepted turn
  kinds strict; an unsupported v1 product request fails closed. Pair the v2
  Core route/schema/client with Runtime tests; no direct Runtime DB/GKS access.
  The v2 wire carries only the fixed turn kind and bounded deterministic reply
  text under the claimed job/authority version. It carries no private binding
  or new grant field. Core persists a content-free decision/binding against
  the job and execution, verifies completion text against that decision, and
  reloads it itself at final release; Runtime cannot supply or replace it.
  Server-owned jobs use the same resolver and release revalidation. Normal
  Knowledge, Work, out-of-hours and staff catalog behavior remains covered.
- **Durability and audit:** persist private fact-decision bindings with the
  claimed job so retries, prepare/complete/send and transport restarts cannot
  omit revalidation. An idempotent content-free AuditEvent binds execution,
  authority, policy/publication refs and result digest; it contains no raw
  Customer/LINE identifier, fact value, source text or model receipt.
- **Acceptance:** real disposable DB tests cover policy CAS/authority, verified
  principal and exact Business isolation, both execution cohorts, producer to
  accepted publication to exact price, unavailable/partial/clarify paths,
  revocation/result change between answer and send, retry and malformed DTOs.
  Deterministic operational turns make zero model calls. No live service or
  deployed database is changed merely to make local tests pass.

`Proposed` and baseline-gap wording in the source analysis below describe the
0.2.0 design and its inspected source revision; the requirements of the bound
contract above and the unchanged acceptance matrix control this implementation.
Delivery evidence and unresolved live acceptance are recorded separately.

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
The implementation supplies the persisted policy and authenticated owner route
above through a reviewed canonical addition. Runtime service credentials do not
change that owner authority or enable disclosure. BusinessAgentConfig,
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

This is the strict internal Core DTO for the versioned deterministic turn.
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

At the inspected source revision, the reader totals the Business and reads
ledger and reservations in parallel without a coherent quantity boundary.
It supplies no observation timestamp,
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
new LINE Reply API path. Revision 0.3.0 authorizes the explicit v2 schema/consumer implementation;
v1 remains strict and deployment/activation evidence stays separate.

## Required implementation acceptance cases

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
THB price and deterministic first answers. The earlier design-only approval is superseded for implementation scope by
the explicit mandate in this revision. Stock rights, canonical additions,
publication proof, audit and Runtime v2 are authorized deliverables; checks and
actual production activation remain separately evidenced.
FR-132's existing quotation authorization remains unchanged.

This contract is indexed from the change-request entrypoint and FR-234
follow-up. The reviewed canonical addition and implementation evidence are
separate artifacts; this document does not claim their checks or activation.
Version 0.1.0 establishes the selected family's reviewable contract; tests in
the matrix are future acceptance criteria, not claims of executed behavior.

Version 0.1.0 → 0.2.0 records the owner's explicit choice to approve the design
with positive/zero ATP rather than exposing exact stock counts. It changes no
field semantics or activation authority. The
[bounded source implementation plan](../../../reports/gap-analysis-2026-10-23/stock-price-implementation.md)
separates the existing ATP consistency fix from missing request, authorization
and Runtime integration contracts.

Version 0.2.0 → 0.3.0 binds the explicit follow-up implementation mandate, typed
command, persisted owner stock grant, publication proof, private durable decision,
versioned Runtime v2 and shared final-release revalidation. Live activation and
production publication evidence remain separate acceptance claims.
