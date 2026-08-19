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

## Wiring status — the LINE OA adapter has no runtime caller (2026-08-19)

`src/platform/integrations/providers/line/line-oa-webhook.js` is complete and
tested, and it is the only place in this repository that verifies an
`x-line-signature` HMAC over the raw request bytes. It is also **reachable from
tests only**: `grep -rn createLineOaWebhookConnector src/` returns nothing. No
route handler, service or script constructs it, so no LINE event has ever
travelled through the canonical ingestion envelope in a running system.

This is not a defect in the adapter — it is the honest consequence of BR-011.
The live LINE path is the Phase 1 pilot seam: `zuri-cli` terminates the LINE
Messaging API, verifies the signature and owns the Reply API, then forwards an
already-normalized batch to `POST /api/agent/line-webhook` (FR-028), which
authenticates it with the FR-052 binding and drives `handleAgentTurn`. That
path writes `Customer`/`Conversation`/`Message`, not `RawExternalRecord`.

So the two ingress designs are real, deliberate and currently disjoint:

| | live pilot path (FR-028/050/052) | FR-081 substrate |
|---|---|---|
| Signature verified in this repo | no — `zuri-cli` owns it (BR-011) | yes, `verifySignature` |
| Caller authentication | binding id + destination + bearer, HMAC-compared | none wired |
| Normalization | ad-hoc `zLineEvent` in the route | `zIngestionEnvelope` |
| Persists | Customer/Conversation/Message + audit | `RawExternalRecord` |
| Runtime callers | the deployed route | **none** |

Writing this down because the charter lists the adapter under "Public
contracts", which reads as though it is serving traffic. Anyone planning to
retire the pilot seam, or to add a second provider by copying "the LINE
adapter", needs to know which of the two they are actually copying. Converging
them means giving the live route a LINE_OA `IntegrationConnection` so it can
emit the canonical envelope alongside the turn — one ingress, one envelope —
not standing up a second raw webhook route, which would be exactly the second
write path this requirement exists to prevent.

## Relationship to the neighbouring requirements

FR-048 remains the provider-port and credential-mode contract; FR-079 the
runtime connection selection; FR-080 the management surface. FR-081 is the
storage boundary underneath all three and changes none of them. It adds
`IntegrationCredential.accessTokenExpiresAt` / `refreshTokenExpiresAt`
alongside the existing `expiresAt`: the token pair describes an OAuth grant held
by the provider, while `expiresAt` remains the secret-manager reference expiry
FR-079 fails closed on. They are separate because rotating an access token does
not invalidate the reference.
