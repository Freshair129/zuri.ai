---
version: "1.0.0b"
status: candidate
created_at: "2026-09-11T00:55:00+07:00,RWANG,799f0ae9"
last_update: "2026-09-11T00:55:00+07:00,RWANG"
---

# Proposed amendment — opt-in MSP composition for the server LINE worker

This is an owner-review amendment to the existing LINE/MSP thread-memory plan. It is a design
proposal only; it does not authorize code, schema, production activation, provider credentials or
LINE sends. The delivered memory lane covers the direct `/api/agent/line-webhook` ->
`handleAgentTurn` seam. This amendment closes the separately observed server-worker composition gap
without replacing the server worker's queue, CRM or transport contracts.

## Evidence and boundary

`/api/line-oa/worker` calls `runLineConversationWorker({ ...serverLinePorts(), answer:
createServerLineAnswer() })`. `createServerLineAnswer` uses the deterministic model for
`LOCAL_ONLY` and resolves a configured model for `EXTERNAL_MODEL_ALLOWED`; both branches call
`answerBusinessQuestion` without `threadMemory`, `threadRoute` or an MSP context packet. The current
ADR-061 answer contract says public scoped knowledge, no memory, no tools and no second CRM ingest,
and `PHASE-04-MSP-EPISODIC-MEMORY.md` is still `candidate` in the current main checkout.

The amendment therefore targets the smallest new composition seam: an opt-in answer adapter owned
by `server-line-answer.js`, invoked by the existing worker after it claims a persisted job. It does
not call `handleAgentTurn`, because that would ingest a second CRM message, resolve a second LINE
identity or expose the webhook action pipeline inside a queue worker.

## Proposed opt-in contract

The memory path is active only when all of these are true:

1. `ZURI_MSP_THREAD_MEMORY_ENABLED=true` is set in the server worker environment.
2. The matched Zuri/MSP service key and MSP transport are configured and pass the existing minimum
   length/fail-closed checks.
3. The claimed job is a server-owned job whose account, tenant, business, channel-account and
   persisted inbound Message all agree. The worker supplies these values; job text, thread labels,
   model output and request payload fields cannot widen them.
4. The local erasure/policy gates allow the operation. `PDPA_ERASURE` jobs, missing/redacted
   messages and revoked private-memory authorization do not retrieve or write private memory.

When the flag is absent, `createServerLineAnswer` remains byte-for-byte on the current
public-knowledge/no-memory path. Missing opt-in prerequisites fail the worker job closed with a
stable unavailable outcome; they never silently fall back to a private or unscoped memory source.

## Bounded worker flow

For an eligible claimed job, the adapter receives the existing internal identifiers:

1. Resolve the MSP thread from the trusted `channelAccountId`, `externalThreadRef` (the persisted
   Conversation external thread), tenant, business and `DIRECT`/`GROUP`/`ROOM` audience. No raw LINE
   id becomes a Person or an MSP authority key.
2. Append the already-admitted CRM inbound Message to MSP with its existing `Message.id` as the
   stable message/source id. This is an idempotent transcript projection and never calls
   `ingestLineMessage` or creates another CRM Conversation/Customer.
3. Re-read current Zuri authorization and retrieve the bounded API-010 context only when policy
   allows it. Group/room private recall remains denied by the existing audience fence; no tools or
   actions are added to the server answer path.
4. Submit the exact bounded packet to the selected model through the existing grounded-answer
   verifier and injection receipt wrapper. Record `RESOLVED`, invoke the model, then record
   `SUBMITTED` and `COMPLETED`/`FAILED`; if evidence persistence becomes uncertain, surface
   `UNKNOWN` and do not produce a retryable effect.
5. On a successful answer, leave `runLineConversationWorker` responsible for settling the job and
   later sending it. The memory adapter may append the generated AGENT message as `QUEUED` with the
   MSP exchange id and `replyToMessageId`; it never calls LINE, changes `LineConversationJob.status`
   or marks provider acceptance.

## Durable primary-server delivery reconciliation

The primary server path does not call `/api/agent/line-delivery`. `reconcileAccepted` in
`line-conversation-jobs.js` appends the scoped CRM OUTBOUND Message and changes the job to
`RECORDED` in one local transaction. Calling `threadMemory.recordDelivery` only after that
transaction would lose the MSP receipt if the process stopped between the commit and the call.

The minimal durable mechanism is an append-only local execution-trace checkpoint with no schema
migration:

1. When the opt-in flag is active for the job, the same `reconcileAccepted` transaction that creates
   the CRM outbound row and marks the job `RECORDED` appends `MEMORY_DELIVERY_PENDING`. Its payload
   contains only the local job id, inbound/outbound Message ids, stable receipt id (the outbound
   Message id), channel-account id, external thread reference and provider acceptance state. It
   contains no message body, token, credential or private prompt.
2. After commit, a bounded worker reconciliation routine reads `RECORDED` jobs with a pending
   checkpoint and fetches the OUTBOUND row by the deterministic `reply:<inboundMessageId>` key,
   joined through the same tenant/business/channel scope. It uses the persisted CRM body and
   Conversation external thread, never `LineConversationJob.answerText` or caller-supplied text.
3. The routine calls `threadMemory.recordDelivery` with the stable outbound Message id as
   `receiptId`, the persisted inbound Message id as `inboundMessageId`, the persisted body, route
   scope and provider reference. `ACCEPTED` is the only normal primary-server outcome because the
   CRM row is created from the provider acceptance transaction; it does not become DELIVERED or
   READ. MSP's idempotent receipt key makes a retry after a response-loss safe.
4. A successful MSP response, including a durable `PENDING_INBOUND` response when MSP has not yet
   observed the inbound, appends an idempotent `MEMORY_DELIVERY_ACKNOWLEDGED` checkpoint containing
   receipt id and outcome only. A transport timeout, rejected/ambiguous result or checkpoint write
   failure leaves the pending checkpoint and reports `UNKNOWN`; the next bounded worker tick
   retries the same receipt. No retry calls LINE or creates another CRM Message.
5. The scanner is bounded and isolated from the answer/send batch. One unknown MSP receipt cannot
   block unrelated LINE jobs, while monitoring exposes pending/unknown counts. A successfully
   acknowledged checkpoint is never sent again; replaying the scanner is harmless.

This checkpoint is the recovery source. A process crash after CRM commit but before MSP call leaves
`RECORDED + MEMORY_DELIVERY_PENDING`, so the next worker tick can recover it. A crash after MSP
acceptance but before the acknowledgement checkpoint repeats the same idempotent receipt and then
closes the checkpoint. A crash before the local CRM transaction commits leaves `ACCEPTED`, so the
existing `reconcileAccepted` retry remains the source and no MSP receipt is attempted.

## Policy and erasure rules

- The worker never treats a memory packet or delivery receipt as authorization. Zuri's live
  AuthContext, tenant/business scope and audience fence precede private retrieval; MSP receives a
  signed operation grant and rechecks its stored route scope.
- A revoked or pending identity cannot retrieve private context or write protected memory. A
  provider acceptance already recorded by the server remains an acceptance fact, but it is not
  proof that a recipient read the message and does not widen future memory access.
- Before every pending-receipt call, the local row is re-read. If the job is `PDPA_ERASURE`, its
  outbound row is missing or carries the CRM erasure tombstone, the routine appends a redacted/closed
  checkpoint with ids only and does not call MSP. It never uses the erased `answerText` or reconstructs
  a body from the inbound question, model output, logs or audit records.
- This amendment does not claim that Zuri can erase content already accepted by MSP. The MSP
  retention/erasure API and the cross-repository erasure receipt remain a release gate before this
  opt-in is enabled for production data. Local erasure must invalidate pending checkpoints and the
  paired MSP erasure operation must be tested for already-synced receipts.

## Required proof before implementation is accepted

The implementation must add tests for:

- opt-in off preserving the current worker answer contract and no MSP calls;
- missing service key/transport failing closed at composition;
- trusted job/account/conversation scope and direct/group/room audience fences;
- idempotent already-admitted inbound projection with no second CRM row;
- bounded context and receipt ordering, including model invocation before `SUBMITTED`;
- primary `ACCEPTED -> RECORDED` reconciliation with pending checkpoint in one transaction;
- process-crash recovery before MSP call and after MSP acceptance;
- retrying the same receipt without another LINE send or outbound CRM row;
- MSP `UNKNOWN`, `PENDING_INBOUND`, scope rejection and checkpoint-write failure;
- policy revoke between context and outbound append;
- `PDPA_ERASURE` before scan, during retry setup and after an already-synced receipt, with no
  re-created text;
- generated trace playback showing pending/acknowledged/unknown memory delivery state while
  provider acceptance remains separate.

The amendment is complete only after the relevant Zuri/MSP contract suites, build and governance
pass, the MSP erasure dependency is explicit, and the report separates local implementation from
configured, deployed, provider-accepted, recipient-delivered/read and erased states.

## Approval boundary

This amendment requests review of the server-worker composition and durable checkpoint only. The
full onboarding/provisioning flow, policy inspector UI, production session/compaction worker host,
retention deployment, group private-memory disclosure, automatic protected-memory extraction,
browser/native acceptance and production activation remain separate phase work.
