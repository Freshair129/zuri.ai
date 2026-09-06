# Appendix F — Glossary

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Author** | Boss |
| **Created** | 2026-08-10 |
| **Last Updated** | 2026-08-10 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-10 | Boss | Initial creation via RWANG doc-architect |

| Term | Definition |
|---|---|
| **Zuri** | The governed control plane and business-operations companion (ซูริ). Owns tenant/RBAC, command state, policy snapshots, audit, LINE OA credentials, Flex validation, and the delivery outbox. This repository is a consumer of Zuri's API, not a replacement for it. |
| **Zuri Command Agent** | This repository: a standalone local runtime that registers as a bridge, runs approved read-only DuckDB queries, and submits evidence to Zuri. |
| **GoVibe** | Governs mission/CR lifecycle, approval, and policy/template/query promotion and budget. Not the message hot path or a durable state store. |
| **Operator adapter** | Codex, Claude Code, or Antigravity acting as a client of the Zuri Command Agent CLI — never an unattended public responder. |
| **Command envelope** | The versioned request shape (`CommandEnvelope`) an adapter sends: contract version, source, tenant/group refs, command, arguments, delivery intent, idempotency key. |
| **Command lifecycle** | `ADMITTED → QUEUED → CLAIMED → EVIDENCE_READY → REVIEW_REQUIRED \| DELIVERY_PENDING → DELIVERED \| FAILED \| CANCELLED \| EXPIRED`. |
| **Policy snapshot** | An immutable, versioned policy state (capability, group binding, retention boundary, kill-switch) that every result must be traceable to. A local runtime cannot promote it. |
| **Lease** | A time-bounded claim on a command job (`leaseId`, `expiresAt`, `queryId`, `queryVersion`) — a bridge may progress only the state assigned by its current lease. |
| **Evidence packet** | The typed, minimized aggregate result (`EvidencePacket`) submitted to Zuri: source, `as_of`, sensitivity, query version, row data, and the derived `CardViewModel`. |
| **CardViewModel** | The typed Flex-card view model built from evidence — never raw Flex JSON delivered directly. |
| **Query registry** | The fixed set of approved, versioned, read-only DuckDB queries (`src/queries/registry.ts`), each with an id, parameter schema, column allow-list, row cap, and sensitivity class. |
| **Sensitivity class** | `PUBLIC \| INTERNAL \| CONFIDENTIAL \| RESTRICTED` — classifies a registered query's output. |
| **Operational state** | `live \| snapshot \| candidate \| unavailable` — the state a Zuri response is described in; never decorative wording. |
| **Delivery intent** | `preview \| line_reply \| line_push` — what an adapter is requesting; Zuri alone decides whether it is actually sent. |
| **Automatic delivery (`autoDeliveryAllowed`)** | A policy-snapshot flag that lets an approved group/template/capability combination send without a per-message human click. Set once by the owner, not per command. |
| **Bridge** | The long-running local worker (`zuri-agent worker`) that claims leased jobs, executes queries, and submits evidence. |
| **SmartGift** | The workstation/business system whose DuckDB database this agent reads from, read-only. |
| **Flex** | LINE's card message format; Zuri owns validation and the delivery outbox. |
| **LINE / LINE OA** | The messaging platform and Official Account this system ultimately delivers cards to. This agent never holds a LINE channel token — Zuri owns the LINE Messaging API call. |
| **Idempotency key** | A caller-supplied key that guarantees a command is admitted and responded to exactly once, even if the same request is retried. |
