---
domain: agent
feature: FR-141
module: agent
source: v2-native
version: "0.1.0b"
status: "implemented (local); persistence decision open"
---

# FR-141 — Edge Device heartbeat registry

## Intent

ADR-041 D3 draws the cloud/edge line: the Zuri Cloud Console shows **device
pairing status, live heartbeat telemetry and an online pulse**, and nothing
else about the edge — no credentials, no configuration. `/api/agent/heartbeat`
is the in-repo port for that promise. The Platform Integrations page reads it
to colour the "Edge Runtime online / paired" card and to offer "remove device".

## What was wrong (gap analysis 2026-09-02)

`reports/gap-analysis-2026-09-02` findings D3-line-agent-crm-flow-05 (CRITICAL),
D4-connector-governance-15/18 and D2-domain-agent-17 described the route as it
shipped:

- `GET` caught a failed `resolveRequestViewer` and served the device list to
  the caller anyway as `viewerId: 'anonymous'`.
- `POST` never resolved a viewer, and when the Zod parse failed it fell back to
  the raw body and a hardcoded `deviceId` of `DEV-SMARTGIFT-PRIMARY` — a bad
  payload *registered a device*.
- `DELETE` had no authentication; without `?deviceId=` it cleared the whole
  process-global registry for every Business in one request.
- Every `catch` returned HTTP 200 with an error body, so no monitor could see
  a failure.
- The file was annotated `@req FR-080` (the integration secret-management UI,
  which says nothing about devices) and `@tested tests/unit/fr080-ui-contract.test.js`,
  a file that never imports the route. TRACE and Appendix D therefore credited
  FR-080 with evidence that was not evidence.

No FR declared edge-device heartbeat at all. Re-pointing the annotation at
another existing id would have been the same misattribution with a different
number, so FR-141 is declared instead.

## Contract (what FR-141 states)

| Method | Behaviour |
| --- | --- |
| all | `resolveRequestViewer` first; 401/503 propagate. Nothing is read or written before the viewer is known. |
| `GET` | Devices of every Business in `viewer.ownedBusinessIds`. `?businessId=` narrows to one Business and is 403 unless owned. Each device carries `online` = `status === 'healthy'` and last heartbeat within 120 s. |
| `POST` | JSON object body validated by `zEdgeDeviceHeartbeat`; a failed parse is 400 with the issues and registers nothing. `businessId` must be owned (403). `deviceToken` is accepted for wire compatibility and is never stored, returned or audited. |
| `DELETE` | `?deviceId=` removes that device from the viewer's owned scope (404 if it is not there). No `deviceId` clears exactly the owned scope. `?businessId=` narrows either form and is 403 unless owned. |

Audit (`AuditEvent`, `entityType: 'EDGE_DEVICE'`): `REGISTERED` on first sight
of a `(businessId, deviceId)`, `STATUS_CHANGED` on a transition, `UNREGISTERED`
on removal. A heartbeat tick that changes nothing writes no audit row — a
device reporting every minute would otherwise bury the log.

The route is thin; the behaviour lives in `src/modules/agent/edge-device-registry.js`
and is proven by `tests/unit/fr141-edge-device-heartbeat.test.js`.

## Decision: the registry stays process-local — and what that costs

The gap analysis proposed moving the registry into a Prisma model. This slice
does not, on purpose:

1. **The agent charter owns no Prisma models by design** (its durable state
   lives in the production Postgres runtime behind ports). An `EdgeDevice`
   table would be the first, and a charter change is the owner's call, not a
   side effect of a security fix.
2. **A heartbeat is a cache, not a record.** Its whole meaning expires in two
   minutes. Persisting the last tick buys a "last seen at" across restarts and
   nothing else; the pairing relationship itself (device ↔ Business, token
   reference) is a *different* thing, which today does not exist anywhere in
   this repository — the console generates pairing material client-side and
   never stores it.
3. **The cost is real and is now written down instead of hidden.** The
   registry is empty after a cold start, and on Vercel it is per instance:
   two instances can disagree until each has heard from the device, and the
   console shows "not paired" until the next tick reaches the instance that
   happens to serve the page. Anyone reading the card must know it is a
   liveness pulse, not an inventory.

**Open owner decision.** If the console must show a device that has *ever*
paired (inventory semantics) rather than one that is *currently* heard
(liveness semantics), that is a new declaration: a pairing record with a token
*reference* (never the token — ADR-041 D3), a charter that names its owner,
and a Prisma or Postgres model. It should be declared as its own FR, not
retrofitted into this one.

## Consequence for the edge device (call-out)

Requiring a trusted viewer on `POST` means the on-premise device can no longer
post a heartbeat anonymously. Today the only trusted identity is the session
cookie (FR-046), so a headless device needs either a session it holds, or an
extension of the non-interactive `Authorization: Bearer` data-plane key
(FR-102 / ADR-047) to this route. Neither is declared here; until one is, the
heartbeat is exercised from an authenticated console session. This is the
correct failure mode — the alternative was an unauthenticated write path.

## Evidence

- Route: `src/app/api/agent/heartbeat/route.js`
- Service: `src/modules/agent/edge-device-registry.js`
- Test: `tests/unit/fr141-edge-device-heartbeat.test.js`
- Consumer: `src/app/(pm)/platform/integrations/page.jsx` (`useFetch('/api/agent/heartbeat')`, `deleteEdgeDevice`)
- Findings: `reports/gap-analysis-2026-09-02/03-data-pipeline-gap.md` (D3-line-agent-crm-flow-05), `04-integration-connectors-gap.md` (D4-connector-governance-15/18), `02-domain-driven-gap.md` (D2-domain-agent-17)
