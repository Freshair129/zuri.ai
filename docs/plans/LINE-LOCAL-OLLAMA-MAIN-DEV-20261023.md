---
doc_type: implementation-plan
id: ZAI:LINE-LOCAL-OLLAMA-MAIN-DEV-PLAN-20261023
status: approved
version: "0.3.1"
date: "2026-10-23"
relations:
  - type: references
    target: ../change-requests/integration/LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md
  - type: references
    target: ZAI:FR-079
  - type: references
    target: ZAI:FR-080
  - type: references
    target: ZAI:FEAT-045
  - type: references
    target: ZAI:FR-265
  - type: references
    target: ZAI:FR-266
  - type: references
    target: ZAI:ADR-100
---

# Main-dev LINE local Ollama implementation plan

**Status:** The bounded TEST ONLY fixture contract is approved and its reviewed
`FR-079`/`FR-080` source-row migration and generated projections are applied.
The owner discovery/selection API and UI have focused 38-test coverage; the
fixture helper, runtime integration, and Server answer path pass 119 focused
tests. Independent runtime review found no remaining P1/P2. Private overlay
configuration and live acceptance remain pending. Nothing here changes production provider
behavior or claims deployment or a successful Ollama/LINE conversation.

## Goal and boundaries

Let a trusted Business owner list installed Ollama models and select one for
server-executed ordinary chat on the allowlisted main-dev LINE OA, with no paid
provider key. `NODE_ENV=production` stays as set by the main-dev Docker build.
The existing `PRODUCTION_LINE` profile keeps rejecting Ollama, local vaults, and
raw credentials. Public provider selection continues through the existing
write-only `apiKey` route and FR-266; PRP remains governed by FR-267 and ADR-100
D7. No new application table, Edge path, MSP-memory path, or production change
is in scope. The local test profile uses a dedicated, operator-configured,
read-only fixture built from the existing synthetic TEST ONLY PCAT product
metadata. It does not read GKS/corpus text, the production-pinned `zuri_core`
source, Supabase, or product/stock/price tables. The existing Prisma-backed
IntegrationConnection resolver remains the source for the selected model;
Prisma is also used for the expected database identity and trusted application
scope checks. The current Prisma application role may be broader than this
feature needs; this plan does not describe it as least-privilege. Ollama
receives no database or storage connection or credentials.

The `#product` fact flow remains a separate deterministic path. Its existing
stock and published-price acceptance must make zero Ollama/model calls. A
separate ordinary-chat acceptance must trace a real server-side Ollama
invocation. Passing either case does not imply passing the other. ADR-100 D5
remains in force: the designated test Business must have no existing
`MODEL_PROVIDER_KEY`; the local profile must not shadow or reorder an existing
Business-key connection, and a present key blocks local-Ollama acceptance.

## Private main-dev configuration

The server profile is default-off and reads only server-side configuration. Use
the following shape in the ignored main-dev overlay; place all actual database,
Tenant, Business, and internal LINE OA account identifiers there, never in
tracked application defaults or browser fields:

```text
ZURI_PHASE1_RUNTIME_SOURCE=MAIN_DEV_LOCAL_OLLAMA
ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED=false
ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE=<private expected database name>
ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS=["<tenant UUID>"]
ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS=["<Business UUID>"]
ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS=["<internal LINE OA account UUID>"]
ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL=http://host.docker.internal:11434
ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH=<absolute private read-only fixture path>
ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256=<64 lowercase hex SHA-256>
ZURI_MODEL_TIMEOUT_MS=25000
```

Before listing, selecting, or invoking a local model, compare
`current_database()` from the Prisma-backed main-dev application connection
with the private expected name and validate the server-resolved Tenant,
Business, and internal OA account against separate allowlists. Do not treat the
current Supabase-pinned `ZURI_LINE_DB_URL` as the main-dev database or use it for
the local profile.

The ordinary-chat source is a private, read-only JSON fixture produced by the
root-owned main-dev setup from the existing synthetic TEST ONLY PCAT product
metadata. The fixture builder and runtime reader use only this metadata and
never open or query the source price list or stock. Its versioned envelope is
labeled `TEST_ONLY_PUBLIC` and carries the
exact Tenant, Business, and internal LINE OA account IDs. The fixture's
absolute path is server configuration, never a browser value or URL. Require a
local path and reject UNC/network locations, symlinks or reparse points in any
path component, and non-regular files. Read raw bytes with a hard 64 KiB cap
(using at most one extra sentinel byte to reject overflow), hash the complete
accepted bytes and compare the separately configured expected digest, then
parse. Only after parsing enforce a maximum of eight Product records and the
strict envelope/schema/scope. Reject changed hashes, unknown envelope
versions/classifications, scope mismatches, extra record fields,
non-Product/inactive rows, and any record that does not pass the existing
FR-047 BusinessKnowledge contract.
Preserve the source reference and source digest from the real TEST ONLY PCAT
fixture as provenance. For this test projection, `sell_price`, `currency`, and
`moq` are null and there are no price-list or stock fields; no price or stock
facts are generated or queried. This synthetic fixture is authorized only for
the scoped main-dev test; it does not classify any real Business data as
customer-public or authorize a production data path.

Reuse `parseBusinessKnowledgeQuery` and the existing in-memory
`createInMemoryBusinessKnowledgeReader` for the registered product search,
detail, and compare queries. The runtime accepts only the selected test OA's
`BUSINESS_KNOWLEDGE` setting and supplies this fixture reader through the
existing answer-budget composer. It refuses GKS/corpus modes and shadow
grounding, thread or episodic memory enabled in configuration, and per-job
memory opt-ins. Specifically, it rejects
`ZURI_MSP_THREAD_MEMORY_ENABLED=true`,
`ZURI_MSP_EPISODIC_MEMORY_ENABLED=true`, per-job `memorySyncOptIn=true` or
`episodicMemoryOptIn=true`, and `knowledgeGroundingShadow=true`. No GKS wrapper,
private chunk, memory packet, or shadow read may reach this model. The
`#product` fact path remains separate and continues to use
its existing persisted stock and receipt-backed published-price readers with
zero Ollama/model calls. Ollama receives only the Server-built bounded
test-fixture evidence packet and no database or object-storage credentials.
The profile is not inferred from `NODE_ENV`; absent, empty, malformed, or
mismatched inputs disable the feature.
For this profile only, the Ollama generation request disables thinking and caps
output at 256 tokens to keep the LINE turn bounded. A token-limit completion is
rejected rather than delivering a partial answer. Legacy evaluation and public
provider options remain unchanged. These are server-side constants, never
connection metadata or browser inputs; see the
[Ollama generate contract](https://docs.ollama.com/api/generate).
Accept only the exact server-configured
`http://host.docker.internal:11434` origin, without redirects or any
browser/metadata-selected endpoint. This runtime source takes its model only from
the scoped `PHASE1_LINE_LLM` connection and does not require or accept the legacy
single-model `ZURI_MODEL_PROVIDER`/`ZURI_MODEL_NAME`/`ZURI_MODEL_CREDENTIAL`
configuration. It must keep the existing Business-key-first resolver unchanged;
if a `MODEL_PROVIDER_KEY` exists, it wins under ADR-100 D5 and the local test is
not accepted as Ollama inference.

## Delivery sequence

1. **Reviewed document migration — complete.** The approved change proposal
   migrated only the existing `FR-079` and `FR-080` wrappers. The `FEAT-045`
   row remains unchanged from its prior migration. IDs, leading anchors, source
   paths, FEAT membership, and the ID ledger were preserved; the root integrator
   applied the registry, graph, views, and governance projections serially.
2. **Add the profile guard and main-dev composition.** In
   `apps/server/src/modules/agent/phase1-runtime.js` and
   `apps/server/src/modules/agent/server-line-answer.js`, add an explicit
   main-dev-only runtime composition that does not weaken `PRODUCTION_LINE`,
   verifies the expected database using the local Prisma connection, uses the
   existing Prisma-backed `resolvePhase1PrimaryConnection`, and injects the
   pinned TEST ONLY fixture reader instead of any GKS/corpus reader. Do not
   instantiate or require `ZURI_LINE_DB_URL` for this profile's model
   connection or Knowledge reads. Require `BUSINESS_KNOWLEDGE` for the test OA
   and reject GKS/corpus modes, grounding shadow, thread/episodic memory
   configuration, and per-job memory opt-ins. Bound fixture reads to 64 KiB and
   eight records, verify its separately configured SHA-256, and enforce exact
   Tenant/Business/OA scope plus the FR-047 Product schema with null price,
   currency, and MOQ and no stock fields. Do not send database/storage
   credentials or any live GKS content to the model. Do not require the legacy
   single-model environment trio or create a global legacy provider; retain the
   existing Business-key-first resolution and fail the local test if a Business
   `MODEL_PROVIDER_KEY` is present. In
   `apps/server/src/modules/agent/model-provider.js`,
   allow the fixed Docker-host Ollama origin only for that source, reject
   browser/connection-metadata origins, bound `/api/tags` and generation requests,
   and retain fail-closed behavior. Keep Ollama out of
   `apps/server/src/modules/agent/model-provider-catalog.js`'s public provider
   list and out of `MODEL_PROVIDER_CODES`.
3. **Add owner-scoped discovery and selection.** Add
   `apps/server/src/modules/integration/application/local-ollama-selection-service.js`
   and two separate local-profile routes:
   `GET /api/integration/local-ollama/models` at
   `apps/server/src/app/api/integration/local-ollama/models/route.js`, and
   `POST /api/integration/local-ollama/selection` at
   `apps/server/src/app/api/integration/local-ollama/selection/route.js`.
   The list returns only validated installed model IDs; selection accepts only
   `{ "modelId": "<listed ID>" }`. Both endpoints derive scope from trusted
   Business authority and server configuration. Keep their service separate
   from `apps/server/src/modules/integration/application/integration-management-service.js`
   and `model-provider-credential-service.js`. Do not relax
   `apps/server/src/app/api/integration/model-providers/route.js` or its required
   `apiKey`. Add a local-only section to
   `apps/server/src/app/(pm)/platform/integrations/page.jsx` that appears only
   when the server profile is enabled and the signed-in owner has the exact
   Business scope. The server returns validated installed model IDs and accepts
   only a listed ID. Store only that ID in existing `IntegrationConnection`
   `metadataJson`; create no `IntegrationCredential` or fake `secretRef`. Use the
   existing `promotePhase1PrimaryConnection()` CAS/uniqueness path in
   `apps/server/src/platform/integrations/core/integration-registry.js` for the
   allowlisted test connection, retaining current LINE readiness gates. Keep
   this profile scoped to the actual main-dev Prisma database, not `ZURI_LINE_DB_URL`.
   Refuse
   this local choice when a Business model key exists, preserving ADR-100 D5.
4. **Exercise the actual conversation boundary.** Ordinary chat continues through
   the Server-owned LINE path in
   `apps/server/src/modules/line-oa-studio/application/server-line-runtime.js`
   and Phase-1 runtime. Keep the existing model error behavior in
   `apps/server/src/modules/agent/grounded-business-answer.js`: stopped Ollama,
   missing model, timeout, or invalid output fails closed with no deterministic
   or public-provider fallback. Keep product-fact routing in
   `apps/server/src/modules/line-oa-studio/application/line-product-facts-decision.js`
   independent of local model selection. Carry the trusted internal OA account
   ID derived from the verified job/account binding through
   `apps/server/src/modules/agent/server-line-answer.js` to `resolveModel`;
   today that call supplies only `{ tenantId, businessId }`. Never source the ID
   from inbound content, browser input, or provider metadata. The allowlist check
   must deny a different OA even when it belongs to the same Business.

## Regression checks

Extend the existing focused tests rather than changing the keyed provider tests'
meaning:

- `apps/server/tests/unit/fr079-runtime-cutover.test.js` and
  `apps/server/tests/unit/model-provider-port.test.js`: default-off, actual
  Prisma database identity (not the Supabase URL), profile-specific Prisma
  connection/TEST ONLY fixture composition, existing runtime-source behavior unchanged,
  allowlist mismatch, production denial, exact endpoint, URL/redirect rejection,
  no secret, and Ollama failure without fallback.
- `apps/server/tests/unit/fr080-integration-management.test.js`,
  `apps/server/tests/unit/fr080-ui-contract.test.js`, and a focused test for the
  new `apps/server/tests/unit/local-ollama-selection-service.test.js`:
  Business-owner authorization, cross-tenant/
  Business denial and same-Business cross-OA denial, validated `/api/tags` model list, selection of only a listed
  model, metadata-only persistence, one active primary, and no credential write.
- `apps/server/tests/integration/fr266-model-provider-credential.test.js` and
  `apps/server/tests/unit/platform/model-provider-admin-port.test.js`: existing
  API-key flows still require and validate `apiKey`; Ollama is not added to the
  public/keyed allowlist.
- `apps/server/tests/unit/grounded-business-answer.test.js`,
  `apps/server/tests/unit/model-provider-trace.test.js`, and
  `apps/server/tests/unit/phase1-business-agent-runtime.test.js`: ordinary chat
  traces the selected local model for an evidence-bearing registered query;
  empty evidence correctly produces `not-called` and cannot count as inference;
  actual inference failures never fall back. Cover exact fixture hash and scope,
  TEST ONLY classification, metadata-only Product projection, and refusal of
  GKS/corpus, memory opt-ins and shadow grounding.
- `apps/server/tests/integration/conversation-runtime-product-facts-vertical.test.js`
  and `apps/server/tests/integration/line-product-facts.test.js`: authorized
  `#product` facts still use their persisted stock and receipt-backed published
  price sources and make zero Ollama/model calls. This remains separate from the
  ordinary-chat inference proof.

## Main-dev acceptance

After the focused checks and main-dev build pass, use the existing Business-owner
UI and already connected test OA:

1. Confirm the running server still has `NODE_ENV=production`, the profile is
   default-off outside its private overlay, `current_database()` matches the
   configured expected database, only the configured Tenant/Business/OA IDs pass
   the scope check, and no `MODEL_PROVIDER_KEY` exists for the test Business.
2. From the Business-owner UI, list the actually installed models and select
   one. Verify the existing connection is the single active primary, stores only
   the exact model ID, and has no provider credential or secret reference.
3. Choose a registered ordinary-chat query that matches the product metadata in
   the SHA-pinned TEST ONLY fixture. Verify the bounded evidence packet is
   non-empty and carries only test Product metadata before sending the query to
   the allowlisted test OA; a greeting/no-evidence query is not a valid
   inference test because `answerBusinessQuestion` correctly skips the model in
   that case. Capture the provider/model trace and actual delivered test
   response; verify it used Ollama on the Server, included no price/MOQ/stock
   claim, and did not use a paid provider key. Stop Ollama or remove the selected
   model and verify the request fails closed with no fallback.
4. Separately, run the `#product` acceptance against real persisted stock and
   published price evidence. Verify the customer answer uses those sources and
   the local model invocation count remains zero.
5. Verify a non-allowlisted OA, including another OA in the same Business, a
   Business owner from another scope, mismatched database, and production
   `PRODUCTION_LINE` cannot list or select Ollama or route inference to it.

Record the selected model/version and trace evidence without credentials. This
is main-dev acceptance only; it does not prove production activation or alter
the production OA webhook.

## Test-only source boundary

The user selected TEST ONLY products for this main-dev inference test. The
fixture is built by the root-owned private setup from the existing synthetic
main-dev PCAT product metadata; the price list and stock are excluded. It is
bound to the private main-dev Tenant, Business, and LINE OA IDs and pinned by a
separate exact SHA-256 value. The FR-047 `PUBLIC` sensitivity field validates
the record shape; the envelope's `TEST_ONLY_PUBLIC` classification limits this
synthetic disclosure to the scoped main-dev test and does not classify real
Business data as customer-public.

Do not substitute the SmartGift code fixture, a GKS chunk, an arbitrary corpus
publication, a Supabase query, or production-pinned `zuri_core` source. A missing
or mismatched fixture keeps the profile disabled. The accepted published-price
`#product` response remains separately grounded in persisted stock and
receipt-backed price evidence and continues to make zero model calls; that
acceptance does not prove local ordinary-chat inference.

## Status and remaining work

The bounded profile scope and ADR-100 D9 amendment are approved under the
user's main-dev request and root integration review. The revised TEST ONLY
fixture contract has independent approval, and the reviewed `FR-079`/`FR-080`
wrappers plus generated projections are applied. The owner discovery/selection
API and UI pass 38 focused tests. The profile/scope helper, bounded Ollama
transport, pinned fixture reader, Phase-1 runtime, and Server answer path pass
119 focused tests. These results cover production-source denial, key presence
without secret resolution, scope mismatch, no-memory/no-corpus composition,
redirect and size limits, and fail-closed invalid model output.

Independent review approved the runtime patch with no P1/P2 findings. Private
overlay configuration and live main-dev ordinary-chat acceptance remain
pending. The local profile has not been reported as deployed or LINE-accepted.
The separate LINE Studio color fix was delivered in PR #729 and does not
activate this profile.

Version 0.3.0 replaces the customer-public/GKS source assumption with the
user-selected synthetic TEST ONLY PCAT metadata fixture and its hash/scope
boundary. It creates no requirement, ID, table, provider credential, or
roadmap state.

Version 0.3.1 records independent implementation review, profile-only bounded
non-thinking generation, and the separation from pending live LINE acceptance.
