# Appendix E — Risk Matrix (Permission Matrix + Credential Topology)

| Field | Value |
|-------|-------|
| **Version** | 1.2.0 |
| **Status** | Draft |
| **Author** | Boss |
| **Created** | 2026-08-10 |
| **Last Updated** | 2026-08-31 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-10 | Boss | Initial creation via RWANG doc-architect; reproduces `AGENTS.md` permission matrix and credential topology as a risk artifact |
| 1.1.0 | 2026-08-11 | Boss | Added open risk: `skills/zuri-line-flex-report` calls the LINE Messaging API directly, outside this repo's permission matrix |
| 1.2.0 | 2026-08-31 | Claude | Re-checked against the working tree after a system-design review: CI risk resolved, SEC-005 partially resolved (secret-file adapter), Flex-report skill risk given a recorded decision, and a new row for the permission-matrix gap the same review surfaced — resolved in `AGENTS.md` v0.5.0b |

Parent: [`../PRD-SDD-v1.0.md`](../PRD-SDD-v1.0.md) §2.5. Source of truth remains
[`../../AGENTS.md`](../../AGENTS.md) — update there first, then mirror here.

## E.1 Permission matrix

| Capability | Permission | Rule | Risk if violated |
|---|---|---|---|
| Claim a Zuri job | Allowed | Registered device, compatible contract/version, valid lease only | Cross-tenant job execution |
| Read SmartGift DuckDB | Allowed | Registered read-only query id and validated parameters only | Unbounded data exposure |
| Build evidence packet | Allowed | Aggregate/minimized data with source, `as_of`, sensitivity, query version | Untraceable or stale evidence presented as live |
| Build Flex view model / preview | Allowed | Approved template and CTA allow-list only; preview is never delivery | Unapproved content reaching a channel |
| Submit evidence to Zuri | Allowed | Current lease, matching tenant/policy/query/template versions only | Version-skewed evidence accepted |
| Request a LINE delivery | Allowed conditionally | Local governed outbox: lease-based claim, idempotency key, quarantine on a lost claim | Duplicate or lost send |
| Call LINE Messaging API directly | Allowed conditionally | `docs/LINE-REPLY-OWNERSHIP-DECISION.md`: reply ownership sits here (zuri-ai BR-011, which retired BR-003). Token only via `_FILE` from an OS-restricted file; direct push takes `U…` ids only | Compromise of this machine can send to customers as the OA — no longer bounded by the absence of a credential |
| Report what was sent to Zuri | **Required, not met** | FR-093 receipts exist and are wired on the stack path only, which is disabled; the outbox reports nothing | The outbound half of every conversation is absent from the cloud record |
| Connect directly to Zuri PostgreSQL | **Denied** | Use the canonical Zuri API only | Bypassing RBAC/audit |
| Execute arbitrary SQL, shell, or filesystem command | **Denied** | Query registry and declared local diagnostics only | Data exfiltration, injection |
| Create CRM, Calendar, payment, approval, or policy writes | **Denied** | Requires a separate approved Zuri action contract | Unauthorized state mutation |
| Change template/query/policy/model/provider/budget | **Denied** | GoVibe/Zuri approval and version promotion required | Unreviewed capability drift |
| Read secrets, access tokens, raw credentials, OTPs | **Denied** | Redact and report a safe error; never log or repeat | Credential leak |
| Call an external model provider to phrase a reply | Allowed conditionally | Off by default (`ZURI_LLM_ENABLED`); wording only, never a price/cost/margin decision; every figure ≥100 must trace to a tool result or the caller's own text or the reply is discarded | A model-invented figure reaching a customer as fact |
| Spawn a headless coding-agent process to phrase a reply | Allowed conditionally | Off by default (`ZURI_HEADLESS_ENABLED`); allow-listed environment (no LINE/Vercel/API token, no database path), no shell, `--strict-mcp-config`, one read-only pricing MCP door with role fixed in its own environment | A message-borne instruction reaching a shell or an unintended credential |
| Push a message to a person without an inbound reply token in hand | Allowed conditionally | Only when `ZURI_OUTBOX_ENABLED=true`; content-hash idempotent; one answer in flight per person; only for a recipient already accepted from a signed inbound event | An unprompted or duplicated push to a customer |
| Forward signature-verified message content to the Zuri V2 stack | Allowed conditionally | Only when `ZURI_STACK_REPLY_ENABLED=true`; destination from the verified LINE envelope only; binding UUID/bearer from server config; Tenant/Business scope never client-selected; reply token never forwarded | Cross-tenant scope selection or a forwarded credential |
| Report a stack-mediated reply back to the Zuri V2 stack | Allowed conditionally | Only after the send; same binding credential as the forward; best-effort, never blocks or retries a reply | A transport reporting a delivery under someone else's binding |

## E.2 Credential topology

| Secret or identifier | Store | Notes |
|---|---|---|
| LINE channel access token / channel secret | Zuri tenant integration store, encrypted at rest | Encryption key stays in the Zuri host secret store; never copied to this agent |
| Canonical LINE group binding | Zuri PostgreSQL | Derived from a signed webhook, mapped to tenant/OA/policy; not an `.env` value |
| Bridge device identity/token | Local OS credential store or Docker secret | Zuri keeps only a registered device reference/revocation state |
| DuckDB path and non-secret runtime settings | Local `.env` | Allowed for local development; no raw business rows in env |
| Provider API key | Zuri host secret store unless an approved local provider requires one | Never log, return, or commit it |

## E.3 CTA domain allow-list (`src/cards/types.ts`)

| Domain |
|---|
| `https://zuri.app` |
| `https://smartgift.co.th` |
| `https://app.smartgift.co.th` |

Any card CTA URI outside this list is rejected by `isCtaUriAllowed()` — treat an addition to this
list as a change requiring the same review as a permission-matrix change.

## E.4 Open risks

| Risk | Likelihood | Impact | Mitigation status |
|---|---|---|---|
| `SEC-005` gap: device credentials currently read from plaintext `.env` | Medium (dev-only today) | High if shipped to a shared/production host | **Partially resolved 2026-08-31** — `src/config/secret.ts` adds an optional `${NAME}_FILE` indirection (Docker-secret / ACL-protected-file convention) for `ZURI_AGENT_DEVICE_TOKEN`, `LINE_POC_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_HISTORY_HASH_KEY`, `ANTHROPIC_API_KEY`, and `ZURI_STACK_BINDING_BEARER`. Plaintext `.env` remains a valid input for local dev; this does not add an OS-credential-store (Windows Credential Manager) integration, which is the remaining gap if this ever runs unattended on a shared host |
| No CI/CD configured | High | Regressions ship unreviewed once `send` (S7) is live | **Resolved 2026-08-20** — `.github/workflows/ci.yml` runs the test-file-coverage guard, `tsc --noEmit`, the full test suite, and a build on every PR and push to `master` |
| `buildEvidencePacket` does not itself reject a missing/invalid `policySnapshotId` (BR-006) | Medium | A malformed job could produce evidence without a valid policy binding | Open — verify enforcement point during S6 |
| `skills/zuri-line-flex-report` (a Claude Skill in this repo, outside `src/`) reads a LINE channel token from a local secret store/env file and calls `https://api.line.me/v2/bot/message/push` directly | High — the capability exists and is documented as the skill's normal path, not a misuse | Direct customer-facing LINE send outside Zuri's policy/PII/idempotency validation and audit trail — the exact scenario the permission matrix (§E.1: "Call LINE Messaging API directly — **Denied**") exists to prevent | **Decision recorded 2026-08-31, functionally unchanged:** documented as an intentionally separate, ungoverned demonstration path rather than left unresolved — see `skills/zuri-line-flex-report/SKILL.md`'s Governance boundary note. It was not retired or gated behind the outbox in this pass; that would remove a capability nobody asked to have removed. Retiring it or gating it behind Zuri's outbox remains open for the owner to choose |
| Permission matrix (`AGENTS.md`) has no row for capabilities the conversational/stack generations now exercise: external model calls, spawning a headless coding agent, proactive push delivery, forwarding message content to a third-party stack, delivery-receipt reporting | Medium — each capability is individually documented in its own spec, but the matrix that is supposed to be the single governance surface does not list them | A reviewer checking only `AGENTS.md`'s permission matrix would not learn these paths exist | **Resolved 2026-08-31** — see `AGENTS.md` v0.5.0b §Permission matrix, rows added below the original nine |
