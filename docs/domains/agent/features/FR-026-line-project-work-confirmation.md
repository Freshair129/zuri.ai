---
domain: agent
feature: FR-026
module: agent
source: v2-native
version: "0.1.1b"
status: beta
---

# LINE Project / Work confirmation tools

Approved by the owner through [the Local LLM/CIN execution plan](../../../plans/LINE-OA-LOCAL-LLM-CIN-EXECUTION.md), P4. This slice reuses FR-026's action gate, FR-072's canonical Project Manager ownership authority, and FR-150's Server-owned LINE / Edge compute boundary.

## Decision and scope

`search_project_work` returns up to ten Projects or Work items in the OA's Business, including status and stable internal IDs; the result discloses truncation. A live, verified account-scoped ChannelIdentity and current Project domain visibility are required. This first delivery allows direct conversations only because a group audience is not evidence that all readers can access private Project data.

`propose_work_change` previews creation of a TASK in an existing Workstream, or title/status changes to an existing Work item. The model receives the exact proposed fields, target, target version, argument hash, expiration and confirmation command. It does not receive raw LINE identifiers, actor authority or credential material. Creation of whole Projects, deletion, bulk plan import and payment/order writes are outside this tool's scope.

The user must send a new signed inbound message containing exactly `ยืนยันงาน <proposalId>`. No confirmation tool is exposed to the model. A five-minute proposal binds actor, verified identity/version/link time, tenant, Business, OA, channel-account namespace, transport epoch, conversation, target/parent versions, arguments hash and the original inbound idempotency key. Changing any bound value requires a new preview. The same user's new confirmation in another conversation is refused.

Proposal and execution receipts are append-only AuditEvents. Their unique IDs fence retries across process restarts: one proposal per inbound job, one confirmation claim and one execution result per proposal. Claiming the receipt, running the canonical Work service, its audit and writing the result share one serializable transaction. A canonical writer failure rolls the claim back. A repeated committed confirmation returns the original result without another Work write. These records contain business task fields and are not operational console log payloads.

`createItem` and `updateItem` accept an optional transaction client and expected version; existing HTTP callers keep their current defaults. The Agent does not implement a second Work writer. Permission is refreshed when confirming, and the existing Gate F authorization predicate plus the canonical Project/Work writer both enforce owner authority.

Before the transaction commits, confirmation re-resolves identity, Business ownership and the live execution claim after the awaited canonical writer and audit work. A changed binding, reclaimed execution, expired lease, expired Membership or expired proposal rolls back both the Work mutation and its receipts. This is transaction-local serializable authorization, not a claim about external Postgres concurrency validation.

Operational status/list questions and operational status assertions require current `search_project_work` evidence even when the model skips the tool. Missing or failed reads return a fixed unavailable response; neither prior conversation nor a caller fallback can supply a current status. Successful reads render the current records with their observation time. Generic product and printing lead-time clarification remain on their existing path. Natural-language detection is a bounded Thai/English guard, not a complete intent classifier.

## Connected surfaces

The deterministic adapter supports `/projects <query>`, `/work <query>`, `/work-create <workstreamId> <title>`, `/work-update <itemId> {"status":"DONE"}` and the human confirmation command. Integration owns routing these through the existing claimed-job delivery path for both compute modes.

The local model's tool adapter calls `POST /api/edge/conversation-jobs/[id]/tools` with `{version, executionId, toolName, args}`. Each request authenticates a current Edge credential and checks the active claim, exact execution identity/version, tenant/Business, lease, job expiration and Reply send reserve. Authority is resolved inside each invocation. Unknown tools, caller scope fields, execution tools and oversized inputs/results are refused. The route uses the existing LINE runtime feature flag. It never sends a LINE message directly.

## Verification and limits

`tests/integration/line-project-work-tools.test.js` uses a fresh SQLite database and real identity, Membership, OA, Conversation, Project/Work and AuditEvent records. It exercises read isolation, no write before confirmation, same-inbound proposal retry, duplicate confirmation, expiry, stale target, revoked Membership, pending identity, group denial, identity epoch mismatch, transactional rollback, Edge scope/version/lease fencing and command formatting. The existing FR-072 Work authorization suite is also run.

Local proof does not establish hosted Postgres concurrency, live LINE delivery, target Edge/model latency, or production readiness. The integrator's command/model wiring and full governance/build evidence remain part of the encompassing plan.

On 2026-09-17 the scoped Server run passed 25 tests (16 LINE Project/Work and 9 canonical FR-072 authorization), including five tests advancing expiry or changing authorization/claim during an awaited canonical write and checking complete rollback. The scoped Edge run passed 60 tests (11 Project/Work plus model-port and answer suites), including skipped-read/stale-history rejection, provider failure with a stale fallback, verified current records overriding old memory, and unaffected product clarification. These are isolated SQLite and scripted-provider results.

## Version diff

No feature note -> v0.1.0b: documented approved confirmation protocol, canonical writer reuse, bounded remote tool transport and local evidence boundaries.

v0.1.0b -> v0.1.1b: documented current-fact enforcement and transaction-end authorization refresh, with targeted regression evidence.
