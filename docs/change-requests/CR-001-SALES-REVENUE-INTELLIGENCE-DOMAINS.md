---
doc_type: change-request
id: CR-001
status: proposed
version: "0.1.0"
created_at: "2026-08-20T18:14:00+07:00"
updated_at: "2026-08-20T18:14:00+07:00"
owner: "Boss"
impacted_domains:
  - crm
  - integration
  - agent
  - market-intelligence
proposed_domains:
  - sales
  - conversation-intelligence
  - engagement
  - finance
---

# CR-001 — Sales, Conversation Intelligence, Engagement & Finance Domains

## 1. Change summary

Introduce four first-class business domains into Zuri AI:

1. `sales`
2. `conversation-intelligence`
3. `engagement`
4. `finance`

The change extends the current CRM + integration foundation into a closed-loop revenue operating system without turning `crm` into a God Domain and without making `integration` a business-truth owner.

The target business loop is:

```text
Lead / Customer
→ Call List
→ Sales Conversation
→ Conversation Intelligence
→ Customer / Opportunity State
→ Pipeline / Funnel
→ Next Best Action
→ LINE / Email / Human Follow-up
→ Quotation / Invoice / Payment
→ Revenue Outcome
→ Sales Learning / Coaching
```

This CR is a planning and architecture change request. It does **not** authorize implementation directly. Each implementation slice must be delivered through normal Zuri requirements, architecture, code, tests, evidence, and documentation gates.

---

## 2. Current-state problem

Zuri already has strong foundations for customer identity, conversation ingestion, external integrations, and raw evidence, but the current domain map does not yet provide first-class ownership for the commercial lifecycle after a conversation begins.

Current relevant ownership:

- `crm` owns `Person`, `Customer`, `Conversation`, and `Message`.
- `integration` owns provider metadata, connections, credentials, ingestion runs, raw external records, sync cursors, external references, and dead letters.
- `integration` explicitly does **not** own business truth.
- `market-intelligence` owns external market observations, not internal deal lifecycle.

Without new domain boundaries, the likely failure mode is to place sales pipeline, campaign automation, financial state, and conversation-derived intelligence inside `crm`, which would create a God Domain and mix distinct lifecycles.

The missing capabilities are:

- operational sales pipeline and opportunity state;
- action-oriented call lists and follow-up queues;
- conversation-derived insights with evidence spans;
- funnel drop-off attribution from actual calls;
- sales-call coaching and behavioral scoring;
- customer commercial state and next-best-action;
- LINE and email campaign/journey orchestration;
- engagement events such as delivered/opened/clicked/replied/unsubscribed;
- FlowAccount-derived financial truth such as quotation, invoice, receipt, payment, and revenue;
- end-to-end attribution from conversation → engagement → close → collected revenue.

---

## 3. Decision

### 3.1 Create four new domains

```text
crm
sales
conversation-intelligence
engagement
finance
integration
```

### 3.2 Preserve existing boundaries

`crm` remains the Customer & Conversation System of Record.

`integration` remains the External Connectivity & Raw Ingestion Platform.

The new domains consume existing contracts and publish their own business contracts; they must not directly seize ownership of models already owned by `crm` or `integration`.

---

## 4. Target domain definitions

### 4.1 `crm`

**Definition:** who the business talks to and what was said.

**Owns:**

- Person
- Customer
- Conversation
- Message
- customer profile facts that are not opportunity-specific
- communication timeline references

**Does not own:**

- Opportunity stage
- Sales forecast
- Campaign orchestration
- Conversation AI inference
- Invoice/payment/revenue truth

---

### 4.2 `sales` — NEW

**Definition:** the commercial pursuit lifecycle from lead/opportunity to close, including what sales must do next.

**Proposed core models:**

- Lead
- Opportunity
- Pipeline
- PipelineStage
- OpportunityStageTransition
- SalesTask
- CallListItem
- FollowUp
- SalesActivity
- CommercialState
- FunnelDropoff
- ForecastSnapshot
- OpportunityOutcome

**Owns:**

- lead qualification state;
- opportunity lifecycle;
- pipeline stage;
- commercial status;
- sales owner;
- next action;
- call list priority;
- follow-up due date;
- forecast;
- win/loss/drop-off business state.

**Does not own:**

- base Customer identity;
- raw conversation transcript;
- provider credentials;
- financial accounting documents.

---

### 4.3 `conversation-intelligence` — NEW

**Definition:** transforms recorded or textual business conversations into structured, evidence-linked observations and inferences without becoming the source of truth for Customer or Opportunity state.

**Proposed core models:**

- Recording
- RecordingParticipant
- Transcript
- TranscriptSegment
- SpeakerTurn
- ConversationInsight
- EvidenceSpan
- PainPoint
- NeedSignal
- BudgetSignal
- AuthoritySignal
- TimelineSignal
- Objection
- BuyingSignal
- CompetitorMention
- Commitment
- NextStepSuggestion
- SalesBehaviorObservation
- SalesCallScorecard

**Owns:**

- recording metadata;
- transcript;
- diarization/speaker attribution result;
- evidence spans;
- extracted observations;
- AI inferences and confidence;
- sales behavior observations;
- call scorecard.

**Does not own:**

- Customer business truth;
- Opportunity stage;
- campaign state;
- invoice/payment state.

**Truth rule:** every derived field must preserve `source_kind`, `confidence`, and `evidence_ref` where applicable.

Recommended `source_kind` vocabulary:

```text
CUSTOMER_EXPLICIT
SALE_EXPLICIT
SALE_NOTE
MODEL_OBSERVED
MODEL_INFERRED
SYSTEM_DERIVED
UNKNOWN
```

---

### 4.4 `engagement` — NEW

**Definition:** orchestrates intentional outbound communication and records audience/campaign/journey outcomes across channels.

**Proposed core models:**

- Audience
- Segment
- Campaign
- Journey
- JourneyStep
- Channel
- MessageTemplate
- EngagementMessage
- DeliveryAttempt
- EngagementEvent
- ConsentPreference
- UnsubscribeState
- AttributionTouch

**Initial channels:**

- LINE OA
- Email
- Human sales follow-up intent

**Future-compatible channels:**

- SMS
- WhatsApp
- web push
- other provider adapters

**Owns:**

- audience definition;
- campaign/journey intent;
- channel selection policy;
- message scheduling;
- engagement events;
- unsubscribe/communication preference;
- campaign attribution.

**Does not own:**

- provider connection credentials;
- raw provider webhook payloads;
- base Conversation/Message rows;
- Opportunity stage;
- payment status.

---

### 4.5 `finance` — NEW

**Definition:** business financial truth resulting from commercial activity.

**Proposed core models:**

- Quotation
- Invoice
- Receipt
- Payment
- PaymentAllocation
- RevenueEvent
- CustomerRevenueSummary
- OpportunityRevenueLink

**Owns:**

- quotation state;
- invoice state;
- receipt state;
- payment state;
- collected revenue;
- opportunity-to-revenue linkage;
- customer revenue summary/LTV inputs.

**Does not own:**

- FlowAccount credentials;
- raw FlowAccount payloads;
- provider sync cursors.

---

### 4.6 `integration` — EXISTING, EXTENDED BY ADAPTERS ONLY

**Definition:** provider-neutral external connectivity and raw ingestion.

Add or extend provider adapters for:

- FlowAccount
- Email delivery/marketing provider(s)
- LINE OA outbound/event adapters as needed

`integration` continues to own:

- IntegrationProvider
- IntegrationConnection
- IntegrationCredential
- IngestionRun
- RawExternalRecord
- SyncCursor
- ExternalEntityRef
- DeadLetterRecord

It must not write domain truth directly.

---

## 5. Required cross-domain contracts

### 5.1 CRM → Sales

```text
CustomerRef
ConversationRef
→ sales
```

Sales may reference CRM IDs but may not mutate CRM-owned rows directly.

### 5.2 Conversation Intelligence → Sales

```text
ConversationInsightBatch
{
  conversationId
  opportunityId?
  observations[]
  inferences[]
  evidenceRefs[]
  producedAt
  modelRunRef?
}
```

Sales decides whether an inference changes commercial state.

### 5.3 Sales → Engagement

```text
EngagementIntent
{
  customerId
  opportunityId?
  segmentId?
  reason
  desiredOutcome
  recommendedChannel
  dueAt?
}
```

Engagement owns execution/journey state.

### 5.4 Engagement → CRM

Outbound and inbound communication receipts must resolve through the existing CRM conversation/message boundaries where appropriate. Engagement must not create a second message system.

### 5.5 Integration → Finance

```text
NormalizedFinancialRecord
{
  provider
  connectionId
  externalEntityType
  externalEntityId
  businessId
  customerRef?
  opportunityRef?
  payloadVersion
  normalizedData
  rawRecordRef
}
```

Raw provider payload remains in `integration`; normalized financial truth lands in `finance` only after mapping/validation.

### 5.6 Finance → Sales

```text
RevenueOutcome
{
  opportunityId
  quotationStatus?
  invoiceStatus?
  paymentStatus
  amountCollected
  currency
  occurredAt
}
```

Sales can close the learning loop using actual revenue outcomes.

---

## 6. End-to-end flows

### 6.1 Sales call flow

```text
CRM Customer
→ Sales CallListItem
→ Recording starts
→ Conversation Intelligence transcript + evidence
→ extracted need / pain / budget / authority / timeline / objection / buying signal
→ proposed Sales commercial-state delta
→ rule/human approval when required
→ Opportunity update
→ next action / follow-up
```

### 6.2 Funnel drop-off flow

```text
Opportunity stage
+ conversation evidence
+ outcome
→ FunnelDropoff
→ reason taxonomy
→ evidence link
→ aggregate funnel analytics
```

### 6.3 LINE campaign flow

```text
Sales / Customer State
→ Engagement Segment
→ Campaign / Journey
→ Integration LINE adapter
→ provider event
→ Integration RawExternalRecord
→ EngagementEvent
→ CRM conversation/message receipt if applicable
→ Sales signal / next action
```

### 6.4 Email marketing flow

```text
Segment
→ Campaign / Journey
→ Email provider adapter
→ SENT / DELIVERED / OPENED / CLICKED / REPLIED / BOUNCED / UNSUBSCRIBED
→ EngagementEvent
→ attribution / Sales priority update
```

### 6.5 FlowAccount flow

```text
FlowAccount API
→ Integration raw ingestion
→ normalized financial mapping
→ Finance Quotation / Invoice / Receipt / Payment
→ RevenueOutcome
→ Sales Opportunity
→ Customer revenue summary
```

---

## 7. Call List design

Call List is not a static contact list. It is an action queue.

Minimum `CallListItem` semantics:

- customerId
- opportunityId
- ownerId
- currentStage
- reasonToCall
- priority
- dueAt
- lastInteractionAt
- lastOutcome
- currentObjection?
- nextAction
- evidenceRefs[] where reason derives from a conversation
- status: `OPEN | IN_PROGRESS | DONE | SKIPPED | SNOOZED`

Initial priority inputs may include:

```text
stage urgency
+ next-action deadline
+ explicit buying signal
+ engagement response
+ days since last contact
+ opportunity value
+ manually assigned priority
```

Any later ML score must remain explainable and must not erase deterministic reasons.

---

## 8. Customer state model

Separate CRM profile state from Sales commercial state.

Example:

```text
CRM Customer
- identity
- communication channels
- organization/profile facts

Sales CommercialState
- interest
- productInterest
- budgetRange
- authorityState
- purchaseTimeline
- objectionState
- intentLevel
- nextAction
- ownerAssessment
```

Every mutable commercial state change must retain history rather than only overwriting the latest value.

Recommended transition record:

```text
CommercialStateTransition
{
  opportunityId
  field
  fromValue
  toValue
  sourceKind
  evidenceRef?
  confidence?
  changedBy
  changedAt
}
```

---

## 9. Conversation truth and AI safety rules

1. Transcript is evidence, not automatically canonical business truth.
2. Diarization/speaker identity may be uncertain.
3. AI inference must never be stored indistinguishably from an explicit customer statement.
4. High-impact updates such as budget, decision maker, legal commitment, and stage movement must use policy-based acceptance.
5. Evidence-linked fields must resolve to a real transcript/audio span.
6. If source evidence is deleted or unavailable, derived insights must expose degraded provenance.
7. Reprocessing a recording must create a new analysis revision, not silently rewrite historical model output.

---

## 10. Engagement rules

1. LINE and email are channels, not domain owners.
2. Engagement must support channel-neutral campaign/journey logic.
3. Email events must support at least `SENT`, `DELIVERED`, `OPENED`, `CLICKED`, `REPLIED`, `BOUNCED`, `UNSUBSCRIBED` where the provider can supply them.
4. LINE events must map into channel-neutral engagement semantics where possible.
5. Unsubscribe/consent preference must prevent future sends for the applicable channel/scope.
6. Provider raw payloads remain replayable under `integration`.
7. Campaign analytics must distinguish delivery metrics from conversion/revenue metrics.

---

## 11. Finance rules

1. FlowAccount is a provider, not the finance domain.
2. Provider external IDs must never become internal primary keys.
3. Raw records must remain replayable after translation failure.
4. Finance writes must be idempotent per provider entity/version/event.
5. Revenue must distinguish invoiced amount from collected amount.
6. Opportunity `WON` must not automatically mean `PAID`.
7. Payment/revenue corrections must preserve audit history.

---

## 12. Out of scope for this CR

- implementing a full dialer/telephony provider;
- replacing FUNG or building a generic audio engine inside Zuri;
- autonomous stage changes with no policy/human gate;
- predictive lead scoring ML in the first slice;
- WhatsApp/SMS production adapters in the first slice;
- accounting ledger replacement for FlowAccount;
- public marketing attribution across anonymous web traffic;
- commission/payroll management;
- full CPQ product configurator;
- automated legal/compliance conclusions from recorded calls.

---

## 13. Delivery strategy

Deliver as incremental vertical slices. Do not create all schemas first and leave them disconnected.

### Phase 0 — Architecture and domain registration

**Goal:** establish ownership before code.

Work:

- create charters for the four new domains;
- register domain modules in doc graph/domain tooling;
- define dependency rules;
- define model ownership;
- define public contracts;
- update architecture diagrams/domain map generation inputs;
- create initial ADR if new dependency direction requires it.

**Exit gate:** domain graph has no ambiguous model owner and no dependency cycle.

---

### Phase 1 — Sales core

**Goal:** operational pipeline and call list without AI dependency.

Work:

- Lead / Opportunity / Pipeline / PipelineStage;
- Opportunity stage transitions/history;
- CommercialState + transitions;
- SalesTask / FollowUp / CallListItem;
- pipeline read APIs;
- call-list read/write workflow;
- deterministic next-action and priority baseline.

**Exit gate:** a Customer can become an Opportunity, move through stages, create follow-up work, and appear in a call list with full history.

---

### Phase 2 — Conversation Intelligence evidence core

**Goal:** ingest recordings/transcripts and produce evidence-linked structured insight.

Work:

- Recording / Transcript / SpeakerTurn / EvidenceSpan;
- analysis revision/model-run reference;
- observation vs inference source classification;
- insight extraction contract;
- proposed commercial-state delta;
- human/policy review gate;
- SalesCallScorecard baseline.

**Exit gate:** an analyzed call can produce evidence-linked proposed updates without mutating Sales truth directly.

---

### Phase 3 — Funnel intelligence and coaching

**Goal:** explain where and why opportunities drop.

Work:

- FunnelDropoff taxonomy;
- stage/drop-off linkage;
- objection and lost-reason aggregation;
- sales behavior observations;
- call scorecards;
- funnel analytics/read models.

**Exit gate:** management can trace an aggregate drop-off reason back to the exact conversation evidence used to derive it.

---

### Phase 4 — Engagement core: LINE + Email

**Goal:** channel-neutral campaigns and journeys.

Work:

- Audience / Segment;
- Campaign / Journey / JourneyStep;
- EngagementMessage;
- LINE adapter binding through integration;
- email provider adapter through integration;
- event normalization;
- unsubscribe/consent preference;
- attribution touch;
- engagement → Sales signal path.

**Exit gate:** one segment can run a LINE or email journey and return normalized engagement events without bypassing `integration` or creating duplicate CRM messages.

---

### Phase 5 — FlowAccount / Finance

**Goal:** close the loop to real money.

Work:

- FlowAccount provider adapter;
- raw ingestion + cursor/idempotency;
- financial translation contract;
- Quotation / Invoice / Receipt / Payment;
- OpportunityRevenueLink;
- RevenueOutcome;
- CustomerRevenueSummary.

**Exit gate:** a FlowAccount payment can be replayed from raw evidence into finance truth exactly once and linked to the correct opportunity/customer.

---

### Phase 6 — Revenue Intelligence closed loop

**Goal:** connect behavior to business outcome.

Work:

- pipeline conversion analytics;
- conversation pattern vs outcome analytics;
- engagement attribution;
- collected revenue by opportunity/customer/channel;
- next-best-action rule engine baseline;
- sales coaching feedback loop.

**Exit gate:** the system can answer "where are customers dropping, why, what should Sales do next, and what actually produced collected revenue?" using traceable source data.

---

## 14. Dependency order

```text
P0 Domain ownership/contracts
        ↓
P1 Sales core
        ↓
P2 Conversation evidence + insight
        ↓
P3 Funnel intelligence/coaching

P0 Integration contract
        ↓
P4 Engagement LINE + Email

P0 Integration contract
        ↓
P5 Finance / FlowAccount

P1 + P2 + P3 + P4 + P5
        ↓
P6 Revenue Intelligence closed loop
```

Parallelizable after Phase 0:

- Phase 1 Sales core
- provider-neutral Engagement contract work
- FlowAccount adapter discovery/spike
- recording/transcript contract spike

But P6 must not start before Sales, Conversation Intelligence, Engagement, and Finance expose stable read contracts.

---

## 15. Acceptance criteria

### AC-DOM — Domain boundaries

**AC-DOM-001 — First-class domain registration**  
Given the generated domain map, when documentation graph generation runs, then `sales`, `conversation-intelligence`, `engagement`, and `finance` appear as first-class domains with charters and module ownership.

**AC-DOM-002 — Single model owner**  
Given every new business model, when ownership validation runs, then each model has exactly one owning domain.

**AC-DOM-003 — No CRM God Domain**  
Given Sales, Engagement, Conversation Intelligence, and Finance models, when reviewing CRM ownership, then none of those models are owned by `crm` unless explicitly approved by a superseding ADR.

**AC-DOM-004 — Integration remains non-truth owner**  
Given provider ingestion, when raw records arrive, then `integration` stores provider evidence/connection state but does not directly create or update Sales, CRM, Engagement, or Finance business truth.

**AC-DOM-005 — Dependency direction is acyclic**  
Given domain imports/contracts, when dependency validation runs, then the new domain graph contains no prohibited cycle.

---

### AC-SALES — Sales core

**AC-SALES-001 — Opportunity creation**  
Given an existing CRM Customer, when Sales creates an Opportunity, then the Opportunity references the Customer without copying or owning the Customer identity record.

**AC-SALES-002 — Stage history**  
Given an Opportunity changes stage, when the transition commits, then the previous and new stages, actor/source, and timestamp are preserved in immutable transition history.

**AC-SALES-003 — Commercial state provenance**  
Given budget/intent/authority/timeline state changes, when persisted, then the transition records source kind and optional evidence/confidence instead of overwriting state without provenance.

**AC-SALES-004 — Call list is actionable**  
Given open follow-up work, when Call List is queried, then each item exposes customer, opportunity, owner, stage, reason-to-call, priority, due time, last interaction, and next action.

**AC-SALES-005 — Deterministic priority explainability**  
Given a call-list priority, when inspected, then the user can see deterministic reasons contributing to priority; a later ML score must not hide those reasons.

**AC-SALES-006 — Follow-up lifecycle**  
Given a FollowUp, when completed/snoozed/skipped, then its state change is recorded and duplicate execution is idempotent.

**AC-SALES-007 — Won is not paid**  
Given an Opportunity becomes `WON`, when Finance has no collected payment, then the system does not report the Opportunity as paid revenue.

---

### AC-CI — Conversation Intelligence

**AC-CI-001 — Recording/transcript linkage**  
Given a Recording and Transcript, when persisted, then every TranscriptSegment resolves to the source recording and time range.

**AC-CI-002 — Evidence span validity**  
Given an Insight with `evidenceRef`, when the evidence is opened, then it resolves to an existing transcript/audio interval.

**AC-CI-003 — Observation vs inference separation**  
Given explicit customer speech and model interpretation, when stored, then they remain distinguishable through `source_kind` and cannot collapse into the same truth class.

**AC-CI-004 — Confidence required for model inference**  
Given a model-inferred insight, when persisted, then confidence/uncertainty metadata is stored according to the contract.

**AC-CI-005 — No direct Sales mutation**  
Given the model extracts budget, decision maker, intent, or stage recommendation, when analysis completes, then Conversation Intelligence emits a proposed delta and does not directly mutate Sales-owned state.

**AC-CI-006 — Revision preservation**  
Given a Recording is reprocessed with a new model or configuration, when a second analysis completes, then the prior analysis remains auditable rather than being silently overwritten.

**AC-CI-007 — Sales call scorecard evidence**  
Given a scorecard item such as "budget not asked", when shown, then the scorecard includes rule/evidence context sufficient to explain the score.

**AC-CI-008 — Degraded provenance**  
Given source audio/transcript evidence is unavailable, when an existing derived insight is read, then provenance status is marked degraded/missing rather than pretending full evidence remains.

---

### AC-FUNNEL — Funnel intelligence

**AC-FUNNEL-001 — Drop-off has stage and reason**  
Given an Opportunity is lost or stalls beyond the configured rule, when a FunnelDropoff is created, then it records stage, reason taxonomy, source, and optional evidence reference.

**AC-FUNNEL-002 — Evidence traceability**  
Given an aggregated drop-off reason, when a manager drills down, then contributing opportunities and source evidence can be enumerated.

**AC-FUNNEL-003 — Unknown remains unknown**  
Given no supported reason can be derived, when classifying drop-off, then the reason remains `UNKNOWN`/unclassified rather than being invented.

**AC-FUNNEL-004 — Human correction preserved**  
Given a manager corrects an inferred lost reason, when saved, then the correction is preserved as a new reviewed state with original model result retained for audit.

---

### AC-ENG — Engagement / LINE / Email

**AC-ENG-001 — Channel-neutral journey**  
Given a JourneyStep, when channel is LINE or Email, then the business journey contract remains channel-neutral and provider-specific details stay in adapters.

**AC-ENG-002 — Segment reproducibility**  
Given a Segment used by a campaign, when campaign execution starts, then the audience selection criteria/version are persisted so the audience can be reconstructed.

**AC-ENG-003 — Integration-only provider access**  
Given a send request, when Engagement needs LINE/email provider access, then it uses an Integration contract/adapter and does not read raw credentials directly.

**AC-ENG-004 — Normalized event vocabulary**  
Given provider delivery/webhook events, when translated, then they map into normalized EngagementEvent types without losing a reference to the raw external record.

**AC-ENG-005 — Email minimum events**  
Given provider support, when email events arrive, then `SENT`, `DELIVERED`, `OPENED`, `CLICKED`, `REPLIED`, `BOUNCED`, and `UNSUBSCRIBED` can be represented independently.

**AC-ENG-006 — Unsubscribe enforcement**  
Given a Customer/channel is unsubscribed, when a campaign attempts a prohibited send, then the send is blocked before provider delivery.

**AC-ENG-007 — No duplicate CRM message system**  
Given an outbound/inbound engagement becomes a customer conversation event, when it is recorded, then CRM Conversation/Message remains the communication record owner instead of Engagement creating a competing message table for the same purpose.

**AC-ENG-008 — Engagement signal to Sales**  
Given a meaningful engagement event such as reply or pricing-link click, when policy conditions match, then Sales can consume a typed signal and update next-action/priority through Sales-owned logic.

**AC-ENG-009 — Delivery is not conversion**  
Given a message is delivered/opened/clicked, when analytics are shown, then those metrics are not reported as revenue conversion unless a linked business outcome exists.

---

### AC-INT — External integration substrate

**AC-INT-001 — Raw-first evidence**  
Given a LINE, email, or FlowAccount external event, when ingestion starts, then the raw provider payload is persisted before business translation when technically possible.

**AC-INT-002 — Idempotent redelivery**  
Given the identical external event is redelivered, when ingestion runs again, then duplicate raw/business effects are not created.

**AC-INT-003 — External IDs are not primary keys**  
Given a provider entity ID, when normalized into a business domain, then the provider ID is mapped via an external reference and does not become the internal primary key.

**AC-INT-004 — Failed translation preserves raw payload**  
Given translation fails, when the run terminates, then the raw record remains replayable and a dead-letter/failure record identifies the failed stage.

**AC-INT-005 — Tenant/business scope cannot widen from payload**  
Given an external payload contains tenant/business-like identifiers, when ingested, then server-proven connection scope remains authoritative and payload values cannot widen access.

---

### AC-FIN — Finance / FlowAccount

**AC-FIN-001 — FlowAccount adapter boundary**  
Given a FlowAccount connection, when financial data is synchronized, then credentials/cursors/raw payloads remain owned by Integration and normalized business records are handed to Finance.

**AC-FIN-002 — Financial entity idempotency**  
Given the same external invoice/payment version is synchronized repeatedly, when Finance applies it, then only one corresponding effective business state is produced.

**AC-FIN-003 — Invoice vs collected revenue**  
Given an Invoice is issued but unpaid, when revenue analytics run, then invoiced amount and collected amount remain distinct.

**AC-FIN-004 — Payment linkage**  
Given a Payment resolves to an Opportunity/Customer mapping, when applied, then Finance records the linkage and Sales can consume a RevenueOutcome without owning the Payment row.

**AC-FIN-005 — Correction history**  
Given FlowAccount corrects/cancels an invoice, receipt, or payment, when synchronized, then prior state remains auditable and the effective current state is updated deterministically.

**AC-FIN-006 — Unknown mapping does not invent Customer**  
Given a financial record cannot resolve to a known Customer/Opportunity, when translation runs, then it enters an explicit review/unmapped state rather than silently inventing or merging a Customer.

---

### AC-CLOSED — Closed-loop Revenue Intelligence

**AC-CLOSED-001 — Conversation to opportunity trace**  
Given a Sales conversation influences a commercial-state change, when audited, then the chain `Opportunity → transition → proposed delta → insight → evidence span → transcript/recording` is traceable.

**AC-CLOSED-002 — Engagement to opportunity trace**  
Given an Engagement event causes Sales priority/next-action change, when audited, then the originating Campaign/Journey/Message/Event is traceable.

**AC-CLOSED-003 — Opportunity to revenue trace**  
Given collected revenue, when audited, then the chain to Finance payment, provider/raw reference, Opportunity, and Customer is traceable where mapping exists.

**AC-CLOSED-004 — Funnel analytics use real outcomes**  
Given pipeline analytics, when conversion/win rates are computed, then they derive from Sales transition/outcome history rather than mutable latest-stage snapshots alone.

**AC-CLOSED-005 — Revenue analytics use collected money**  
Given revenue reporting, when collected revenue is requested, then results derive from Finance payment/revenue events rather than `Opportunity.WON` or invoice issuance.

**AC-CLOSED-006 — Next-best-action is explainable**  
Given a recommended next action, when displayed, then deterministic contributing signals and provenance are available.

**AC-CLOSED-007 — No silent AI truth promotion**  
Given an AI-derived recommendation or inference, when it becomes authoritative Sales/CRM/Finance state, then the policy/human/rule path that accepted it is auditable.

---

### AC-NFR — Non-functional and governance acceptance criteria

**AC-NFR-001 — Tenant isolation**  
All reads/writes in new domains are tenant/business scoped according to existing Zuri authority contracts; cross-tenant identifiers are rejected, not post-filtered.

**AC-NFR-002 — PII minimization**  
Conversation recordings/transcripts and engagement data expose only the minimum PII required by each surface and never leak provider credentials/raw secrets.

**AC-NFR-003 — Auditability**  
State-changing operations record actor/system source, timestamp, affected entity, and before/after or transition identity as appropriate.

**AC-NFR-004 — Idempotency**  
External event ingestion, financial synchronization, outbound send receipts, and retried analysis writes have explicit idempotency semantics.

**AC-NFR-005 — Replay safety**  
Replaying a RawExternalRecord or re-running an analysis does not duplicate effective business truth.

**AC-NFR-006 — Failure isolation**  
Failure of Conversation Intelligence, Engagement provider, email provider, LINE provider, or FlowAccount does not corrupt CRM Customer/Conversation truth.

**AC-NFR-007 — Observability**  
Every cross-domain workflow exposes correlation identifiers sufficient to trace a request/event from ingress through business-domain effects.

**AC-NFR-008 — No direct credential access from business domains**  
Sales, CRM, Engagement, Conversation Intelligence, and Finance do not directly read secret material; provider access goes through Integration runtime contracts.

**AC-NFR-009 — Schema migration rollback plan**  
Every migration that introduces new domain truth has a documented rollback/forward-fix strategy before production deployment.

**AC-NFR-010 — Documentation graph consistency**  
After each implementation slice, doc graph/domain-state generation completes with no new unresolved domain ownership or broken cross-reference violations.

---

## 16. Required test layers

Each vertical slice must provide the applicable set of:

1. Domain unit tests
2. Contract/schema tests
3. Repository/persistence tests
4. Cross-domain integration tests
5. Provider adapter tests using fixtures
6. Idempotency/replay tests
7. Tenant-boundary negative tests
8. API/service tests
9. UI/component tests where a surface exists
10. End-to-end workflow test
11. Observability/correlation assertions
12. Migration test where schema changes

No phase may be marked complete from UI screenshots or schema presence alone.

---

## 17. Required end-to-end scenarios

### E2E-01 — Call → insight → follow-up

```text
Customer
→ Opportunity
→ CallListItem
→ Recording/Transcript
→ Insight + Evidence
→ Proposed CommercialState delta
→ Accepted Sales transition
→ FollowUp
```

### E2E-02 — Call → funnel drop-off

```text
Opportunity
→ conversation
→ objection
→ lost/stalled stage
→ FunnelDropoff
→ manager drilldown to evidence
```

### E2E-03 — Segment → email → reply → Sales action

```text
Segment
→ Email Journey
→ provider send
→ reply/click event
→ EngagementEvent
→ Sales signal
→ CallList priority / next action
```

### E2E-04 — Segment → LINE → CRM conversation

```text
Campaign
→ LINE send
→ provider event/reply
→ raw Integration evidence
→ CRM Conversation/Message
→ Sales signal
```

### E2E-05 — Won → FlowAccount → payment → revenue

```text
Opportunity WON
→ Quotation/Invoice
→ FlowAccount sync
→ raw record
→ Finance Payment
→ RevenueOutcome
→ CustomerRevenueSummary
```

### E2E-06 — Translation failure and replay

```text
External event
→ RawExternalRecord
→ translation fails
→ DeadLetter
→ mapping/rule fixed
→ replay
→ exactly one business effect
```

---

## 18. Suggested work packages

### WP-0 — Domain architecture

- WP-0.1 Create domain charters
- WP-0.2 Add domain ownership/graph registration
- WP-0.3 Define dependency policy
- WP-0.4 Define contracts and event vocabulary
- WP-0.5 Architecture/diagram updates

### WP-1 — Sales core

- WP-1.1 Sales data model
- WP-1.2 Opportunity/pipeline service
- WP-1.3 transition history
- WP-1.4 commercial-state history
- WP-1.5 Call List / FollowUp
- WP-1.6 Sales read APIs/UI baseline

### WP-2 — Conversation Intelligence

- WP-2.1 Recording/transcript contracts
- WP-2.2 evidence model
- WP-2.3 analysis revision/model-run provenance
- WP-2.4 insight extraction contract
- WP-2.5 proposed delta review flow
- WP-2.6 scorecard

### WP-3 — Funnel Intelligence

- WP-3.1 drop-off taxonomy
- WP-3.2 lost/stalled classifier
- WP-3.3 evidence drilldown
- WP-3.4 aggregate analytics
- WP-3.5 coaching read model

### WP-4 — Engagement

- WP-4.1 Audience/Segment
- WP-4.2 Campaign/Journey
- WP-4.3 channel-neutral message contract
- WP-4.4 LINE adapter wiring
- WP-4.5 Email adapter wiring
- WP-4.6 normalized EngagementEvent
- WP-4.7 unsubscribe/consent enforcement
- WP-4.8 attribution and Sales signals

### WP-5 — Finance / FlowAccount

- WP-5.1 FlowAccount provider contract
- WP-5.2 ingestion/sync cursor
- WP-5.3 financial normalization
- WP-5.4 Quotation/Invoice/Receipt/Payment
- WP-5.5 opportunity/customer mapping
- WP-5.6 RevenueOutcome / revenue summary
- WP-5.7 correction/replay tests

### WP-6 — Revenue Intelligence

- WP-6.1 funnel conversion metrics
- WP-6.2 conversation-outcome analytics
- WP-6.3 engagement attribution
- WP-6.4 collected-revenue analytics
- WP-6.5 deterministic next-best-action rules
- WP-6.6 coaching feedback loop

---

## 19. Definition of Done for the CR program

The CR program is complete only when all of the following are true:

- four new domain charters exist and are registered;
- domain ownership is unambiguous;
- Sales pipeline/call list works without AI;
- Conversation Intelligence produces evidence-linked insights and proposed deltas;
- funnel drop-off can be traced to source evidence;
- LINE and email operate through Engagement + Integration boundaries;
- unsubscribe/consent is enforced;
- FlowAccount operates through Integration → Finance boundaries;
- collected revenue is distinguishable from invoice/won state;
- CRM remains owner of Customer/Conversation/Message;
- Integration remains owner of provider/raw evidence and not business truth;
- no high-impact AI inference becomes authoritative state silently;
- all required E2E scenarios pass;
- tenant isolation/idempotency/replay tests pass;
- generated domain/doc graph is clean;
- implementation evidence is committed for every completed phase.

---

## 20. Implementation ordering recommendation

Recommended first implementation tranche:

```text
1. WP-0 Domain architecture
2. WP-1 Sales core
3. WP-2 Conversation Intelligence evidence contract
```

Do **not** start with email/LINE automation or FlowAccount first. Without Opportunity/CommercialState ownership, engagement and finance signals have nowhere clean to land and will force domain leakage back into CRM.

Second tranche:

```text
4. WP-3 Funnel Intelligence
5. WP-4 Engagement
6. WP-5 Finance
```

Final convergence tranche:

```text
7. WP-6 Revenue Intelligence
```

---

## 21. Open decisions requiring ADR/owner approval before implementation

1. Exact Sales stage taxonomy: global default vs Business-configurable pipeline.
2. Whether `Lead` is a separate entity or an Opportunity pre-stage over CRM Customer.
3. Recording storage provider and retention policy.
4. Whether audio itself lives inside Zuri storage or only by external artifact reference.
5. Initial email provider(s).
6. FlowAccount authorization mode and tenant connection lifecycle.
7. Human-review policy for AI-proposed commercial-state changes.
8. Consent/recording disclosure policy for Sales calls.
9. Default funnel-dropoff reason taxonomy and per-Business extensibility.
10. Attribution model for multi-touch engagement (`first`, `last`, `linear`, or evidence-only in phase 1).

None of these open decisions block creation of the domain boundaries or Sales core, but the relevant downstream work package must not ship until its decision is resolved.

---

## 22. Success criteria at product level

After this CR is implemented, Zuri should be able to answer, with traceable evidence:

1. Who is the customer?
2. What have we discussed with them?
3. What did the customer explicitly say vs what did AI infer?
4. Which opportunity and funnel stage are they in?
5. Why are they likely to progress, stall, or drop?
6. What should Sales do next?
7. Which customers need to be called now?
8. What LINE/email journey was sent and how did they engage?
9. Which engagement affected the sales process?
10. What quotation/invoice/payment exists?
11. How much money was actually collected?
12. Which conversation, sales behavior, and engagement patterns correlate with collected revenue?

That is the intended transition from CRM records to an evidence-linked **Revenue Intelligence + Omnichannel Sales Engagement** capability while preserving Zuri's modular-monolith domain boundaries.
