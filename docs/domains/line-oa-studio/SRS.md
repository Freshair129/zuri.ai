---
domain: line-oa-studio
stable_domain_id: DOM-LINE-OA-STUDIO
status: proposed
version: 0.3.0
date: 2026-09-05
architecture: domain-driven-modular-monolith
---

# SRS — LINE OA Studio domain

**System:** Zuri AI (`zuri-ai`)
**Document type:** Software Requirements Specification
**Domain:** LINE OA Studio — the multi-account command center for LINE Official Accounts
**Stable product-domain ID:** `DOM-LINE-OA-STUDIO`
**Technical owner ID:** `TD-LINE-OA-STUDIO`
**Status:** Proposed (Phase 0 declaration)
**Version:** Draft v0.3

> **Clause-label note.** `LOS-RQ-*` labels below are local clause labels for
> this proposal, in the convention CR-014 used for `AM-PRD-*`. They are **not**
> Zuri global `FR-*` / `NFR-*` / `BR-*` / `SEC-*` / `SDD-*` ids, they are not
> pinned in `docs/.id-ledger.json`, and this file is not an id registry. Global
> ids remain defined only in `docs/PRD-SDD-v1.0.md` under the AGENTS.md §18
> contract; each implementation slice SHALL reserve them before code is
> annotated or shipped (ADR-060 D13).

## 1. Purpose

LINE OA Studio lets a Business design, publish and operate **several** LINE
Official Accounts from one console, so the people who run the accounts can
answer:

- Which accounts does this Business run, and is each one connected, routed and
  healthy?
- What rich menu, welcome flow, Flex cards and LIFF apps does each account have,
  and which version is live on LINE?
- What is going out — push, broadcast, test — who approved it, and what did LINE
  accept?
- How are the accounts doing, by LINE's own numbers, per account and across the
  Business?

It reproduces the owner's reference prototype (Dashboard, Projects → Accounts,
Templates, Analytics, Team, Media, Settings, and a per-account Design Studio with
Flow Designer, Flex Message, Rich Menu and LIFF App) inside Zuri's shell, scope
chain, authorization and audit — and it makes the prototype multi-account.

## 2. Architectural constraints

LINE OA Studio SHALL conform to Zuri's domain-driven modular monolith
(`docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md`, ADR-025). It SHALL:

- live in the `zuri-ai` codebase and release boundary, under
  `src/modules/line-oa-studio` and `docs/domains/line-oa-studio/`;
- own only its declared operational state and expose explicit application
  contracts;
- use approved cross-domain contracts, read models and the shared audit seam;
- reach LINE only through the trusted transport owner's pull-model job lane;
- remain selectively extractable only if a future scale, security, availability
  or ownership requirement justifies it.

It SHALL NOT hold a LINE channel secret or channel access token, call a LINE
API except through the integration lane's port for `CLOUD` accounts, activate
LINE routing, create a second connection registry,
secret manager, raw-ingestion store, identity model, file store or membership
model.

## 3. Authority and domain boundaries

### 3.1 Integration owns connections, credentials and raw evidence

`IntegrationProvider` (`LINE_OA`), `IntegrationConnection`,
`IntegrationCredential` (opaque `secretRef`), `IngestionRun`, `RawExternalRecord`,
`SyncCursor`, `ExternalEntityRef` and `DeadLetterRecord` remain integration
authority (FR-080, FR-081, ADR-032).

- **LOS-RQ-001 — Connection reference.** A `LineOaAccount` SHALL reference
  exactly one `IntegrationConnection` whose provider is `LINE_OA`, and a
  connection SHALL back at most one account.
- **LOS-RQ-002 — Connect through the contract.** "Connect account" SHALL create
  the connection only through the integration lane's owner-only create contract,
  SHALL accept only the opaque secret reference that contract accepts, and SHALL
  never store, log, audit or return secret material.
- **LOS-RQ-003 — Insight as raw evidence.** LINE Insight data SHALL enter as
  `RawExternalRecord` rows written by an integration adapter (provider
  `LINE_OA`, lane `INSIGHT`); the Studio SHALL translate, never ingest.

### 3.2 Agent owns binding, routing, activation and the turn

`zuri_core.line_channel_binding`, activation/rollback/canary (FR-052, FR-055,
ADR-020), the webhook seam (FR-028) and the single reply (FR-050, BR-011)
remain agent authority.

- **LOS-RQ-004 — Binding join.** `LineOaAccount.bindingCode` SHALL equal the
  agent binding `code` for the account's destination and identity's
  `channelAccountId`; the Studio SHALL resolve per-account configuration only
  from a scope the agent resolved from the server-owned binding.
- **LOS-RQ-005 — No activation.** The Studio SHALL NOT activate, disable, rotate
  or expire a binding. It SHALL display binding state read from the agent lane
  and link to the operator runbook.
- **LOS-RQ-006 — Automation before the model.** The Studio SHALL expose
  `resolveAutomation(scope, event)`; the agent turn calls it before model work,
  and a match produces the turn's one reply. The Studio SHALL NOT consume a reply
  token or send a reply itself.

### 3.3 LINE transport is owned per account by its transport mode

The owner's answer of 2026-09-05 fixes the topology: a Zuri Edge Device exists
only for tenants that want a local LLM through Ollama, or Codex CLI on a
monthly-plan quota instead of an API key; every other tenant is served from the
cloud. An account therefore carries a `transportMode` of `EDGE` or `CLOUD`
(ADR-060 D5), and the two modes share one job lane.

- **LOS-RQ-007 — Everything to LINE is a job.** Every operation that must reach
  LINE (rich-menu image upload, create/set-default/link/delete rich menu, LIFF
  create/update, push/multicast/broadcast/narrowcast send, Insight pull) SHALL be
  a `LineOaTransportJob` with one lifecycle and one receipt shape regardless of
  mode.
- **LOS-RQ-017 — EDGE claimant.** For an `EDGE` account the tenant's Zuri Edge
  Device SHALL claim and execute the job under its `EdgeDeviceCredential`
  (FR-144) in the ADR-059 pull model; the device holds the channel secret and
  access token (ADR-041 D2) and answers on its local LLM.
- **LOS-RQ-018 — CLOUD claimant.** For a `CLOUD` account a Studio worker SHALL
  claim the job in-process under the same lease rules and execute it through the
  integration lane's LINE Messaging port, which resolves the account's access
  token from Supabase Vault per call under the cloud runtime role and never
  returns it (ADR-031 D3); the Studio SHALL receive results only.
- **LOS-RQ-019 — One owner at a time.** An account SHALL be `EDGE` or `CLOUD`,
  never both (BR-011); switching SHALL be a publisher-only, versioned
  compare-and-swap that disables routing first, moves credentials, cancels jobs
  queued under the old owner, re-enables routing and audits the switch.
- **LOS-RQ-008 — Bytes to the lease holder only.** Bytes a job needs SHALL be
  served by the cloud only to the device holding the job's live lease; no bucket
  URL, signed link or storage credential SHALL be handed out (ADR-059 D4).
- **LOS-RQ-009 — Results are references.** A job result SHALL carry external
  identifiers, an acceptance class and counts only — never token material, a
  request echo, or customer content beyond what the Studio queued.

### 3.4 Identity owns persons, subjects and authority

- **LOS-RQ-010 — Authorization ladder.** View SHALL require Business visibility
  plus the `line-oa` domain grant (FR-061); edit SHALL require an active
  Membership with the domain visible; publish, dispatch, connect and archive
  SHALL require Business OWNER or an active `LINE_OA_PUBLISHER` `RoleBinding`
  (FR-076 pattern). Team membership, payload roles and client-selected scope
  SHALL grant nothing (BR-020). The role key `LINE_OA_PUBLISHER` is confirmed
  by the owner (2026-09-05).
- **LOS-RQ-011 — Subjects are identity references.** Flow sessions and test
  dispatches SHALL reference identity's `ChannelIdentity` / `ExternalIdentity`
  rows; the Studio SHALL NOT use a raw LINE user id as a key.
- **LOS-RQ-012 — 404-shaped refusals.** An account, design or dispatch outside
  the viewer's scope SHALL be refused as not found (FR-072).

### 3.5 CRM owns conversations, customers and consent

- **LOS-RQ-013 — Read, do not write.** Conversation lists and counts SHALL come
  from the crm read model (FR-091); a conversational outbound message SHALL be
  recorded through the crm contract (FR-093); the Studio SHALL NOT write
  `Customer`, `Conversation` or `Message`.
- **LOS-RQ-014 — Consent gate.** A marketing dispatch (BROADCAST, NARROWCAST,
  MULTICAST to Customers, PUSH to a Customer outside an open conversation) SHALL
  reach only Customers whose consent is `GRANTED` (FR-103, SEC-005).
- **LOS-RQ-015 — Thread-key prerequisite (crm-owned).** Before a per-account
  inbox view, per-account message count or per-account dispatch receipt is
  shown, `Conversation` identity SHALL include the channel account
  (`tenantId, channel, channelAccountId, externalThreadId`). Until that crm
  requirement lands, such tiles SHALL be labelled Business-wide.

### 3.6 File management owns bytes

- **LOS-RQ-016 — Images are FileAsset references.** Rich-menu and Flex images
  SHALL be `FileAsset` rows referenced by id, validated by inspected MIME and
  size, never copied into Studio tables.

### 3.7 LINE OA Studio owns design, publication and operation

The Studio SHALL own business meaning and write authority for `LineOaAccount`,
`LineOaRichMenu`(+versions), `LineOaFlexTemplate` / `LineOaFlexMessage`,
`LineOaFlow` / `LineOaFlowVersion`, `LineOaFlowSession`, `LineOaLiffApp`,
`LineOaTemplate`, `LineOaDispatch`, `LineOaTransportJob`, `LineOaInsightSnapshot`,
and the pure calculators over them.

## 4. Multi-account model

- **LOS-RQ-020 — N accounts per Business, one Business per account.** A Business
  MAY own any number of accounts; an account SHALL belong to exactly one
  Business; a Tenant MAY hold many Businesses that each do so. Moving an account
  SHALL be a new account plus an archive.
- **LOS-RQ-021 — Scope on every row.** Every Studio-owned row SHALL carry
  `tenantId`, `businessId` and `lineOaAccountId`; the server SHALL derive the
  first two from the trusted viewer and selected visible Business and SHALL
  validate the third against them. Repositories SHALL be bound to one scope at
  construction and refuse rows outside it (SEC-001, BR-012).
- **LOS-RQ-022 — Account identity.** An account SHALL have an internal UUID and
  a human `code` unique per Tenant; LINE channel id, basic id and bot user id
  SHALL be external references (BR-002) and SHALL NOT be primary keys.
- **LOS-RQ-023 — Default account.** At most one account per Business MAY be
  flagged default; the flag is a UI convenience and SHALL grant no routing or
  authority.
- **LOS-RQ-024 — Templates are the only shared thing.** Templates SHALL carry a
  scope of `SYSTEM`, `TENANT` or `BUSINESS`; instantiating one SHALL copy it into
  an account with `templateId` lineage. No other Studio record SHALL be shared
  across accounts. The first release SHALL offer `SYSTEM` seeds and `BUSINESS`
  templates only; `TENANT` stays a reserved value with no UI and no write path
  until a later release (owner, 2026-09-05).
- **LOS-RQ-025 — Aggregation stops at the Business.** Dashboard, Analytics and
  Command Center SHALL aggregate the accounts of the selected Business that the
  viewer may see, and nothing wider (ADR-011).
- **LOS-RQ-026 — Per-account quota.** Message quota and limits SHALL be recorded
  per account from translated LINE facts; a dispatch gate SHALL refuse, not
  estimate, when no current snapshot exists.
- **LOS-RQ-027 — Persisted resolver in production.** Multi-account production
  SHALL use the persisted binding resolver; the env-configured single-binding
  resolver SHALL be treated as a dev/compat path and SHALL NOT be presented as
  multi-account.
- **LOS-RQ-028 — Account selection is a resource, not a shell scope.** The
  active account SHALL appear in the path (`/line-oa/accounts/[accountId]/…`)
  like a Project; Tenant and Business SHALL NOT (ADR-006).
- **LOS-RQ-029 — Transport mode per account.** `transportMode` SHALL be `EDGE`
  or `CLOUD`, fixed at connect time from whether the Business holds an ACTIVE
  `EdgeDeviceCredential` (the ADR-059 D5 rule) and overridable by a publisher
  at connect time; the mode SHALL be shown on every account card and health
  view, and a Business MAY mix modes across its accounts.

## 5. Functional requirements by capability

### 5.1 Accounts

- **LOS-RQ-030 — Account list and health.** The Dashboard and Accounts pages
  SHALL list the Business's accounts with computed health: connection status
  and secret readiness (integration), binding status (agent), last webhook
  receipt time (integration raw evidence), queued/failed transport jobs (Studio),
  and quota (latest insight snapshot). Health SHALL be computed, never stored.
- **LOS-RQ-031 — Connect.** A publisher SHALL be able to connect an account by
  selecting or creating a `LINE_OA` connection through the integration contract
  and entering display metadata; the account starts `DRAFT`, becomes `CONNECTED`
  when the connection and binding references exist, and `LIVE` only when the
  agent lane reports an `ACTIVE` binding.
- **LOS-RQ-032 — Pause and archive.** A publisher MAY pause (no dispatches, no
  automation match) or archive an account; archiving SHALL keep history and
  SHALL NOT delete designs, dispatches, jobs or snapshots.
- **LOS-RQ-033 — Bot profile.** An editor MAY set the greeting, fallback text
  and persona label per account; the agent reads them per account; they are not
  knowledge and not memory.

### 5.2 Rich Menu designer

- **LOS-RQ-040 — Layouts and areas.** The designer SHALL offer the LINE layouts
  (1×1, 2×1, 2×2, 2×3, 3×1, 1×2), a chat-bar label, and per-area actions
  (message, postback, URI, LIFF, rich-menu switch), validating bounds against
  the selected image size before save.
- **LOS-RQ-041 — Versions.** Saving SHALL create a draft version; publishing
  SHALL freeze the version and queue a transport job; the external `richMenuId`
  returned by the job SHALL be recorded as an external reference on that
  version.
- **LOS-RQ-042 — Default and aliases.** Setting the default rich menu, an alias,
  or linking a menu to a subject SHALL each be a transport job with its own
  receipt.

### 5.3 Flex Message designer

- **LOS-RQ-050 — Visual and JSON.** The designer SHALL offer a visual editor
  and a JSON editor over one validated Flex document (bubble / carousel), with
  a LINE-style preview; invalid JSON SHALL be refused with field-level errors.
- **LOS-RQ-051 — Starter kinds.** HERO_CARD, PRODUCT_CARD and ORDER_STATUS SHALL
  ship as SYSTEM templates; CUSTOM SHALL be allowed.
- **LOS-RQ-052 — Send test.** "ส่งทดสอบ" SHALL create a `TEST` dispatch whose
  only allowed audience is the viewer's own linked LINE identity or a registered
  staff subject.

### 5.4 Flow designer

- **LOS-RQ-060 — Graph schema.** A flow SHALL be a strict-schema graph with one
  START, nodes of type MESSAGE, QUICK_REPLY, FLEX, CONDITION, LIFF, PUSH,
  CONNECTOR_ACTION, VARIABLE, WAIT, END, and typed edges; unknown properties
  SHALL be rejected (SEC-002).
- **LOS-RQ-061 — Triggers.** A published flow SHALL bind to one trigger per
  account: FOLLOW, MESSAGE_KEYWORD, POSTBACK or RICH_MENU_TAP; at most one
  published flow per (account, trigger key).
- **LOS-RQ-062 — Pure interpreter.** `evaluateFlowStep(flowVersion, event,
  session)` SHALL be a pure function returning `{actions, nextSession}`; it
  SHALL perform no I/O and SHALL execute no code from the document (BR-007).
- **LOS-RQ-063 — Connector allow-list.** `CONNECTOR_ACTION` SHALL name a
  registered internal contract from an allow-list; a URL, host or arbitrary
  endpoint SHALL be refused at schema level.
- **LOS-RQ-064 — Sessions.** `LineOaFlowSession` SHALL be keyed by account and
  identity subject reference, SHALL expire, and SHALL be deleted or tombstoned
  when the subject is erased (FR-022).
- **LOS-RQ-065 — Timers run on the Studio scheduler.** A WAIT node with a
  duration SHALL create a `LineOaSchedule` row (LOS-RQ-085) when a session
  reaches it and SHALL resume the session through a PUSH dispatch when the
  schedule fires. Until the scheduler ships (Phase 3) the designer SHALL refuse
  to publish a timed WAIT rather than accept it silently.
- **LOS-RQ-066 — Single reply preserved.** A flow match SHALL produce at most one
  reply per inbound event (FR-050); additional messages SHALL be PUSH dispatches
  subject to §5.6.
- **LOS-RQ-067 — Published configuration for edge runtimes.** An `EDGE`
  account's device SHALL be able to pull the account's published configuration
  snapshot (published flow versions, rich-menu aliases, bot profile) through a
  device-authenticated, ETag-versioned read; the snapshot SHALL contain no secret
  and no customer data, and the device SHALL evaluate the same interpreter
  contract this repository publishes.

### 5.5 LIFF and templates

- **LOS-RQ-070 — LIFF registry.** An account MAY register LIFF apps (name, view
  size, endpoint, scope); creation or update on LINE SHALL be a transport job,
  and the external `liffId` SHALL be an external reference.
- **LOS-RQ-071 — Template library.** Templates SHALL have a kind (FLOW, FLEX,
  RICH_MENU, LIFF), a category, a scope (`SYSTEM` | `TENANT` | `BUSINESS`), an
  official flag for SYSTEM seeds, and usage derived from lineage counts; search
  and filter by kind and category SHALL be supported.
- **LOS-RQ-072 — First-release scope.** The first release SHALL create and list
  `SYSTEM` and `BUSINESS` templates only; a `TENANT` value SHALL be refused by
  the write path and absent from the UI until a later release declares it
  (owner, 2026-09-05).

### 5.6 Dispatch

- **LOS-RQ-080 — Kinds and audience.** A dispatch SHALL be PUSH, MULTICAST,
  BROADCAST, NARROWCAST or TEST, with an audience resolved server-side from crm
  and identity references; a client SHALL NOT supply raw LINE user ids.
- **LOS-RQ-081 — Approval and confirmation.** Queuing SHALL require publisher
  authority; BROADCAST and NARROWCAST SHALL additionally require a typed
  confirmation in the request body.
- **LOS-RQ-082 — Idempotency.** One dispatch SHALL map to one transport job
  under one idempotency key; re-queuing SHALL return the existing job.
- **LOS-RQ-083 — Receipt.** The receipt SHALL record LINE's acceptance class,
  request id and counts; `ACCEPTED_BY_LINE` SHALL NOT be presented as delivered
  or read (ADR-020 #7).
- **LOS-RQ-084 — Scheduled dispatch.** A dispatch MAY carry a `scheduledFor`
  instant. Queuing it SHALL create a `LineOaSchedule` row instead of a transport
  job, and the transport job SHALL be created only when the schedule fires
  (LOS-RQ-085). Approval, consent, quota and confirmation gates SHALL be
  evaluated at scheduling time and again at fire time; a dispatch whose gate
  fails at fire time SHALL be marked FAILED with the reason, never sent.

### 5.9 Scheduler (Studio-owned)

The owner decided on 2026-09-05 that scheduling is a Studio requirement, not a
platform one. This repository has no scheduler today; the Studio builds one for
its own needs rather than storing promises nothing keeps.

- **LOS-RQ-085 — Studio scheduler.** The Studio SHALL own a durable scheduler:
  `LineOaSchedule` rows (kind `DISPATCH_SEND_AT` | `FLOW_WAIT_RESUME`, `dueAt`,
  a target reference, status `PENDING` → `CLAIMED` → `FIRED` | `CANCELLED` |
  `EXPIRED`, lease, attempts, idempotency key) fired by an in-process worker
  tick. It SHALL live in one codebase and release, SHALL use the same lease and
  idempotency discipline as transport jobs, and SHALL be extractable later
  without changing its contract.
- **LOS-RQ-086 — Fire semantics.** A schedule SHALL fire at most once: claim
  under a lease, then `FIRED` with the created job or resumed session id. A
  schedule past its due time by more than the account's tolerance SHALL be
  marked `EXPIRED` and surfaced in the Command Center, never sent late in
  silence. Cancelling the underlying dispatch, ending the flow session or
  archiving the account SHALL cancel its schedules.

### 5.7 Analytics and Command Center

- **LOS-RQ-090 — Insight snapshots.** `translateInsightRecord` SHALL produce a
  per-account, per-day snapshot (followers, targeted reaches, blocks, delivered
  messages by type) deterministically from an immutable raw record; the same
  input SHALL yield the same snapshot (NFR-018's shape).
- **LOS-RQ-091 — Sourced tiles.** Every Dashboard and Analytics figure SHALL
  name its source (LINE insight, crm read model, Studio records); nothing SHALL
  be estimated.
- **LOS-RQ-092 — Command Center.** The Command Center SHALL show, per account:
  health, queued/claimed/failed transport jobs with correlation ids, recent
  dispatches and receipts, recent conversations (crm read model) with a deep
  link to the CRM Inbox, and quota; it SHALL offer the dispatch console under
  §5.6 rules. It SHALL NOT offer human takeover; that stays in the Inbox.

### 5.8 Projections and settings

- **LOS-RQ-095 — Media projection.** The Media page SHALL be a filtered view of
  `FileAsset` with upload through the existing file contract.
- **LOS-RQ-096 — Team projection.** The Team page SHALL list who can view, edit
  and publish for the selected Business from identity's grants and roles and
  deep-link to `/platform/users`; it SHALL NOT invite, grant or revoke.
- **LOS-RQ-097 — Settings.** Business-level settings SHALL cover the default
  account, dispatch consent policy defaults and Command Center preferences;
  they SHALL grant no authority.

## 6. Non-functional requirements

- **LOS-RQ-100 — Determinism.** Validators, the flow interpreter, gates and
  insight translation SHALL be pure and replay-safe.
- **LOS-RQ-101 — Fail closed.** Missing viewer, invisible Business, unknown
  account, missing connection or binding, missing snapshot for a quota gate, or
  an unavailable transport owner SHALL refuse before any write or job.
- **LOS-RQ-102 — Traceability.** Every dispatch, job and receipt SHALL carry a
  correlation id that appears on every structured log and audit row (NFR-017's
  shape).
- **LOS-RQ-103 — Surfaces.** Pages SHALL use the Zuri Heritage design system
  with explicit loading, empty and error states (NFR-008), Thai copy on
  user-facing surfaces, and SHALL be reachable by search and by browsing.
- **LOS-RQ-104 — Offline-first.** Local SQLite and the existing Prisma
  repository pattern SHALL be used; a later Postgres adapter SHALL preserve the
  contracts.

## 7. Security requirements

- **LOS-RQ-110 — No secrets.** No channel secret, access token, Vault plaintext
  or authorization header SHALL be accepted, stored, logged, audited or returned
  by any Studio route or service.
- **LOS-RQ-111 — Scope cannot widen.** Client, prompt, model, template or flow
  values SHALL never widen the server-owned Tenant/Business/account scope
  (BR-020, SEC-018).
- **LOS-RQ-112 — Redacted audit.** Every write SHALL append an `AuditEvent`
  whose payload excludes secrets, customer message bodies and raw LINE user ids.
- **LOS-RQ-113 — Data-only flows.** Flow documents SHALL be validated with
  strict schemas, SHALL NOT be executed, and SHALL NOT reference URLs.
- **LOS-RQ-114 — Erasure.** Erasing a Person (FR-022) SHALL tombstone or delete
  that subject's flow sessions and test-dispatch references inside the same
  erasure path, through a Studio contract identity calls.

## 8. Data model candidates

| Candidate | Key fields (sketch) | Notes |
|---|---|---|
| `LineOaAccount` | id, code, tenantId, businessId, displayName, basicId?, integrationConnectionId (unique), bindingCode? (unique per tenant), status, isDefaultForBusiness, botProfileJson, version, archivedAt? | aggregate root |
| `LineOaRichMenu` / `LineOaRichMenuVersion` | accountId, name, layout, chatBarText, areasJson, imageFileAssetId, status, publishedVersionId?; version: number, frozen body, externalRichMenuId? | versions immutable once published |
| `LineOaFlexTemplate` / `LineOaFlexMessage` | accountId?, kind, name, flexJson, variablesJson, templateId? | account-scoped or library-scoped |
| `LineOaFlow` / `LineOaFlowVersion` | accountId, name, triggerKind, triggerKey, status; version: graphJson, publishedAt, publishedBy | one published per (account, trigger key) |
| `LineOaFlowSession` | accountId, subjectRef (ChannelIdentity id), flowVersionId, nodeId, variablesJson, expiresAt | expiring; erasure-aware |
| `LineOaLiffApp` | accountId, name, viewSize, endpointUrl, scopeJson, status, externalLiffId? | |
| `LineOaTemplate` | kind, category, scope, tenantId?, businessId?, isOfficial, bodyJson | SYSTEM rows have no tenant |
| `LineOaDispatch` | accountId, kind, audienceSpecJson, messagesJson, status, approvedBy, idempotencyKey, transportJobId?, receiptJson | |
| `LineOaTransportJob` | accountId, businessId, kind, payloadJson, status, claimedByDeviceId?, leaseExpiresAt?, attempts, resultJson?, error?, correlationId, idempotencyKey, version | mirrors `AssetExtractionJob` |
| `LineOaSchedule` | accountId, businessId, kind (DISPATCH_SEND_AT / FLOW_WAIT_RESUME), dueAt, targetRef (dispatchId or flowSessionId), status, leaseExpiresAt?, attempts, firedJobId?, idempotencyKey, version | the Studio's own timer; fires at most once |
| `LineOaInsightSnapshot` | accountId, snapshotDate, followers, targetedReaches, blocks, deliveredJson, rawExternalRecordId, translationVersion | unique per (account, date, translationVersion) |

All internal keys are UUIDs; every external identifier is a reference; every
row carries timestamps and `version`.

## 9. Contracts

### 9.1 Application contracts (direction)

See the charter's "Public contract direction". The device-facing transport-job
routes are:

```text
POST /api/line-oa/transport-jobs/claim               → 204 when the queue is empty
GET  /api/line-oa/transport-jobs/[id]/bytes           → bytes for the lease holder only
POST /api/line-oa/transport-jobs/[id]/complete        → { externalIds, acceptanceClass, counts }
POST /api/line-oa/transport-jobs/[id]/fail            → { reason }
GET  /api/line-oa/accounts/[accountId]/published-config → ETag-versioned snapshot for the EDGE runtime
```

Each authenticates with `Authorization: Bearer edgk_…` (FR-144), never a session
cookie, and is scoped to the Business of the presented credential. `CLOUD`
accounts use none of these: their jobs are executed by the in-process worker
through the integration lane's port.

### 9.2 Wire contract

`contracts/line-oa-transport-job.schema.json` (Phase 1) SHALL define the job
object and the four calls in the style of `contracts/edge-extraction-job.schema.json`:
job status enum, lease semantics, and a `kind`-discriminated payload
(`RICH_MENU_UPLOAD`, `RICH_MENU_CREATE`, `RICH_MENU_SET_DEFAULT`,
`RICH_MENU_LINK`, `RICH_MENU_DELETE`, `LIFF_CREATE`, `LIFF_UPDATE`,
`DISPATCH_SEND`, `INSIGHT_PULL`). The cloud owns the shape; the transport
repository codes against it.

## 10. Surfaces and navigation

```text
LINE OA Studio (route key line-oa)
├── Dashboard         /line-oa                          account cards + sourced KPI band
├── Accounts          /line-oa/accounts                 list · connect
│     /line-oa/accounts/[accountId]                     overview · health
│     /line-oa/accounts/[accountId]/studio              Rich Menu · Flex · Flows · LIFF
│     /line-oa/accounts/[accountId]/dispatches          push · multicast · broadcast · narrowcast · test
│     /line-oa/accounts/[accountId]/analytics           per-account insights
├── Templates         /line-oa/templates
├── Analytics         /line-oa/analytics                 across the Business's accounts
├── Command Center    /line-oa/command-center
├── Media             projection of Files
├── Team              projection of identity
└── Settings          /line-oa/settings
```

Prototype-to-domain vocabulary: **Project → Account**; **Design Studio →
per-account studio**; **Templates, Analytics, Settings → Studio-owned**; **Team,
Media → projections**. Runtime navigation wiring is authorized only by the
implementation slice (ADR-060 D12).

## 11. Phasing and gates

See ADR-060 D14. Phase 1's gate includes the crm thread-key prerequisite
(LOS-RQ-015) and one real rich-menu deployment through a real transport owner
with a truthful receipt.

## 12. Open questions for the owner

1. **Transport owner in production — answered 2026-09-05.** A Zuri Edge Device
   exists only for tenants that want a local LLM through Ollama, or Codex CLI on
   the monthly-plan quota instead of an API key; every other tenant is served
   from the cloud. Hence `transportMode` per account (§3.3, LOS-RQ-029).
2. **Cloud transport adapter — answered by the same decision.** It is the
   `CLOUD` mode, behind the integration lane's Vault-resolved LINE port;
   ADR-041 D2 is scoped to `EDGE` accounts (ADR-060 0.2.0).
3. **Tenant-scope templates — answered 2026-09-05.** Business scope is enough
   for the first release; `TENANT` stays a reserved value (LOS-RQ-024,
   LOS-RQ-072).
4. **Scheduler — answered 2026-09-05.** A Studio requirement: the Studio owns
   its own durable scheduler (§5.9, LOS-RQ-085/086); scheduled dispatch lands
   in Phase 2 and timed WAIT in Phase 3.
5. **Publisher role name — answered 2026-09-05.** `LINE_OA_PUBLISHER` is
   confirmed (LOS-RQ-010).

No question remains open; the next decision is acceptance of ADR-060 itself.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.3.0 | 2026-09-05 | proposed | Owner's answers to the last three questions: Business-scope templates for the first release (LOS-RQ-072), a Studio-owned scheduler (§5.9, LOS-RQ-085/086; 065 and 084 reworded), `LINE_OA_PUBLISHER` confirmed | Claude Code |
| 0.2.0 | 2026-09-05 | proposed | Owner's answer on edge devices: transport mode per account (LOS-RQ-017..019, 029), published-config pull for edge runtimes (LOS-RQ-067), open questions 1–2 answered | Claude Code |
| 0.1.0 | 2026-09-05 | proposed | First draft: boundaries, multi-account model, capability requirements, security, data-model candidates, contracts, surfaces, phasing and open questions | Claude Code |
