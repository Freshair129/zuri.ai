---
version: "0.1.0b"
created_at: "2026-09-06T11:51:02+07:00,RWANG,uncommitted"
last_update: "2026-09-06T11:51:02+07:00,RWANG"
status: "candidate"
superseded_by: null
attributes:
  domain: "edge"
  scope: "Zuri server and Edge monorepo documentation and migration design"
---

# Edge runtime documentation — device integration retired

> **Retirement status:** Edge-device pairing, `edgk_` credentials, cloud heartbeat,
> device-side evidence extraction, and Edge-owned LINE ingress/delivery are retired.
> Do not follow the old device enrollment or transport procedures in this README.
> The local worker, Core conversation capability, and local Knowledge/RAG runtime remain
> separate concerns. A Localworker API key is governed by the Private Runtime Platform
> (PRP); an old Edge-device key or device identity is not a substitute.

## Historical monorepo migration note

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

The following paragraph records the former migration target; it is historical, not a current
execution contract. Edge-device job claims, Business-scoped device leases, and device protocol
compatibility are not active integration surfaces.

Migration first preserved existing behavior while source moved. The later Edge-device retirement
supersedes that plan. Historical references below are retained as evidence; they do not authorize
device configuration, cloud enrollment, LINE transport, or data migration.


Standalone local runtime for the Zuri Command Agent. It is a consumer of Zuri's governed command
API, not a replacement for the Zuri control plane.

## Retained local worker, Core conversation, and Knowledge/RAG

The local worker and Core conversation capability are retained independently of Edge-device
enrollment. Use the current Localworker API key contract from the Private Runtime Platform (PRP)
when that integration is in scope. This repository's retired pairing flow, device id, and
`edgk_` credential do not configure or authorize the Localworker API.

The local Knowledge/RAG components are also retained. Their service boundaries and runbooks remain
separate from device enrollment and LINE transport; see the
[GenesisRAG pipeline runbook](docs/GENESIS-RAG-V4-PIPELINE-RUNBOOK.md). This README does not claim
that the retired Edge webhook sends LINE messages or that a cloud heartbeat is active.

## Ownership

- **Zuri owns:** tenant/RBAC, command state, policy snapshot, audit, LINE OA credentials, Flex
  validation, delivery outbox, and the canonical API contract.
- **Zuri Command Agent owns:** registered local bridge lifecycle, approved operator adapters,
  read-only DuckDB query execution, evidence shaping, and local diagnostics.
- **GoVibe governs:** mission/CR lifecycle, approval, policy/template/query promotion, budget,
  and evidence links. It is not the message hot path or durable command state store.

Read `AGENTS.md`, `docs/COMMAND-AGENT-SPEC.md`, and `docs/AGENT-RUNTIME-SPEC.md` before
implementation. The canonical integration contract is
`G:\zuri\docs\contracts\zuri-command-agent-api-v1.md`; this repository must not fork or alter
that contract unilaterally.

For the temporary, deliberately bounded local Flex demonstration, read
[`docs/POC-LINE-DELIVERY.md`](docs/POC-LINE-DELIVERY.md). It is not the production delivery
architecture and it reports LINE acceptance rather than a fabricated delivery receipt.

## Retired Edge-device surfaces

The old device-side extraction flow and its setup are retained only in the
[historical extraction record](docs/EDGE-EXTRACTION-RUNTIME.md). Its cloud credentials,
claim/complete/fail calls, and `extraction` CLI commands are retired and must not be used.
The record is not a current operator runbook.

Version diff unversioned → 0.1.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
