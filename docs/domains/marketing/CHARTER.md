---
domain_id: DOM-MARKETING
domain: marketing
modules:
  - marketing
owns_routes:
  - src/app/(pm)/growth/**
  - src/app/api/growth/**
owns_models:
  - MarketingPlan
  - MarketingPlanVersion
  - MarketingReview
  - MarketingDecision
  - MarketingHandoff
  - MarketingInitiative
technical_owner: TD-MARKETING
version: "0.2.0b"
created_at: "2026-09-06T18:35:00+07:00,RWANG,5044ba25"
last_update: "2026-09-06T18:35:00+07:00,RWANG"
status: beta
superseded_by: null
---

# Marketing domain charter

Marketing turns Business objectives and evidence into reviewed plans, coordinates
channel execution, and measures outcomes. Stable identity is `DOM-MARKETING`,
route and permission key `growth`, console root `/growth`.

The user approved [CR-018](../../change-requests/CR-018-MARKETING-DOMAIN-DESIGN.md)
and its 100-interface mockup at commit 494a3666, then authorized implementation.
The candidate wording in that historical artifact records its original review state;
it does not withdraw the subsequent approval.

## Boundaries and rollout

The approved navigation has Dashboard, Strategy, Campaigns, Paid Media, Content,
Social, Partners, Live, Website, SEO, Analytics, Operations and Team. The complete
[tab matrix](../../change-requests/marketing/MARKETING-NAVIGATION-VIEWS.md),
[channel contracts](../../change-requests/marketing/MARKETING-CHANNEL-CONTRACTS.md)
and [runtime team contract](../../change-requests/marketing/MARKETING-TEAM-REFINEMENT.md)
remain the full delivery scope. A sidebar capability becomes available when its
server contract and functional UI exist. The first slice activates Dashboard and
Strategy, described in [the strategy contract](features/FR-155-strategy-plans.md).
Campaign implementation follows [the initiative contract](features/FR-156-campaign-initiatives.md),
adding one scoped association while preserving Strategy evidence and PM execution ownership.

- Marketing owns planning payloads, immutable revisions, independent reviews,
  accountable decisions and references to accepted PM handoffs.
- Business Strategy keeps BusinessRoadmap and BusinessGoal authority. Their
  existing read projection is reused; Marketing does not clone these records.
- Project Manager owns Project, Workstream, work, progress and import receipts.
  Marketing calls its PlanEnvelope importer. Delivery progress is not ROAS,
  revenue or KPI attainment. A PM handoff never spends or publishes externally.
- Integration owns credentials, raw ingestion and provider adapters. Meta Ads,
  TikTok Ads, Instagram, GA4 and SEO selections in a draft are planning intent;
  selecting one does not connect an account or claim available measurements.
- Files owns binary assets. Asset Management owns physical assets.
- Identity owns authentication, Business grants and membership. Marketing Team
  assignment grants no access. The first write policy is existing Business OWNER
  plus `growth` visibility; no new privileged role is introduced.
- MSP owns agent sessions/control/memory and GKS owns canonical knowledge. Human
  review records in this slice do not constitute an operational agent runtime.

## Storage and acceptance

MarketingPlan is a Business-scoped UUID identity with a human code. Immutable
MarketingPlanVersion, MarketingReview and MarketingDecision records preserve the
exact payload hash and actors. MarketingHandoff links that revision to one target
Workspace and PM receipt. Scope derives from the server-loaded Business; no tenant
identifier supplied in a plan controls authorization. Repository operations and
audit participate in the same transaction, with expected-version compare-and-swap.

Local SQLite is the test/runtime baseline. The generated Postgres schema and
additive SQL migration accompany schema changes; no production migration or live
PM intake is implied by source delivery. Completion evidence is recorded in the
[tracking plan](../../roadmap/PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md).

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Activate the approved Marketing lane and first Strategy slice | See git history | RWANG |
