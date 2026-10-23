---
doc_type: intake-note
id: ZAI:LINE-LOCAL-OLLAMA-MAIN-DEV-PROPOSAL-20261023
status: approved
superseded_by: null
version: "0.4.0"
date: "2026-10-23"
migration_base_revision: ba0167e90d9a4d6059f7b7f85c886cc60fd3e5cc
relations:
  - type: references
    target: ZAI:FEAT-045
  - type: references
    target: ZAI:FR-079
  - type: references
    target: ZAI:FR-080
  - type: references
    target: ZAI:FR-265
  - type: references
    target: ZAI:FR-266
  - type: references
    target: ZAI:ADR-099
  - type: references
    target: ZAI:ADR-100
  - type: references
    target: ../../plans/LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md
  - type: references
    target: line-agent-stock-price-facts-20261023.md
---

# Main-dev keyless Ollama for LINE — reviewed-record migration proposal

**State:** The bounded main-dev TEST ONLY fixture contract is approved, and the
reviewed `FR-079`/`FR-080` source-row migration and generated projections are
applied. The owner API/UI pass 38 focused tests; the fixture/runtime/Server
path passes 119 focused tests. Independent runtime review found no remaining
P1/P2; live main-dev acceptance remains pending. This does not authorize production provider changes
or production activation.

## Approved memory amendment — 2026-10-24

The owner selected "เพิ่ม memory ให้โปรไฟล์ Ollama ใน main-dev แล้วทดสอบ" after
being told that the original main-dev profile deliberately refused memory.
This amends the earlier memory exclusion only for the separately opted-in,
allowlisted main-dev profile. Earlier no-memory clauses below describe the
0.3.2 baseline; this amendment and the updated FR-079 row control that scope.
The original fixture source, model/database/account allowlists, production
provider restrictions and FR-080 UI behavior remain unchanged.

`ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED` is false by default. Only the exact
string `true` enables it; malformed values fail closed. The standard MSP flags
still select thread/episodic ports. Account policy and immutable job enrollment
remain required. Episodic access additionally requires verified identity,
GRANTED consent, DIRECT audience and a valid mapped Project/Workspace.
Thread and episodic packets use the existing bounded composer, injection and
projection receipts, delivery reconciliation, retention and erasure paths.
No customer consent is fabricated and no legacy vault contents are copied.
Unknown owners, absent signer/transport, revoked policy, scope mismatch and
invalid model output fail closed. A public Product fixture never authorizes a
private memory slice. Production keeps its existing provider profile.

This is an approved same-ID, same-subject FR-079 source-row migration from
`ba0167e90d9a4d6059f7b7f85c886cc60fd3e5cc`; membership and ID stay pinned.
Implementation, independent review, CI, built-image main-dev acceptance and
production activation are separate gates and are not claimed by this approval.

## Objective and boundary

Allow the Business owner to select an installed local Ollama model for a real
LINE conversation in the isolated main-dev instance, without entering a paid
provider key. The Zuri Server remains the only LINE execution owner. The existing
public-provider and PRP key flows remain intact, and production `PRODUCTION_LINE`
continues to reject Ollama, local vaults, and raw model credentials.

This is a narrowly scoped exception for the explicitly opted-in main-dev
deployment. It does not change normal deployment defaults, Edge execution, MSP
memory, Conversation Runtime ownership, or the application data model. It adds
no product table. Ordinary-chat evidence comes from the existing synthetic
main-dev TEST ONLY PCAT metadata through a bounded, read-only, SHA-pinned local
fixture and the existing FR-047 BusinessKnowledge record/query contract. This
does not require a new database role or broad read grant. The existing Prisma
connection supplies owner-scoped IntegrationConnection and identity checks;
this is application-capability isolation, not a claim of a least-privilege
database principal or row-level database-role isolation. The feature adds no ad
hoc SQL or direct customer-table read, and Ollama receives neither database nor
object-storage credentials. Ollama is not
added to the public/keyed provider list and this does not weaken
`POST /api/integration/model-providers`, which continues to require a real
`apiKey` for its existing providers. FR-266's key lifecycle and FR-267's PRP
contract are unchanged.

The current FR-079 local adapter only accepts `127.0.0.1`, which names the
application container itself in Docker, and the runtime refuses local sources
when `NODE_ENV=production`. This profile must solve the container-to-host path
without flipping `NODE_ENV` or treating the production build as permission to
use a local provider.

## Proposed local profile

The profile is disabled unless a server-side opt-in is present. `NODE_ENV` may
remain `production`; it does not select or enable this profile. This is an
explicit `MAIN_DEV_LOCAL_OLLAMA` runtime composition, not a global `LOCAL_DEV`
override: `PRODUCTION_LINE`, `LOCAL_DEV`, `TEST`, and `EVAL` behavior remains
unchanged. Before model discovery, selection, or inference, the Server verifies
the actual main-dev application database identity (using the same local
application connection used for owner-scoped IntegrationConnection lookups
and identity checks) and checks the resolved Tenant, Business, and
internal LINE OA account ID against separate server-side allowlists. It must not
use the Supabase-pinned `ZURI_LINE_DB_URL` as proof of main-dev identity or as
the local profile's provider-connection store. Resolve the existing
`PHASE1_LINE_LLM` row through the current Prisma-backed
`resolvePhase1PrimaryConnection` path for this profile. For ordinary-chat
evidence, use a separate, operator-configured, read-only JSON fixture produced
by the root-owned main-dev setup from the existing synthetic TEST ONLY PCAT
product metadata; the fixture builder and runtime reader use only that metadata
and never open or query the source price list or stock. Its versioned envelope
carries the exact Tenant, Business, and internal LINE OA account IDs and the
`TEST_ONLY_PUBLIC` classification. The separately configured absolute local
file path and expected SHA-256 stay in the ignored private overlay. Reject
UNC/network paths, symlinks or reparse points in any path component, and
non-regular files. Read raw bytes with a hard 64 KiB cap (using at most one
extra sentinel byte to reject overflow), hash the complete accepted bytes and
compare the expected digest, then parse. Only after parsing enforce a maximum
of eight Product records and the strict envelope/schema/scope. Every row
must pass the existing FR-047 BusinessKnowledge Product contract, be active and
`PUBLIC`, and have null `sell_price`, `currency`, and `moq`; no stock fields or
extra fields are accepted. Preserve actual `source_ref` and `source_sha256`
from the test fixture as provenance. The `PUBLIC` sensitivity field validates
the record shape; the envelope limits this synthetic disclosure to the scoped
main-dev test and does not classify any real Business data as customer-public
or authorize a production data path. Reuse the registered BusinessKnowledge
query contract and bounded answer composer without querying GKS/corpus content,
the production-pinned `zuri_core` source, or Supabase. Keep the account's
`BUSINESS_KNOWLEDGE` setting; reject GKS/corpus modes and shadow grounding.
Also reject `ZURI_MSP_THREAD_MEMORY_ENABLED=true`,
`ZURI_MSP_EPISODIC_MEMORY_ENABLED=true`, per-job `memorySyncOptIn=true` or
`episodicMemoryOptIn=true`, and `knowledgeGroundingShadow=true` for this test
OA/job.
This reuses the Server's existing application-capability boundary and does not
claim database-principal least privilege or row-level database-role isolation.
The application contains no default tenant, Business, OA account, or database
instance IDs. Absent, malformed, mismatched, or empty required configuration
fails closed.

Proposed private deployment overlay shape (values remain in the ignored local
overlay; placeholders here are not instance configuration):

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
```

When enabled, the database check compares the configured expected name to
`current_database()` obtained from the Prisma-backed main-dev application
connection used for these existing scoped reads, not the separate
Supabase-pinned `ZURI_LINE_DB_URL`. No database URL, credential, or file storage
credential is sent to Ollama; the provider receives only the request and
approved bounded evidence the Server already builds. The base URL is server
configuration, accepted only as the exact `http://host.docker.internal:11434`
origin. The Server rejects credentials, any port other than 11434, paths,
queries, fragments, redirects, browser-supplied URLs, and connection-metadata
URL fields. It calls Ollama's installed-model listing endpoint with response-size
and time bounds, validates returned model IDs, and exposes only those IDs to the
authorized Business owner.

Proposed owner API: `GET /api/integration/local-ollama/models` returns validated
installed model IDs for the authorized Business. `POST
/api/integration/local-ollama/selection` accepts only `{ "modelId": "<listed ID>" }`;
the Server derives Tenant, Business, and OA scope from trusted application
context/configuration, never from a provider URL or unverified client-supplied
scope. The existing `/api/integration/model-providers` endpoint remains the
separate API-key flow.

The owner selects one listed model for the exact allowlisted Business and OA.
The selection uses the existing `PHASE1_LINE_LLM` connection and active-primary
compare-and-swap/uniqueness gate. It stores the model identifier in the existing
connection metadata only; it creates no `IntegrationCredential`, `secretRef`,
fake key, or browser-configurable endpoint. Runtime uses the existing
server-owned `ModelProviderPort` with an explicit main-dev-only runtime source.
The account's existing LINE readiness and authorization gates remain in force.
Selecting a different model is an explicit owner action; there is no silent
provider swap. ADR-100 D5 remains in force: if a Business `MODEL_PROVIDER_KEY`
already exists, its existing precedence is not bypassed and the local model
selection is refused for this test. The designated test Business must have no
model-provider credential so a successful ordinary-chat trace proves Ollama
inference rather than a paid-provider call.

The runtime must pass the trusted internal OA account ID from the verified LINE
job/account binding into model resolution. `server-line-answer.js` currently
calls `resolveModel` with only `{ tenantId, businessId }`; implementation must
carry the already server-derived OA ID through that seam. It must never accept
the ID from inbound message content, client body, or connection metadata.

Model listing, selection, connection promotion, and inference all fail closed
when the profile is disabled, the identity or scope does not match, the model is
missing, the Ollama endpoint is unavailable, or the response is malformed. There
is no automatic fallback to an API-key provider, deterministic answer, or
unconfigured endpoint. Ollama stays outside `PUBLIC_LINE_PROVIDERS` and
`MODEL_PROVIDER_CODES`; local-profile availability is a separate server-side
allowlist.

## LINE acceptance boundary

The existing `#product` stock/published-price fact path and ordinary model-backed
chat are separate acceptance cases. The #product regression must continue to
return only source-authorized customer facts and make **zero Ollama/model calls**;
it does not prove local inference. Separately, an ordinary-chat query on the
allowlisted test OA must match non-empty metadata in the hash-pinned synthetic
TEST ONLY fixture and produce a real server-side Ollama trace for the selected
installed model and a delivered test response. Its prompt/evidence packet must
contain no price, MOQ, or stock facts, and it must not draw on real customer or
Business data. A greeting or no-evidence query is insufficient because the
existing answer path can correctly skip model invocation when its reader returns
no records. A stopped Ollama server, removed model, or invalid response must fail
closed with no fallback. No synthetic provider receipt proves inference. The
stock/price scenario remains governed by the
[existing approved LINE fact contract](line-agent-stock-price-facts-20261023.md)
and its real persisted-source acceptance.

## Approved reviewed-record migration

The revised `FR-079` and `FR-080` source-row migration is authorized against
`8cd98190669748a74131eaedc7f8993e69b77f49`, recorded in this proposal's
`migration_base_revision`. Their IDs, canonical paths, source registries,
explicit FEAT membership, and pinned leading subject anchors remain unchanged.
The `FEAT-045` row below is unchanged from its prior approved migration based on
`fa10e309ac1e2833ad518f5432e921a5822d5d4d`; this amendment does not migrate or
rebind that row. No new IDs or changed membership are part of the work. The
sanctioned ID-ledger writer acknowledges the approved same-subject statement
digests for `FR-079`, `FR-080`, and `FEAT-045` through `--review`; the identity
inventory, subject anchors, roster, and historical declarations remain unchanged.

### `ZAI:FR-079`

Canonical path: `docs/features/FEAT-004/requirements/FR-079.md`. Preserve the
subject anchor `phase 1 line runtime connection cut over` and membership in
FEAT-004.

```text
| FR-079 | Phase 1 LINE runtime connection cut-over: after the server-owned LINE binding resolves the trusted Tenant/Business scope, the runtime keeps the existing Business-key-first behavior and selects exactly one `ACTIVE` `PRIMARY` `PHASE1_LINE_LLM` IntegrationConnection under that scope when no Business model key applies. The existing credentialed connection path resolves its opaque `secretRef` through the configured provider-neutral SecretManagerPort before the ModelProviderPort call. The default-off `MAIN_DEV_LOCAL_OLLAMA` profile may instead use a Business-owner-selected installed Ollama model without a `secretRef` or credential only when the Server verifies the actual main-dev database identity through its Prisma-backed connection and verifies the resolved Tenant, Business, and internal LINE OA account ID against separate server-side allowlists. It uses the existing Prisma-backed `resolvePhase1PrimaryConnection` and a separate operator-configured, read-only, size-bounded, SHA-256-pinned fixture built only from the existing main-dev TEST ONLY PCAT product metadata; the source price list and stock are excluded. The versioned fixture is bound to the trusted Tenant, Business, and internal LINE OA account ID, labeled `TEST_ONLY_PUBLIC`, and contains only existing BusinessKnowledge Product metadata passing the FR-047 contract, with `sell_price`, `currency`, and `moq` null and no stock fields. This synthetic fixture is authorized only for the scoped main-dev test; it does not classify any real Business data as customer-public or authorize a production data path. The local profile does not use the production-pinned `zuri_core`/Supabase reader and rejects GKS/corpus grounding and grounding shadow for this test OA/job. Memory remains refused unless the separate server-side `ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED=true` opt-in is set. With this opt-in, the same allowlisted main-dev OA may use existing MSP thread and principal-private episodic memory through the standard account policy, authenticated identity, per-turn authorization, consent, audience, signed-grant, receipt, retention and erasure gates of FR-057 and ADR-091; it grants no additional memory authority and never falls back to shared legacy Workspace storage. The bounded context composer may include only those authorized memory slices alongside the unchanged synthetic Product fixture. Missing memory transport or signer fails closed before inference. ADR-100 D5 remains unchanged: a present Business `MODEL_PROVIDER_KEY` retains precedence and prevents this local-Ollama acceptance. This local profile uses only the exact server-configured `http://host.docker.internal:11434` origin, ignores/rejects browser- and connection-metadata-supplied origins, preserves SERVER execution, and uses the existing compare-and-swap/uniqueness gate for exactly one active primary. The trusted OA account ID is carried from the verified LINE job/account binding into model resolution, never supplied by the client. `NODE_ENV=production` does not enable the local profile; the existing `PRODUCTION_LINE` path continues to reject local-vault, raw-credential, and Ollama selection. Untrusted scope, profile/database/allowlist/fixture hash/schema mismatch, unsafe or unknown fixture source, zero or multiple candidates, credentialed-provider secret-manager failure/expiry/version mismatch, Ollama endpoint/model failure, or an invalid provider response fails closed before a test reply, with no automatic fallback. Production provider behavior is unchanged. | 🟠 keyed runtime and main-dev Ollama implementation tested; main-dev live LINE and production evidence pending |
```

### `ZAI:FR-080`

Canonical path: `docs/features/FEAT-004/requirements/FR-080.md`. Preserve the
subject anchor `platform integrations ui` and membership in FEAT-004.

```text
| FR-080 | Platform Integrations UI: an owner with trusted Business authority can inspect and create Business-scoped IntegrationProvider/IntegrationConnection/IntegrationCredential metadata at `/platform/integrations`, with fixed `purpose=PHASE1_LINE_LLM`, redacted Vault status and explicit loading/error/empty states. The existing public-provider form accepts only `supabase-vault:<uuid>`; secret material is never returned to the browser or stored in Prisma, logs or audit events. When the default-off `MAIN_DEV_LOCAL_OLLAMA` profile is enabled and actual main-dev database identity plus Tenant/Business/internal LINE OA account allowlists match, the authorized Business owner can list installed Ollama model IDs from the Server and select one for that scoped main-dev test. Ordinary chat uses only the separately configured hash-pinned `TEST_ONLY_PUBLIC` metadata fixture described by FR-079; the source price list and stock are excluded, and this does not authorize real Business/customer data or production reads. This separate local action stores only the selected model ID in existing connection metadata, creates no secret reference or credential, and uses the existing compare-and-swap/uniqueness gate to activate exactly one local primary connection for the allowlisted scope; all existing LINE readiness gates still apply. It refuses local selection if a Business `MODEL_PROVIDER_KEY` exists, preserving ADR-100 D5 precedence. The local option and endpoints are unavailable when the profile is off or the scope does not match. The browser cannot supply a provider URL. This exception does not alter the keyed provider form, FR-266, the public-provider list, or production activation policy. The read model continues to carry the AC-075.3 `health` field (`CONNECTED · DEGRADED · ERROR · DISABLED · MISCONFIGURED` plus every reason observed), computed from connection/credential state and `RawExternalRecord` arrival evidence rather than stored; the listing includes the `LINE_OA` channel alongside the Phase 1 model providers so channel health has no separate surface, while the public-provider create form stays fixed to `purpose=PHASE1_LINE_LLM`. | 🟠 keyed integrations and main-dev Ollama UI/API implementation tested; live acceptance and production evidence pending |
```

### `ZAI:FEAT-045` (unchanged prior migration)

Canonical path: `docs/features/FEAT-045/feature.md`. Preserve the subject
anchor `line oa on api keys only`, its explicit membership `FR-265, FR-266,
FR-267`, and row status `building`.

```text
| FEAT-045 | LINE OA on API keys only — the existing public-provider and PRP paths require the Business-owned, browser-provisioned key; the Studio's EDGE execution mode, its edge conversation-job claim surface and the LOCAL_ONLY deterministic-answer branch are retired. For those keyed provider paths, the Business owner enters the model provider API key in the browser, write-only, through the same credential vault that already holds the LINE channel secret (ADR-100, amending ADR-061 D2/D3 for LINE OA; ADR-110 D1 retires Zuri-owned pairing and Edge extraction surfaces, while D3 preserves existing records and schema). A separate, default-off, explicitly allowlisted main-dev Ollama test profile is scoped by FR-079/FR-080 and does not change the public-provider or PRP key flows or production provider selection. | FR-265, FR-266, FR-267 | building |
```

FR-266 and FR-267 are not migrated. Their existing browser `apiKey` and
credentialed PRP contracts remain unchanged. Only the `FR-079` and `FR-080`
wrappers are migrated from the declared 8cd base; `FEAT-045` keeps its prior
fa10 migration provenance and unchanged row. No IDs, FEAT membership, ID-ledger
identity or subject-anchor entries, pinned source revision, or record paths may
be rewritten. Only the three review-only statement digest witnesses are updated
through the existing sanctioned writer. Each newly
migrated wrapper carries the hash of its approved row bytes; the pinned initial
hashes remain recoverable from the applicable migration base.

The approved wrapper updates set `status: reviewed-migration`, remove each
wrapper's initial `source_revision`, add the full approved
`migration_base_revision` and this `migration_document`, and bind the exact row
bytes with `source_row_sha256`. The canonical writer validates those migrated
rows and regenerates the registry projection and record digests; it does not
invent a missing source-row hash. The exact paths, `source_path`, `feature_id`,
subject anchors, and FEAT membership remain unchanged. The existing-row workflow is **not**
`--register-reviewed` or `document-record-migration --apply`; those handle new
standalone FR records. The sanctioned projection command after accepted wrapper
updates is `npm run docs:registry`, followed serially by `npm run docs:graph`,
`npm run docs:views`, and `npm run govern`. Do not run `docs:ids --write` or
hand-edit `docs/.id-ledger.json` for this same-subject migration. Use
`npm run docs:ids -- --review <ID> --reason "<reviewed amendment reason>"`
from `apps/server/`, separately for `FR-079`, `FR-080`, and `FEAT-045`, to
acknowledge their approved body changes without changing their pinned subjects
or identities.

## Approved ADR-100 amendment

ADR-100 D9 now records an explicitly enabled, allowlisted main-dev-only local
Ollama profile for server-executed test conversations without a provider
credential. It uses the existing Prisma-backed `PHASE1_LINE_LLM` connection and
a bounded, separately hash-pinned `TEST_ONLY_PUBLIC` fixture built from the
existing synthetic main-dev PCAT product metadata. The file is bound to the
trusted Tenant/Business/OA scope, contains null price/currency/MOQ and no stock,
and never carries the source price list. The test OA must use
`BUSINESS_KNOWLEDGE`; GKS/corpus access, memory opt-ins, and shadow grounding are
refused. The `PUBLIC` sensitivity field validates the existing FR-047 record
shape but does not classify real Business data as customer-public. No DB or
storage credentials are sent to Ollama. The endpoint is fixed server-side, the
model ID is metadata only, and current-primary compare-and-swap plus all LINE
readiness gates remain. ADR-100 D5 continues to take precedence if a Business
key exists; the local-only acceptance requires no Business model-provider
credential. The exception does not alter public-provider or PRP credential
rules, FR-266/FR-267, production `PRODUCTION_LINE` denials,
existing runtime-source behavior, or the no-fallback rule. It does not claim a
least-privilege database role or production acceptance.

## Approval

Approval basis: the user explicitly requested keyless local Ollama for the
isolated main-dev LINE test and selected synthetic TEST ONLY product data.
The root integrator accepted the bounded test-only source design on 2026-10-23
under that request, and the independent reviewer approved the exact fixture
contract. This records approval for main-dev implementation only; it does not
claim the user separately approved this exact wording, any production provider
change, or production activation. The migration updated only the two existing
`FR-079`/`FR-080` source-row wrappers; the `FEAT-045` row is unchanged. The
runtime implementation has passed independent review; no profile
deployment or LINE delivery acceptance is claimed.

Version 0.3.0 replaces the customer-public/GKS source assumption with the
user-selected, hash-pinned synthetic TEST ONLY PCAT metadata fixture while
preserving keyed and production contracts. The implementation has focused
unit-test coverage and independent review; private overlay configuration and live
acceptance remain pending.

Version 0.3.1 reconciles tested implementation status with independent review,
while keeping live LINE and production acceptance explicitly pending.

Version 0.3.2 records the sanctioned statement-digest review for the three approved
same-subject amendments. It changes no canonical source row or acceptance claim.
