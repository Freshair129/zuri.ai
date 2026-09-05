---
domain_id: DOM-LINE-OA-STUDIO
domain: line-oa-studio
modules:
  - line-oa-studio
owns_models: []
owns_routes:
  - src/app/(pm)/line-oa/**
  - src/app/api/line-oa/**
owns_code:
  - src/modules/line-oa-studio/**
technical_owner: TD-LINE-OA-STUDIO
status: proposed-phase-0
version: "0.2.0"
created_at: "2026-09-05T00:00:00+07:00"
updated_at: "2026-09-05T12:00:00+07:00"
---

<!-- owns_routes are longest-prefix globs (ADR-025). The two claims reserve the
     `/line-oa` page tree and the `/api/line-oa/**` handlers away from
     project-manager's `src/app/(pm)/**` + `src/app/api/**` catch-all. No route
     exists yet: the claim is the lane, so no other domain lands one there. The
     generators read each list as an unbroken run of `  - value` lines, so
     annotations stay outside the frontmatter. -->

# LINE OA Studio domain charter

## Mission

LINE OA Studio is the Business-scoped authority for **designing, publishing and
operating LINE Official Accounts — several per Business**: the account record,
rich menus, Flex messages, conversation flows, LIFF app registry, the template
library, outbound dispatches, the transport jobs that carry them to LINE, and
the translated insight facts that come back.

It is the command center the owner asked for: one place that answers, for every
account a Business runs,

1. What does this account look like and do right now — rich menu, welcome flow,
   Flex cards, LIFF apps — and what is the published version of each?
2. Is it healthy — connection, binding, last webhook, queued or failed jobs,
   remaining quota?
3. What is going out — pushes, broadcasts, tests — who authorized them, and what
   did LINE actually accept?
4. How is it doing — followers, reaches, blocks, delivered messages — from
   LINE's own numbers, per account and across the Business?

Stable identities:

```text
Product domain:   DOM-LINE-OA-STUDIO
Technical owner:  TD-LINE-OA-STUDIO
Target route key: line-oa
Display label:    LINE OA Studio (ศูนย์บัญชาการ LINE OA)
```

Architecture decision: [ADR-060](../../decisions/ADR-060-LINE-OA-STUDIO-DOMAIN-AND-MULTI-ACCOUNT-BOUNDARY.md).

## Owned concepts (target; models land only with an approved global implementation requirement)

`owns_models` above is deliberately empty: that list mirrors
`prisma/schema.prisma`, and each implementation slice adds a model there in the
same change that adds it (the crm and market-intelligence charters follow the
same discipline). Until then this section is the claim, so no other lane designs
these tables elsewhere:

- `LineOaAccount` — the aggregate: one LINE Official Account operated by one
  Business. Holds a stable Tenant-unique `code`, references the integration
  lane's `IntegrationConnection` (`LINE_OA`) 1:1 and the agent's binding code
  (= identity's `channelAccountId`), an operating status, a `transportMode`
  (EDGE / CLOUD — who owns this account's LINE transport, ADR-060 D5), a
  default flag and the bot presentation profile. N per Business.
- `LineOaRichMenu` / `LineOaRichMenuVersion` — layout, chat-bar text, tap areas
  and actions, `FileAsset` image reference, alias, default flag, published state,
  external `richMenuId` after deployment.
- `LineOaFlexTemplate` / `LineOaFlexMessage` — validated Flex JSON with
  variables and preview state.
- `LineOaFlow` / `LineOaFlowVersion` — the automation graph (trigger, nodes,
  edges); a version is immutable once published.
- `LineOaFlowSession` — the per-account, per-channel-subject cursor through a
  published flow; expiring.
- `LineOaLiffApp` — the per-account LIFF registry with the external `liffId`.
- `LineOaTemplate` — the library: kind, category, `SYSTEM` / `TENANT` /
  `BUSINESS` scope, official flag, body; usage derived from lineage.
- `LineOaDispatch` — an outbound intent (PUSH, MULTICAST, BROADCAST,
  NARROWCAST, TEST) with audience specification, messages, schedule, approval
  and receipt.
- `LineOaTransportJob` — the queued unit of work the trusted transport owner
  claims and executes; lifecycle QUEUED → CLAIMED → COMPLETED | FAILED |
  CANCELLED with a lease, mirroring `AssetExtractionJob` (FR-143, ADR-059).
- `LineOaInsightSnapshot` — per-account, per-day translated LINE Insight facts.

Pure calculators owned alongside them: rich-menu bounds validation, Flex schema
validation, the flow interpreter (`evaluateFlowStep`), dispatch audience and
quota gates, insight translation. None opens a database.

When a model is added, this frontmatter is updated in the same implementation
slice so preflight can enforce unique model ownership.

## Explicitly not owned

| Concept | Authority | Studio behaviour |
|---|---|---|
| `IntegrationProvider` `LINE_OA`, `IntegrationConnection`, `IntegrationCredential`, opaque `secretRef`, connection health | integration (FR-080, ADR-032) | reference by id; "connect account" calls the owner-only create contract; never stores or shows secret material |
| Raw webhook and Insight records (`RawExternalRecord`, `IngestionRun`, cursors, dead letters) | integration (FR-081) | translation input and lineage only; the Insight pull is an integration adapter |
| `zuri_core.line_channel_binding`, activation, rollback, canary receipts | agent (FR-052, FR-055, ADR-020) | reads binding state for health; never activates or disables routing |
| The webhook seam, the agent turn, the single reply | agent (FR-028, FR-057, FR-050) | supplies a pure automation contract the turn calls before model work |
| LINE channel secret, channel access token, signature verification, every Messaging API and Insight API call | by `transportMode` (ADR-060 D5): EDGE — the tenant's Zuri Edge Device (ADR-041 D2, BR-011); CLOUD — the integration lane's Vault-resolved LINE Messaging port, executed under the cloud runtime role (ADR-031 D3, FR-079's shape) | queues `LineOaTransportJob`; an EDGE device claims it and pulls bytes under a lease, the CLOUD worker executes it through the port; records receipts; never sees the token in either mode |
| `Person`, `ExternalIdentity`, `ChannelIdentity` (namespaced by `channelAccountId`), Membership, domain grants, `RoleBinding` | identity (FR-021, FR-022, FR-061, FR-076, FR-097) | asks identity; declares the `LINE_OA_PUBLISHER` role key; owns no membership, invite or role row |
| `Customer`, `Conversation`, `Message`, the Inbox, reply receipts, PDPA consent | crm (FR-023, FR-091, FR-093, FR-103) | reads through the crm read model; resolves dispatch audiences from crm references; writes conversational outbound records only through the crm contract |
| Canonical business knowledge | knowledge / GKS | a flow's `CONNECTOR_ACTION` may call a registered knowledge query; the Studio stores no knowledge |
| `FileAsset` bytes and metadata (rich-menu and Flex images) | file management (ADR-016, FR-045) | reference by id; upload through the existing file contract |
| `AuditEvent` | project-manager (shared `recordAudit` seam) | appends redacted audit rows; owns no audit model |
| Campaigns and marketing execution | Marketing (future) | Marketing may consume dispatch outcomes; the Studio owns the dispatch |

## Multi-account rules

1. **One Business, many accounts; one account, one Business.** An account
   belongs to exactly one Business, mirroring `IntegrationConnection.businessId`
   and `line_channel_binding.business_id`. Moving an account is a new account
   plus an archive.
2. **Every owned row carries `tenantId`, `businessId` and `lineOaAccountId`.**
   The server derives scope from the trusted viewer and the selected visible
   Business; an `accountId` in a request is validated against that scope, never
   trusted. Repositories are bound to one scope at construction and refuse a row
   outside it rather than filtering afterwards (SEC-001, BR-012).
3. **LINE identifiers are external attributes** — channel id, basic id, bot
   user id (`destination`), `richMenuId`, `liffId`, request ids — mapped through
   `ExternalRef` / `ExternalEntityRef` (BR-002); never a primary key.
4. **The binding code is the join.** `LineOaAccount.bindingCode` equals the
   agent's binding `code` and identity's `channelAccountId`, so an inbound event
   reaches per-account configuration only after the agent resolved scope from
   the server-owned binding. The env-configured single-binding resolver is a
   dev/compat path; multi-account production uses the persisted resolver.
5. **Cross-account sharing happens only through templates**, with an explicit
   `SYSTEM` / `TENANT` / `BUSINESS` scope. Instantiating a template copies it
   into the account with lineage; nothing else is shared between accounts.
6. **Aggregation stops at the Business.** Dashboard, Analytics and Command
   Center sum the accounts of the selected Business the viewer may see
   (ADR-011); there is no portfolio-wide view in this charter.
7. **Quota and limits are per account** and come from LINE through the insight
   snapshot; a dispatch gate reads the latest snapshot and refuses rather than
   estimates when none exists.
8. **Prerequisite owned by crm:** `Conversation` identity must carry the channel
   account before a per-account inbox view, message count or dispatch receipt
   can be truthful (ADR-060 D9). Until that lands, the Studio labels those
   tiles as Business-wide, never per-account.
9. **Transport mode is per account, and exactly one owner at a time.**
   `transportMode` is EDGE or CLOUD (ADR-060 D5): EDGE for a tenant that runs a
   Zuri Edge Device for a local LLM (Ollama) or Codex CLI on the monthly-plan
   quota, CLOUD for everyone else. It is fixed at connect time from whether the
   Business holds an ACTIVE `EdgeDeviceCredential`, and changes only through an
   audited, versioned switch that disables routing first and cancels jobs queued
   under the old owner.

## Boundaries

- Holds no secret and activates no routing. Reaches LINE only as a
  `LineOaTransportJob`: for an EDGE account the tenant's Zuri Edge Device claims
  it; for a CLOUD account a Studio worker executes it through the integration
  lane's LINE Messaging port, which resolves the token from Vault per call and
  never returns it (ADR-060 D5).
- Flows are data (BR-007, SEC-002): a strict-schema graph interpreted by a pure
  function; `CONNECTOR_ACTION` targets a registered allow-list of internal
  contracts, never a URL.
- Dispatches need publisher authority (Business OWNER or `LINE_OA_PUBLISHER`),
  server-resolved audiences, PDPA consent `GRANTED` for marketing kinds
  (FR-103, SEC-005), an idempotency key, and a typed confirmation for
  BROADCAST / NARROWCAST. `TEST` reaches only the viewer's own linked LINE
  identity or a registered staff subject.
- Receipts are truthful: `ACCEPTED_BY_LINE` is an acceptance class, never
  delivery or reading (ADR-020 #7).
- Every write is transactional, versioned and audited with a redacted payload;
  refusals are 404-shaped (FR-072); client, prompt, model or flow values may
  attenuate but never widen server-owned scope (BR-020, SEC-018).
- Thai copy on user-facing surfaces; English for code, ids and contracts.

## Public contract direction

The names describe the intended boundary; each lands with its own requirement:

```text
listAccounts(viewer, businessId)                      → accounts + computed health
connectAccount(viewer, {businessId, connectionRef})   → LineOaAccount over an existing LINE_OA connection
getAccountHealth(viewer, accountId)                   → connection · binding · last webhook · jobs · quota
saveRichMenuDraft / publishRichMenu(viewer, accountId, …)      → draft · queued transport job
saveFlexTemplate / renderFlexPreview(…)               → validated Flex JSON
saveFlowDraft / publishFlowVersion(…)                 → immutable published version
evaluateFlowStep(flowVersion, event, session)         → pure: { actions, nextSession }
resolveAutomation(scope, event)                       → the contract the agent turn calls before model work
instantiateTemplate(viewer, templateId, accountId)    → copy with lineage
createDispatch / approveDispatch / queueDispatch(…)   → consent + quota + idempotency gates
claimTransportJob / completeTransportJob / failTransportJob  → device-authenticated (FR-144) pull routes (EDGE)
runCloudTransportJob(jobId)                           → the CLOUD worker; executes through the integration LINE port
getPublishedAccountConfig(accountId, etag)            → device-authenticated snapshot for EDGE runtimes (flows · aliases · bot profile)
switchTransportMode(viewer, accountId, mode)          → publisher-only, versioned CAS, routing-first, audited
translateInsightRecord(rawExternalRecordRef)          → LineOaInsightSnapshot
getAccountInsights / getBusinessInsights(…)           → read models; every figure names its source
```

Cross-domain consumers call these contracts or read models rather than writing
Studio-owned tables directly.

## Runtime interaction

```text
inbound   LINE → transport owner (signature) → POST /api/agent/line-webhook
          → binding-resolved scope → identity + crm ingest
          → Studio resolveAutomation(account, trigger) → deterministic actions
          → ONE reply via the transport owner (FR-050, BR-011)   |  else the AI turn

publish   Studio: publishRichMenu / queueDispatch / registerLiff / pullInsight
          → LineOaTransportJob QUEUED
          → EDGE account:  the device claims (Bearer edgk_…), fetches bytes if any, calls LINE
          → CLOUD account: the Studio worker claims in-process and executes through the
                           integration lane's Vault-resolved LINE port (token never leaves the port)
          → COMPLETED {externalIds, acceptance class, counts} | FAILED {reason}
          → receipt on the dispatch / rich menu; audit row; Command Center state

edge run  EDGE account: the device pulls the published configuration snapshot
          (flows · rich-menu aliases · bot profile) with its credential, runs the same
          pure interpreter on its local LLM (Ollama / Codex CLI), and reports evidence
          and reply receipts through the existing trusted seams (FR-028, FR-093)
```

## Capability map

```text
LINE OA Studio
├── Accounts (connect · health · default · archive)
├── Design Studio
│   ├── Rich Menu designer
│   ├── Flex Message designer
│   ├── Flow designer
│   └── LIFF app registry
├── Template library
├── Dispatch (push · multicast · broadcast · narrowcast · test)
├── Analytics (per account · per Business)
├── Command Center (health · transport jobs · dispatch console · links to CRM Inbox)
└── Projections: Media (Files) · Team (identity)
```

These are capabilities of one product domain, not peer Tier-2 domains.

## Source layout (target)

```text
src/modules/line-oa-studio/
├── application/       account, design, dispatch and transport-job use cases (the only writers)
├── domain/            strict vocabularies, schemas, rich-menu/Flex validators, flow interpreter, gates
├── transport/         the CLOUD claimant worker — calls the integration lane's LINE port, holds no token
├── translation/       insight raw-record → snapshot
└── index.js           stable module exports
```

Runtime surfaces are under `/line-oa` and `/api/line-oa`. The device-authenticated
transport-job routes are a route family under `/api/line-oa/transport-jobs/**`
(claim · bytes · complete · fail); they authenticate through identity's
`resolveEdgeDeviceContext` (FR-144), never a session cookie, and are scoped to the
Business of the presented credential. The module must not import a page or
route to reach another domain's private repository; cross-domain work uses an
explicit contract or read projection.

## Delivery state

Phase 0 — declaration only. There is no runtime code, route, model, migration,
navigation entry or requirement id. ADR-060 D14 phases the implementation; each
phase declares its own ids and updates this charter's ownership claims in the
same change.

## References

- [ADR-060](../../decisions/ADR-060-LINE-OA-STUDIO-DOMAIN-AND-MULTI-ACCOUNT-BOUNDARY.md)
- [Context map](CONTEXT-MAP.md)
- [SRS](SRS.md)
- [integration charter](../integration/CHARTER.md) · [agent charter](../agent/CHARTER.md) · [crm charter](../crm/CHARTER.md) · [identity charter](../identity/CHARTER.md)
- [ADR-059 edge-executed evidence extraction](../../decisions/ADR-059-EDGE-EXECUTED-EVIDENCE-EXTRACTION.md) — the pull-model job precedent
- [ADR-041 edge device topology](../../decisions/ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md) — where LINE secrets live

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0 | 2026-09-05 | proposed-phase-0 | Owner's answer on edge devices: added `transportMode` EDGE / CLOUD on the aggregate, the CLOUD worker over the integration lane's Vault-resolved LINE port, the published-config pull for edge runtimes and the audited mode switch | working-tree | Claude Code |
| 0.1.0 | 2026-09-05 | proposed-phase-0 | Established the LINE OA Studio lane: multi-account aggregate, owned concepts, explicit external boundaries, contract direction and runtime interaction; no models or routes claimed as existing | working-tree | Claude Code |
