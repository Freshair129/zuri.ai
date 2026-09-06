---
version: "0.1.0b"
created_at: "2026-08-14T07:45:00+07:00,ATHER"
last_update: "2026-08-14T08:01:31+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "root-cause-analysis"
  scope: "FR-050 transport to FR-052 production binding"
---

# RCA — Phase 1 LINE binding contract drift

## Symptom

The existing stack-answer bridge cannot produce a grounded production answer: it sends
client-configured Tenant/Business scope, while the production route rejects client-selected scope
and requires `bindingId`, signed LINE `destination`, and a binding bearer.

## Evidence

1. The old client serialized `tenantId`, optional `businessId`, and `events`.
2. Zuri V2 resolves Phase 1 scope only from an active persisted LINE binding.
3. Each repository mocked its own side; no shared request fixture exercised the real contract.
4. Existing LINE configuration validation passes, so the failure is contract drift rather than a
   missing channel secret or Reply API token.

## Root Cause

FR-050 established the single-reply transport before FR-052 replaced client-selected scope with a
server-owned database binding. The transport contract was not superseded when the authorization
model changed.

## Why the issue escaped detection

Zuri tests proved binding rejection while `zuri-cli` tests mocked a successful stack response. No
cross-repository fixture compared the emitted request with the accepted route shape.

## Proposed prevention

- Derive destination only from the signature-verified LINE envelope.
- Keep binding UUID and bearer in server secret configuration.
- Never forward `replyToken`, Tenant ID or Business ID.
- Fail startup when reply mode uses legacy scope or lacks binding inputs.
- Share one byte-identical request fixture across both repositories.

## Implementation evidence

- The client emits the binding-only request and allow-lists forwarded event fields.
- Missing destination and rejected binding do not spend a LINE reply token.
- Restart dedupe preserves single-reply ownership.
- The dedupe store is written atomically and corruption fails startup closed instead of silently
  forgetting previously consumed events.
- Full tests, typecheck and build are required before promotion.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Confirmed drift and implemented binding-only transport contract | working-tree | ATHER |
