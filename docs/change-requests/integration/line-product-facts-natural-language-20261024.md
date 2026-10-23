---
doc_type: intake-note
id: ZAI:LINE-PRODUCT-FACTS-NATURAL-LANGUAGE-20261024
status: approved
superseded_by: null
version: "0.1.1"
date: "2026-10-24"
relations: [{"type":"references","target":"ZAI:FR-291"},{"type":"references","target":"ZAI:FR-132"},{"type":"references","target":"ZAI:FR-079"},{"type":"references","target":"ZAI:FR-080"},{"type":"references","target":"line-agent-stock-price-facts-20261023.md"},{"type":"references","target":"LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md"}]
---

# TEST ONLY natural-language LINE stock and published price

## Intent and authority

The owner's 2026-10-24 request authorizes natural-language stock/price questions
through LINE, initially for TEST ONLY products, with actual persisted-source
proof and no invented stock or price. It extends the explicit-command entry of
FR-291. It does not approve real/private Business data, production activation,
new quotation behavior, a new requirement ID, or removal of identity checks.

## Design and alternatives

Use a bounded deterministic intent parser before ordinary model routing, then
the existing Core owner readers, formatter, durable decision and final release
fence. The integrator selects this approach within the request because the
existing factual path already enforces source/authority/currentness. Model tool
selection would add nondeterminism and a new contract; model-written prices or
stock cannot meet the no-guessing acceptance. Neither alternative is adopted.

The pilot has a separate default-off server flag and requires the existing
MAIN_DEV_LOCAL_OLLAMA profile, actual main-dev database identity and all three
trusted-scope allowlists. The server-configured `ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS` list pins each eligible internal Product UUID and exact SKU; both must match the currently resolved Product before a stock/price read. Prefixes route requests but grant no authority.
No caller may provide a scope, URL, source/publication flag or verified principal.
Canonical FR-079/FR-080's model fixture still has no stock or price: deterministic
fact reads stay outside Ollama and do not broaden its grounding.

Recognize Thai/English stock or price questions with one explicit TEST-ONLY SKU.
A price request states quantity and base unit, such as `ราคา <SKU> 1 EA เท่าไร`.
A combined question may ask `สินค้า <SKU> มีของไหม และราคา 1 EA เท่าไร`.
The parser never defaults quantity/unit, converts units, picks a product by fuzzy
name, handles a quote/order, or follows embedded instructions. Ambiguous wording,
multiple SKUs, missing required fields, negation, exact stock counts, injected
JSON/control text or private-cost requests produce a bounded clarification or
refusal. Any detected stock/price intent, including unknown/non-test/omitted SKU requests, cannot fall through to a model
even when the pilot is disabled or scope is wrong. Product-name questions remain
ordinary metadata-grounded model turns. Existing #product behavior is retained.

The same parser/resolver applies to Server and Core's Runtime v2 fixed
PRODUCT_FACTS turn; Runtime receives no new fields. Core validates current source
and durable request/authority/result binding again before send, including profile
revocation. Price must match the accepted published SKU/quantity/unit and current
source proofs. Stock preserves verified DIRECT identity, exact Customer Business,
explicit product policy and fenced ATP. It exposes only positive/zero/not-measured,
never a quantity, sufficiency or delivery promise. Unavailable sources or missing
authority remain explicit unavailable/partial results, not fabricated values.

## Canonical amendment and provenance

FR-291 retains its ID, `customer line product facts` subject anchor, standalone
membership, active authored-v2 record kind, path and export order. Preserve all
old manifests, approval copies and receipts. Its add-only writer cannot perform
this amendment; add a distinct writer-only plan/apply operation with fresh
committed base/index/ledger digests, exact prior provenance verification, and a
new unique manifest/approval copy/receipt. Bind the approved proposal path, version and digest to its committed revision, which must be ancestral to the fresh migration base. Require this approved exact row, refuse
identity/lifecycle/order drift or stale/forged inputs, and leave strict readers
unchanged. The integrator uses `docs:ids --review FR-291` separately for the body
witness. No new ID, ledger hand edit or frozen artifact rewrite is permitted.

### `ZAI:FR-291`

```text
| FR-291 | Customer LINE product facts: accept an explicit strict #product JSON request for one exact public SKU and selected availability/price facets, with positive base-unit quantity required for price. A separately enabled main-dev natural-language entry may classify bounded, unambiguous stock/price questions about one exact TEST-ONLY SKU into the same typed request only after the actual database and trusted Tenant, Business and internal LINE account match the existing main-dev allowlists. Price requires an explicit positive safe-integer quantity and exact base unit; missing SKU/quantity/unit, multiple products, exact-stock-count requests, negation, unsupported instructions or ambiguous wording produce deterministic clarification or refusal without owner reads or model fallback. A deterministic guard classifies stock/price intent before model routing even for omitted, unknown or non-test SKUs; unsupported requests and disabled or out-of-scope profiles clarify or refuse without a model or stock/price read. Eligible test products must match a server-configured internal Product ID and exact code allowlist, not a caller label or prefix alone. Ordinary product-name questions retain their existing route. This entry changes neither real-data/production disclosure nor FR-132 quotation semantics. Core derives scope and principal from the persisted job and original signed direct-user event; a verified active ChannelIdentity and non-erased Customer with an exact non-null Business binding are required for stock, never a fabricated staff Viewer or memory permission. A Business OWNER controls a default-off, version-CAS Inventory disclosure policy keyed by Tenant, Business, internal LINE account and Product, with audited changes. Inventory returns only quantity-independent positive/zero ATP or not-measured for eligible products using its fenced quantity reader, never counts, quantity sufficiency or fulfillment promises. Commerce reads an exact published SKU/quantity/unit THB sell price only after Knowledge verifies current generation/manifest/source-receipt membership and PCAT asset/content plus producer-calculation lineage and effective approved pricing rules; NOT_VERIFIED, stale, revoked, foreign or imprecise sources are unavailable, tax remains UNKNOWN, and no new price opt-in or FR-132 quotation change is introduced. Both Server and Conversation Runtime use the same deterministic bounded allow-listed formatter with no model invocation or fallback for recognized product-fact requests, private cost/provenance fields or unrequested owner reads. Core persists a content-free per-job/execution decision, verifies completion text, and revalidates live identity/customer/account/direct audience, applicable owner authority, policy, publication and result before either cohort sends; changed or missing bindings suppress old facts. A separate conversation-runtime.v2 fixed PRODUCT_FACTS contract carries only bounded reply text and existing job/authority context; strict v1 rejects product turns. Malformed requests clarify, denied combined requests have no product/facet payload, allowed one-source failures are explicit PARTIAL, and every read binds a content-free audit without a fabricated model receipt. Local DB and paired Core/Runtime tests prove successful publication-backed reads, negative authorization/source cases, revocation/rebind, concurrency and retry; no production disclosure activation is implied. | planned |
```

## Implementation plan

1. Review and commit this proposal within the owner mandate. Implement and test
   the narrow same-ID authored-v2 amendment writer (RED then GREEN); apply the
   new manifest and sanctioned digest review. Root alone runs shared generators.
2. Add parser/resolver tests first. Implement the bounded intent entry, trusted
   profile/DB/scope guards and clarification formatter. Preserve the signed
   original inbound body; do not rewrite jobs or synthesize LINE events.
3. Exercise Server and Runtime v2 paths, strict v1 rejection, no-model semantics,
   durable/final-send revalidation, malformed/ambiguous requests, missing identity,
   foreign scope, unpublished/stale/revoked prices, stock-policy/source failure
   and changed result. Run applicable PostgreSQL tests, build and governance.
4. Independent Luna Max review of the composed exact patch; resolve findings,
   then standard Git/CI delivery and isolated main-dev deployment. Keep current
   production/UAT data boundaries and private backups intact.
5. Verify persisted TEST ONLY source facts without changing stock/price merely to
   pass. Complete existing identity linking only with the owner's specific
   authority and existing proof service; never set ACTIVE manually or fabricate
   a staff Viewer. Live LINE price and stock answers need actual trace/source
   evidence and provider send receipt, plus user receipt confirmation.

## Acceptance and limits

- Supported explicit SKU Thai/English price, availability and combined wording
  enters only the factual reader; no MODEL_COMPLETED is fabricated or expected.
- Missing/ambiguous parameters, omitted/unknown/non-test SKUs, and a different Product sharing the TEST-ONLY prefix clarify/refuse with zero stock/price reads and zero model calls. Eligible reads require the pinned internal Product ID and exact current code.
- Exact published price result matches its accepted source. No exact price for a
  quantity/unit without matching publication; missing source returns unavailable.
- Positive/zero ATP is proven against owner data; unverified identity, wrong
  scope, revoked policy or failed read discloses no stock. Counts never appear.
- Final-send suppression works for profile/identity/policy/publication/result
  change and missing/changed durable decision, in both cohorts and retries.
- Existing #product, product-name Ollama, catalog, memory and out-of-hours paths
  remain covered. This pilot is not general ERP natural-language query support.

## Approval

Independent Luna Max design review approved the revised contract on 2026-10-24 with no remaining P1/P2 design findings. The direct owner request supplies the trusted
scope; approval of this reviewed technical implementation does not claim a
separate owner vote on exact wording or any production activation.