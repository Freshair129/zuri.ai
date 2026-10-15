---
doc_type: proposal
task_id: TASK-ZAI-010
version: "0.1.0"
status: candidate
updated_at: "2026-10-15"
---

# Agent Approval Gateway L1-L4 over the FR-026 action gate

**Lifecycle: candidate only; non-authoritative.** This proposal is an intake document, not a product requirement, an approved decision, or runtime authority. It does not select approval policy, authorize implementation, change the roadmap, or claim Task10 is implemented or accepted.

**Source snapshot:** repository HEAD dcaaffa71555389bb7a4e80499f31a269fe24588. Findings below come from static inspection of the source and test assets at that revision. Test assets are references, not test results.

## Purpose and scope

TASK-ZAI-010 is recorded as planned in the [roadmap task list](../../roadmap/ROADMAP-zuri-ai-24w-program.md). Its intended subject is a possible L1-L4 approval boundary over selected writes already protected by FR-026 Gate F.

The proposal separates three things that currently have different owners and contracts:

1. FR-026 decides whether a resolved principal may execute a registered write and applies step-up to HIGH-sensitivity actions.
2. The agent role registry carries an approvalTier value as role metadata.
3. FR-272 and ADR-103 cover approval admission for Project Manager Agent/Fleet execution-run steps.

None of these sources, alone, defines an implemented general L1-L4 approval ladder for FR-026 actions.

## Source map and current behavior

| Source | What is present at the inspected revision | Boundary for TASK-ZAI-010 |
|---|---|---|
| [FR-026](../../requirements/FR-026.md), [Gate F action gate](../../../apps/server/src/modules/agent/action-gate.js), [step-up service](../../../apps/server/src/modules/agent/step-up.js), and [integration test asset](../../../apps/server/tests/integration/agent-action-gate.test.js) | FR-026 describes a separate WRITE registry and executor, principal resolution, Membership-role and resource-ownership authorization, sensitivity checks, single-use step-up for HIGH actions, and a transactional write with an audit event. The implementation resolves the LINE principal and authorization context and authorizes before entering the write transaction; when authorization returns `allowed=false`, it records `AGENT_ACTION/DENIED` before that transaction, and the cited integration test covers a HIGH step-up refusal but does not assert a `DENIED` audit for that path. For an allowed action, one transaction consumes any required HIGH step-up token, executes the action, and appends the execution audit. The tests cover registry separation, unknown-principal denial, staff and resource-owner cases, denied and successful audit events, HIGH step-up refusal, single-use consumption, and an action with no executor. | Gate F is an action authorization and execution boundary. It does not implement an L1-L4 approval request, reviewer decision, quorum, or approval ledger. A future approval result cannot replace Gate F, Identity authorization, step-up, or the owning writer. |
| [Agent role registry](../../../apps/server/src/modules/agent/role-registry.js) and [role registry unit test asset](../../../apps/server/tests/unit/agent-role-registry.test.js) | ROLE_SPECIFICATIONS.policy.approvalTier currently contains Executive=L4, Operations=L2, Finance Analyst=L3, Research=L1, and Marketing=L2. Unit assertions check the role-spec values and show a resolved Finance Analyst context carrying L3. | These are existing role metadata values. The Gate F action-gate module does not read approvalTier; the registry test does not establish action-to-tier policy, reviewer eligibility, quorum, or enforcement. This proposal does not reinterpret or change the values. |
| [FR-026 LINE Project/Work feature note](../../domains/agent/features/FR-026-line-project-work-confirmation.md) | This scoped flow previews a Work change and requires a new signed inbound confirmation bound to the actor, identity, target/version, arguments, and a short expiry. It records proposal and execution receipts and calls the canonical Work writer. | This is a specific confirmation protocol for that tool path. It is not a general multi-reviewer L1-L4 gateway. |
| [FR-272](../../requirements/FR-272.md), [FR-272 feature note](../../domains/project-manager/features/FR-272-approval-gateway-admission.md), [ADR-103](../../decisions/ADR-103-PM-APPROVAL-GATEWAY-ADMISSION.md), [PM approval service](../../../apps/server/src/modules/project-manager/application/approval-gateway.js), and [PM integration test asset](../../../apps/server/tests/integration/project-approval-gateway.test.js) | ADR-103 remains candidate design-only. The separate FR-272 record reports local implementation with verification and release pending and not deployed. PM owns an approval request scoped to an execution run and step. The request binds an exact digest and PM action class; Identity resolves current reviewer capability and scope; the executor rechecks state, hashes, expiry, revocation, and lease before admission. State transitions are audited, and the design keeps replay approvals separate. Its test asset covers scoped decisions, self-approval refusal, stale input and lease, expiry, revocation, idempotency, and replay isolation. | This is a PM execution-step contract, not an L1-L4 mapping for all FR-026 actions. Its action classes, reviewer model, data model, and lifecycle values are not adopted for Task10. Source and test presence do not establish test execution or production use. |

The [ADR-103 design](../../decisions/ADR-103-PM-APPROVAL-GATEWAY-ADMISSION.md) keeps Project Manager execution admission, Identity grants, executor leases, and owning-domain effects in their respective boundaries. Its documented service and test patterns may inform later review, but this proposal does not merge the PM and Agent approval authorities.

## Candidate boundary for review

A future approval component, with its owner and insertion point still to be decided, could hold selected FR-026 writes for an approved decision before handing control back to the existing Gate F path. It would not execute writes or grant Identity permissions. Gate F, Identity, step-up, any applicable provider-specific approval gate or record, and each owning domain's canonical writer would remain required authorities; the new gate must not bypass, replace, or weaken any of them.

An effectful step within the PM execution-run scope remains subject to the PM-owned FR-272 boundary; read-only steps follow the existing no-approval-row path. This proposal does not route it around that boundary, make the PM gateway a generic Agent gateway, or assume both systems share a request store.

No endpoint, state machine, database shape, digest field set, TTL, approver role, approval count, or L1-L4 action mapping is fixed here.

## Decisions reserved for the product owner

Every item below is open. The registry values and PM patterns above are source facts only; they do not resolve these choices.

| Decision | Questions that remain open |
|---|---|
| L1-L4 to action mapping | Which FR-026 actions, if any, belong to each tier? How should an eventual tier relate to Gate F sensitivity such as LOW or HIGH? |
| Reviewer eligibility and scope | Which people or Identity capabilities may review, for which tenant/Business/resource scope? Do role labels have any reviewer meaning? |
| Decision cardinality and quorum | How many decisions are required at each tier, in what sequence, and what distinct-principal rule applies? How are requester, agent, reviewer, target owner, and executor separated? |
| Expiry, revocation, and step-up | What expiry policy applies? At which points are grants and approvals revalidated? When is Identity step-up required, and how does it interact with an approval decision? |
| Persistence and audit | Which owning domain stores the request and current lifecycle projection? What immutable request evidence, audit events, retention, redaction, and recovery rules are required? |
| Replay and idempotency | What exact identity binds a decision to a request and effect? How do retries, duplicate decisions, changed inputs, replay, and an uncertain effect behave? |
| Migration ownership | Which domain owns schema and migrations, backup/restore behavior, compatibility, rollback, and the release gate? |

## Source questions requiring reconciliation

The current roadmap container for TASK-ZAI-010 remains planned, with its criteria unchecked. It records an acceptance criterion that an L4 action is refused until four distinct approvals exist, a success criterion that the same principal cannot count twice, and an exit criterion for positive and negative cases across L1-L4. Its changelog also says FR-026 has one HIGH-sensitivity step-up tier, not an approval ladder. The task container marks its Task10 test path unavailable; existing Gate F integration tests are not L1-L4 acceptance evidence.

Those roadmap statements are recorded but unchecked. The trusted scope for this candidate explicitly reserves tier/action mapping, reviewer eligibility, quorum/SoD, and decision cardinality for the product owner. The owner must reconcile and adopt, amend, or replace the unchecked criteria through the roadmap's normal authority path before implementation. This proposal neither discards those criteria nor promotes them to approved policy.

The role registry's existing role-to-tier metadata also needs an owner interpretation before it can be used by a gateway. The current source does not establish that those values classify actions or identify eligible reviewers.

Finally, the PM approval service is currently scoped to PM execution-run steps. Whether any Agent mission or action should call that service, remain under FR-026 only, or use another owner-approved boundary is unresolved. Neither reuse nor duplication is assumed.

## Dependency-ordered future plan

1. **Reconcile authority first.** Resolve the unchecked roadmap criteria against the product owner's intended L1-L4 policy. Keep the roadmap status and acceptance unchanged until its owner makes an authorized update.
2. **Freeze policy semantics.** Decide tier/action mapping, reviewer eligibility and scope, quorum and separation of duties, decision cardinality, expiry/revocation/step-up behavior, and the treatment of changed requests.
3. **Assign domain and data ownership.** Decide the Agent, Identity, Project Manager, and domain-writer interfaces; settle persistence, audit, replay/idempotency, retention, migration, backup, and rollback ownership.
4. **Review a complete contract.** Only after the policy and owners are resolved, specify the request/decision lifecycle, integration seam with Gate F, typed denials, race behavior, and privacy/security acceptance cases. Reconcile any PM interaction with FR-272's owning domain.
5. **Authorize a separate implementation task.** Register or migrate requirements through the repository's normal reviewed process, then plan code, migration, tests, independent review, exact-head CI, and release gates under the applicable mandate. This candidate does not authorize any of those effects.

## Delivery and evidence boundary

The [active v4 workflow](../../architecture/delivery-control/WORKFLOW-POLICY.md) treats READY as readiness evidence, not product-policy approval or runtime authority. TASK-ZAI-010 remains planned at the inspected source revision. No application tests or builds were run for this proposal, and no live, production, or deployment behavior is claimed.

## Version diff

- 0.1.0 - Initial candidate-only source map, boundary proposal, unresolved owner decisions, and dependency-ordered follow-up. No product policy or runtime behavior is approved by this document.
