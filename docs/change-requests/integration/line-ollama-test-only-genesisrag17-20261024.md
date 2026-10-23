---
doc_type: intake-note
id: ZAI:LINE-OLLAMA-TEST-ONLY-GENESISRAG17-20261024
status: approved
superseded_by: null
version: "0.1.0"
date: "2026-10-24"
migration_base_revision: aa82e3058e81fddf793d18795bee660b40945263
relations:
  - type: references
    target: ZAI:FR-079
  - type: references
    target: ZAI:FR-235
  - type: references
    target: ZAI:FR-291
  - type: references
    target: ZAI:SDD-099
  - type: references
    target: ZAI:SEC-032
  - type: references
    target: LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md
  - type: references
    target: line-product-facts-natural-language-20261024.md
  - type: references
    target: ../knowledge/genesisrag17-ownership-reliability-20261023.md
---

# LINE Ollama with a TEST ONLY GenesisRAG17 source

## Status, audience and scope

This is the approved 0.1.0 implementation contract for a main-dev-only
knowledge-source option in the existing LINE local Ollama profile. The selected
mode answers ordinary product-metadata questions from the real, currently
published GenesisRAG17-backed corpus instead of the existing synthetic fixture.
It keeps the fixture as the legacy default, and introduces no production path,
new product identity, new canonical requirement, or change to the stock and
price owners.

The canonical requirement remains FR-079 in FEAT-004. FR-235 owns LINE corpus
grounding, SDD-099 its in-process query implementation, and SEC-032 the scoped
corpus boundary. FR-291 retains deterministic handling of stock and price
questions. GenesisRAG17's accepted wire and publication contracts remain owned
by their existing sources; this proposal does not authorize direct store access,
a new RAG service, or bypassing GKS/MSP/worker authority.

## Approval and canonical migration scope

The user's direct instruction on 2026-10-24 was:

> “ทำต่อ เชื่อม LINE กับ GenesisRAG17 ให้ Ollama ดึงข้อมูล TEST ONLY จาก RAG จริงแทน fixture กรองข้อมูลก่อนส่งให้โมเดล คงการตรวจราคาและสต็อกเดิม ปรับเอกสาร เขียนโค้ด ทดสอบ แล้ว deploy main-dev ใช้ Luna Max เท่านั้น”

This authorizes the bounded main-dev design, same-ID FR-079 reviewed source-row migration, implementation, testing and main-dev deployment described here. The migration preserves FR-079's identity, subject anchor, FEAT-004 membership, version-1 record key and reviewed-migration lifecycle. Its previous approved migration proposal remains unchanged as historical approval evidence. The canonical record binds this revision to base aa82e3058e81fddf793d18795bee660b40945263 and this approved proposal.

No requirement ID is issued or repurposed. Existing FR-291 rules continue to own stock and price; FR-235's corpus reader and budget remain the grounding contract. Approval here does not establish that code, tests, RAG retrieval, LINE delivery or deployment have completed, and does not authorize production activation.

## Bounded source profile

The existing default-off MAIN_DEV_LOCAL_OLLAMA profile remains enabled only by
its current explicit server configuration. The existing TEST_ONLY_FIXTURE
source remains its default. GENESISRAG17_TEST_ONLY is a separately enabled
server-side source mode for the same bounded main-dev test profile; selecting it
replaces the fixture for that request and never silently falls back to the
fixture or to an unrestricted corpus.

The existing guards remain in force: the Server proves the actual main-dev
database through its Prisma-backed connection, verifies the resolved Tenant,
Business and internal LINE OA account ID against separate server-side
allowlists, uses the existing Prisma-backed primary-connection resolver,
preserves Business model-key precedence under ADR-100 D5, and accepts only the
exact configured http://host.docker.internal:11434 Ollama origin and selected
installed model. SERVER execution remains required. Production LINE, other
environments, credentials, provider behavior and primary-connection
CAS/uniqueness are unchanged.

Persisted LineOaAccount.knowledgeGrounding and the private main-dev profile must
both select this mode: the persisted account must be GKS_CORPUS and the matching
server-private profile must be GENESISRAG17_TEST_ONLY. Reject
GKS_THEN_BUSINESS_KNOWLEDGE, BUSINESS_KNOWLEDGE, any account/profile mismatch,
memory opt-in or grounding shadow. A caller, message, model or retrieved
document cannot choose a Tenant, Business, Product, source, source ID, origin,
grounding mode or principal. No client-facing API or UI selection exposes the
internal source allowlist.

## Retrieval, lineage and model projection

The selected profile calls queryKnowledgeCorpus in process through the existing
knowledge.query reader under the scoped runtime knowledge capability. It passes
a server-derived list of 1–8 UUID source IDs through internal options.sourceIds
before corpus snapshot selection and native search. The query path must enforce
this source filter before it opens or queries a snapshot; a post-query filter is
insufficient.

Each server-configured allowlist entry binds one exact internal Product UUID
and Product code/SKU to one sourceId, ingestionId, accepted PCAT FileAsset byte
SHA-256 and current corpus manifest SHA-256. A selector match, vector result,
citation string or Product code by itself is not proof. Before composition, the
Server verifies that the source is a member of the current published generation
and manifest, the accepted PCAT asset bytes and receipt hashes match, the
structured ProductMaster lineage resolves to the same live Product under the
job's Tenant and Business, and the exact internal Product UUID/code pair is
allowlisted. The unit comes from that exact live Product row because ProductMaster
does not carry a unit. Unknown, extra, stale, unpublished, revoked, foreign or
mismatched evidence is unavailable.

Validate the accepted ProductMaster/PCAT source against its existing strict
schema and lineage inside the trusted reader; do not serialize that source or a
full FR-047 record to the model. The separate bounded public prompt projection
contains only product_code, name, unit from the exact live Product row,
sell_price null, currency null, moq null, an empty specification object, and
one bounded citationId navigation reference. ProductMaster does not carry unit.
Do not invent approval timestamps or as-of fields absent from this projection. The accepted citationId resolves only to its
approved source navigation target. SourceId, ingestionId, snapshotId,
manifestHash and all other retrieval/provenance fields remain outside
serialized model records. Reject CUSTOM_COMPONENT and dedicated Customer or
SalesOrder records. The public-string validator accepts Thai combining marks.
Do not send raw passage text, source files, embeddings, costs, stock or data
from an unapproved source. Keep the FR-235/SDD-099 query budget: 2,500 ms, five
results and an 8 KiB answer packet. Trace EVIDENCE_SELECTED with reason, budget
and content-free retrieval references/digests without query or projected values.
FR-171 CONTEXT_COMMITTED retains the exact sanitized model request under existing
retention and erasure. Raw PCAT/corpus passages never enter any trace.

The persisted account mode, private profile, exact source allowlist, current
manifest, accepted source lineage and live Product identity are checked before
model generation and again after generation. The existing TOOL_RESULT journal
and final send-fence revalidation bind delivery without a schema addition. A
changed profile, source, manifest, Product, scope or result invalidates the
in-flight answer. Empty, invalid or failed reader evidence yields only the fixed NO_EVIDENCE text,
records a content-free denied binding in the existing TOOL_RESULT journal and
makes no model call. This mode has no fixture or broad-corpus fallback. If a
profile, source, manifest, Product, scope or result changes or an error is
observed after generation, existing final send-fence revalidation suppresses
the stale answer before dispatch.

FR-291's deterministic stock/price intent guard runs before ordinary model
routing. Recognized stock and price requests continue through the existing
owner-controlled readers and formatters, outside Ollama. Neither this proposal
nor the RAG projection changes quantity, price, ATP, quotation, tax, customer
authorization or source-publication rules.

## Acceptance checklist

- GENESISRAG17_TEST_ONLY is off unless the server-side main-dev profile and
  exact database, Tenant, Business and OA allowlists match; the legacy fixture
  mode remains the default.
- Source selection accepts only 1–8 valid, server-selected UUIDs and is applied
  before snapshot/native queries. No request field or caller-selected source
  reaches the query options.
- Only an exact allowlisted Product UUID/code with current sourceId,
  ingestionId, FileAsset digest, manifest digest, accepted PCAT bytes,
  structured ProductMaster lineage and live Product identity can contribute
  metadata; unit is read from that live Product.
- Model-input tests prove the minimal prompt record contains only product_code,
  name, unit, null price fields, empty specification and a bounded citationId;
  retrieval/provenance IDs stay outside serialized model records. Reject
  CUSTOM_COMPONENT and dedicated Customer/SalesOrder records, and accept Thai
  combining marks in otherwise permitted public strings.
- Empty, invalid or failed reader evidence yields only fixed NO_EVIDENCE text,
  records a content-free denied binding, makes no model call and never falls
  back to the fixture or broad corpus. The legacy fixture path still passes its
  existing regression cases.
- Revocation and source/manifest/Product/profile changes between lookup,
  generation and dispatch suppress the old answer. Concurrent jobs across
  different scopes or allowlists cannot mix results.
- Focused unit and integration tests plus isolated actual-PostgreSQL tests cover
  the source filter, lineage, failure paths, revocation, concurrency and
  no-model rule.
- Actual retrieval from the current GenesisRAG17-backed published generation in
  main-dev is a separate acceptance item requiring content-free trace/source
  references and matching accepted lineage. A real LINE delivery receipt is
  another separate item. Passing local or PostgreSQL tests alone proves neither.
- Run relevant governance, focused checks, build and exact-head independent
  review before deploying the tested artifact to isolated main-dev. Record
  commands and results; do not stage generated registry views by hand or infer
  production acceptance.

## Implementation plan and file ownership

1. **Knowledge query worker — TDD scope only:** add internal options.sourceIds
   validation for 1–8 UUIDs and apply the filter before snapshot/native query
   selection in the existing Knowledge query path. Add focused tests for bounds,
   invalid UUIDs, exact selection and refusal to query outside the list. This
   worker owns only the Knowledge query adapter and its tests; it does not expose
   source selection to an API or UI.
2. **Root integrator — source reader and LINE composition:** add
   apps/server/src/modules/agent/main-dev-test-rag-knowledge.js; update
   apps/server/src/modules/agent/main-dev-local-ollama.js,
   phase1-runtime.js and server-line-answer.js. Preserve the existing fixture as
   the default. Add only server-side mode selection and exact source/Product/
   lineage validation, sanitized FR-047 projection, content-free trace
   references, budgeted query, and pre/post-generation revalidation. Change
   LocalOllamaModelCard only if a non-sensitive display of the server-selected
   mode is required; it must never accept source IDs or scope from the client.
   Bind delivery through the existing TOOL_RESULT journal and send-fence checks;
   do not add a schema.
3. **Tests:** write failing unit tests first, then integration tests for the
   connected profile and source filter, and isolated actual-PostgreSQL coverage
   for scope and revocation. Keep stock/price regression tests deterministic and
   assert that those requests do not call Ollama. Run the actual RAG and LINE
   receipt acceptance separately.
4. **Review and deployment:** root integrates the docs and code, serially runs
   the sanctioned registry/projection workflow and governance, completes scoped
   tests/build, obtains independent Luna Max review of the composed patch, and
   deploys only to isolated main-dev under the existing deployment boundary.
   Record actual RAG evidence and the LINE provider delivery receipt separately.

## Canonical amendment

The approved same-ID reviewed migration is the following exact FR-079 row. It
preserves the current subject and FEAT-004 membership; the integrator's
sanctioned document-registry workflow computes and publishes the row digest and
generated projections.

### `ZAI:FR-079`

```text
| FR-079 | Phase 1 LINE runtime connection cut-over: after the server-owned LINE binding resolves the trusted Tenant/Business scope, the runtime keeps the existing Business-key-first behavior and selects exactly one ACTIVE PRIMARY PHASE1_LINE_LLM IntegrationConnection under that scope when no Business model key applies. The existing credentialed connection path resolves its opaque secretRef through the configured provider-neutral SecretManagerPort before the ModelProviderPort call. The default-off MAIN_DEV_LOCAL_OLLAMA profile may instead use a Business-owner-selected installed Ollama model without a secretRef or credential only when the Server verifies the actual main-dev database identity through its Prisma-backed connection and verifies the resolved Tenant, Business, and internal LINE OA account ID against separate server-side allowlists. It uses the existing Prisma-backed resolvePhase1PrimaryConnection. The legacy TEST_ONLY_FIXTURE remains the default local-profile knowledge source. A separately enabled GENESISRAG17_TEST_ONLY knowledge source may replace that fixture only under the same verified main-dev profile, scope, exact server-configured origin and model guards, and only when the Business MODEL_PROVIDER_KEY does not apply under unchanged ADR-100 D5 precedence. This source mode requires both the persisted LineOaAccount.knowledgeGrounding value GKS_CORPUS and the matching private server profile GENESISRAG17_TEST_ONLY; it rejects GKS_THEN_BUSINESS_KNOWLEDGE, BUSINESS_KNOWLEDGE, any profile/account mismatch, memory opt-ins and grounding shadow. Execution remains SERVER and no caller may select source IDs, products, scope or origins. It calls queryKnowledgeCorpus in process through the existing knowledge.query reader and scoped runtime knowledge capability, passing a server-selected allowlist of 1–8 source UUIDs in internal options.sourceIds before corpus snapshot/native queries. Each allowed binding pins one internal Product UUID and exact Product code/SKU to one sourceId, ingestionId, accepted PCAT FileAsset SHA-256 and current corpus manifest SHA-256. Before model composition, the Server verifies current published-generation membership, manifest and source-receipt/PCAT bytes, structured ProductMaster lineage and the live Product identity under the trusted Tenant and Business. It rejects CUSTOM_COMPONENT and dedicated Customer or SalesOrder records. Thai combining marks remain valid in permitted public Product strings. Names require a TEST ONLY prefix and a trimmed bounded label without control/invisible characters or known instruction phrases; unit is one bounded token. These syntax checks supplement exact immutable source pins, not a universal instruction classifier. Verify the existing producer shape code/externalId commerce-sku:<Product UUID> and nameTh <SKU> — <Product.name>, then project the exact bound Product.name. The accepted ProductMaster/PCAT source is validated against its existing strict schema and lineage inside the reader, then a separate bounded public prompt projection (not the full FR-047 record) contains only product_code, name, unit from the exact live Product row, sell_price null, currency null, moq null, specification empty and one bounded citationId navigation reference; do not invent approval timestamps or as-of fields absent from this projection. ProductMaster does not supply unit. Only citationId may navigate to the accepted source; sourceId, ingestionId, snapshot and manifest IDs stay outside serialized model records. Raw source text/files, costs, other source/provenance references and unapproved sources never reach Ollama. Retrieval retains FR-235/SDD-099's 2 500 ms, five-result and 8 KiB answer budget and records content-free EVIDENCE_SELECTED retrieval references and digests without query or projected values. FR-171 CONTEXT_COMMITTED retains the exact sanitized model request under existing retention and erasure; raw PCAT/corpus passages never enter any trace. Empty, invalid or failed reader evidence yields only the fixed NO_EVIDENCE text, records a content-free denied binding in the existing TOOL_RESULT journal and makes no model call; there is no fixture or broad-corpus fallback. The persisted account mode, private profile, source allowlist, current manifest, accepted source lineage and Product are revalidated before model generation and after generation; the existing TOOL_RESULT journal and final send-fence revalidation bind delivery without a new schema. A revocation, change or failed revalidation after generation suppresses the stale answer at the existing send fence. FR-291's deterministic stock/price intent guard and owner reads remain outside the model and unchanged. The fixture path, exact configured http://host.docker.internal:11434 origin, Prisma-backed primary resolver, one-active-primary CAS/uniqueness gate, trusted OA account binding, SERVER execution, provider behavior and production rejection of local credentials/Ollama remain unchanged. Any invalid database/scope/profile, missing or extra source, source/manifest/lineage/Product mismatch, disabled guard, Ollama failure or invalid response fails closed without automatic fallback. | 🟠 approved design; implementation, tests, main-dev actual-RAG and LINE-send evidence pending |
```

## Approval

The approval provenance is the direct user instruction quoted above, received
2026-10-24. It covers this bounded design and delivery to main-dev. It does not
extend to production or claim that implementation, verification or delivery
evidence exists before those events are recorded.

## Version diff

0.0 → 0.1.0: adds the approved, default-off main-dev GenesisRAG17 TEST ONLY
source option to FR-079 while preserving its identity and existing stock/price
owners. It does not add an ID or authorize production behavior.
