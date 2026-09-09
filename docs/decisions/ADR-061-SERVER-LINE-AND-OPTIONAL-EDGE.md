---
id: ZAI:ADR-061
version: "0.1.3b"
status: active
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-10T00:00:00+07:00,Claude Opus 5"
relations:
  - type: relates_to
    target: ZAI:ADR-041
  - type: relates_to
    target: ZAI:ADR-059
  - type: relates_to
    target: ZAI:ADR-060
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:FR-148-NOTE
  - type: relates_to
    target: ZAI:FR-149-NOTE
  - type: relates_to
    target: ZAI:FR-150-NOTE
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
---

# ADR-061 — Server-owned LINE and optional Edge execution

**Status:** Accepted by owner instruction, 2026-09-06; implementation and activation evidence are separate.

## Context and authorization

The owner requested an ADR and implementation across zuri.ai and zuri-edge-device after reviewing the LINE flow. LINE availability must not depend on a customer workstation. Local models, coding-agent processes and LAN data access justify an optional executor, not ownership of the customer messaging channel. Running an agent locally does not make its external model calls local or keep their inputs on premise.

This decision amends ADR-041's mandatory ingress/credential placement, ADR-059's use of device existence to choose LINE transport, and ADR-060 D5 for conversation transport. BR-011 and FR-050 remain valid descriptions of the explicitly retained legacy forwarding path; their IDs are not repurposed. The new behavior is FR-148..150, FEAT-019. MSP and GKS authority is unchanged; this is not permission to write their stores or execute code supplied in jobs.

## Decisions

1. **Server is the LINE owner.** The Integration lane verifies raw LINE signatures and calls LINE. The Studio owns account routing configuration and durable `LineConversationJob` state. CRM owns conversations and messages. The Agent lane supplies a server answer adapter. The app and its worker can run on one server; no microservice split is required.
2. **Transport and execution are independent.** New accounts default to CLOUD transport and SERVER execution regardless of paired devices. An explicitly selected EDGE execution mode uses a paired Business device for computation only. A device receives minimized question, internal conversation identity and lease, never LINE credentials, reply tokens or recipients. Provider access from a local agent remains subject to its local policy; no automatic SERVER fallback for EDGE work.
3. **Explicit activation and migration.** Existing accounts are not activated by migration. `serverEnabled` defaults false. Server activation requires a paused/quiescent legacy transport, CLOUD mode, server-held credentials and an owner/publisher versioned action. Old forwarding and delivery endpoints refuse an account whose server owner is enabled. Edge compute-only is the new daemon default; old direct LINE processing requires an explicit LEGACY_EDGE mode. Disabling old processes and changing the LINE webhook in the provider console are deployment operations, not performed by merging this code.
4. **Durable admission.** `POST /api/line-oa/accounts/{id}/webhook` verifies signature before parsing, including empty verification requests. Account ID is a locator, not authorization. Destination must match the server-owned connection. The acknowledgement boundary is durable capture, not admission (amended 2026-09-10 by PR #306): every event is written as raw Integration evidence first, HTTP 200 is returned once the whole batch is captured, and an event that could not be captured makes the response non-2xx so LINE redelivers it. Text events still create account-scoped CRM inbound and a uniquely keyed job in one transaction, but that transaction runs after the response, in the same long-lived container process (ADR-058), retried at +4 s and +12 s, with its outcome labelled back onto the evidence row as ADMITTED, SKIPPED or FAILED. Known gap: a process exit between the acknowledgement and a successful admission leaves the evidence row at RECEIVED with no job and no automatic recovery — redelivery does not rescue it, because LINE has already been told the event was accepted. Non-text events are preserved as sanitized Integration evidence and acknowledged without invented support. Group text requires an explicit bot mention before creating a response job. Transient LINE reply tokens never enter raw evidence or logs.
5. **Account-aware history.** Conversation uniqueness becomes Tenant + channel + channelAccountId + externalThreadId. Old conversations stay in LEGACY:LINE. No migration guesses which OA owned an old transcript, and no code joins histories merely because a user/thread id matches. Account namespace is the existing binding code where available, otherwise the stable account UUID.
6. **Worker and delivery recovery.** A server worker claims durable work using compare-and-set versions and bounded leases. SERVER work calls the established scoped business-answer contract; EDGE work waits for an authenticated device. The final answer is persisted before sending. Prefer Reply API for a still-valid sealed reply token; after a send with an ambiguous outcome never switch to Push, because that can double-send. A Reply the provider *definitively* rejected is the one case that does switch, and it is an application of that rule rather than an exception to it: `LINE_HTTP_400` from the Reply endpoint is a confirmed non-delivery of a dead reply token, so falling back to Push cannot double-send anything (amended 2026-09-10). When a Reply fails that way and the account permits delayed Push, the job returns to READY with `sendMethod` switched to PUSH and the already-persisted answer is pushed without recomputing it. Every other Reply failure is unchanged: ambiguous outcomes — 5xx, timeout, a lost response — stay UNKNOWN and never switch, and the credential/configuration rejections that share the same `PERMANENT_FAILURE` transport mapping (401, 403, 404) stay terminally FAILED, because Push would fail on them the same way under a different name. Delayed work may use Push only when the account explicitly permits it. Push has an immutable recipient/body/retry UUID from its first attempt, exponential backoff and a retry deadline below LINE's 24-hour key lifetime. A 409 is acceptance only with the provider's accepted-request identifier. Acceptance is not delivery/read.
7. **No false outbound rows.** Accepted output and CRM outbound are reconciled transactionally. Persisted ACCEPTED jobs can repair CRM recording without calling LINE again. A lost Reply response is UNKNOWN and visible; it is never called failed-and-safe-to-resend. Stale leases cannot complete or replace an answer. Account pause/ownership change fences waiting work and prevents new sends; an in-flight external request cannot be recalled, and cutover must wait for it to settle.
8. **Secret and policy boundaries.** LINE material is a scoped Integration secret-manager reference, not a Studio field. A deployment-managed read-only secret mount is authorized for generic Docker/Postgres deployments through a distinct production SecretManagerPort adapter; each entry binds secretRef, Tenant, Business and account/connection, with expiry. This amends the Phase 1 Supabase-only restriction for channel transport only, not model credentials. Raw channel keys never become API response fields or Prisma values. A server worker credential is unrelated to device credentials. Edge routes require active `edgk_` Business credentials on every call; version, claimant and lease must match. No arbitrary URL, SQL, executable or recipient is accepted in a compute job. Replies are bounded text; model output never selects scope or delivery policy.

## Consequences and deployment

LINE and CRM remain available without Edge. Jobs requiring an offline device remain visibly waiting or expire; they do not silently use a different model. Push can consume the account's message allowance, so delayed Push is opt-in and no automatic upgrade is hidden in this change. The server now needs channel credentials and a running durable worker. Reply delivery cannot be made exactly-once across a network timeout; UNKNOWN is an intentional terminal state requiring operator reconciliation.

Implementation uses the existing Next.js app, Prisma provider schemas and Docker deployment. The worker is a separate process from the same release and calls an authenticated internal worker route; it does not keep work in RAM after acknowledgment. The Edge daemon is independently deployable and must upgrade before transport cutover. Asset extraction remains supported through its existing pull contract.

Snapshot recovery preserves the LINE job ledger after its account and inbound Message parents, while excluding sealed reply tokens from export and discarding any token supplied on import. Every restored account has server ownership disabled and its epoch advanced; activation requires fresh credential validation and an explicit handoff. Waiting or prepared jobs become CANCELLED with `RESTORED_REQUIRES_REVIEW`; an exported SENDING job becomes UNKNOWN because a provider send may have succeeded after the snapshot was taken. Existing UNKNOWN remains uncertain and blocks activation until acknowledged. ACCEPTED jobs retain provider evidence for CRM-only repair, without another LINE call. Snapshot restoration never resumes external delivery automatically.

## Required proof

- Signed native webhook, invalid signature, destination mismatch and account isolation.
- Admission survives replay and commits CRM plus queue atomically.
- Two OAs with the same LINE subject/thread remain separate.
- Server mode works with no Edge or local credentials.
- Edge completion is scoped, leased, versioned and contains no delivery authority.
- Worker restart, duplicate completion, account pause, revoked device, expired lease and offline device.
- Provider acceptance, permanent failure, timeout ambiguity and receipt-only recovery.
- Legacy and server ownership cannot answer the same newly admitted event during the documented cutover.

## External contracts

- [LINE webhook processing](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE retry keys and acceptance semantics](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [Execution wire contract](../../apps/server/contracts/line-conversation-execution.schema.json)

Production migration, credential provisioning, webhook replacement and real provider/device canary are separate evidence gates. This decision authorizes implementation; it does not claim those operations have happened.

Policy changes fence completion and sending; a prompt already dispatched to an executor/provider cannot be recalled. Cancelled in-flight computation may finish locally but its stale result cannot be sent. An ambiguous Push awaiting retry also blocks ownership handoff. Credential failure isolates one job (UNKNOWN if a prior attempt exists), so one account cannot starve other accounts.

The incremental PostgreSQL scripts in `supabase/migrations` target Supabase's existing `public` application schema and roles. The application connection must own the job table or have an explicitly provisioned server policy; browser roles have no access. A generic PostgreSQL deployment needs equivalent migration-owner grants and roles reviewed before applying these scripts.

## Implementation validation and rollout boundary

Both repositories implement the conversation contract. The native webhook currently admits text conversations; binary attachment intake is not migrated into this webhook. Existing asset extraction remains a separate device pull contract. Server grounded answers still use the existing dedicated business-knowledge reader and its deployment scope; this change does not widen the SmartGift read policy.

Validated locally: provider/secret policy tests, real SQLite admission/replay/scope/lease/send/erasure/backup tests, Next production build, and the LINE OA browser journey. Full verification is not certified: the Linux/Node 24 run encountered Windows filesystem cases and intermittent SQLite corruption; affected database suites passed independently. The broad browser run exposed fixture leakage from the new account test into the connector inventory test; cleanup now removes only that test's account and connection.

Before activation: apply the two incremental migrations in order; provision the mounted credential entry with exact tenant/business/account/connection/destination and expiry; set `ZURI_LINE_REPLY_SEAL_KEY` (64 hex characters), `ZURI_LINE_WORKER_TOKEN` (at least 32 random characters), and the mounted file location. Use `docker-compose.line-server.yml` with the `line-server` profile. Configure scoped business knowledge before enabling SERVER computation. Upgrade the optional Edge release, stop the old LINE receiver/sender, confirm handoff in `/line-oa`, then change the provider webhook. Verify a real account/device canary before general rollout. Do not roll back to the old sender while SENDING, UNKNOWN or an unconfirmed Push remains unresolved.

## Evidence refresh — 2026-09-06

Server main through PR #243 passed hosted verify and E2E on Windows; the earlier Linux validation paragraph above records the original implementation run, not the current server CI result. Edge [PR #22](https://github.com/Freshair129/zuri-edge-device/pull/22) merged into master as `b089320` on 2026-09-06; hosted verify passed for head `f7e047a`. Stateless Codex is temporarily rejected with `LOCAL_POLICY_UNAVAILABLE` before execution, without provider fallback. Installed-device and production activation require separate evidence. Production and real provider/device gates remain pending unless their own receipts prove otherwise. See [[ZAI:PLAN-FEAT-019-PHASES]].
