---
id: ZAI:LINE-OA-SRS
relations:
  - type: relates_to
    target: ZAI:ADR-018
  - type: relates_to
    target: ZAI:ADR-025
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-089
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:ADR-105
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:ADR-110
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
domain: line-oa-studio
stable_domain_id: DOM-LINE-OA-STUDIO
status: approved
version: "0.6.0b"
date: 2026-09-23
reconciliation_revision: "2026-10-21.1"
reconciliation_date: 2026-10-21
architecture: server-core-with-stateless-studio-and-versioned-runtime-boundaries
---

# SRS — LINE OA Studio domain

> Current boundary: ADR-100 and ADR-110 make LINE conversation execution server-only and retire the Edge Device product surfaces; ADR-105 defines durable Studio state behind stateless API/worker processes, and ADR-106 defines Core ownership plus the versioned Conversation Runtime boundary. Studio owns its declared account and operational state, Integration owns LINE transport and secret resolution, CRM owns conversation history, and Agent provides answer contracts. Native LINE behavior remains governed by FR-148, FR-149 and FR-265 with ADR-100/106/110. FR-150's former Edge conversation behavior is superseded and is outside the minimum profile. FR-050 and FR-140 remain in canonical source but their legacy transport-specific behavior is deferred. The phase plan is delivery evidence, not a product authority or activation proof.


**System:** Zuri AI (`zuri-ai`)
**Document type:** Software Requirements Specification
**Domain:** LINE OA Studio — the multi-account command center for LINE Official Accounts
**Stable product-domain ID:** `DOM-LINE-OA-STUDIO`
**Technical owner ID:** `TD-LINE-OA-STUDIO`
**Status:** Approved domain baseline v0.6.0b, subject to later accepted ADR amendments
**Version:** v0.6.0b

> **Clause-label and authority note.** `LOS-RQ-*` labels are local references
> within this domain document; they are not global Zuri IDs and do not create
> global registry rows, feature membership, or approval. Global requirement
> identities and exact statements remain in their canonical records. A local
> clause is part of the build baseline only to the extent that an accepted
> canonical requirement or decision governs it. Later accepted decisions
> supersede conflicting text below without rewriting historical source rows.

### 0.1 Current precedence and superseding amendments

Read this SRS with the global canonical records and the accepted decisions that
control it. The current product baseline is Server/Core-owned LINE execution
with durable Studio state and the versioned Runtime boundary. ADR-110 D1 and D5
retire Edge Device pairing, device credentials, heartbeat, Edge asset extraction
and Edge-to-Server adapters; ADR-110 D3 retains existing records and schema for
recovery. Thus old Edge clauses below are historical source context only. They
do not authorize new routes, credentials, clients, jobs, device execution or
schema changes. ADR-100 supersedes the former Edge conversation path, and
ADR-106 defines runtime ownership and fencing.

The SRS is the approved 0.6.0b domain baseline identified by its frontmatter.
This body reconciliation makes later accepted amendments explicit; it does not
claim that every `LOS-RQ-*` clause is a globally registered requirement or that
the product has been activated against a live LINE provider.

**Version reconciliation.** The body now matches the frontmatter's approved
`0.6.0b` version instead of the stale Draft `0.4.0b` label. The reconciliation
adds no global requirement, changes no canonical subject or feature membership,
and does not convert the historical proposed changelog entries below into
current requirements.

**Explanatory reconciliation 2026-10-21.1 (2026-10-21).** This dated note
clarifies the accepted current job owners and separates them from the earlier
generic transport-job sketch. It preserves the approved baseline version
`0.6.0b`; it is not a new domain approval and creates no global requirement.

**Current job ownership.** The earlier `LOS-RQ-007` statement that every LINE
operation uses one `LineOaTransportJob` is historical as a generalized design
sketch. The currently selected contracts are specific: Studio owns the durable
`LineOaRichMenuJob` for rich-menu publishing (FR-152, ADR-061/105), while Core
alone owns `LineConversationJob` writes and claim/lease state; the Conversation
Runtime uses the versioned Core port (ADR-106). Integration owns the LINE
provider port and secret resolution. No universal transport-job model or shared
lifecycle is selected. LIFF, dispatch, Insight and other provider operations
must use their own accepted contracts; where none is selected, this SRS does
not supply a writer, queue or receipt protocol.

**Schedule scope.** ADR-105 D2/D3 selects the general durability invariant:
when accepted behavior uses scheduled work, Studio owns its declared schedule
state, schedules persist and use the owning lease/idempotency discipline, and a
process-local timer is only a wake-up hint. Those invariants remain in the
minimum profile. The concrete `LineOaSchedule` model, in-process scheduler,
scheduled-dispatch behavior and timed flow-WAIT behavior described by proposed
[ADR-060](../../decisions/ADR-060-LINE-OA-STUDIO-DOMAIN-AND-MULTI-ACCOUNT-BOUNDARY.md)
and local clauses LOS-RQ-065/084/085/086 are not selected by a current canonical
FR or schema for this profile. The clauses and their 2026-09-05 historical
answer remain here for provenance; this note grants no new approval or
retirement and implies no replacement timer or job contract.

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

LINE OA Studio SHALL follow its current Server/Core ownership and service
boundaries under ADR-018, ADR-025 D8, ADR-100, ADR-105 and ADR-106. ADR-025 D8
adopts domain taxonomy and logical ownership only; the candidate target
modular-monolith runtime choices are not an accepted implementation contract.
It SHALL:

- use the current Server/Core product boundary and this domain's owning
  contracts; repository paths are documented by the service index;
- own only its declared operational state and expose explicit application
  contracts;
- use approved cross-domain contracts, read models and the shared audit seam;
- reach LINE only through the approved server Integration port and durable
  Server/Core-owned work;
- remain selectively extractable only if a future scale, security, availability
  or ownership requirement justifies it.

It SHALL NOT hold a LINE channel secret or channel access token, call a LINE
API except through the Integration lane's port, activate LINE routing, create a
second connection registry, secret manager, raw-ingestion store, identity model,
file store or membership model.

### 2.1 Stateless application tier (ADR-105 approved for implementation)

The Studio Web/API tier and LINE runtime workers SHALL be disposable process
instances. Correctness SHALL come from durable Zuri state, the Integration
SecretStore and explicit contracts, not from process memory, local queues, local
timers, local files or a particular worker identity.

This requirement does not make the LINE OA Studio domain stateless. The domain
continues to own durable account, design, dispatch, schedule and insight state,
and the Studio-owned `LineOaRichMenuJob` under its selected contract. Core owns
conversation-job state and fencing. A cache may be used only as a disposable
optimisation; this clause does not define a universal transport-job entity.
Under ADR-105 D3, any schedule selected by an accepted behavior is durable and
uses lease/idempotency recovery; a local timer is only a wake-up hint. This does
not select the proposed `LineOaSchedule` schema or scheduler-specific dispatch
and flow-WAIT behavior described in §5.7.

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

### 3.2 Core owns the turn; Agent supplies its declared answer policy

The earlier `zuri.command-agent` transport-owner wording in BR-011 is a
historical transport name. Current LINE admission, ownership fencing and reply
execution follow the server-owned Core and Conversation Runtime contracts in
ADR-100, ADR-106 and ADR-110. Agent remains a provider/answer-policy owner where
its contract assigns that work; it does not independently authorize a second
reply path or Edge relay. FR-050 and FR-140 remain preserved canonical records,
but this minimum profile defers their legacy transport-specific behavior until
a separately accepted replacement transport contract exists. Do not transplant
FR-050's one-model-request clause into the Runtime tool-loop.

`zuri_core.line_channel_binding`, activation/rollback/canary (FR-052, FR-055,
ADR-020) and the webhook seam (FR-028) remain governed by their current owning
contracts. The one-reply user outcome follows current native LINE requirements
and accepted server/runtime decisions, not the retired `zuri.command-agent`
transport name.

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

### 3.3 LINE conversation execution is server-owned

> **Current amendment — ADR-100.** For new LINE OA conversation work, `EDGE` is
> retired from this domain's execution vocabulary: transport is `CLOUD` and
> execution is `SERVER`. The EDGE/CLOUD clauses below remain historical context
> for the earlier FEAT-019 design and are not a license to create new EDGE
> conversation jobs. ADR-110 D1/D5 later retires the remaining Edge Device
> extraction, credential and pairing surfaces; those behaviors are out of the
> current product profile while ADR-110 D3 preserves their existing stored
> records and schema.

The paragraphs and clauses below preserve the earlier FEAT-019 topology for
traceability. The current LINE OA path is the ADR-100 server-only amendment:
new accounts use `CLOUD` transport and `SERVER` execution, and the worker may be
replaced or scaled because its authority is durable state rather than process
memory.

- **LOS-RQ-007 — Generalized transport job (historical sketch).** The earlier
  proposal assigned every LINE call to one `LineOaTransportJob`; that shared
  entity and lifecycle are not selected by the current profile. Rich-menu
  publication uses the Studio-owned `LineOaRichMenuJob` contract (FR-152,
  ADR-061/105). Conversation admission and leases use the Core-owned
  `LineConversationJob` contract (ADR-106). Other provider operations require
  their own accepted contract; this local clause does not define one.
- **LOS-RQ-017 — EDGE claimant (historical).** This earlier LINE conversation
  path is retired by ADR-100/110. Device claim, extraction and pairing behavior
  is retired from current product scope by ADR-110 D1/D5; stored records and
  schema are retained by ADR-110 D3.
- **LOS-RQ-018 — Disposable server workers.** A Studio worker may claim and
  execute only work assigned to its selected owner contract. For rich-menu
  publishing, the Studio worker uses the durable `LineOaRichMenuJob` contract
  and Integration's LINE port. Core owns conversation job claims and leases;
  the Conversation Runtime requests them through the versioned Core port. The
  Integration port resolves credentials per call and never returns secret
  material. This clause does not assign all LINE jobs to Studio.
- **LOS-RQ-019 — Server-only owner.** A new LINE OA account SHALL use `CLOUD`
  transport and `SERVER` execution. No user action may switch a new account to
  EDGE conversation execution; historical rows are evidence of what ran and are
  not rewritten by this SRS.
- **LOS-RQ-008 — Bytes to the lease holder only (historical Edge clause).** This
  device-byte behavior is retired from active scope by ADR-110 D1/D5 together
  with Edge extraction and device routes. ADR-110 D3 retains data and schema;
  that retention does not authorize new device byte access.
- **LOS-RQ-009 — Results are references.** The selected rich-menu job result
  carries provider references and its accepted outcome only; it never carries
  token material or an unapproved request/customer-content echo. Conversation
  delivery receipts follow their Core/CRM contracts. This local clause does not
  define a shared result schema for unrelated provider operations.

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
`LineOaTemplate`, `LineOaDispatch`, the Studio-owned `LineOaRichMenuJob`,
`LineOaInsightSnapshot`, and pure calculators over those records. Core owns
`LineConversationJob` admission, writes, claims and leases; Integration owns the
LINE provider port and secret resolution. No shared `LineOaTransportJob` is
implied by the similar LINE subject matter.

### 3.8 Runtime statelessness and persistence boundary

- **LOS-RQ-130 — Durable authority.** Every state needed to resume a request,
  webhook, job, schedule or receipt SHALL be persisted in the owning Zuri domain
  or its approved external authority before the process may forget it.
- **LOS-RQ-131 — Restart safety.** Replacing an API or worker instance SHALL not
  lose accepted work, audit evidence, credential lifecycle state or a truthful
  receipt.
- **LOS-RQ-132 — Leased work.** A worker SHALL claim asynchronous work through a
  durable lease with scope, claimant, expiry, retry/idempotency key and version;
  an expired lease SHALL be reclaimable without creating a second external send.
- **LOS-RQ-133 — Integration secret boundary.** Studio and workers SHALL use an
  opaque connection reference. Only Integration's port may resolve the secret,
  and the secret SHALL not appear in Prisma values, job payloads, logs, responses
  or audit payloads.
- **LOS-RQ-134 — Journal roles.** Session, user usage, business mutation,
  credential lifecycle, asynchronous job, agent trace and external-ingestion
  evidence SHALL retain their existing purpose-specific records. A future
  Activity Timeline SHALL be a read-only projection, not a new authority.
- **LOS-RQ-135 — Shared asset durability.** Rich-menu and Flex bytes SHALL be
  available through the File management contract and SHALL not depend on a
  container-local filesystem.
- **LOS-RQ-136 — Scope-preserving service extraction.** If the runtime worker is
  deployed as an independent service, it SHALL use an authenticated versioned
  contract and SHALL not write another domain's tables directly.

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
- **LOS-RQ-029 — Transport mode per account (superseded).** The former `EDGE` /
  `CLOUD` account choice and `EdgeDeviceCredential` dependency are not current
  behavior. New LINE conversation execution is server-owned under ADR-100 and
  ADR-106; ADR-110 retires the device surfaces. No account selection, operator
  action or saved historical mode may create Edge work.

## 5. Functional requirements by capability

### 5.1 Accounts

- **LOS-RQ-030 — Account list and health.** The Dashboard and Accounts pages
  SHALL list the Business's accounts with computed health: connection status
  and secret readiness (integration), binding status (agent), last webhook
  receipt time (integration raw evidence), status from the selected
  `LineOaRichMenuJob` and Core-owned `LineConversationJob` contracts,
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
  SHALL freeze the version and queue a Studio-owned `LineOaRichMenuJob` under
  FR-152; the external `richMenuId` returned by that contract SHALL be recorded
  as an external reference on that version.
- **LOS-RQ-042 — Default and aliases.** Setting the default rich menu, an alias,
  or linking a menu to a subject SHALL use only an accepted rich-menu operation
  under the `LineOaRichMenuJob` contract. FR-152 selects publish, set-default
  and set-alias operations; a separate subject-link operation is not implied by
  this clause unless an accepted contract defines it.

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
- **LOS-RQ-066 — Single reply preserved.** A flow match SHALL produce no more
  than the reply outcome allowed by the native LINE conversation contracts
  (FR-148/FR-149 under ADR-100/106); additional Studio messages SHALL use the
  approved dispatch flow in §5.6.
- **LOS-RQ-067 — Published configuration for edge runtimes (historical).** This
  device snapshot behavior is retired with the Edge Device surfaces by ADR-110
  D1/D5. It does not authorize a device route, credential, client or new
  execution path; existing rows/schema remain under ADR-110 D3.

### 5.5 LIFF and templates

- **LOS-RQ-070 — LIFF registry.** An account MAY register LIFF app metadata
  under its accepted Studio contract. Provider-side LIFF creation or update is
  not covered by the current rich-menu job contract; no shared transport job,
  endpoint or receipt shape is selected here. The external `liffId`, when
  supplied through an accepted contract, remains an external reference.
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
- **LOS-RQ-082 — Idempotency.** Apply the exact idempotency rule of the accepted
  contract for a dispatch operation. The earlier one-dispatch/one-generic-job
  mapping is not an operative contract, and this local clause does not create
  a shared `LineOaTransportJob` or re-queue protocol.
- **LOS-RQ-083 — Receipt.** The receipt SHALL record LINE's acceptance class,
  request id and counts; `ACCEPTED_BY_LINE` SHALL NOT be presented as delivered
  or read (ADR-020 #7). Receipt fields and persistence follow the accepted
  operation contract; this clause does not define a universal transport receipt.
- **LOS-RQ-084 — Scheduled dispatch.** A dispatch MAY carry a `scheduledFor`
  instant. Queuing it SHALL create a `LineOaSchedule` row instead of a transport
  job, and the transport job SHALL be created only when the schedule fires
  (LOS-RQ-085). Approval, consent, quota and confirmation gates SHALL be
  evaluated at scheduling time and again at fire time; a dispatch whose gate
  fails at fire time SHALL be marked FAILED with the reason, never sent.
- **LOS-RQ-087 — One send, one receipt path (current selected paths).** A
  conversation reply uses the Core-owned conversation path and its CRM delivery
  receipt contract (FR-093); it is not a Studio dispatch job. Rich-menu
  publication uses its `LineOaRichMenuJob` result. A generic job/result path for
  other Studio-initiated dispatches is not selected here. The withdrawn
  Edge-to-Server delivery adapter is not recreated.

### 5.7 Scheduler (Studio-owned)

> **Scope status.** The following clauses preserve a proposed local design and
> its historical owner answer. [ADR-105 D2/D3](../../decisions/ADR-105-LINE-OA-STUDIO-STATELESS-APPLICATION-TIER.md)
> selects the general invariant that Studio owns selected schedule state and
> accepted schedules persist, use the owning lease/idempotency discipline, and
> survive worker replacement; a process-local timer is only a wake-up hint.
> Those invariants remain operative wherever an accepted behavior selects a
> schedule. They do not adopt the concrete proposed `LineOaSchedule` model,
> scheduled-dispatch behavior or timed flow-WAIT behavior below. No substitute
> timer or job contract is defined here.

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

### 5.8 Analytics and Command Center

- **LOS-RQ-090 — Insight snapshots.** `translateInsightRecord` SHALL produce a
  per-account, per-day snapshot (followers, targeted reaches, blocks, delivered
  messages by type) deterministically from an immutable raw record; the same
  input SHALL yield the same snapshot (NFR-018's shape).
- **LOS-RQ-091 — Sourced tiles.** Every Dashboard and Analytics figure SHALL
  name its source (LINE insight, crm read model, Studio records); nothing SHALL
  be estimated.
- **LOS-RQ-092 — Command Center.** The Command Center SHALL show, per account:
  health, statuses and correlation ids exposed by the selected
  `LineOaRichMenuJob` and Core `LineConversationJob` contracts, recent
  dispatches and receipts available through their accepted contracts, recent
  conversations (CRM read model) with a deep link to the CRM Inbox, and quota;
  it SHALL offer the dispatch console under §5.6 rules. It SHALL NOT offer
  human takeover; that stays in the Inbox. No universal transport-job status
  projection is implied.

### 5.9 Projections and settings

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
- **LOS-RQ-104 — Persistence profiles (resolved by accepted decisions).** Local
  and offline use SHALL use the SQLite repository profile; hosted Server/Core
  use SHALL use the accepted PostgreSQL profile under ADR-018. These profiles
  preserve the owning domain contracts but do not imply network sync, dual-write,
  automatic cutover, or per-domain PostgreSQL schemas (ADR-025 D8). This
  clarification follows the accepted global persistence decision and does not
  create a new global requirement row.
- **LOS-RQ-120 — Disposable instances.** API and worker instances SHALL be safe to
  scale, restart and replace without relying on local process state.
- **LOS-RQ-121 — Recovery.** Shutdown, timeout and crash recovery SHALL leave a
  durable state that a later instance can reconcile; `UNKNOWN` and `SENDING`
  SHALL never be silently treated as delivered.
- **LOS-RQ-122 — Idempotency.** Duplicate webhook admission, job claim,
  completion and retry requests SHALL have one durable outcome per scoped
  idempotency key.
- **LOS-RQ-123 — Correlation.** A user action or LINE event SHALL be traceable
  through request/session, mutation, job/receipt and agent execution where those
  stages exist, without exposing secret or forbidden customer content.

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
- **LOS-RQ-115 — No local secret authority.** A process-local cache of a resolved
  credential, if used, SHALL be bounded and disposable; loss of the cache SHALL
  not change authorization, scope or credential selection.
- **LOS-RQ-116 — Journal redaction.** `AuditEvent`, `UsageEvent`, job receipts and
  agent traces SHALL exclude channel secrets, model keys, authorization headers,
  raw LINE user ids and unapproved customer content.

## 8. Data model candidates and source boundary

The following historical sketches explain the domain design. They do not
declare current Prisma fields, relations, routes or wire shapes. Read the exact
persisted schema from `apps/server/prisma/schema.prisma` and exact API behavior
from accepted canonical endpoint contracts. Any Edge-only field below is
historical and cannot authorize new product behavior.

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
| Historical `LineOaTransportJob` sketch | accountId, businessId, kind, payloadJson, status, lease/version, attempts, resultJson?, error?, correlationId, idempotencyKey | not a current model or shared contract; current job owners are listed above |
| `LineOaSchedule` | accountId, businessId, kind (DISPATCH_SEND_AT / FLOW_WAIT_RESUME), dueAt, targetRef (dispatchId or flowSessionId), status, leaseExpiresAt?, attempts, firedJobId?, idempotencyKey, version | the Studio's own timer; fires at most once |
| `LineOaInsightSnapshot` | accountId, snapshotDate, followers, targetedReaches, blocks, deliveredJson, rawExternalRecordId, translationVersion | unique per (account, date, translationVersion) |

Internal keys and external references follow the owning persisted schema and
canonical contract. This SRS candidate list does not impose a universal UUID,
timestamp, or `version` field on every row.

The current Server schema is shared across its declared domain owners: Identity
owns identity records, Integration owns connection and credential metadata,
Studio owns its declared Studio records including `LineOaRichMenuJob`, and Core
owns `LineConversationJob` admission and execution state. A similar LINE subject
does not merge those ownership contracts. Runtime extraction does not grant the
Runtime a second database or direct table access. Secret material stays outside
ordinary Prisma persistence in the configured SecretStore.

## 9. Contracts

### 9.1 Historical device application contract (retired)

See the charter's "Public contract direction". The device-facing transport-job
routes are:

```text
POST /api/line-oa/transport-jobs/claim               → 204 when the queue is empty
GET  /api/line-oa/transport-jobs/[id]/bytes           → bytes for the lease holder only
POST /api/line-oa/transport-jobs/[id]/complete        → { externalIds, acceptanceClass, counts }
POST /api/line-oa/transport-jobs/[id]/fail            → { reason }
GET  /api/line-oa/accounts/[accountId]/published-config → ETag-versioned snapshot for the EDGE runtime
```

The route list and old `edgk_…` authentication text are historical only.
ADR-110 retires the device credential and route surfaces; their retained rows
and schema are for recovery/provenance, not new authorization. This text does
not specify the current worker protocol or transport owner.

The block above is a historical Edge Device contract. ADR-110 D1/D5 removes
these surfaces from current product scope; ADR-110 D3 preserves their existing
records and schema. No new implementation may use these paths or credentials.
Current LINE execution uses the server-owned Core/Runtime boundary in ADR-100
and ADR-106.

### 9.2 Historical Edge wire contract (retired)

The earlier proposal for `contracts/line-oa-transport-job.schema.json` to define
device job calls in the style of `contracts/edge-extraction-job.schema.json` is
retired with the Edge surfaces by ADR-110. Those historical schemas are not
current API authorization. Current machine-readable LINE/Runtime contracts are
the accepted Server-owned contracts selected by ADR-100 and ADR-106. The former
proposal listed a job status enum, lease semantics and a `kind`-discriminated
payload for rich-menu upload/create/update/delete, LIFF operations, dispatch,
and Insight pull. This list is historical design context only; no device API,
payload, queue or transport contract is authorized by it.

### 9.3 Current server and Runtime boundary

The Runtime uses the versioned Core operations and trust boundary defined by
ADR-106. Core owns viewer resolution, admission, durable state, ownership fencing
and recovery; the Runtime owns only the versioned conversation computation
contract and receives no direct database or reusable LINE credential authority.
Do not infer a new queue protocol or transport owner from the retired device
contract above. The service boundary, request schemas and operation behavior are
those selected by the accepted ADR and current service contract.

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

The phase and rollout maps under `docs/roadmap/` describe delivery sequencing
and evidence. They do not expand the canonical product baseline, approve a
Runtime implementation choice, or establish production activation. Runtime
selection and behavior follow ADR-105/106; live provider behavior and activation
remain separately qualified.

## 12. Historical decisions and remaining evidence boundaries

The former Edge transport and device-owner answers below are historical and are
superseded by ADR-100/106/110. They must not be read as a current execution or
activation requirement. The still-applicable domain design decisions include:

1. **Tenant-scope templates — answered in the earlier design.** Business scope is enough
   for the first release; `TENANT` stays a reserved value (LOS-RQ-024,
   LOS-RQ-072).
2. **Scheduler — answer recorded in proposed design history.** The 2026-09-05
   answer described a Studio-owned scheduler, scheduled dispatch in Phase 2 and
   timed WAIT in Phase 3 (§5.7, LOS-RQ-085/086). This preserves that historical
   answer without selecting those concrete behaviors for this profile; the
   accepted ADR-105 durability invariants remain as stated in §§0.1 and 2.1.
3. **Publisher role name — answered in the earlier design.** `LINE_OA_PUBLISHER` is
   confirmed (LOS-RQ-010).

This document does not establish production activation, successful LINE API
delivery, or live-provider acceptance. Those claims require the appropriate
current evidence under the verification policy.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.6.0b / reconciliation 2026-10-21.1 | 2026-10-21 | explanatory reconciliation — no new approval | Clarified the selected rich-menu and conversation job owners and marked the earlier generalized transport-job sketch as historical; baseline version and canonical requirement identities are unchanged | Codex |
| 0.6.0b | 2026-09-23 | approved baseline | Approved SRS revision; implementation and production activation are separate evidence questions | RWANG |
| 0.5.0b | 2026-09-23 | candidate | Added ADR-105 proposal for stateless Studio API/runtime workers over durable domain state, Integration-owned secrets, purpose-specific journals and restart/idempotency requirements | RWANG |
| 0.4.0b | 2026-09-06 | candidate | Added explicit FEAT-019 phase links and current server/Edge evidence boundaries; no runtime or ownership manifest changes | RWANG |
| 0.3.1 | 2026-09-05 | proposed | Added LOS-RQ-087 (one send, one receipt path: FR-093 for reply-turn sends, the job result for Studio-initiated sends) and put the scheduler section in order as §5.7 | Claude Code |
| 0.3.0 | 2026-09-05 | proposed | Owner's answers to the last three questions: Business-scope templates for the first release (LOS-RQ-072), a Studio-owned scheduler (§5.7, LOS-RQ-085/086; 065 and 084 reworded), `LINE_OA_PUBLISHER` confirmed | Claude Code |
| 0.2.0 | 2026-09-05 | proposed | Owner's answer on edge devices: transport mode per account (LOS-RQ-017..019, 029), published-config pull for edge runtimes (LOS-RQ-067), open questions 1–2 answered | Claude Code |
| 0.1.0 | 2026-09-05 | proposed | First draft: boundaries, multi-account model, capability requirements, security, data-model candidates, contracts, surfaces, phasing and open questions | Claude Code |
