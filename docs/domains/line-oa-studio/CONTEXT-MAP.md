---
version: "0.2.0"
status: proposed
domain: line-oa-studio
doc_type: context-map
---

# Context map — LINE OA Studio

This document records how LINE OA Studio collaborates with the authorities that
already exist. It is about **ownership and contracts**, not deployment topology:
every context below stays inside the Zuri modular monolith, and the one process
outside it — the tenant's Zuri Edge Device, for EDGE-mode accounts — is a
boundary this repository already has (BR-011, ADR-041, ADR-059).

## System context

```text
                         ┌────────────────────────┐
                         │  Platform / Identity   │
                         │ viewer · Business      │
                         │ visibility · grants ·  │
                         │ LINE_OA_PUBLISHER ·    │
                         │ ChannelIdentity        │
                         └───────────▲────────────┘
                                     │ authorize · resolve subjects
                                     │
┌──────────────────┐  connection ref ┌┴───────────────────────────┐ inbox read model ┌──────────────────┐
│   Integration    ├────────────────►│      LINE OA Studio        │◄─────────────────┤       CRM        │
│ LINE_OA provider │  raw insight    │  LineOaAccount ×N/Business │ audience refs    │ Customer ·       │
│ connection ·     │  records        │  rich menu · flex · flow · │ consent          │ Conversation ·   │
│ secretRef ·      ├────────────────►│  LIFF · templates ·        ├─────────────────►│ Message · Inbox  │
│ RawExternalRecord│  create contract│  dispatch · transport job ·│ outbound record  │ (thread-key      │
│                  │◄────────────────┤  insight snapshot          │ via contract     │  prerequisite)   │
└──────────────────┘                 └──┬───────────▲──────────┬──┘                  └──────────────────┘
                                        │           │          │
                       binding code ·   │           │          │ FileAsset id
                       automation call  │           │          ▼
                                        │           │   ┌──────────────────┐
                                        ▼           │   │ File management  │
                                ┌──────────────┐    │   │ FileAsset bytes  │
                                │    Agent     │    │   └──────────────────┘
                                │ binding ·    │    │
                                │ turn · single│    │ transport jobs (pull) · receipts
                                │ reply        │    ▼
                                └──────────────┘  ┌──────────────────────────────┐
                                                  │ LINE transport owner by mode │
                                                  │ EDGE:  Zuri Edge Device      │
                                                  │ CLOUD: Studio worker over the│
                                                  │ integration Vault LINE port  │
                                                  └──────────────────────────────┘
```

Business Home may project read-only account health and attention items.
Marketing (future) consumes dispatch outcomes. Knowledge/GKS is reached only
through a registered flow connector action.

## Context relationships

### Integration → LINE OA Studio

**Relationship:** upstream provider of connection metadata and raw evidence;
customer-supplier for account creation.

Integration owns `IntegrationProvider` (`LINE_OA`), `IntegrationConnection`,
`IntegrationCredential` (opaque `secretRef` only), `RawExternalRecord`,
`IngestionRun`, cursors and dead letters (FR-080, FR-081, ADR-032). The Studio:

- references a `LINE_OA` connection by id, 1:1 per account, and reads its
  redacted status for health;
- creates a connection only by calling the integration lane's owner-only create
  contract from "connect account" — it never writes the connection or credential
  tables and never accepts secret material;
- consumes LINE Insight records that arrive through an integration adapter
  (provider `LINE_OA`, lane `INSIGHT`) as immutable translation input with
  lineage; re-translation is idempotent and a failed translation never mutates
  the raw row;
- for `CLOUD` accounts, executes transport jobs through the integration lane's
  LINE Messaging port (a provider adapter beside the webhook normalizer), which
  resolves the account's channel access token from Vault per call
  (`IntegrationCredential.secretRef`, the FR-079 resolver shape) and never
  returns it — the Studio worker sees results, never material.

### Agent ↔ LINE OA Studio

**Relationship:** the agent is the runtime host; the Studio is a configuration
and automation supplier.

- The agent resolves Tenant/Business scope and the binding code from the
  server-owned binding (FR-052) before anything else; the Studio looks its
  account up by that code and never by payload values.
- Inside the turn, the agent calls `resolveAutomation(scope, event)` — a Studio
  contract wrapping the pure interpreter — before model work. A matching
  published flow yields deterministic actions that become the one reply
  (FR-050); no match falls through to the AI turn (FR-057). The reply owner,
  reply token handling and single-reply rule are unchanged (BR-011).
- Binding activation, rollback and canary remain the agent lane's operator-only
  path (ADR-020, FR-055); the Studio reads binding state and links to the
  runbook.
- The bot presentation profile (greeting, fallback text, persona label) is
  Studio configuration the agent reads per account; it is not knowledge and not
  memory.

### CRM ↔ LINE OA Studio

**Relationship:** CRM is the conversation authority; the Studio is a reader and
an audience resolver.

- Per-account conversation and message counts and the "recent conversations"
  panel use the crm read model (FR-091) filtered by channel account; human
  takeover stays in the CRM Inbox and the Studio deep-links to it.
- Dispatch audiences are resolved from crm references (Customer ids, segments)
  and identity's staff subjects; marketing dispatches reach only Customers with
  consent `GRANTED` (FR-103, SEC-005).
- A conversational outbound message (a push inside an existing thread) is
  recorded through the crm contract (`recordLineReply`, FR-093); the Studio
  never writes `Message`.
- **Prerequisite owned by crm (ADR-060 D9):** `Conversation` identity must carry
  `channelAccountId`. Until then, per-account inbox views and counts are labelled
  Business-wide.

### Identity → LINE OA Studio

**Relationship:** authorization and subject authority.

- View = Business visibility plus the `line-oa` domain grant (FR-061); edit =
  active Membership; publish/dispatch/connect = Business OWNER or the
  `LINE_OA_PUBLISHER` `RoleBinding` key (FR-076 pattern). The Studio declares
  the role key vocabulary and owns no binding row.
- Flow sessions and test dispatches reference identity's `ChannelIdentity` /
  `ExternalIdentity` rows, which identity already namespaces by
  `channelAccountId` (FR-097); the Studio stores no raw LINE user id as a key.
- Refusals are 404-shaped (FR-072); audit payloads carry no token, secret or
  customer content (SEC-018).

### LINE OA Studio ↔ LINE transport owner (the account's mode decides)

**Relationship:** the Studio queues; the transport owner executes. Which owner
is fixed per account by `transportMode` (ADR-060 D5), after the owner's answer
of 2026-09-05: a Zuri Edge Device exists only for tenants that want a local LLM
(Ollama) or Codex CLI on the monthly-plan quota; everyone else is cloud-served.

**EDGE accounts — the only context outside the monolith.**

- The tenant's Zuri Edge Device holds the account's channel secret and access
  token (ADR-041 D2), verifies signatures, calls the LINE Messaging and Insight
  APIs, and answers on its local LLM.
- It claims `LineOaTransportJob`s over outbound HTTPS with its Business-scoped
  `EdgeDeviceCredential` (FR-144), downloads any bytes (rich-menu images) from
  the cloud only while holding the lease (ADR-059 D4), and reports
  `COMPLETED {externalIds, acceptanceClass, counts}` or `FAILED {reason}`.
- It pulls the account's published configuration snapshot (published flows,
  rich-menu aliases, bot profile — no secret, no customer data) through a
  device-authenticated, ETag-versioned read and evaluates the same pure
  interpreter contract, shipped from this repository as contract plus reference
  implementation (ADR-059 D6).
- The cloud owns the wire contract (`contracts/line-oa-transport-job.schema.json`,
  to be added with the Phase 1 slice) and the edge repository codes against it.

**CLOUD accounts — inside the monolith.**

- A Studio worker claims the same job in-process under the same lease rules and
  executes it through the integration lane's LINE Messaging port; the port
  resolves the token from Vault per call under the cloud runtime role and never
  returns it. Signature verification for these accounts happens at
  `POST /api/agent/line-webhook` (agent lane, integration's `verifySignature`).
- One receipt shape, one Command Center view, in both modes.

**One owner at a time.** An account is EDGE or CLOUD, never both (BR-011);
switching is a publisher-only, versioned compare-and-swap that disables routing
first, moves credentials, cancels jobs queued under the old owner and audits the
switch.

### File management → LINE OA Studio

**Relationship:** content authority; the Studio references.

Rich-menu and Flex images are `FileAsset` rows; the Studio stores ids, validates
MIME/size by inspected metadata, and serves bytes to a lease-holding transport
job only. The Media page is a filtered projection with upload through the
existing file contract.

### LINE OA Studio → Business Home / Marketing

**Relationship:** read-only projection source.

Business Home may show account health, failed jobs and quota warnings; Marketing
may consume dispatch outcomes and audience signals. Neither stores a duplicate of
Studio truth.

## Shared concepts and ownership

| Concept | Authority | Studio usage |
|---|---|---|
| `IntegrationConnection` (`LINE_OA`) / `IntegrationCredential` / `secretRef` | Integration | reference by id; create via contract; redacted status |
| `RawExternalRecord` (webhook, insight) | Integration | translation input + lineage; last-webhook health |
| `line_channel_binding` code, activation state | Agent | join key (`bindingCode`); read-only health |
| The webhook turn and the single reply | Agent | supplies `resolveAutomation`; never replies itself |
| Channel secret, access token, LINE API calls | EDGE: the tenant's Zuri Edge Device · CLOUD: the integration lane's Vault-resolved LINE port | queues jobs; never holds either in either mode |
| `Person`, `ChannelIdentity`, Membership, `RoleBinding` | Identity | authorization; subject references; `LINE_OA_PUBLISHER` key |
| `Customer`, `Conversation`, `Message`, consent | CRM | read model; audience refs; outbound via contract |
| `FileAsset` | File management | reference by id |
| `AuditEvent` | project-manager (shared seam) | appends redacted rows |
| `LineOaAccount` and every Studio record above | LINE OA Studio | owner |

## Event vocabulary candidates

```text
LineOaAccountConnected            → Command Center · Business Home
RichMenuPublishRequested          → LineOaTransportJob QUEUED
TransportJobCompleted / Failed    → receipt on the design or dispatch · Command Center
DispatchApproved / DispatchQueued → transport job · audit
FlowVersionPublished              → agent automation cache invalidation
InsightSnapshotTranslated         → Analytics · quota gate
```

These are vocabulary candidates only; a global implementation requirement must
authorize concrete events, outbox or schema changes.

## Anti-corruption boundaries

1. LINE payload shapes (webhook events, rich-menu objects, Flex containers,
   Insight responses) terminate at the integration adapter or the Studio's
   validators; they do not become domain model shapes. Flex JSON is stored as a
   validated document, never interpreted as code.
2. `richMenuId`, `liffId`, request ids, bot user ids and basic ids are external
   references (BR-002), never Studio primary keys or authority inputs.
3. A transport job result is evidence of what LINE accepted, not proof of
   delivery or reading (ADR-020 #7); `DISPLAYED_UNKNOWN` stays unknown.
4. A flow is data; a `CONNECTOR_ACTION` names a registered internal contract,
   never a URL, and runs with the turn's resolved scope (ADR-045 D4).
5. Follower and delivery figures come only from translated LINE facts; nothing
   on a dashboard is estimated, and every tile names its source.
6. An account outside the viewer's visible Businesses does not exist to the
   viewer (404-shaped, FR-072).

## Change protocol

Any new writer, a LINE API call outside the integration lane's port, a secret
readable by Studio code, a bidirectional sync with CRM, or a transfer of
authority requires a new ADR or an explicit amendment to ADR-060. Adding an adapter that implements an existing
one-way contract does not transfer ownership.

## Deployment statement

All contexts in this map are logical boundaries inside one application and one
release, plus the already-existing transport owner process. No separate
database, network service or hosted "studio" origin is implied.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0 | 2026-09-05 | proposed | Split the transport relationship by account mode after the owner's answer: EDGE device (pull model, published-config pull) vs CLOUD worker over the integration lane's Vault-resolved LINE port; one owner at a time | working-tree | Claude Code |
| 0.1.0 | 2026-09-05 | proposed | Fixed providers, consumers, direction, shared concepts and anti-corruption rules for LINE OA Studio | working-tree | Claude Code |
