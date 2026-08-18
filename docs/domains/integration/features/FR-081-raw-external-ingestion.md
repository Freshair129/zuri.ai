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

## Relationship to the neighbouring requirements

FR-048 remains the provider-port and credential-mode contract; FR-079 the
runtime connection selection; FR-080 the management surface. FR-081 is the
storage boundary underneath all three and changes none of them. It adds
`IntegrationCredential.accessTokenExpiresAt` / `refreshTokenExpiresAt`
alongside the existing `expiresAt`: the token pair describes an OAuth grant held
by the provider, while `expiresAt` remains the secret-manager reference expiry
FR-079 fails closed on. They are separate because rotating an access token does
not invalidate the reference.
