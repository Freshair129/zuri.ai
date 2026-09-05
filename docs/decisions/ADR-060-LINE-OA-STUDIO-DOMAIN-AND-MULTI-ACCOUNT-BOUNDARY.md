---
version: "0.1.0"
created_at: "2026-09-05T00:00:00+07:00,Claude Code"
last_update: "2026-09-05T00:00:00+07:00,Claude Code"
status: "proposed"
superseded_by: null
attributes:
  domain: "line-oa-studio"
  doc_type: "architecture-decision"
  scope: "LINE OA Studio product-domain boundary, multi-account model, credential/transport ownership, rich menu / Flex / flow / LIFF / dispatch / insight ownership, navigation identity and modular-monolith runtime shape"
---

# ADR-060 — LINE OA Studio is a first-class Zuri domain: the multi-account command center for LINE Official Accounts

**Status:** Proposed architecture and documentation boundary, awaiting owner
acceptance. No runtime module code, route, model, migration or implementation
requirement is authorized by this ADR alone.

**Date:** 2026-09-05

**Decided by:** pending — Boss (owner). Drafted from the owner's request of
2026-09-05 ("ออกแบบโดเมน LINE OA command center (LINE OA Studio) — ใช้งานได้แบบ
multi account") and the owner's reference screenshots of a LINE Studio prototype
(nine screens dated 2026-08-27: Dashboard, Projects, Templates, Analytics, Team,
Media, Settings, and a per-project Design Studio with Flow Designer, Flex
Message, Rich Menu and LIFF App tabs).

**Repository baseline surveyed:** `74ff4e9f7537f0815ecc1b8283f6ad2d22779de2`
(`origin/main`, 2026-09-05).

**Relates to:** [ADR-007](ADR-007-LINE-AI-STACK-SEQUENCING.md) (LINE is a
channel with authority over nothing), [ADR-018](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md),
[ADR-020](ADR-020-CONTROLLED-LINE-BINDING-ACTIVATION-AND-RECEIPT.md) (activation
is operator-only; receipts are truthful), [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
[ADR-029](ADR-029-STABLE-IDENTITY-BINDINGS-FOR-EXECUTION-PLANS.md) (stable
domain ids), [ADR-031](ADR-031-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md),
[ADR-032](ADR-032-INTEGRATION-SECRET-MANAGEMENT-UI.md) (Integrations is a
Platform sub-domain), [ADR-038](ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md)
and [ADR-055](ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md)
(the two precedents for adding a domain), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md)
(edge secrets stay on the edge; the cloud console shows no secret),
[ADR-044](ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md) (Tier 1 owns
the live console and push transport), [ADR-045](ADR-045-CANONICAL-IDENTITY-AND-ACCESS-MANAGEMENT.md),
[ADR-059](ADR-059-EDGE-EXECUTED-EVIDENCE-EXTRACTION.md) (the pull-model job
precedent), `docs/domains/integration/CHARTER.md`, `docs/domains/agent/CHARTER.md`,
`docs/domains/crm/CHARTER.md`, `docs/domains/identity/CHARTER.md`,
[`docs/SITEMAP-DOMAIN-NAV.md`](../SITEMAP-DOMAIN-NAV.md), and the domain pack this
ADR introduces: [charter](../domains/line-oa-studio/CHARTER.md),
[context map](../domains/line-oa-studio/CONTEXT-MAP.md),
[SRS](../domains/line-oa-studio/SRS.md).

**Amends:** ADR-029 D2 and the stable product-domain catalog by adding
`DOM-LINE-OA-STUDIO`. It renames, reuses or moves no existing domain id, route
key, requirement id or model.

## Context

LINE is this product's primary surface (`docs/PRODUCT.md` §1), and the LINE
stack is already substantial — but it is spread across four lanes, none of which
is *about* the Official Account itself:

| What exists today | Lane | What it answers |
|---|---|---|
| `IntegrationProvider` `LINE_OA`, `IntegrationConnection`, `IntegrationCredential`, raw webhook evidence (FR-080, FR-081) | integration | "which connection, which opaque secret reference, what arrived" |
| `zuri_core.line_channel_binding`, activation, canary, the webhook seam, the agent turn (FR-052, FR-055, FR-028, FR-057) | agent | "which Tenant/Business does this destination route to, and what does the AI answer" |
| `Customer`, `Conversation`, `Message`, the Inbox and the reply receipt (FR-023, FR-091, FR-093) | crm | "who said what, and what did we send back" |
| `ExternalIdentity`, `ChannelIdentity` namespaced by `channelAccountId` (FR-021, FR-022, FR-097) | identity | "which Person is this LINE subject, in which channel account" |
| LINE Group / LINE User registry inside `/platform/integrations` (FR-080) | integration | operator-shaped bookkeeping of groups and staff subjects |

Nothing owns the questions a business actually asks about its LINE OA every day:
*what does the rich menu look like, which welcome flow runs on follow, which Flex
card do we send for an order status, which LIFF app is registered, how many
followers do we have, what is queued to go out, is the webhook alive — and the
same again for the second and third OA the business runs.* The reference
prototype the owner supplied is a picture of exactly those questions with a
console around them. Its vocabulary ("Project") collides with Development's
`Project`; its "Team" and "Media" pages duplicate identity and file management;
and its single-account shape does not express the owner's requirement, which is
**multi-account**: one Business operates several Official Accounts (brand,
support, branch, campaign), and a Tenant may hold several Businesses that each
do so.

Two facts in the substrate already favour multi-account, and one blocks it:

- `IntegrationConnection` is unique on `(tenantId, providerId,
  externalAccountId)` with an optional `businessId`, so N `LINE_OA` connections
  per Business are expressible today.
- `zuri_core.line_channel_binding` is unique only on `code`, indexed by
  `(tenant_id, business_id, status)`, and resolved by the hashed LINE
  `destination` (the bot's own user id, i.e. the account); the persisted
  resolver (`createPostgresLineBindingResolver`) already supports N active
  bindings per Business, and identity already namespaces `ChannelIdentity` by
  the binding code (`channelAccountId`, FR-097). Only the env-configured
  single-binding resolver is one-account by construction.
- **`Conversation` is not account-aware.** The webhook derives the thread key as
  `groupId || roomId || userId` and `Conversation` is unique on `(tenantId,
  channel, externalThreadId)` — so one LINE user talking to two Official
  Accounts of the same Tenant collapses into one Conversation, and an inbox or
  analytics view "per account" cannot be truthful until the account joins the
  thread identity. That is a crm-owned change and is declared here as a
  prerequisite, not silently absorbed.

Putting the capability under Platform → Integrations would make an operator
credential surface into a daily design and dispatch tool for business staff.
Putting it under CRM would make the domain that owns *what was said* also own
*how the account looks and behaves*. Putting it under Marketing would leave rich
menus, flows, LIFF and account health with no owner between campaigns. A separate
"LINE Studio" application would duplicate authentication, Business scope, audit
and the single-reply-owner rule. The missing capability is a Business domain: the
**design, publication and operation of LINE Official Accounts, many per
Business**.

## Decision

### D1 — Add one first-class Product Domain: LINE OA Studio

The stable product-domain catalog gains:

```text
DOM-LINE-OA-STUDIO
route key: line-oa
display label: LINE OA Studio  (ศูนย์บัญชาการ LINE OA)
technical owner: TD-LINE-OA-STUDIO
module: src/modules/line-oa-studio
docs lane: docs/domains/line-oa-studio/
```

LINE OA Studio is a peer Business capability domain inside the existing Zuri
modular monolith, alongside CRM, Market Intelligence, Asset Management and the
rest. It uses the same deployment, origin, authenticated session, selected
Business context, audit and design system as every other domain. It is not
deployed at a separate host in this decision. Its initial route surface is on
the existing application origin:

```text
/line-oa                                   Dashboard — accounts of the selected Business
/line-oa/accounts                          account list · connect a new account
/line-oa/accounts/[accountId]              account overview and health
/line-oa/accounts/[accountId]/studio       Design Studio: Rich Menu · Flex · Flows · LIFF
/line-oa/accounts/[accountId]/dispatches   push · multicast · broadcast · narrowcast
/line-oa/accounts/[accountId]/analytics    per-account insights
/line-oa/templates                         template library (system · tenant · business)
/line-oa/analytics                         cross-account analytics for the selected Business
/line-oa/command-center                    live health, queued transport jobs, dispatch console
/line-oa/settings                          Business-level Studio settings
```

As required by the scope-free URL contract (ADR-006), `tenantId` and `businessId`
never appear in the path. An `accountId` **does**: an Official Account is a
resource inside a Business, exactly as a Project is inside Development, not a
shell scope.

### D2 — One Business, many Official Accounts: `LineOaAccount` is the aggregate

The prototype's "Project" becomes **`LineOaAccount`** — never Zuri's `Project`,
which belongs to Development, and never a Tenant or Business. The account is the
unit of everything in this domain.

```text
LineOaAccount
  id                      internal UUID
  code                    human-readable, unique per Tenant (e.g. oa-smartgift-main)
  tenantId                isolation boundary
  businessId              the ONE operating Business
  displayName             what staff see (not authority)
  basicId?                LINE "@handle" — external attribute, never a key
  integrationConnectionId 1:1 → IntegrationConnection (provider LINE_OA) — reference
  bindingCode?            the agent's binding code = identity's channelAccountId — reference
  status                  DRAFT | CONNECTED | LIVE | PAUSED | ARCHIVED   (Studio's operating view)
  isDefaultForBusiness    at most one per Business
  botProfileJson          presentation config: greeting, fallback text, persona label
  createdAt · updatedAt · version · archivedAt?
```

Rules:

1. A Business may own any number of accounts; an account belongs to exactly one
   Business, mirroring `IntegrationConnection.businessId` and
   `line_channel_binding.business_id`. Moving an account between Businesses is a
   new account plus an archive, never an update in place.
2. Every row this domain owns carries `tenantId`, `businessId` and
   `lineOaAccountId`. The account id in a request is a *selector the server
   validates against the viewer's visible Businesses*, never an authority input
   (SEC-001, BR-012 pattern). A rich menu, flow, dispatch or job can never be
   attached to an account outside the caller's scope: the repository is bound
   to the scope at construction and refuses, rather than filters afterwards.
3. LINE identifiers — channel id, basic id, bot user id (`destination`),
   `richMenuId`, `liffId`, request ids — are external attributes mapped through
   `ExternalRef` / `ExternalEntityRef` (BR-002). None is a primary key or a
   uniqueness authority on its own.
4. Cross-account sharing exists in exactly one place: templates, with an
   explicit scope (`SYSTEM` | `TENANT` | `BUSINESS`). Everything else is
   per-account. "Copy to another account" is instantiation with lineage, not a
   shared row.
5. The Dashboard, Analytics and Command Center aggregate **the accounts of the
   selected Business** the viewer may see. The shell stops at Business
   (ADR-011); there is no portfolio-wide Studio view in this decision.

### D3 — An account is the join of three authorities the Studio does not own

Connecting an Official Account composes existing seams; the Studio adds a
record over them and computes health from them:

```text
IntegrationConnection (LINE_OA)   integration  — connection + opaque secretRef metadata (FR-080, ADR-032)
line_channel_binding (code)       agent        — destination → Tenant/Business routing; activation (FR-052, FR-055, ADR-020)
channel credential + transport    edge/zuri-cli — channel secret, channel access token, Messaging API calls (ADR-041 D2, BR-011)
                 └──────────────► LineOaAccount  line-oa-studio — the operating record that references all three
```

- "Connect account" in the Studio calls the integration lane's owner-only create
  contract for a `LINE_OA` connection; it does not write `IntegrationConnection`
  or `IntegrationCredential` itself and never accepts secret material.
- The Studio **never activates routing**. Binding activation, rollback and
  canary remain the operator-only path of ADR-020 / FR-055. The Studio shows the
  binding state it reads and links to the runbook.
- `LineOaAccount.bindingCode` is the join key to identity's `channelAccountId`
  and to the agent's binding; an inbound event therefore reaches the Studio's
  per-account configuration only after the agent has resolved scope from the
  server-owned binding, never from the payload.
- Account health is computed, never stored: connection status and secret
  readiness (integration read model), binding status (agent read model), last
  webhook receipt (`RawExternalRecord.receivedAt` for the connection), queued or
  failed transport jobs (this domain), and quota from the latest insight
  snapshot (this domain).

### D4 — LINE OA Studio owns design, publication and operating state

`TD-LINE-OA-STUDIO` owns, once their implementation requirements are declared:

| Concept | Owned meaning |
|---|---|
| `LineOaAccount` | the aggregate above |
| `LineOaRichMenu` (+ versions) | layout (1×1, 2×1, 2×2, 2×3, 3×1, 1×2), chat-bar text, tap areas and their actions, image `FileAsset` reference, alias, default flag, published state and the external `richMenuId` after deployment |
| `LineOaFlexTemplate` / `LineOaFlexMessage` | validated Flex JSON (bubble/carousel), variables, preview state; kinds such as HERO_CARD, PRODUCT_CARD, ORDER_STATUS, CUSTOM |
| `LineOaFlow` / `LineOaFlowVersion` | the automation graph: triggers (FOLLOW, MESSAGE_KEYWORD, POSTBACK, RICH_MENU_TAP), nodes (START, MESSAGE, QUICK_REPLY, FLEX, CONDITION, LIFF, PUSH, CONNECTOR_ACTION, VARIABLE, WAIT, END), edges; immutable once published |
| `LineOaFlowSession` | the per-account, per-channel-subject cursor through a published flow: node, variables, expiry |
| `LineOaLiffApp` | the registry of LIFF apps per account: name, view size, endpoint, scope, external `liffId` |
| `LineOaTemplate` | the library: kind (FLOW, FLEX, RICH_MENU, LIFF), category, `SYSTEM`/`TENANT`/`BUSINESS` scope, official flag, body, and usage derived from instantiation lineage |
| `LineOaDispatch` | an outbound intent: PUSH, MULTICAST, BROADCAST, NARROWCAST or TEST; audience specification; messages; schedule; approval; receipt |
| `LineOaTransportJob` | the queued unit of work the trusted transport owner claims and executes (D5) |
| `LineOaInsightSnapshot` | per-account, per-day translated LINE Insight facts: followers, targeted reaches, blocks, delivered message counts by type |

It also owns the pure calculators over these records: rich-menu bounds
validation, Flex schema validation, the flow interpreter, dispatch audience and
quota gates, insight translation.

### D5 — Credentials and transport stay where they are; publishing is a queued job

The Studio holds **no** LINE channel secret and **no** channel access token, and
it never calls the LINE Messaging API from the cloud. Both facts already stand:
ADR-041 D2 keeps edge secrets — "LINE Channel Secret, Access Tokens" — on the
edge; ADR-041 D3 forbids the cloud console from capturing, storing or displaying
them; BR-011 and ADR-031 D5 make the transport owner the sole LINE signature and
Reply API owner.

Every operation that must reach LINE — uploading a rich menu image, setting the
default rich menu, linking a rich menu to a user, creating or updating a LIFF
app, sending a push, multicast, broadcast or narrowcast, pulling Insight — is
therefore a **`LineOaTransportJob`**, and the pattern is ADR-059's pull model
verbatim:

```text
Studio (cloud)                                trusted transport owner
  queue job {kind, accountId, payload,         (zuri-edge-device runtime or zuri-cli,
             idempotencyKey, correlationId}     holding the account's channel token)
        │                                            │
        │◄──────── claim (Bearer edgk_…, FR-144) ────┤   QUEUED → CLAIMED, 10-minute lease
        │───────── bytes to the lease holder only ──►│   e.g. the rich-menu image (ADR-059 D4)
        │                                            │   performs the Messaging API call
        │◄──────── complete {externalIds, counts} ───┤   CLAIMED → COMPLETED
        │◄──────── fail {reason} ────────────────────┤   CLAIMED → FAILED
```

- The job carries external identifiers and counts back, never token material,
  never a request echo with secrets, never customer content beyond what the
  Studio itself queued.
- Receipts are truthful in ADR-020's sense: `ACCEPTED_BY_LINE` is an acceptance
  class, not delivery or reading, and `DISPLAYED_UNKNOWN` / `READ_UNKNOWN` are
  explicit states that cannot be promoted.
- Idempotency is the job's `idempotencyKey` plus the account: a re-queued
  broadcast returns the existing job (BR-014's shape), so a double click cannot
  become a double blast.
- The wire contract (`contracts/line-oa-transport-job.schema.json`) is owned by
  the cloud and coded against by the transport repository, exactly as
  `edge-extraction-job.schema.json` is today (ADR-059 D6).

A **cloud transport adapter** — resolving a LINE channel access token through
the integration lane's secret manager the way FR-079 resolves a model provider
key — is *deferred, not rejected*. It would move the channel token into the
cloud-resolvable set and must therefore amend ADR-041 D2 explicitly; until that
amendment exists the pull model is the only transport.

### D6 — Flows are data: interpreted by a pure function, executed by nobody

A flow is a strict-schema JSON graph (BR-007, SEC-002: plans are data; nothing
that arrives in a document is executed). The Studio owns the interpreter,
`evaluateFlowStep(flowVersion, event, session) → { actions, nextSession }`, as a
pure function with no I/O, and the agent domain calls it inside the existing turn
before any model work:

```text
POST /api/agent/line-webhook  →  binding-resolved scope (FR-052)
      →  identity / crm ingest (FR-021, FR-023)
      →  Studio automation: published flow for (account, trigger)?
            yes → deterministic actions → the ONE reply (FR-050, BR-011 unchanged)
            no  → the AI turn as today (FR-057)
```

- The `CONNECTOR_ACTION` node (the prototype's "API Call") may target only a
  **registered allow-list of internal contracts** — a knowledge query, a CRM
  read, an FR-132-style quotation tool — never a URL. An arbitrary-URL node is
  SSRF by design and is refused at schema level (ADR-031 D4's reasoning).
- `LineOaFlowSession` is keyed by account plus identity's channel-subject
  reference (`ChannelIdentity` / `ExternalIdentity` id), never by a raw
  `lineUserId` as a key, and expires; a `WAIT` node that needs a timer is not
  in the first slice, because this repository has no scheduler and the Studio
  must not pretend it does (the `automationJobs` lesson in
  `line-registry-service.js`).
- A flow never widens authority: it runs with the turn's resolved scope
  (ADR-045 D4), and a `PUSH` node inside a flow is a dispatch subject to D7.

### D7 — Dispatch is authorized, consented, idempotent and truthful

- Push, multicast, broadcast and narrowcast require **publisher authority**:
  Business OWNER, or the `LINE_OA_PUBLISHER` key in identity's generic
  `RoleBinding` registry (the `PRODUCT_OWNER` / FR-076 pattern). Editing a draft
  needs only an active Membership with the domain visible.
- `BROADCAST` and `NARROWCAST` additionally require a typed confirmation in the
  request body (the FR-022 `confirmation: 'ERASE'` shape), because a blast is
  irreversible and spends the account's monthly quota.
- The audience is resolved **server-side** from CRM/identity references —
  Customer ids, segments, a staff `ChannelIdentity` — never from raw LINE user
  ids supplied by the client. A `TEST` dispatch may target only the viewer's own
  linked LINE identity (FR-022 / FR-038 link state) or a registered staff
  subject.
- Marketing dispatches reach only Customers whose PDPA consent is `GRANTED`
  (FR-103, SEC-005); transactional pushes inside an existing conversation are
  per-conversation and follow the reply rules.
- One dispatch = one transport job with one idempotency key; the receipt records
  LINE's acceptance class and counts, and the Inbox's outbound record (FR-093)
  is written through the crm contract when the dispatch is conversational.

### D8 — Analytics come from LINE, through the integration substrate

Follower and delivery counts are LINE facts. They enter through an
**integration provider adapter** (`LINE_OA`, lane `INSIGHT`, pulled by a
transport job because the Insight API needs the channel token), land as
`RawExternalRecord` (FR-081), and are translated by a Studio contract into
`LineOaInsightSnapshot` — deterministic and replay-safe (the NFR-018 / FR-092
shape). Conversation and message counts come from a crm read contract. Nothing
on the Dashboard is inferred or estimated, and every tile names its source.

### D9 — Prerequisite in CRM: the account joins the thread identity

Before any per-account Inbox view, per-account message count or multi-account
dispatch receipt can be truthful, `Conversation` identity must carry the channel
account: `(tenantId, channel, channelAccountId, externalThreadId)`, with the
`channelAccountId` the webhook already passes to identity (`scope.channelAccountId`).
This is a **crm-owned** change with its own FR, declared here so no other lane
designs it elsewhere and so the Studio's Phase 1 gate names it. Existing rows
keep their identity; the migration is additive and back-fills from the single
binding that exists today.

### D10 — Media and Team are projections, not Studio records

- **Media** is the existing file-management authority: rich-menu images and Flex
  hero images are `FileAsset` rows (ADR-016, FR-045/FR-058) referenced by id.
  The Studio's media view is a filtered projection with upload through the
  existing file contract; it owns no bytes and no file metadata.
- **Team** is identity: seeing the domain is the per-Business domain grant
  `line-oa` (FR-061); publishing is `LINE_OA_PUBLISHER` (D7); inviting people
  is FR-067 Workspace invitation. The Studio's Team page lists who can view,
  edit and publish for the selected Business and deep-links to
  `/platform/users`; it owns no Membership, invite or role row.

### D11 — Authorization ladder, refusals and audit

```text
view       Business visible to the viewer  +  domain `line-oa` visible (FR-061)
edit       active Membership with the domain visible (draft designs, templates at BUSINESS scope)
publish    Business OWNER  or  RoleBinding LINE_OA_PUBLISHER  (deploy, dispatch, connect, archive)
operator   installation operator only: binding activation stays outside the Studio (ADR-020)
```

- Refusals are 404-shaped (FR-072): an account a viewer may not see is an
  account they are not told exists.
- Every write appends an `AuditEvent` through the shared `recordAudit` seam with
  a redacted payload: no token, no secret reference beyond the masked label, no
  customer message body, no raw LINE user id.
- Client, prompt, model or flow values may attenuate but never widen the
  server-owned scope (BR-020, SEC-018).

### D12 — Navigation is reserved before routes exist

The target Tier-2 slot and Tier-3 sidebar are:

```text
LINE OA Studio  (route key line-oa)
├── Dashboard          /line-oa
├── Accounts           /line-oa/accounts
├── Templates          /line-oa/templates
├── Analytics          /line-oa/analytics
├── Command Center     /line-oa/command-center
├── Media              projection of Files (FileAsset)
├── Team               projection of identity's grants and roles
└── Settings           /line-oa/settings
```

and inside an account: Overview · Design Studio (Rich Menu · Flex · Flows ·
LIFF) · Dispatches · Analytics. `DOM-LINE-OA-STUDIO` may be documented in the
stable product-domain catalog immediately. Runtime `src/config/domains.js`
wiring, pages and routes are **not** authorized by this ADR: the implementation
slice must first reserve global requirement ids and add route and navigation
tests under AGENTS.md §16–18. Until then the domain is a planned lane, not a
fake clickable surface (ADR-038 D7).

### D13 — The ADR reserves architecture identity, not implementation ids

`ADR-060`, `DOM-LINE-OA-STUDIO` and `TD-LINE-OA-STUDIO` are the identities this
decision establishes. Global `FR-*`, `FEAT-*`, `NFR-*`, `BR-*`, `SEC-*` and
`SDD-*` ids are allocated per authorized implementation slice after rebasing on
the current registries and ledger (ADR-055 D12); they are never guessed from
this ADR. The SRS uses `LOS-RQ-*` **local clause labels** that are not ids and
are not pinned — the CR-014 `AM-PRD-*` convention, not the MI-RQ one.

### D14 — Delivery is phased, each phase its own requirement slice

| Phase | Delivers | Gate |
|---|---|---|
| 0 | this ADR, charter, context map, SRS, module lane README, catalog row | `npm run govern` green; owner acceptance |
| 1 | `LineOaAccount` + connect flow over the integration contract; Rich Menu designer; `LineOaTransportJob` + wire contract + claim/bytes/complete/fail routes; `LINE_OA_PUBLISHER`; **crm thread-key prerequisite (D9)** | FR ids declared; deploy of one rich menu proven end to end with a real transport owner; receipts truthful |
| 2 | Flex designer and `TEST` dispatch; template library with SYSTEM seeds; push / multicast / broadcast / narrowcast with consent, quota and typed confirmation | one real broadcast under quota with a truthful receipt; consent gate proven by test |
| 3 | Flow designer, published versions, the interpreter inside the agent turn, `LineOaFlowSession`; LIFF registry | deterministic reply proven ahead of the AI turn without a second reply (FR-050) |
| 4 | Insight pull adapter, `LineOaInsightSnapshot`, cross-account Analytics, Command Center live view | every Dashboard tile names its source; replay-safe translation test |

## Context map

```text
                ┌──────────────────────┐          ┌──────────────────────┐
                │ Platform / Identity  │          │  File management     │
                │ viewer · grants ·    │          │  FileAsset bytes     │
                │ LINE_OA_PUBLISHER    │          │  (images for menus)  │
                └──────────┬───────────┘          └──────────┬───────────┘
                           │ authorize                       │ reference by id
                           ▼                                 ▼
┌──────────────┐ conn ref ┌──────────────────────────────────────────┐ read  ┌──────────────┐
│ Integration  ├─────────►│           LINE OA Studio                 │◄──────┤     CRM      │
│ LINE_OA conn │ raw      │  LineOaAccount (N per Business)          │ inbox │ Conversation │
│ secretRef    │ insight  │  rich menu · flex · flow · LIFF          │ count │ Message      │
│ RawExternal  ├─────────►│  templates · dispatch · transport job    │ audience refs · consent
└──────────────┘          │  insight snapshot · health (computed)     ├──────►│ (D9 prereq)  │
                          └───────┬──────────────────┬───────────────┘       └──────────────┘
                 binding code     │                  │ transport jobs (pull)
                 automation call  │                  ▼
                          ┌───────▼──────┐   ┌──────────────────────────┐
                          │    Agent     │   │ Trusted transport owner  │
                          │ binding ·    │   │ zuri-edge-device / cli   │
                          │ turn ·       │   │ channel secret + token   │
                          │ single reply │   │ Messaging API · Insight  │
                          └──────────────┘   └──────────────────────────┘
```

Business Home may project read-only account health and attention items.
Marketing (future) consumes dispatch outcomes and audience signals but owns
none of the records above.

## Consequences

- A LINE Official Account gains one operating record and one owner, and a
  Business can run several of them without any lane inventing a second
  connection, binding or identity model.
- The prototype's screens map onto the domain without duplicating Zuri: Projects
  → Accounts; Templates, Analytics and the Design Studio → Studio-owned; Team and
  Media → projections of identity and file management.
- No secret enters zuri-ai and no LINE API is called from the cloud; the cost is
  that every publish or blast is asynchronous and shows a job state, exactly as
  edge extraction does today.
- CRM must add the account to the thread identity before the Studio's
  per-account views can be truthful; declaring it here makes the dependency a
  gate rather than a surprise.
- The domain bar becomes wider by one slot; responsive and command-palette tests
  must prove the slot remains usable (ADR-055's same cost).
- Cost accepted: a first-class domain means a charter, requirement and feature
  rows per phase, navigation registration, schema ownership, transport wire
  contract, and a broader test matrix including a real transport-owner round trip.

## Alternatives rejected

**Put it under Platform → Integrations (ADR-032).** Rejected: Integrations is an
owner/operator credential and metadata surface whose charter explicitly
"never writes … LINE reply state". Designing menus, running flows and sending
blasts is daily Business work by staff who must never see a secret.

**Put it under CRM.** Rejected: CRM owns who the business talks to and what was
said. How an account looks, what it automates and what it broadcasts is a
different authority with different roles; CRM keeps the Inbox and takeover, and
the Studio links to them.

**Put it under Marketing.** Rejected: broadcasts are one capability among rich
menus, flows, LIFF, account health and quota. Marketing may consume dispatch
outcomes; it does not own the account.

**Hold channel access tokens in the cloud and call the Messaging API directly.**
Deferred: contradicts ADR-041 D2/D3 and the transport-owner rule. Recorded as a
possible future amendment with the Vault path, never as an implicit default.

**One account per Business.** Rejected: the owner's requirement is
multi-account, and the connection and binding substrate already express N.

**A separate LINE Studio application or repository.** Rejected: duplicates
authentication, Business scope, authorization, audit and the single-reply
owner; the prototype is a UI reference, not an architecture.

**Call the aggregate "Project" as the prototype does.** Rejected: `Project` is
Development's model and id family; two meanings for one word is how ids drift.

## Implementation gate

Runtime consequences of this ADR are implemented phase by phase (D14). Each
implementation branch declares its ids first, updates the charter's ownership
claims in the same change that adds a model or route, and includes generated
documentation produced by `npm run govern`; generated files are never
hand-edited. The final proof of every phase is:

```text
npm run verify
```

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0 | 2026-09-05 | proposed | Declared LINE OA Studio as a first-class multi-account Business domain; fixed credential/transport, flow, dispatch, insight, media/team and authorization boundaries; named the crm thread-identity prerequisite; reserved navigation and phased delivery | working-tree | Claude Code |
