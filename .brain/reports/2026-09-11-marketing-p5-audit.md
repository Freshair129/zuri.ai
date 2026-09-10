---
version: "1.0.0b"
status: candidate
created_at: "2026-09-11T01:35:00+07:00,RWANG"
last_update: "2026-09-11T01:35:00+07:00,RWANG"
---

# Marketing P5 audit and bounded implementation proposal

This is a review artifact for the retained `feat/p5-marketing-parallel` work only. It does not
authorize provider credentials, advertising spend, publication, LINE sends, or a new requirement id.
No source code is changed in this worktree.

## Authority result

The current source of authority is not sufficient for P5 runtime implementation:

- `docs/change-requests/CR-018-MARKETING-DOMAIN-DESIGN.md` is `candidate` and explicitly says
  “no implementation approval.” It describes a C-3/HIGH design with provider credentials,
  spend/publishing authority and action-specific receipts as later gates.
- `docs/domains/marketing/features/FR-160-campaign-initiatives.md` is `beta`, but its contract is
  the persisted initiative, Strategy version and PM receipt. It says no provider campaign is
  created in that slice and exposes campaign results as `UNAVAILABLE` without an approved source.
- `docs/domains/marketing/features/FR-162-operations-coordination.md` is `beta`; its aggregate is
  a read projection and explicitly must not call provider APIs or write CRM conversations, Commerce
  stock or PM work. Provider activation, spend and publishing are out of scope.
- `docs/roadmap/PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md` leaves paid UI/source verification in
  planned W2 items (`MKT-W2-PAID-UI`, `MKT-W2-VERIFY`) and controlled publication/spend in planned
  W4 items (`MKT-W4-PUBLISH`, `MKT-W4-SPEND`). The branch label “Phase 5” is not an approved wave
  in the current plan.

The prior design approval recorded in the roadmap covers the Marketing domain plan and the native
Strategy/Campaign/Content/Operations slices. It does not make provider-backed paid-media reads,
broadcast execution or AskMarketing runtime authority available. Those gates remain open until the
owner accepts a provider/read/action contract and its evidence requirements.

## Branch evidence

The audited branch is `feat/p5-marketing-parallel` at `ec2f5dbd`, one commit ahead of its historical
base. Relative to current `origin/main` (`f320e888`), the commit changes 16 tracked source/test paths
and 11 generated/documentation paths, with no Prisma schema or migration change. The P5 source/test
paths are:

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
- Tests: `apps/server/tests/unit/marketing/marketing-p5-parallel.test.js`.

The branch contains these concrete blockers:

- `broadcast-campaign-service.js` reads `sampleCustomers` and `sampleBroadcasts`, hardcodes two
  sender records and returns `deliveredCount: matched.length` with the comment “Simulated successful
  immediate dispatch.” Its POST mutates a process-local array and creates no durable campaign or
  provider receipt.
- `marketing-attribution-service.js` computes from hardcoded `sampleAds`,
  `sampleVerifiedTransactions` and a hardcoded heatmap. The `db` argument is used only for scope
  resolution; no Integration or Commerce owner port is called.
- `ask-marketing-service.js` consumes those fixture metrics and recommends increasing a campaign
  budget by 20%. It has no persisted evidence references, unavailable/unknown source state or
  action authorization boundary.
- The only P5 tests are unit tests for pure normalization/aggregation and fixture audience filtering.
  They do not prove persistence, Business/Tenant isolation at the routes, provider read evidence,
  provider action receipts, retry/UNKNOWN semantics, or browser acceptance.

These facts make the branch unsuitable for direct cherry-pick. The generated graph/document changes
must also be regenerated from whichever owner-approved contract is eventually implemented.

## Bounded proposal for owner review

Keep the retained P5 intent limited to three read/planning surfaces and one separately gated action
surface. Do not implement any provider action or live send in this proposal.

### Track A — Paid Media and attribution read projection

Map the read-only portion to the existing planned W2 contracts:

1. Integration owns Meta/TikTok/Instagram credentials, account scope, cursors, raw evidence and
   provider run receipts. Marketing receives a bounded read DTO containing source, account/property,
   object identity, metric grain, timezone, currency, measurement window, freshness and an evidence
   reference. Missing or ambiguous provider state is `UNAVAILABLE`/`UNKNOWN`, never zero.
2. Commerce remains the source for verified money, corrections/refunds and confirmed order identity.
   Attribution joins only explicit internal/external references and records the source receipt; it
   never treats a provider-reported revenue figure as verified money.
3. Marketing calculates ROAS, discrepancy and fatigue only from those owner DTOs. No provider account,
   sample ad, sample transaction or hardcoded heatmap is emitted from the route.
4. Acceptance requires scoped owner/read receipts for each enabled source and tests for metric grain,
   cross-Business denial, missing source, duplicate correction and unavailable revenue. This closes
   to the existing `MKT-W2-PAID-UI`, `MKT-W2-ANALYTICS-UI` and `MKT-W2-VERIFY` items only when their
   evidence gates are met.

### Track B — Broadcast planning and owner dispatch handoff

The Marketing surface may capture a Business-scoped broadcast intent after the owner defines its
persisted identity, content reference, audience criteria, consent snapshot reference, selected LINE
account reference and human approval. The intent remains a planning record until a separate dispatch
contract is approved.

When that contract exists, the handoff must go to LINE OA Studio's existing dispatch/worker owner:
Marketing supplies the exact intent/version and references; LINE OA Studio owns recipient resolution,
transport, provider request and acceptance receipt. Marketing does not create a second CRM conversation,
sender registry, message writer or provider success surface. A dispatch result is `REQUESTED`,
`ACCEPTED`, `FAILED` or `UNKNOWN`; `ACCEPTED` is not `DELIVERED` or `READ`. A timeout or response-loss
must not cause a second send without the owner reconciliation contract.

Before any implementation, the owner must approve the dispatch intent schema, consent/erasure behavior,
LINE account capability and action-specific receipt/retry contract. This maps to planned
`MKT-W4-POLICY`, `MKT-W4-PUBLISH`, `MKT-W4-UNKNOWN` and `MKT-W4-CANARY`; the current P5 branch's
simulated immediate completion does not satisfy any of them.

### Track C — AskMarketing read-only interpretation

AskMarketing may interpret the current Business-scoped Marketing/Integration/Commerce read DTOs. It
must include source references, measurement windows and explicit unavailable/unknown states in the
response. It may produce a recommendation as a draft artifact, but it must not change a budget, create
a campaign, dispatch a broadcast or claim provider delivery. A model runtime may be connected only
through the existing approved agent/provider contract; no fixture metrics or implicit provider access
are allowed.

## Required approval and exit evidence

Owner approval should identify the exact retained tracks, owner ports, existing work-item mapping and
whether any existing FR contract needs a reviewed amendment. No new ID should be declared until the
registry confirms that an existing requirement cannot carry the approved statement.

An implementation review can start only after the approved documents state:

- the source owner and exact Business/Tenant/account scope for each read;
- the persistence and correction/idempotency model for source evidence;
- the provider action writer, capability grant, amount/recipient ceiling and expiry where applicable;
- receipt states, retry/reconciliation and the boundary between provider acceptance and delivery/read;
- consent, erasure and redaction behavior, including what happens when the source is unavailable;
- local test fixtures versus configured/read/provider/recipient evidence.

The implementation exit requires independent server install, focused integration tests, browser checks
for the enabled read/planning surface, full server test/build, governance and a report that labels
fixture, local, configured, provider-accepted and recipient-delivered/read evidence separately. No live
send or ad spend is part of this lane.

## Version diff

`1.0.0b` is the initial owner-review audit. It records the authority gap, enumerates the P5 branch
evidence and proposes the smallest read/planning and separately gated dispatch boundaries. It adds no
code, schema, provider credential, live action or global requirement id.

## Approval boundary

Please review and approve the bounded P5 contract before implementation. Until approval, the only
valid status is audit/proposal; the fixture-backed branch remains an evidence-only draft and must not
be merged as a completed Marketing runtime.
