---
id: ZAI:FR-150-P2
version: "0.1.6b"
status: beta
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-08T22:33:22+07:00,RWANG"
title: "Optional Edge conversation execution"
parent_requirement: FR-150
phase_id: FR-150-P2
phase_order: 2
domain: agent
bundle: FEAT-019
relations:
  - type: relates_to
    target: ZAI:FR-150
  - type: relates_to
    target: ZAI:FR-150-NOTE
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FR-150-P1
  - type: relates_to
    target: ZAI:FR-150-P3
---

# FR-150-P2 — Optional Edge conversation execution

## Responsibility

Apply the executor contract on the optional device. Own the answer contract boundary; the implementation is the external Edge application. Local process placement and external-model permission are separate choices.

## Entry condition

The minimized P1 envelope and the device local execution policy.

## Output and next handoff

Bounded text and protocol/lease identifiers returned to P3; never delivery authority.

Next: [[ZAI:FR-150-P3]].

## Failure and acceptance

No arbitrary executable, URL, SQL or tenant selection from job data. Edge [PR #22](https://github.com/Freshair129/zuri-edge-device/pull/22) merged into master as `b089320` on 2026-09-06; hosted verify passed for head `f7e047a`. Stateless Codex is temporarily rejected with `LOCAL_POLICY_UNAVAILABLE` before execution, without provider fallback. Installed-device and production activation require separate evidence.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/contracts/line-conversation-execution.schema.json)
- [Server verification anchor](../../../../apps/server/tests/integration/server-line-jobs.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## Desktop remediation proposal — 2026-09-08

The owner requested correction of the Desktop documentation/runtime gap. The
[Desktop guide, revision 1.1.0b](../../../../apps/edge/docs/EDGE-DESKTOP-TAURI-RUNTIME.md)
defines two ordered slices: correct pairing/status behavior, then supervise and
package the existing optional worker. The [RCA](../../../../.brain/rca/2026-09-08-edge-desktop-runtime-contract-gap.md)
records source evidence, including the Console apiBaseUrl export ignored by the
Desktop parser. The owner subsequently approved completing provider browser login,
Ollama setup and managed worker/package in parallel using Luna max on 2026-09-08.
The [Desktop contract, revision 1.3.0b](../../../../apps/edge/docs/EDGE-DESKTOP-TAURI-RUNTIME.md#10-approved-provider-setup-and-managed-execution--2026-09-08)
records this implementation scope. Existing executor evidence above remains a
historical baseline; a blocked Codex path requires isolation proof before reopening.

Reuse the TypeScript executor under Tauri supervision rather than duplicating
lease, privacy and answer policy in Rust. A label-only repair leaves the Desktop
unable to control the runtime. Keep the worker as the sole periodic heartbeat
sender so a healthy GUI cannot conceal degraded execution. Saved identity, server
verification, worker state and execution capability must remain separate.

Agent owns execution behavior, Identity owns device/Business authority, Integration
owns the pairing Console and Server owns migrated-account LINE transport. This
refinement does not change the subject of FR-150 or enable legacy ingress.
Current stateless Codex containment remains enforced.

Acceptance requires the real Console export shape through the production Rust
parser, negative IPC/auth/persistence tests, owned process lifecycle, a single
heartbeat sender, existing executor regression tests and a Windows package that
runs without a developer checkout. Code, documentation and release claims must
agree. Risk HIGH, complexity C-3; isolated, package and production evidence remain
separate. No live activation follows automatically from a package build.

Documentation coverage limit: the root graph discovers this existing phase note.
The Edge scanner is based on the imported manifest, so the newer standalone
Desktop guide is not itself indexed at this baseline. Governance PASS does not
prove every link or capability in that guide. Check its source links directly;
extending scanner discovery is separate tooling work, not permission to modify
historical import provenance.

The [Desktop 0.3.0 local evidence](../../../../apps/edge/docs/EDGE-DESKTOP-TAURI-RUNTIME.md#11-local-implementation-evidence--desktop-030)
records implementation, executor regression, native/frontend tests and actual
packaged worker lifecycle. Live account login, installed GUI and production gates
remain distinct from that synthetic acceptance.

## Desktop navigation — approved implementation scope

The [Desktop interface inventory and wireframes](INVENTORY-FR-150-edge-desktop-ui.md)
propose four tabs, one visible panel, paginated long content and no scrolling.
The owner approved the combined inventory before implementation. It preserves
this phase's pairing, provider and worker contracts; the runtime evidence above
does not alone cover the newer navigation or hardware collector.

Inventory 0.2.0b additionally defines local computer-name/hardware diagnostics
at startup, with bounded partial results. This needs one local read-only command;
device identity, heartbeat payload and executor readiness contracts stay unchanged.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.6b | 2026-09-08 | beta | Owner approved combined UI/inventory implementation without changing execution authority | uncommitted | RWANG |
| 0.1.5b | 2026-09-08 | beta | Linked candidate automatic local computer inventory without changing execution authority | uncommitted | RWANG |
| 0.1.4b | 2026-09-08 | beta | Linked candidate tabbed Desktop inventory; implementation remains pending approval | uncommitted | RWANG |
| 0.1.3b | 2026-09-08 | beta | Owner approved separate provider setup and managed Desktop worker; implementation and portable verification extend the existing phase | uncommitted | RWANG |
| 0.1.2b | 2026-09-08 | candidate | Linked Desktop remediation, ownership, acceptance and documentation coverage limits | base b17e7258; uncommitted | RWANG |
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
