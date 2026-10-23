---
doc_type: implementation-plan
id: ZAI:LINE-LOCAL-OLLAMA-MAIN-DEV-PLAN-20261023
status: approved
version: "0.2.0"
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

**Status:** Approved for bounded main-dev implementation. The canonical
migration and ADR-100 D9 have received independent review and acceptance. This
plan does not change production provider behavior or roadmap status, and no
Ollama implementation, configuration, or LINE acceptance is claimed.

## Goal and boundaries

Let a trusted Business owner list installed Ollama models and select one for
server-executed ordinary chat on the allowlisted main-dev LINE OA, with no paid
provider key. `NODE_ENV=production` stays as set by the main-dev Docker build.
The existing `PRODUCTION_LINE` profile keeps rejecting Ollama, local vaults, and
raw credentials. Public provider selection continues through the existing
write-only `apiKey` route and FR-266; PRP remains governed by FR-267 and ADR-100
D7. No new application table, Edge path, MSP-memory path, or production change
is in scope. Reuse the existing Prisma-backed IntegrationConnection resolver
and published-corpus reader for this explicit profile; do not add a database
role, broad read grant, or alternate source unless a separate reviewed design
shows the existing scoped reader cannot meet the boundary. The current Prisma
application role may be broader than this feature needs; this plan does not
describe it as least-privilege. Ollama receives no database or storage
connection or credentials.

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
```

Before listing, selecting, or invoking a local model, compare
`current_database()` from the Prisma-backed main-dev application connection
with the private expected name and validate the server-resolved Tenant,
Business, and internal OA account against separate allowlists. Do not treat the
current Supabase-pinned `ZURI_LINE_DB_URL` as the main-dev database or use it for
the local profile. For the allowlisted test OA, compose the existing
`PHASE1_LINE_LLM` resolver from Prisma (`resolvePhase1PrimaryConnection`) and the
existing `createCorpusKnowledgeReader`/`queryKnowledgeCorpus` in `GKS_CORPUS`
mode; do not instantiate the production-pinned `zuri_core` reader or query
through `ZURI_LINE_DB_URL`. Configure the test OA through the existing account
setting for `GKS_CORPUS`; default `BUSINESS_KNOWLEDGE` and
`GKS_THEN_BUSINESS_KNOWLEDGE` are not accepted in this profile because they
can access the Supabase-backed reader or fall back to it. The selected corpus
reader is Business-scoped and returns a bounded evidence packet. Keep customer
disclosure at the existing source authorization boundary: Business-owner
visibility or corpus publication alone does not authorize customer disclosure.
Only evidence already eligible under the customer-public source contract may
reach the answer path. The Server may use its existing app connection through
these scoped application ports, but it does not pass database or object-storage
credentials to Ollama; the model receives only the Server-built prompt/evidence
packet. The profile is not inferred from
`NODE_ENV`; absent, empty, malformed, or mismatched inputs disable the feature.
Accept only the exact server-configured
`http://host.docker.internal:11434` origin, without redirects or any
browser/metadata-selected endpoint. This runtime source takes its model only from
the scoped `PHASE1_LINE_LLM` connection and does not require or accept the legacy
single-model `ZURI_MODEL_PROVIDER`/`ZURI_MODEL_NAME`/`ZURI_MODEL_CREDENTIAL`
configuration. It must keep the existing Business-key-first resolver unchanged;
if a `MODEL_PROVIDER_KEY` exists, it wins under ADR-100 D5 and the local test is
not accepted as Ollama inference.

## Delivery sequence

1. **Apply the approved document migration.** Use
   [the approved change proposal](../change-requests/integration/LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md),
   then migrate only `FR-079`, `FR-080`, and `FEAT-045` as reviewed existing-row
   wrappers. Preserve their IDs, leading anchors, source paths, FEAT membership,
   and the ID ledger. The supported projection command is
   `npm run docs:registry`; run `npm run docs:graph`, `npm run docs:views`, and
   `npm run govern` serially afterward. Do not use the new-record registration
   or ID-allocation workflows.
2. **Add the profile guard and main-dev composition.** In
   `apps/server/src/modules/agent/phase1-runtime.js` and
   `apps/server/src/modules/agent/server-line-answer.js`, add an explicit
   main-dev-only runtime composition that does not weaken `PRODUCTION_LINE`,
   verifies the expected database using the local Prisma connection, and uses
   the existing Prisma-backed `resolvePhase1PrimaryConnection` instead of the
   Supabase-pinned `resolvePhase1PrimaryConnectionByQuery`. Do not instantiate
   or require `ZURI_LINE_DB_URL` for this profile's model connection or
   Knowledge reads. The test OA must use its existing `GKS_CORPUS` account
   setting; reject `BUSINESS_KNOWLEDGE` and
   `GKS_THEN_BUSINESS_KNOWLEDGE` for this profile, so the Supabase-backed reader
   and fallback cannot run. Preserve the scoped corpus reader and existing
   customer-disclosure boundary; do not broaden corpus visibility or send
   database/storage credentials to the model. Do not require the legacy
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
  connection/corpus composition, existing runtime-source behavior unchanged,
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
  actual inference failures never fall back. Cover corpus scope and customer-
  public evidence eligibility without making Business-private corpus material
  eligible for customer disclosure.
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
3. Choose a registered ordinary-chat query that matches real searchable,
   published evidence already eligible under the customer-public source
   contract. Verify the evidence packet is non-empty before sending it to the
   allowlisted OA; a greeting/no-evidence query is not a valid inference test
   because `answerBusinessQuestion` correctly skips the model in that case.
   Capture the provider/model trace and the actual delivered response; verify it used Ollama on the Server
   and did not use a paid provider key. Stop Ollama or remove the selected model
   and verify the request fails closed with no fallback.
4. Separately, run the `#product` acceptance against real persisted stock and
   published price evidence. Verify the customer answer uses those sources and
   the local model invocation count remains zero.
5. Verify a non-allowlisted OA, including another OA in the same Business, a
   Business owner from another scope, mismatched database, and production
   `PRODUCTION_LINE` cannot list or select Ollama or route inference to it.

Record the selected model/version and trace evidence without credentials. This
is main-dev acceptance only; it does not prove production activation or alter
the production OA webhook.

## Current source-reader limitation

Read-only inspection of main-dev and the source at `fa10e309` found that the
existing GKS corpus capability is Business-scoped but does not itself classify
chunk text as customer-public. `genesisrag17-contract.js` uses private storage
visibility, and `corpus-knowledge-reader.js` returns chunks without a disclosure
classification. Neither private storage visibility nor publication alone grants
customer disclosure. The existing `business-contract.js` has an explicit
`PUBLIC` projection, while its current PostgreSQL reader depends on the separate
production-pinned `zuri_core` runtime that is absent in main-dev.

This is an unresolved implementation prerequisite, not permission to copy the
production migrations or send arbitrary GKS chunks to Ollama. Keep the local
profile disabled for real LINE ordinary-chat inference until a reviewed source
reader satisfies the approved customer-public contract. Helper/provider tests
using synthetic packets do not close this gate. The real published-price
`#product` response was independently delivered and confirmed by the user; that
zero-model command remains separate and does not close this inference gate.

## Status and remaining work

The bounded design, canonical migration, and ADR-100 D9 amendment are approved.
The source-row wrappers and generated projections have been reviewed and
regenerated serially. The preparatory profile/scope helper and source-specific
Ollama provider transport passed 60 focused tests, independent review and the
Server build. Those tests include production-source denial, keyed-provider
rejection, scope mismatch, redirect rejection, request/response limits and
cancellation of an unread oversized response.

Owner discovery/selection endpoints and UI, Phase-1/Server integration, and the
customer-public source reader remain unimplemented. No local profile has been
enabled or deployed, and no ordinary-chat Ollama/LINE acceptance is claimed.
Complete those prerequisites and real main-dev acceptance before calling the
profile complete. The separate LINE Studio color fix was delivered in PR #729;
it does not activate this profile.

Version 0.2.0 records approval for the bounded main-dev implementation and
acceptance sequence. It creates no requirement, ID, table, provider credential,
or roadmap state.
