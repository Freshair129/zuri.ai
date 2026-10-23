---
id: ZAI:LINE-CUSTOMER-PRODUCT-DISCLOSURE-PROPOSAL-20261024
doc_type: interface-contract
status: proposed
version: "0.1.0"
date: "2026-10-24"
source_revision: "79e36b5bce875f1d7c0b7e29a0b8db517646e4f3"
relations: [{"type":"relates_to","target":"ZAI:FR-079"},{"type":"relates_to","target":"ZAI:FR-049"},{"type":"relates_to","target":"ZAI:FR-235"},{"type":"relates_to","target":"ZAI:FR-291"},{"type":"relates_to","target":"ZAI:SDD-099"},{"type":"relates_to","target":"ZAI:SEC-032"}]
---

# LINE customer product disclosure from GenesisRAG17

## Status, intent and authority

Audience: Knowledge, Commerce, Inventory, Identity, Agent, LINE OA Studio and
Conversation Runtime maintainers. This is a proposed design, not an approved
canonical migration, implementation receipt or disclosure grant.

The user requested real product information through GenesisRAG17, explicit
selection of what customers may receive, unchanged authorization/stock/price
guards, no model-invented facts, and GPT-6 Luna Max for delegated work. The user
selected per-product and per-field approval with a preview in LINE OA Studio.
The remaining choices below are the integrator's proposal for design approval.
No actual product or source is authorized by this document.

## Inspected baseline and gaps

- [The accepted TEST ONLY source contract](line-ollama-test-only-genesisrag17-20261024.md)
  and `main-dev-test-rag-knowledge.js` bind immutable source bytes, ingestion,
  manifest and live Product identity, project only name/code/unit, and validate
  before/after generation and at send. Actual LINE acceptance passed in PR734.
  Its server-private allowlists and TEST ONLY name/SKU checks must stay intact.
- `queryKnowledgeCorpus` verifies corpus publication; publication into a
  Business corpus alone is not a customer-disclosure grant.
- `LineStockDisclosurePolicy` already has owner-only audited version-CAS writes.
  It owns stock disclosure, not general product descriptions. Do not repurpose
  its model or infer grants from its enabled flag.
- The accepted structured `ProductMaster` schema supplies nameTh/nameEn,
  category, productFamily, dimensionsCm and unitWeightKg, as well as commercial
  and provenance fields that must not enter this new model packet. Live Product
  supplies the internal SKU code and base unit; an external record identifier
  is never an implicit Product UUID mapping.
- `verifyCandidate` checks numbers, codes and selected risky claims. It does
  not prove every arbitrary prose assertion. Reusing it alone cannot establish
  the requested no-invention behavior for a wider real catalog.
- The natural-language stock/price entry is currently TEST ONLY. This increment
  does not widen that eligibility. Real SKU natural-language commercial routing
  would need a separate explicit FR-291 amendment; deleting a prefix check is
  not an implementation of descriptive disclosure.

## Approaches

1. **Per-product/per-field disclosure with preview — selected by the user.**
   Keep one scoped policy, exact approved source revision, and explicit allowed
   fields. More precise than whole-document publication; adds a policy writer,
   preview and runtime enforcement.
2. **Whole-document/source disclosure.** Simpler selection, but a catalog source
   can carry costs, prices and provenance alongside names. Rejected as the
   primary grant because it cannot express the requested field selection.
3. **Server environment pins only.** Retain for the existing TEST ONLY profile;
   unsuitable as a Business Owner's durable catalog publishing interface.

## Ownership and persistence

Knowledge owns the customer-disclosure policy and verified public projection.
Commerce owns Product identity; Inventory retains ATP disclosure; Commerce and
Knowledge retain exact published-price validation. LINE OA Studio composes the
owner's configuration UI. No new domain, service, vector database, graph database
or second product catalog is introduced; no direct GKS/MSP store writes occur.

Proposed persistence is a scoped, versioned policy in Zuri's existing database,
keyed uniquely by Tenant + Business + internal LINE OA account + internal Product.
Store enabled/withdrawn state, approved field keys, exact source/ingestion/asset
and content/manifest digests, source-to-Product mapping, exact structured record
identity (externalId, recordIndex/count, record content hash and source version), Product version and
projection digest, approver Person ID, approval time, reason and policy version.
Use existing AuditEvent for immutable approval/revocation evidence. Persist
createdAt/updatedAt and retention-compatible lifecycle; do not copy source prose
or stock/price values into policy rows. Model/route names remain implementation
choices, subject to canonical review and both SQLite/PostgreSQL schema parity.

An absence of policy is disabled. A draft preview creates no grant. Approval,
field change, withdrawal and reapproval require Business OWNER authority from
the existing resolved viewer, current domain visibility, current active
Business/account/Product scope and version-CAS inside the transaction. Publisher
role alone, operator visibility, client actor IDs and model outputs cannot grant
disclosure. Audit and policy commit atomically; stale previews return conflict.
Retain revoked rows and increase versions; never delete/recreate to reset CAS.

## Owner UI and preview

Extend the current LINE OA account configuration with a customer product data
section using Zuri tokens. Do not add an unrelated global registry or a new
navigation domain. The owner can search scoped eligible Products, select one,
select an already published structured ProductMaster source, review the verified
identity mapping, choose fields, and see the exact public values and example
server-rendered answer before approval. No automatic matching by title or SKU
substring; require explicit mapping and validate trusted lineage/identity.
All field checkboxes start off; an internal SKU or preview value is never an
implicit public selection.

Start with a fixed field vocabulary supported by existing sources:

| Field | Authoritative value | Selection |
|---|---|---|
| SKU | Bound live Product.code | Optional; internal binding is not permission to display it |
| Thai name | ProductMaster.nameTh; accepted commerce producer shape resolves its bound Product.name | Optional |
| English name | ProductMaster.nameEn | Optional, only if present |
| Base unit | Bound live Product.unit | Optional |
| Category | ProductMaster.category | Optional, only if present |
| Product family | ProductMaster.productFamily | Optional, only if present |
| Dimensions | ProductMaster.dimensionsCm, exact named components and cm unit | Optional, only if present |
| Unit weight | ProductMaster.unitWeightKg, exact kg unit | Optional, only if present |

At least one public field must be selected. Missing/null fields are shown
as unavailable and cannot be fabricated. Arbitrary free text, description keys
not in the schema, costs, supplier/provenance data, customer/order-specific data,
price tiers, discounts, margins, MOQ, stock quantities and delivery claims are
not selectable in this increment. Reject CUSTOM_COMPONENT or dedicated
Customer/SalesOrder products; do not generalize the catalog by widening Zero-PII.

Show stock and price as separate existing controls/status, explicitly explaining
that this approval grants neither. Withdrawal is immediately available; source,
manifest or relevant Product changes make the old approval stale and require a
new preview/approval. Even an unrelated manifest update conservatively invalidates
the pin in this increment; no automatic transfer to a new generation.

## Runtime contract and no-invention rule

1. Resolve scope from the original persisted signed LINE event/job, current
   account and existing reader authority. No client supplies a disclosure policy,
   trusted source IDs, audience, Tenant or Business for the runtime.
2. Retain the existing stock/price intent guard before model routing, including
   its current eligibility and clarification/refusal behavior. This increment
   adds no real-SKU natural-language commercial entry and does not weaken the
   TEST ONLY parser. Public product approval never authorizes ATP or a price read.
3. For descriptive product questions, read only enabled policies in the trusted
   account scope and constrain native retrieval by their approved source IDs
   before snapshots/retrieval. Preserve the existing five-result/8 KiB/time budget;
   bound policy enumeration with scoped pagination and pre-query caps. Resolve
   one Product from an exact approved public SKU or a unique approved name value
   before building its packet. Internal/unselected codes are not public aliases;
   semantic rank alone never selects the Product. Missing, duplicate or ambiguous
   name resolution clarifies without a model call or disclosing hidden aliases.
   Do not
   retrieve the whole corpus and redact it after the model call.
4. Verify current manifest membership, receipt/Stage 9 publication, exact PCAT
   asset bytes/lineage, live Product eligibility and approved projection hash.
   General structured sources use the existing strict adapter contract and an
   explicit owner-approved mapping to one exact ProductMaster record. Pin and
   verify descriptor recordIndex/count, externalId, record content hash, asset
   hash, source version and ingestion identity as well as the Product UUID.
   A multi-record asset is allowed only when the existing adapter split produced
   one exact ProductMaster record per source/ingestion; an ingestion containing
   multiple product records is ineligible. Hit source/ingestion/snapshot bindings
   must match that exact record. Sibling records never enter the public packet.
   The special commerce producer shape remains strictly checked. Raw retrieval
   text is not an answer source.
5. Build a typed packet containing only selected, verified public fact IDs and
   values. Keep retrieval citations internal to the existing proof/trace; no raw
   asset/source citation or download URL is sent to the customer or model. A
   future public citation view requires its own selected-field projection and
   access checks. Never serialize provenance, raw PCAT,
   source IDs, unapproved fields, costs, prices or stock into the model context.
   Treat approved strings as data, not instructions; keep memory and other tool
   context from bypassing this restricted catalog answer path.
6. Ollama receives facts for exactly the one resolved Product and may select a
   bounded list of supplied opaque fact IDs in strict JSON (`factIds` only). The
   server rejects unknown/duplicate IDs, extra keys, free prose and invalid output
   and renders accepted facts with fixed Thai labels and exact stored values.
   No free model prose is sent for this path. Invalid model output yields a safe
   deterministic answer from the same approved facts or the existing no-evidence
   response; it never expands the fields or changes values. Numeric dimensions
   and units are copied without interpretation or unit conversion.
   A valid empty selection means no evidence/clarification, never selection of
   all fields or another Product. Selection/output validation is shared code,
   not another prompt-only policy.
7. Bind the policy version, source/projection digests, actual execution and reply
   digest in the existing content-free TOOL_RESULT decision. Revalidate before
   and after generation and at the final send fence, including paused/archived
   account, owner authority, revocation, Product scope and source withdrawal.
   Pending retries cannot replay a reply bound to an old grant. Use the existing
   cancellation/answer clearing semantics; fail closed on unavailable checks.
8. Preserve filtered-prompt tracing and content-free retrieval metadata under
   current retention/erasure. No secrets or unapproved source content in logs.

Unknown/ambiguous products, unavailable approvals or unsupported fields receive
bounded clarification/no evidence, with no whole-corpus, fixture or unrelated
business-knowledge fallback. Mixed stock/price requests stay with the existing
bounded facts contract; they must not cause a model to infer commercial facts.
Natural-language customer requests never turn into policy mutations.

## Stock, price, environments and compatibility

FR-291's exact linked Customer requirement for stock, active direct-user identity,
owner-controlled stock policy, positive/zero ATP-only answer and final send
revalidation remain mandatory. Price still requires exact SKU/base unit/positive
quantity, effective published calculation lineage and the existing publication
guard. Tax remains UNKNOWN if evidence does not establish it. No stock counts,
quantity sufficiency, delivery guarantees, invented discounts or quotations.

The new real-product source mode is separate and default-off. Preserve both
existing TEST ONLY and credentialed provider modes and Business-key precedence.
Local Ollama remains restricted to the verified main-dev database, exact origin,
allowlisted trusted scope and selected installed model; do not enable it in
production. Implement/qualify real-product disclosure in isolated main-dev first.
Owner selection is required before actual real data can be sent; this design
does not select any existing product automatically. No production rollout,
database repointing or implicit memory consent is authorized.

Server and Runtime must share the projection/selection verifier and Core-owned
decision semantics before either cohort can use this mode. Keep unsupported
accounts SERVER-only until Runtime is qualified; no partial Runtime admission.
Do not deploy over another session's main-dev changes without verifying revision
and configuration. Existing PR736 memory work is a separate change to compose
and requalify if it lands before this implementation.

## Acceptance and delivery gates

- Owner UI: exact preview, selected-field-only approval, denial for staff/publisher
  without ownership, correct tenant/account isolation and stale-preview conflict.
- SQLite and actual disposable PostgreSQL: grant/revoke, unique/CAS races,
  transactional audit rollback, source/product changes and cross-scope attempts.
- Actual query adapter: approved sources constrained before retrieval; unapproved
  hit, wrong bytes/receipt/manifest, missing mapping and stale generation deny.
- Capturing model tests prove exact packet field filtering; injection-bearing
  source strings cannot issue actions; fabricated facts/prose/IDs/numbers cannot
  enter server-rendered replies. Zero evidence makes zero model calls.
- Server and Runtime parity for supported modes; stale proof or authority changes
  after generation and during send/retry suppress old disclosure.
- Regression tests preserve Customer link and stock policy, exact published-price
  checks and unchanged real-SKU eligibility, zero model calls for stock/price,
  TEST ONLY behavior and provider/memory
  boundaries. Existing main-dev RAG and facts positive cases must still pass.
- Required build/type/lint/governance/hosted CI follow the scoped verification
  policy. No test, CI, deployment or live LINE pass is implied by this document.
- Main-dev acceptance: owner selects a real product and public fields through UI;
  actual RAG/model trace and LINE receipt match only selected values; an excluded
  field question does not disclose it; revocation prevents later replies. Confirm
  price/stock only if their independent existing authorization is enabled.

## Canonical impact and approval boundary

After design approval, prepare reviewed same-ID amendments for the affected
FR-079 local-source boundary, FR-049 answer verification and FR-235 customer-safe
grounding, preserving their original subject/membership. FR-291 remains unchanged;
new descriptive policy membership must never become commercial eligibility.
Do not relabel those sources implemented by editing this intake. Let independent
Luna Max review determine whether a separate new requirement is needed for the
owner-disclosure writer; allocate only through the sanctioned cross-branch ID
workflow if required, never choose an unreserved next number.

The implementation plan must pin the composed base and list schema/reader/UI/
Core/Runtime work, tests, migrations, rollback and actual live acceptance. No
product code, grant or schema is changed by this proposed document. The user
still needs to approve this concrete design before implementation.

## Version diff

0.1.0 proposes owner-selected product/field disclosure, strict fact selection and
rendering, separate commercial facts authority and a bounded main-dev rollout.
It preserves the previously accepted TEST ONLY contract as a separate mode.
