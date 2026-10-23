---
id: ZAI:LINE-CUSTOMER-PRODUCT-DISCLOSURE-PROPOSAL-20261024
doc_type: interface-contract
status: approved
approval_scope: design-and-implementation
version: "0.2.0"
date: "2026-10-24"
source_revision: "79e36b5bce875f1d7c0b7e29a0b8db517646e4f3"
migration_base_revision: 8a3eb253bc7ccf750a05d5df317ca7c34695fa45
relations: [{"type":"relates_to","target":"ZAI:FR-079"},{"type":"relates_to","target":"ZAI:FR-049"},{"type":"relates_to","target":"ZAI:FR-235"},{"type":"relates_to","target":"ZAI:FR-291"},{"type":"relates_to","target":"ZAI:SDD-099"},{"type":"relates_to","target":"ZAI:SEC-032"}]
---

# LINE customer product disclosure from GenesisRAG17

## Status, intent and authority

Audience: Knowledge, Commerce, Inventory, Identity, Agent, LINE OA Studio and
Conversation Runtime maintainers. The user approved this design and instructed
implementation on 2026-10-24. Approval is not a canonical migration receipt,
implementation receipt or disclosure grant.

The user requested real product information through GenesisRAG17, explicit
selection of what customers may receive, unchanged authorization/stock/price
guards, no model-invented facts, and GPT-6 Luna Max for delegated work. The user
selected per-product and per-field approval with a preview in LINE OA Studio.
The remaining choices below were included in the approved concrete design.
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
   The durable SENDING claim is the send-authorization cutoff. Policy changes take the same account-row fence and return 409 without mutation while any attempt is SENDING; an already claimed network attempt cannot be recalled. After settlement/recovery the owner retries withdrawal, including when the source is unavailable. Pending retries cannot replay a reply bound to an old grant. Use the existing
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
  after generation and before a send/retry claim suppress old disclosure. A concurrent policy change during SENDING returns a retryable conflict without recording a successful withdrawal.
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
product code, grant or schema is changed by this design document itself.

## Implementation plan

For agentic workers: use subagent-driven-development with GPT-6 Luna Max only.
The approved design above is the spec; this section pins implementation
interfaces and verification. Base is 8a3eb253bc7ccf750a05d5df317ca7c34695fa45 (the indexed prior state for these reviewed same-ID migrations).
Use the existing Next/React, Prisma SQLite/PostgreSQL and Node Runtime stack.
The integrator owns shared generators, canonical amendments and final merge.

### Global constraints and review focus

- Preserve TEST ONLY modes, FR-291 commercial eligibility and default-off real
  source selection; no automatic disclosure grant or production activation.
- Revoke during generation or before the durable SENDING claim: suppress the old answer. After SENDING, refuse policy mutation with a retryable conflict until the authorized attempt settles; never report a successful withdrawal while that attempt remains in flight.
- Two owners editing one preview: CAS permits one winner, with atomic audit.
- Multi-record PCAT: the bound record alone supplies selected values.
- Unselected SKU/name: never become public aliases, even through error messages.
- Model prose, unexpected facts, empty selection and hostile source strings:
  only the fixed renderer and approved fact values may reach LINE.

### Task 1: shared source/projection contract and verified source reader

Owner: Knowledge reader worker. Create
`apps/server/src/modules/knowledge/line-product-disclosure-contract.js` and
`line-product-disclosure-source.js`; unit tests use matching names.
Export `DISCLOSURE_FIELDS` (ordered keys: sku, nameTh, nameEn, unit, category,
productFamily, dimensionsCm, unitWeightKg), `projectDisclosureFacts(values)`
(opaque IDs, fixed labels), and `renderDisclosureFacts(facts, factIds)`.
Export `resolveLineProductDisclosureSource(input, options)` where input is
`{tenantId,businessId,accountId,productId,sourceId,fields}` and options include
`db`, `env`, optional `readManifest`/`fileContentResolver`. Return
`{values:[{field,value}], binding, projectionSha256, retrievalRef}`. Binding pins
all approved record/source/Product identities; retrievalRef is internal only.

- [ ] Write/run failing tests for private field exclusion, exact immutable record
  binding, wrong source/Product/asset, changed manifest and model fact selection.
- [ ] Implement using the existing manifest, adapter and managed-file readers;
  no raw-store access or raw-text evidence fallback.
- [ ] Run targeted Vitest tests with the repository nonzero-test wrapper.

### Task 2: policy persistence, owner service and API

Owner: policy worker. Create `LineProductDisclosurePolicy` with scoped unique
key, source/field binding JSON, projection hash, approver, reason, enabled flag,
timestamps and monotonically increasing version. Add a migration and export
PostgreSQL equivalents through existing schema tooling; do not hand-maintain a
second authority. Source verification consumes Task 1.
Create `apps/server/src/modules/knowledge/line-product-disclosure-service.js`:

- `listLineProductDisclosure({businessId,accountId,q?,sourceQuery?,sourceCursor?},
  {viewer,db,env})` returns bounded
  `{products:[{id,code,name}], sources:[{id,title}], sourcesNextCursor, policies, fields}`.
  Product `q` filters the scoped product list. Source search is a
  case-insensitive title substring; keyset pages scan at most 200 authorized
  manifest-listed rows and return at most 100 eligible candidates. The cursor
  advances after the scanned page, including a page with no title matches.
  Policy summaries carry productId, sourceId, fields, enabled, version and stale
  status; no raw source contents in list responses.
- `previewLineProductDisclosure({businessId,accountId,productId,sourceId,fields},
  {viewer,db,env})` returns `{previewHash,expectedVersion,values,exampleText}`;
  verify source and authority before returning exact selected values.
- `setLineProductDisclosure({businessId,accountId,productId,sourceId,fields,
  expectedVersion,previewHash,reason}, options)` approves the exact preview.
- `withdrawLineProductDisclosure({businessId,accountId,productId,expectedVersion,
  reason}, options)` disables the row, retaining version/audit and no source
  availability prerequisite for revocation.

Expose GET/POST at
`apps/server/src/app/api/line-oa/accounts/[id]/product-disclosure/route.js`.
POST uses `action: PREVIEW | APPROVE | WITHDRAW`; derive accountId from params,
viewer from existing request resolver; return service DTOs with existing helpers.

- [ ] First fail owner/publisher/isolation, preview-CAS, atomic audit, stale-source
  and withdrawal tests using existing viewer factories.
- [ ] Implement transactional persistence and current authority validation.
- [ ] Run SQLite integration tests and actual disposable PostgreSQL qualification.

### Task 3: owner UI

Owner: UI worker. Create `LineProductDisclosureCard.jsx`, mount it within
`LineStudioAccountConsole.jsx` for the selected active account, and add focused
render/interaction tests. Consume Task 2 GET/POST DTOs; never infer a grant from
the preview or from stock policy. Account/business changes reset stale previews.

- [ ] First fail tests for all fields initially off, preview-only not approved,
  stale request suppression, version conflict and successful withdrawal.
- [ ] Implement searchable scoped product/source selection, exact selected-value
  preview, explicit reason/approve/withdraw, independent stock/price explanation,
  busy/error handling and design-token colors/accessibility.
- [ ] Run component tests and review browser behavior against the real API.

### Task 4: runtime reader, strict selection and durable send fence

Owner: integrator. Create `line-customer-product-knowledge.js` and
`line-customer-product-decision.js` in `modules/agent`, and selection tests.
Resolve exact public aliases from enabled current policy rows, one Product per
turn; use Task 1 to revalidate and constrain corpus queries before retrieval.
Add a distinct main-dev `GENESISRAG17_CUSTOMER_PRODUCTS` source mode in
`main-dev-local-ollama.js` / `phase1-runtime.js`, keeping exact database/scope/
origin/primary-provider guards and no shadow or memory context in this path.
In `server-line-answer.js`, call the existing selected model with a typed
fact-selection packet; validate `factIds` and render exact values. Keep commercial
intent handling outside this branch. Persist an execution-bound content-free
decision and validate it at the existing worker send fence. Runtime admission
must reject this source mode until its shared contract is qualified.

- [ ] First fail tests for unapproved source, wrong aliases, injected/raw fields,
  malformed/empty model output and stale proof before generation/after generation/
  final send, including retries and profile/account mismatch.
- [ ] Implement guarded source selection and shared strict renderer; no widening
  of existing generic corpus readers or commercial parser.
- [ ] Run focused Server, existing RAG/facts/Runtime regression tests and builds.

### Task 5: canonical migration, composed verification and delivery

Owner: integrator; independent Luna Max reviewer checks the final composed patch.
Use sanctioned reviewed amendments for FR-079/FR-049/FR-235, leaving original
subjects/membership and FR-291 unchanged. Reconcile any newly required owner
writer requirement through the existing identity workflow, never invent an ID.

- [ ] Regenerate registry, graph and views serially; run govern and inspect output.
- [ ] Run approved scoped tests/build/checks and actual PostgreSQL. Fix independent
  review findings against the same patch; record exact commands/results.
- [ ] Commit/push/PR and required exact-head CI through existing controls. A green
  local test is not a hosted CI or live acceptance receipt.
- [ ] Deploy qualified image only to isolated main-dev after checking actual
  runtime revision/configuration; do not overwrite unrelated memory work.
- [ ] Let the owner choose actual real-product fields through the UI. Verify
  filtered model input, positive LINE receipt, excluded field refusal, revocation
  and unchanged commercial behavior. No hidden selection of production data.

Rollback: disable the new source mode/account setting and withdraw policies;
retain audit/history and previous TEST ONLY source configuration. Schema remains
additive; do not drop data or repoint databases as rollback.

## Version diff

0.1.0 proposed owner-selected product/field disclosure, strict fact selection and rendering, separate commercial facts authority and a bounded main-dev rollout.
0.2.0 records the approved implementation mandate and same-ID FR-079/FR-049/FR-235 candidates; it preserves existing TEST ONLY, memory and FR-291 boundaries.

## Approval

The user mandate was: “ทำต่อให้ LINE ใช้ข้อมูลสินค้าจริงจาก GenesisRAG17 ได้ โดยเลือกได้ว่าข้อมูลไหนอนุญาตให้ตอบลูกค้า คงการตรวจสิทธิ์ ราคาและสต็อกเดิม ไม่ให้โมเดลเดา ใช้ Luna Max เท่านั้น” The selected control was per product and per field with a preview: “รายสินค้า + รายฟิลด์ พร้อมตัวอย่าง (แนะนำ)”. The user explicitly approved the draft and implementation: “อนุมัติร่างและเริ่มพัฒนา”. This authorizes the approved design and implementation work only. It does not grant any product disclosure, approve production activation, or constitute test, deployment or live LINE acceptance.

The following same-ID canonical row candidates preserve each record's source path, subject and membership. FR-079 retains its TEST ONLY modes, FR-057 memory opt-in and FR-291 commercial guard.

### `ZAI:FR-079`

```text
| FR-079 | Phase 1 LINE runtime connection cut-over: after the server-owned LINE binding resolves the trusted Tenant/Business scope, the runtime keeps the existing Business-key-first behavior and selects exactly one ACTIVE PRIMARY PHASE1_LINE_LLM IntegrationConnection under that scope when no Business model key applies. The existing credentialed connection path resolves its opaque secretRef through the configured provider-neutral SecretManagerPort before the ModelProviderPort call. The default-off MAIN_DEV_LOCAL_OLLAMA profile may instead use a Business-owner-selected installed Ollama model without a secretRef or credential only when the Server verifies the actual main-dev database identity through its Prisma-backed connection and verifies the resolved Tenant, Business, and internal LINE OA account ID against separate server-side allowlists. It uses the existing Prisma-backed resolvePhase1PrimaryConnection. The legacy TEST_ONLY_FIXTURE remains the default local-profile knowledge source. A separately enabled GENESISRAG17_TEST_ONLY knowledge source may replace that fixture only under the same verified main-dev profile, scope, exact server-configured origin and model guards, and only when the Business MODEL_PROVIDER_KEY does not apply under unchanged ADR-100 D5 precedence. This source mode requires both the persisted LineOaAccount.knowledgeGrounding value GKS_CORPUS and the matching private server profile GENESISRAG17_TEST_ONLY; it rejects GKS_THEN_BUSINESS_KNOWLEDGE, BUSINESS_KNOWLEDGE, any profile/account mismatch and grounding shadow. Both TEST_ONLY_FIXTURE and GENESISRAG17_TEST_ONLY refuse memory unless the separate server-side ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED=true opt-in is set. With this opt-in, the same allowlisted main-dev OA may use existing MSP thread and principal-private episodic memory through the standard account policy, authenticated identity, per-turn authorization, consent, audience, signed-grant, receipt, retention and erasure gates of FR-057 and ADR-091. This grants no additional memory authority and never falls back to shared legacy Workspace storage. Authorized memory slices remain separate from public Product evidence and cannot authorize Business facts, widen source selection or bypass RAG revalidation. Missing memory transport or signer fails closed before inference. Execution remains SERVER and no caller may select source IDs, products, scope or origins. It calls queryKnowledgeCorpus in process through the existing knowledge.query reader and scoped runtime knowledge capability, passing a server-selected allowlist of 1–8 source UUIDs in internal options.sourceIds before corpus snapshot/native queries. Each allowed binding pins one internal Product UUID and exact Product code/SKU to one sourceId, ingestionId, accepted PCAT FileAsset SHA-256 and current corpus manifest SHA-256. Before model composition, the Server verifies current published-generation membership, manifest and source-receipt/PCAT bytes, structured ProductMaster lineage and the live Product identity under the trusted Tenant and Business. It rejects CUSTOM_COMPONENT and dedicated Customer or SalesOrder records. Thai combining marks remain valid in permitted public Product strings. Names require a TEST ONLY prefix and a trimmed bounded label without control/invisible characters or known instruction phrases; unit is one bounded token. These syntax checks supplement exact immutable source pins, not a universal instruction classifier. Verify the existing producer shape code/externalId commerce-sku:<Product UUID> and nameTh <SKU> — <Product.name>, then project the exact bound Product.name. The accepted ProductMaster/PCAT source is validated against its existing strict schema and lineage inside the reader, then a separate bounded public prompt projection (not the full FR-047 record) contains only product_code, name, unit from the exact live Product row, sell_price null, currency null, moq null, specification empty and one bounded citationId navigation reference; do not invent approval timestamps or as-of fields absent from this projection. ProductMaster does not supply unit. Only citationId may navigate to the accepted source; sourceId, ingestionId, snapshot and manifest IDs stay outside serialized model records. Raw source text/files, costs, other source/provenance references and unapproved sources never reach Ollama. Retrieval retains FR-235/SDD-099's 2 500 ms, five-result and 8 KiB answer budget and records content-free EVIDENCE_SELECTED retrieval references and digests without query or projected values. FR-171 CONTEXT_COMMITTED retains the exact sanitized model request under existing retention and erasure; raw PCAT/corpus passages never enter any trace. Empty, invalid or failed reader evidence yields only the fixed NO_EVIDENCE text, records a content-free denied binding in the existing TOOL_RESULT journal and makes no model call; there is no fixture or broad-corpus fallback. The persisted account mode, private profile, source allowlist, current manifest, accepted source lineage and Product are revalidated before model generation and after generation; the existing TOOL_RESULT journal and final send-fence revalidation bind delivery without a new schema. A revocation, change or failed revalidation after generation suppresses the stale answer at the existing send fence. FR-291's deterministic stock/price intent guard and owner reads remain outside the model and unchanged. The fixture path, exact configured http://host.docker.internal:11434 origin, Prisma-backed primary resolver, one-active-primary CAS/uniqueness gate, trusted OA account binding, SERVER execution, provider behavior and production rejection of local credentials/Ollama remain unchanged. Any invalid database/scope/profile, missing or extra source, source/manifest/lineage/Product mismatch, disabled guard, Ollama failure or invalid response fails closed without automatic fallback. A separate GENESISRAG17_CUSTOMER_PRODUCTS mode is default-off and descriptive-only; it requires per-account Business OWNER preview and explicit per-product/per-field approval, current authorized manifest/receipt/PCAT lineage, an exact ProductMaster-to-live-Product binding, and the verified main-dev database, Tenant/Business/account, origin, installed model and existing no-Business-key guards. It is not an automatic grant. The selected projection contains only approved public values and opaque fact IDs; Ollama returns strict JSON factIds from that packet, the Server rejects unknown, duplicate or extra values and renders exact approved values with fixed Thai labels, with no model-authored reply text. No approved fields, ambiguous identity, stale source/projection/owner proof or invalid selection produces a model call or corpus/fixture/business-knowledge fallback. Resolve only an exact approved SKU or unique approved name, so unselected values do not become lookup aliases. Revalidate owner policy, source and Product before and after generation and at the final send fence; withdrawal remains possible after source removal. This path grants neither stock nor price permission, does not widen FR-291 TEST ONLY commercial eligibility and never uses memory; the separate FR-057 memory opt-in behavior above remains unchanged for the existing TEST ONLY modes. | 🟠 approved design; implementation, tests, main-dev actual-RAG and LINE-send evidence pending; the separate customer-product mode is approved design only, with implementation, tests, parity, main-dev RAG and LINE-send evidence pending |
```

### `ZAI:FR-049`

```text
| FR-049 | Evidence-grounded answer: classify into a registered knowledge query, send only a bounded evidence packet to the configured provider, reject unsupported numbers/facts, and return a deterministic Thai fallback when evidence or provider output is insufficient. On the separate default-off GENESISRAG17_CUSTOMER_PRODUCTS path only, after one exact Product and current owner-approved selected-field projection are established, the configured model may return strict JSON containing only supplied opaque factIds. The Server rejects unknown or duplicate IDs, extra keys, free prose and invalid output, then renders selected facts with fixed Thai labels and exact approved values; missing evidence skips inference, while an empty/invalid model selection is rejected to the deterministic Thai fallback. This scoped renderer does not rewrite provider-wide answer verification, admit generic corpus prose, or change commercial authority. | Phase 1 active - owner-approved 2026-08-14; the customer-product fact-selection extension is approved design only; implementation and acceptance are pending |
```

### `ZAI:FR-235`

```text
| FR-235 | LINE answer grounding from the published knowledge corpus: a LINE OA account carries a publisher-set `knowledgeGrounding` mode — `BUSINESS_KNOWLEDGE` (default, today's behaviour), `GKS_CORPUS` or `GKS_THEN_BUSINESS_KNOWLEDGE`. In a corpus mode a server-owned LINE job's answer reads the Business's published corpus generation through an in-process reader that implements the existing `knowledge.query` port over `queryKnowledgeCorpus` under the scoped runtime knowledge capability, within a configurable budget (2 500 ms, five results, an evidence packet of at most 8 KiB). A timeout or error is `GKS_UNAVAILABLE` and an empty result `NO_EVIDENCE`; either falls back to business knowledge only in `GKS_THEN_BUSINESS_KNOWLEDGE`, and every hop is traced as `EVIDENCE_SELECTED` with its source, reason, budget and retrieval references (citation, source, snapshot and corpus generation). No evidence from any allowed source means the deterministic reply and no model call. The first Business switched is SmartGift, after ADR-075 Phase 3 is deployed. A separate default-off GENESISRAG17_CUSTOMER_PRODUCTS descriptive path reads only enabled owner-approved per-Product/per-field policies for the current LINE OA account and constrains retrieval to their source IDs before querying. It resolves one Product from an exact approved public SKU or unique approved name, then verifies current owner authority, manifest/receipt/PCAT lineage, the exact ProductMaster record-to-live-Product binding and projection hash. Its packet contains only selected values and opaque fact IDs; model output is strict JSON factIds, unknown/duplicate/extra values and prose are rejected, and a fixed Thai renderer emits exact approved facts. Missing approval, ambiguity or stale proof prevents inference. Invalid model selection yields the deterministic no-evidence reply; neither case allows fixture, broad-corpus or business-knowledge fallback. It does not use memory, grant stock/price access or widen FR-291; owner policy, source and Product are revalidated before and after generation and at the durable SENDING authorization claim. Policy changes serialize with that claim and return a retryable conflict without mutation while an attempt is SENDING; after settlement/recovery withdrawal remains possible even when the source is unavailable. An already claimed network attempt cannot be recalled. Existing GKS_CORPUS and GKS_THEN_BUSINESS_KNOWLEDGE behavior is unchanged. | ✅ merged #407 2026-09-14 (main af3f7822; not deployed; TASK-ZAI-093, ADR-090 D1–D5, FEAT-038) — `LineOaAccount.knowledgeGrounding`, the in-process `knowledge.query` reader and the traced mode-gated fallback; the SmartGift switch itself is TASK-ZAI-095, blocked on ADR-075 Phase 3; the separate customer-product path is approved design only; implementation, tests, parity, main-dev and LINE acceptance remain pending |
```
