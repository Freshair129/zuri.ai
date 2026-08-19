---
domain: integration
feature: FR-081
module: integration
source: v2-native
version: "0.1.0"
status: beta
---

# FR-081 — Raw external ingestion boundary

## Rationale

Before FR-081 the integration domain could describe *a connection* but had
nowhere to put what arrived through it. Every acquisition channel that landed
would otherwise grow its own persistence, its own idea of "have I seen this
already", and its own translation into business entities — which is how a
failed translation ends up destroying the only evidence of what the provider
actually sent.

This is the same convergence the intake surfaces already have (BR-009,
SDD-009): four surfaces, one envelope, one write path. Ingestion needs its own
because it sits *outside* that boundary — the payload has not been consented to
by a human and has not been validated against any business rule yet.

## Contract

1. **One envelope.** A channel produces `zIngestionEnvelope` — tenant,
   Business, connection, provider, lane, entity type, external id, source type,
   schema version, payload. The envelope is `.strict()`: an unknown field is
   rejected, never carried through (SEC-002).
2. **Identity, not a key.** `idempotencyKey = sha256(tenantId, connectionId,
   entityType, externalId, payloadHash)` over a canonically serialized payload.
   Re-delivering the same event returns `UNCHANGED`. The external id
   contributes to the identity and is never itself a primary key (BR-002); the
   internal mapping lives in `ExternalEntityRef`.
3. **Scope is proven at persistence, not filtered after it.** A repository is
   constructed bound to one tenant/connection scope and refuses any row outside
   it (SEC-001). A referenced Business or IngestionRun must itself resolve
   inside that scope.
4. **Raw stays raw.** Ingestion writes `RawExternalRecord` and nothing else. No
   Customer, Conversation, Message or LINE reply state — translation is a
   separate, later path, which is what makes the raw row replayable evidence.
5. **Failure is recorded, not swallowed.** A run carries its own counts and
   terminal state; a failure becomes a `DeadLetterRecord` naming the failing
   stage and the owner responsible for it.

## Not in scope

No scheduler, no pull adapters, no translation ACL, no reader surface and no
replay trigger. FR-081 declares the substrate those will need. The one adapter
shipped with it is the LINE OA webhook, which resolves its scope from the
server-owned connection under FR-052 and never from the webhook payload.

## Wiring status — converged onto the live LINE ingress (2026-08-19)

Until 2026-08-19 `src/platform/integrations/providers/line/line-oa-webhook.js` was
complete, tested and **reachable from tests only** — `grep -rn
createLineOaWebhookConnector src/` returned nothing. The repository therefore held
two disjoint ideas of "a LINE event": the route-local `zLineEvent` that drove the
agent turn, and `zIngestionEnvelope`, which no running system ever produced.

That is now converged. `POST /api/agent/line-webhook` resolves a `LINE_OA`
`IntegrationConnection` from the Tenant/Business the FR-052 binding already proved,
and records every event as a `RawExternalRecord` through
`src/platform/integrations/providers/line/line-oa-evidence.js` — which calls the
**same** `normalizeLineWebhookEvent` the connector uses. One channel, one
normalizer, one raw write path.

Design points worth keeping:

- **Evidence first, then the turn.** The raw record is written before
  `handleAgentTurn` and never inside its transaction, so a turn that fails on a bad
  model, missing knowledge or an answer-policy bug still leaves a replayable record
  of exactly what LINE sent. Proven by the "keeps the evidence when the turn fails
  afterwards" case.
- **Every event, not just the ones that reply.** `follow`, `unfollow`, `postback`
  and non-text messages are still skipped by the turn, but they are no longer
  discarded — each becomes a typed record (`LINE_IDENTITY`, `LINE_POSTBACK`,
  `LINE_MESSAGE`). Previously they left no trace at all.
- **Configuration, not a flag.** A channel with no *ACTIVE* `LINE_OA` connection
  records no evidence and behaves exactly as before; the recorder returns `null`.
  `ACTIVE` is part of the lookup rather than a check after it, so a row being
  prepared (`createIntegrationConnection` defaults to `DRAFT`) or deliberately
  disabled reads as "this channel is not ingesting" instead of taking a live channel
  down mid-provisioning — and that state is still visible, because every event in the
  response carries `evidence: null`. Once the connection is ACTIVE, evidence becomes
  required and an event whose record cannot be written is not processed. An ACTIVE
  connection for the destination under a *different* Business is a mapping error, not
  an absence, and fails the batch (`LINE_OA_CONNECTION_OUTSIDE_BUSINESS`).
- **The binding never reaches persistence.** The envelope payload is
  `{ destination, event }` with `replyToken` stripped; `bindingId` and the caller's
  bearer are not in it. Asserted, not assumed.

### Resolution and provisioning

The connection is found by `resolveLineOaConnection` on `(tenantId,
provider.code='LINE_OA', externalAccountId=<destination>)`. The schema's
`@@unique([tenantId, providerId, externalAccountId])` makes at most one such row
exist, so resolution is deterministic without an ambiguity tiebreak and a tenant
can run several Official Accounts.

Provisioning is still an operator step — there is no UI for it, because FR-080
fixes its form to `purpose=PHASE1_LINE_LLM`. Registering the provider and creating
the connection (`registerIntegrationProvider` + `createIntegrationConnection` with
`externalAccountId` set to the LINE destination and `status='ACTIVE'`) is the
outstanding work before evidence flows in a live environment.

### Still not closed by this

An `IngestionRun` is not opened per batch: a webhook stream is continuous and a run
per delivery would be noise, so `ingestionRunId` is left null and FR-081(d)'s run
counters remain unexercised on this channel. `DeadLetterRecord` is likewise still
unwritten — an evidence failure is reported in the response as
`{ ok: false, stage: 'EVIDENCE' }` and nothing durable records it. Both need the
scheduler/replay surface this requirement declares out of scope.

**Signature verification lives in `zuri-cli`, and it is real.** The connector's
`verifySignature` needs the raw request bytes and the `x-line-signature` header,
and the live route receives an already-normalized batch — so the authenticity
boundary sits in the transport, exactly as BR-011 assigns it. Convergence gives
ZURI the canonical envelope; it does not move that boundary.

Read on 2026-08-19 in `zuri-cli` (`codex/line-stack-fr050`) rather than assumed:

- `src/history/webhook-server.ts` buffers the raw body, reads `x-line-signature`
  and returns **401 before parsing or archiving anything**.
- `src/history/archive.ts :: verifyLineSignature` is HMAC-SHA256 over the raw
  bytes, base64, compared with a length check plus `crypto.timingSafeEqual`.
- `src/stack/stack-client.ts :: normalizedEvents` is an allowlist that never
  forwards `replyToken`, so the token stays with its single owner.
- `handleStackReplies` awaits this route, honours `skipReply`, falls back to its
  own message when a turn fails, caps the reply at 5,000 characters, and dedupes
  on `webhookEventId` both durably and in-flight.

So the two hops this repository cannot perform are performed, and the exit-gate
blocker is not "unimplemented" — it is that no test spans both runtimes. What
guards the seam from this side is
`tests/integration/line-webhook-transport-contract.test.js`, which pins the four
response fields `handleStackReplies` actually reads. Renaming one of them is
otherwise a silent failure: every customer receives the transport's "unavailable"
fallback while this repository's suite stays green.

**The correlation id now crosses the seam.** `zuri-cli` mints `cli-<uuid>` per
signature-verified batch and sends it as `x-correlation-id`; this side adopts it
(`correlationSource: CALLER`) and carries it to the audit row, so the LINE request
id, the transport's log and the ZURI turn are one chain.

**The round trip is proven end to end.**
`tests/integration/line-oa-cross-repo-round-trip.test.js` drives a genuinely
HMAC-signed LINE payload into `zuri-cli`'s real webhook server, through its real
`ZuriStackClient`, into this route and turn, and asserts on what the transport
would have handed the LINE Reply API. Exactly two things are substituted, both real
external boundaries: the LINE Messaging API (a spy on `replyText`) and the network
hop between the two services (the stack client's injectable `fetchFn`). Nothing in
ZURI's own chain is mocked — identity, customer, conversation, message and audit
are really written.

It is opt-in on `ZURI_CLI_DIST` and **skips by name** when that is absent, because
`zuri-cli` is not a dependency of this repository and CI has no copy of it. A green
CI run therefore never implies this ran. Run it with:

```
ZURI_CLI_DIST=<zuri-cli>/dist npx vitest run tests/integration/line-oa-cross-repo-round-trip.test.js
```

The harness and `line-webhook-transport-contract.test.js` cover different failures
and both are load-bearing. Renaming `skipReply` on this route was checked as a
mutation: the contract test failed, the round trip did **not** — `zuri-cli`'s own
durable dedupe suppresses a redelivery before it forwards, so that field never
reaches the wire in a round trip. The harness proves the wiring; the contract test
proves the fields.

## Relationship to the neighbouring requirements

FR-048 remains the provider-port and credential-mode contract; FR-079 the
runtime connection selection; FR-080 the management surface. FR-081 is the
storage boundary underneath all three and changes none of them. It adds
`IntegrationCredential.accessTokenExpiresAt` / `refreshTokenExpiresAt`
alongside the existing `expiresAt`: the token pair describes an OAuth grant held
by the provider, while `expiresAt` remains the secret-manager reference expiry
FR-079 fails closed on. They are separate because rotating an access token does
not invalidate the reference.
