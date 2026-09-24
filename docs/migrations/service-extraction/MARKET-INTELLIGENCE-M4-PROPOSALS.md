---
id: ZAI:MARKET-INTELLIGENCE-M4-PROPOSALS
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T13:00:00+07:00,Claude"
attributes:
  domain: market-intelligence
  scope: market-intelligence-m4-cross-owner-proposals
relations:
  - type: relates_to
    target: ZAI:ADR-108
  - type: relates_to
    target: ZAI:FR-092
---

# Market Intelligence M4: proposals for other owners (no code)

Session 4, following the delegated ruling Q12(b). These are **proposals only**. No ADR id
is minted, no port shape changes, and no audit or Integration code is touched. Each one
needs its owner's review before anyone implements it.

## P1: durable audit handoff (to the audit owner, project-manager)

**Input: the M2 behaviour as it stands.** A translation run commits its observations,
then appends one `MARKET_TRANSLATION_RUN` event (counts only) through core's façade.
If that append fails, the service answers:

```json
{ "error": "Core authority is unavailable", "code": "CORE_UNAVAILABLE", "phase": "audit", "committed": true }
```

It also logs the failure. The observations are kept and a replay is idempotent through
`lineageKey`, but that run's audit event is lost. Legacy has the same gap, answering 500.

**Proposal.** Give the audit event a stable identity and make the append idempotent, so
a retry can close the gap without an outbox that the Market service owns:

1. The service derives `runKey = sha256(tenantId, businessId, sorted lineageKeys created
   in this run, run start instant)`, and sends it as `requestId` on the audit event
   (`AuditEvent.requestId` already exists).
2. The audit owner makes `(action, requestId)` idempotent on the façade's `audit`
   operation, so a repeat returns the original event instead of a second one.
3. After `phase: audit, committed: true`, the service retries the append with bounded
   backoff in the background and reports the outcome in a log line. The HTTP response
   stays as it is today.

**Why not an outbox in the service:** it would make Market the durable holder of
project-manager's audit truth, which changes the audit owner without its review. That
is exactly what ADR-108 D7 forbids.

**Questions for the owner:** Is `requestId` the right idempotency key, or do you prefer a
dedicated column? Do you want the retry to live in core (an audit intake queue) rather
than in the service?

## P2: source revoke and redaction (to the Integration owner)

**Input.** `MarketObservation` copies provenance fields (`rawRecordId`, `connectionId`,
`sourcePayloadHash`, `sourceUri`) and a candidate derived from the raw payload. Today
there is no path by which a revoked connection or a redacted raw record reaches Market
state. The same is true in legacy and in the service.

**Proposal.**

1. Integration exposes, through the same `market-core.v1` façade, a bounded read of
   raw-record state changes since a cursor:
   `raw-changes { tenantId, businessId, sinceCursor, limit }` returns
   `[{ rawRecordId, state: REDACTED | REVOKED, at }]` plus the next cursor. Payloads
   are never returned.
2. The Market service applies each change to its own rows only:
   - REDACTED: blank `candidateJson` to `{}`, set `sourceUri` to null, keep the
     lineage columns so identity and replay protection survive, and mark the row
     (a new nullable `redactedAt` column needs a Market migration, owned by Market).
   - REVOKED connection: stop reading the connection's evidence for new runs (already
     true once Integration stops listing it); existing rows are kept, with no payload
     re-derivation.
3. A redacted row is never revived by re-translation. The run's lineage-key filter
   already skips an existing key. A tombstone must not be compared against a fresh
   payload hash to "recover" content, a limit the extraction prompt states explicitly.

**Questions for the owner:** Does Integration already keep a redaction/revocation
state the façade can read, or does this need a new Integration FR? What retention do
you require for the lineage columns after a redaction?

## Status

| Proposal | Owner | State |
|---|---|---|
| P1 durable audit handoff | project-manager (audit) | PROPOSED; not reviewed |
| P2 source revoke/redaction | Integration | PROPOSED; not reviewed |
