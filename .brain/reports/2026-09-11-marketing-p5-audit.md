---
version: "1.0.1b"
status: candidate
created_at: "2026-09-11T00:56:37+07:00,RWANG"
last_update: "2026-09-11T01:05:05+07:00,RWANG"
---

# Marketing P5 audit and bounded implementation contract proposal

This is a review artifact for the retained `feat/p5-marketing-parallel` work. It does not authorize
provider credentials, advertising spend, publication, LINE sends, or a new requirement id. No source
code or schema is changed by this report.

## Authority result and phase boundary

The current source of authority does not approve the branch's provider-backed P5 runtime:

- `docs/change-requests/CR-018-MARKETING-DOMAIN-DESIGN.md` is `candidate` and explicitly says
  there is no implementation approval. It describes a C-3/HIGH design with provider credentials,
  spend, publishing authority and action-specific receipts as later gates.
- `docs/domains/marketing/features/FR-160-campaign-initiatives.md` is `beta`. Its contract is the
  persisted initiative, Strategy version and PM receipt; it says no provider campaign is created
  in that slice and exposes campaign results as `UNAVAILABLE` without an approved source.
- `docs/domains/marketing/features/FR-162-operations-coordination.md` is `beta`. Its aggregate is
  a read projection and explicitly must not call provider APIs or write CRM conversations, Commerce
  stock or PM work. Provider activation, spend and publishing remain out of scope.
- `docs/roadmap/PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md` leaves paid UI/source verification in
  planned W2 items (`MKT-W2-PAID-UI`, `MKT-W2-VERIFY`) and controlled publication/spend in planned
  W4 items (`MKT-W4-PUBLISH`, `MKT-W4-SPEND`). The branch label “Phase 5” is not an approved wave.

The currently approved native phase is the existing Marketing plan, content, campaign/PM handoff
and Operations projection contract. The retained P5 branch is an audit candidate. The concrete
proposal below is a bounded candidate for read-only source composition, a durable `PLANNING` intent
record and a deterministic AskMarketing read surface. Paid provider metrics, audience expansion,
LINE dispatch, delivery workers, provider reconciliation, budget mutation and ad spend remain future
owner-approved phases. They are listed as future work rather than silently counted as complete.

## Branch evidence

The audited branch is `feat/p5-marketing-parallel` at `ec2f5dbd`. Relative to current
`origin/main` (`f320e888`), it changes 16 tracked source/test paths and 11 generated/documentation
paths, with no Prisma schema or migration change. The source/test paths are:

- Paid Media: `apps/server/src/app/(pm)/growth/paid-media/page.jsx`,
  `apps/server/src/app/api/growth/paid-media/route.js`,
  `apps/server/src/modules/marketing/application/marketing-attribution-service.js`,
  `apps/server/src/modules/marketing/components/paid-media/PaidMediaWorkspace.jsx`.
- Broadcast: `apps/server/src/app/(pm)/growth/broadcast/page.jsx`,
  `apps/server/src/app/api/growth/broadcast/route.js`,
  `apps/server/src/modules/marketing/application/broadcast-campaign-service.js`,
  `apps/server/src/modules/marketing/components/campaigns/BroadcastWorkspace.jsx`.
- AskMarketing and shared surface: `apps/server/src/app/api/growth/ask-marketing/route.js`,
  `apps/server/src/modules/marketing/application/ask-marketing-service.js`,
  `apps/server/src/modules/marketing/components/AskMarketingDrawer.jsx`,
  `apps/server/src/modules/marketing/components/MarketingDashboard.jsx`,
  `apps/server/src/modules/marketing/components/marketing-contract.js`,
  `apps/server/src/modules/line-crm/LineCrmLiveChat.jsx`,
  `apps/server/src/modules/line-crm/LineCrmMembers.jsx`.
- Test: `apps/server/tests/unit/marketing/marketing-p5-parallel.test.js`.

The branch contains these blockers:

- `broadcast-campaign-service.js` reads `sampleCustomers` and `sampleBroadcasts`, hardcodes sender
  records with channel IDs and quota, and returns `deliveredCount: matched.length` with the comment
  “Simulated successful immediate dispatch.” Its POST mutates a process-local array and creates no
  durable campaign or provider receipt.
- `marketing-attribution-service.js` computes from hardcoded `sampleAds`,
  `sampleVerifiedTransactions` and a hardcoded heatmap. The `db` argument is used only for scope
  resolution; no Integration or Commerce owner port is called.
- `ask-marketing-service.js` consumes those fixture metrics and recommends increasing a campaign
  budget by 20%. It has no persisted evidence references, unavailable/unknown source state or action
  authorization boundary.
- The only P5 tests are unit tests for pure normalization/aggregation and fixture audience
  filtering. They do not prove persistence, Business/Tenant isolation at the routes, provider read
  evidence, provider action receipts, retry/`UNKNOWN` semantics or browser acceptance.

## Existing owner exports and DTOs

The bounded proposal uses only these existing owner functions. No new provider integration or direct
cross-domain Prisma reader is assumed.

| Owner | Existing export | Exact usable result in this slice |
|---|---|---|
| Marketing | `listMarketingCampaigns({viewer,businessId})`, `getMarketingCampaign({viewer,businessId,initiativeId})` | Business-scoped Campaign/Strategy/PM projection. `results` remains `{status:'UNAVAILABLE',reasonCode:'NO_APPROVED_SOURCE',measurementWindow:null,sources:[],metrics:[]}`. |
| Marketing | `listMarketingOperations({viewer,businessId})` | Business-scoped intake, calendar, approvals and validated PM handoff projection with section states. |
| Marketing | `getMarketingContent({viewer,businessId,briefId})` | Content brief plus immutable version, `payloadHash`, rights/approval and owner reference state. The broadcast intent stores only this exact reference, never a second message body. |
| Integration | `listPhase1Integrations({db,resolve,businessId,now,staleAfterMs})` | Redacted connection metadata: id, tenant/business, provider, purpose, role, status, version, secret readiness/ref mask, expiry, update time and health. It has no paid-media metrics, audience or provider action receipt. |
| Integration | `readLineOaConnectionHealth({db,connectionIds,now,staleAfterMs})` | Redacted LINE connection health and last inbound event. It never returns credential material or quota. |
| Commerce | `getRevenueSummary({businessId,from,to},{viewer,db})` | Verified net/refunds/by-origin/by-day/pending/open/completed counts. It has no ad-source attribution, so it cannot produce ROAS by ad. |
| CRM | `getConversationInbox({viewer,businessId,limit})`, `getConversationThread({viewer,businessId,conversationId})` | Inspected tenant-shared, authorized boundary; customer DTO includes `consentStatus`, `consentRecordedAt` and `consentNote`. No planning or AskMarketing path calls these readers to manufacture an audience; there is no audience/filter or consent-snapshot resolver. |
| LINE OA Studio | `listLineOaAccounts({businessId,viewer,db,ports})`, `getLineOaAccount(id,{viewer,db,ports})` | Business-scoped account DTO with internal id/version, transport/status/execution flags and computed redacted health. It has no broadcast writer or provider send receipt. |

The consequence is explicit: paid provider metrics and recipient audience resolution are currently
`UNAVAILABLE`. A connection row, a CRM conversation count or a LINE account health row is not
evidence that an ad was measured or a broadcast was sent.

## Bounded contract for owner review

### A. Paid Media read state

Retain the `/growth/paid-media` surface only as a truthful read projection. It may show the existing
Marketing plan/campaign references, Integration connection metadata and Commerce verified revenue
summary when each owner grant permits the read. It must return a section state and source record for
each input:

```text
READY       source exists, is scoped, and contains the requested measurement window
EMPTY       the owner read is valid and contains no rows
PARTIAL     some required owner sources are ready and another is unavailable
UNAVAILABLE provider/read adapter is absent, disabled, unauthorized at the owner boundary, or has
            no approved metric source
UNKNOWN     timeout, response loss, ambiguous provider result, or failed evidence reconciliation
```

For this bounded slice, paid media metrics (`spend`, impressions, clicks, platform revenue,
frequency, ad identity and heatmap) are `UNAVAILABLE` because no existing owner DTO supplies them.
The panel must not render zero, fixture names or a calculated ROAS. Verified Commerce revenue may be
shown independently with its actual `from`/`to` window and `byOrigin` source; it must never be joined
to an ad by name or an invented external ID. Attribution closes only after an Integration/measurement
owner supplies a real read DTO carrying source/account/object identity, metric grain, timezone,
currency, window, freshness and evidence reference. That is a future owner contract, not a Marketing
fixture fallback.

### B. Durable LINE broadcast planning intent

The planning surface may persist a Business-scoped intent with status `PLANNING` and display a clear
dispatch-unavailable state. It must not create a provider campaign, expand recipients, write CRM
messages, call a LINE send API or report delivered/read counts.

The recommended storage is a new Marketing-owned identity plus append-only revisions, because the
existing `MarketingInitiative` is already pinned to one Strategy plan and `MarketingOperationsIntake`
is a generic request with no content/account/consent identity. The exact proposed records are:

```text
MarketingBroadcastIntent
  id              UUID primary key
  tenantId        UUID, copied only from the authorized Business
  businessId      UUID
  code            Business-local human code
  status          PLANNING | ARCHIVED
  currentRevision positive integer
  version         positive integer optimistic CAS version
  idempotencyKey  bounded client key, unique with businessId
  createdBy       trusted viewer principal
  createdAt       updatedAt       deletedAt?

MarketingBroadcastIntentVersion
  id              UUID primary key
  intentId        UUID
  revision        positive integer, unique with intentId
  payloadJson     strict canonical payload
  payloadHash     SHA-256 of canonical payload
  createdBy       trusted viewer principal
  createdAt
```

The strict payload is exactly:

```json
{
  "channel": "LINE",
  "account": {
    "lineOaAccountId": "internal LineOaAccount UUID",
    "accountVersion": 1
  },
  "content": {
    "briefId": "internal MarketingContentBrief UUID",
    "contentVersionId": "internal MarketingContentVersion UUID",
    "payloadHash": "64 lowercase hex characters"
  },
  "audience": {
    "source": "CRM_CONVERSATION_READ_MODEL",
    "sourceVersion": null,
    "audienceSpecVersion": "1.0",
    "filter": { "consentStatus": "GRANTED" },
    "criteriaHash": "64 lowercase hex characters",
    "resolutionState": "UNAVAILABLE",
    "resolutionRef": null
  },
  "consent": {
    "source": "CRM_CUSTOMER.consentStatus",
    "requiredValue": "GRANTED",
    "policyReference": "FR-103",
    "policyVersion": null,
    "snapshotRef": null,
    "snapshotVersion": null,
    "state": "UNAVAILABLE"
  }
}
```

`account` is nullable only when the API also returns `accountState: UNAVAILABLE` with a stable
reason such as `LINE_ACCOUNT_NOT_SELECTED`; a non-null account is re-read through
`getLineOaAccount` and stored as internal id plus version only. No basic ID, channel ID, credential,
quota or account display text is copied into the intent. `content` is required and is validated
through `getMarketingContent` against the exact Business/Tenant, version and hash. The intent stores
no raw message body; the content owner remains authoritative.

The audience filter is deliberately limited to the existing CRM consent field. `audienceSpecVersion`
is the proposed planning-payload schema version; `audience.sourceVersion` remains null until a CRM
owner publishes a versioned audience resolver. The FR-103 policy version also remains null because
this audit did not enumerate a canonical policy version. CRM currently has no audience query or
consent-snapshot export, so `resolutionState` and `consent.state` remain
`UNAVAILABLE`, `resolutionRef` and `snapshotRef` remain null, and no customer ID or count may be
fabricated. A future CRM owner port may replace those null references with an actual scoped snapshot;
that future port is outside this slice. Lifecycle/tag/intent-score filters from the retained fixture
branch are not accepted because no current owner DTO supplies them.

Create idempotency is deterministic: `(businessId,idempotencyKey)` returns the existing intent only
when the canonical payload and identity fields are byte-equivalent; a different payload returns
`409 BROADCAST_INTENT_IDEMPOTENCY_CONFLICT`. Revisions require `expectedVersion`, append one new
version row and increment the parent version in one transaction. Archive is the only lifecycle action
and never invokes an external owner. Every mutation writes one Marketing audit event containing IDs,
revision, hash and state, with no customer body, recipient list or credential.

The exact routes are:

| Route | Behavior | Authority |
|---|---|---|
| `GET /api/growth/broadcast-intents?businessId=...` | At most 100 scoped planning rows; missing account/content/consent sources carry explicit unavailable state. | Marketing read scope |
| `POST /api/growth/broadcast-intents` | Creates identity and revision; requires `businessId`, `idempotencyKey` and strict payload. | Active Business owner |
| `GET /api/growth/broadcast-intents/[id]?businessId=...` | Returns selected revision, hashes, source states and `dispatch:{state:'UNAVAILABLE',reasonCode:'LINE_BROADCAST_OWNER_CONTRACT_UNAVAILABLE'}`. | Marketing read scope |
| `PATCH /api/growth/broadcast-intents/[id]` | `revise` with expectedVersion or `archive`; no dispatch action exists. | Active Business owner |

All routes first call `resolveMarketingScope`; hidden Business/Tenant identities answer as the existing
404-shaped Marketing boundary requires. Account validation goes through LINE OA Studio, content
validation through Marketing Content, and consent is reference-only through the existing CRM DTO
contract. There is no direct Marketing read of Integration, CRM or LINE OA tables.

The existing `/api/growth/broadcast` POST from the retained branch is excluded. The page may remain
as a planning UI only: it lists these intents and renders “Dispatch unavailable — LINE OA owner
contract is not enabled.” It must not expose `send`, `delivered`, `failed`, `sentAt`, quota or a
success receipt. Any later dispatch endpoint belongs to LINE OA Studio's owner contract and must
return `REQUESTED`, `ACCEPTED`, `FAILED` or `UNKNOWN`; `ACCEPTED` never means delivered or read.

Retention and erasure are bounded by reference storage. Intent/version/audit rows retain only internal
IDs, hashes, policy references and planning text already admitted by the Marketing contract; they do
not copy customer records, recipient IDs, credentials or private conversation content. Archive uses
the existing `deletedAt`/audit pattern and the same retention/deletion policy as Marketing plan and
content records; no new automatic TTL is invented. If a linked content, account or future consent
snapshot is deleted or becomes unauthorized, reads return `UNAVAILABLE` and no source payload is
reconstructed.

### C. AskMarketing deterministic read-only behavior

Retain `POST /api/growth/ask-marketing` as a read-only interpretation route with strict input
`{businessId,question}`. It first resolves Marketing scope, then reads only the existing owner
adapters listed above. It never calls a provider, mutates a budget, creates a Campaign or Broadcast
Intent, sends a LINE message or follows a suggested action.

Classification is deterministic after trimming and lower-casing the question:

- contains `roas`, `revenue`, `รายได้` or `ยอดจริง` → `ANALYZE_ROAS`;
- contains `fatigue`, `frequency`, `ล้า` or `ความถี่` → `DETECT_FATIGUE`;
- empty or the default overview question → `EXECUTIVE_OVERVIEW`;
- otherwise → `UNSUPPORTED`.

The response is the following read model; source IDs are present only when returned by an authorized
owner adapter:

```text
{
  readModel: 'MARKETING_ASK',
  schemaVersion: '1.0',
  businessId,
  question,
  intentType,
  state: READY | PARTIAL | UNAVAILABLE | UNKNOWN | FORBIDDEN,
  answer: { sections: [...], recommendations: [] } | null,
  sources: [{ owner, source, sourceVersion, ref, window, state }],
  unavailable: [{ source, reasonCode }],
  generatedAt
}
```

`EXECUTIVE_OVERVIEW` may summarize actual Marketing campaign/Operations rows and an authorized
Commerce verified-revenue window. `ANALYZE_ROAS` and `DETECT_FATIGUE` return `UNAVAILABLE` with
`PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE` because no current owner supplies paid metrics. They never
use fixture spend, platform revenue, heatmap, frequency or ad names. `UNSUPPORTED` returns
`QUESTION_UNSUPPORTED` without a model call. Recommendations are empty or clearly labelled planning
drafts and contain no action endpoint. A missing owner grant is an unavailable/forbidden source,
not zero; timeout or response loss is `UNKNOWN`.

### D. UI and worker boundary

The retained UI can be adapted only to these states:

- Paid Media renders source cards and `UNAVAILABLE`/`UNKNOWN` reasons; it never renders sample ads,
  zeros or inferred ROAS.
- Broadcast renders durable `PLANNING` intents and the disabled dispatch message above; it never
  renders provider completion or a recipient count.
- AskMarketing renders the read model, source references and measurement window, with no budget or
  broadcast action button.

There is no approved P5 worker in this proposal. Recipient expansion, consent snapshot creation,
provider request/receipt, retry/reconciliation, delivery/read projection and LINE OA worker changes
are future owner phases. They must not be implemented by calling a Marketing service directly into
CRM or the provider.

## Authorization, retention and verification gates

The owner-approved implementation must prove:

1. Strict payload/hash/idempotency behavior, immutable revision rows, CAS conflicts, archive and
   audit payload redaction.
2. Marketing Business/Tenant/domain visibility, cross-Business and cross-Tenant 404-shaped refusal,
   account/content reference scope checks and no direct cross-domain table reads.
3. Missing Integration paid metrics, missing Commerce grant, missing CRM audience resolver and
   missing LINE account each produce explicit `UNAVAILABLE`; timeout/ambiguous reads produce
   `UNKNOWN`; no missing source becomes zero.
4. Existing real owner DTOs are used in integration tests: `getRevenueSummary`, Marketing campaign/
   Operations readers, `getMarketingContent` and `listLineOaAccounts`. The CRM inbox/thread exports
   are inspected boundary evidence only and are not invoked to claim audience resolution. Fixture-only
   tests are labelled as contract tests and cannot support a production claim.
5. AskMarketing classification and output are deterministic, source IDs/hashes/windows round-trip,
   and no provider/CRM/Commerce/PM mutation or model action occurs.
6. Browser tests cover Business switching, reload/back, empty, denied, unavailable and unknown
   states at 390px; independent server install, focused integration tests, full test/build and
   governance pass before any merge review.

## Requirement recommendation and remaining phases

Keep FR-160 unchanged: it remains the Strategy/Campaign/PM receipt contract and does not acquire a
LINE broadcast entity. Keep FR-162 unchanged: its Operations intake/aggregate remains a projection
and does not acquire provider or audience writes. The recommended new subject is a reserved
`FR-185` for “Business-scoped LINE broadcast planning intent with durable version/idempotency and an
explicit unavailable dispatch state.” Do not declare or add `FR-185` until the owner approves this
exact statement and the registry confirms the reservation. No new ID is declared in this branch.

The following phases remain future and are not counted as local completion: Integration/measurement
paid-media evidence adapters; CRM audience and consent-snapshot read contract; LINE OA broadcast
dispatch and provider receipt/reconciliation worker; controlled publish/spend/canary policy; and
the corresponding UI action affordances. This proposal can be implemented locally only after the
owner approves the planning/read contract and its requirement mapping.

## Version diff

`1.0.0b` was the initial audit and listed open design gaps. `1.0.1b` replaces those open questions
with an exact owner-export inventory, truthful unavailable states, a durable planning-intent schema,
routes, authorization, retention, deterministic AskMarketing response and verification gates. It
adds no code, schema, provider credential, live action or global requirement id.

## Approval boundary

Please review and approve this bounded P5 contract before implementation. Until approval, the only
valid status is audit/proposal; the fixture-backed branch remains an evidence-only draft and must not
be merged as completed Marketing runtime.
