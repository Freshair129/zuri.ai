---
id: ZAI:ADR-109
title: "Retire Edge Device and harness surfaces; keep PRP LocalWorker key flow"
version: "1.0.0"
status: approved
created_at: "2026-09-24T00:00:00+07:00,Codex"
last_update: "2026-09-24T00:00:00+07:00,Codex"
author: Codex (implementation owner)
approval_scope: architecture-and-local-implementation
approved_on: "2026-09-24"
approved_by: "User instruction in Session 1 follow-up"
attributes:
  doc_type: architecture-decision
  domain: agent
  scope: retirement-of-edge-device-and-harness-surfaces
relations:
  - type: relates_to
    target: ZAI:ADR-041
  - type: relates_to
    target: ZAI:ADR-059
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-087
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:FR-143
  - type: relates_to
    target: ZAI:FR-144
  - type: relates_to
    target: ZAI:FR-220
  - type: relates_to
    target: ZAI:FR-221
  - type: relates_to
    target: ZAI:FR-222
---

# ADR-109 — Retire Edge Device and harness surfaces; keep PRP LocalWorker key flow

**Status:** Approved for local implementation on 2026-09-24. Removal from a running
deployment, credential revocation, and any production data operation remain separate
gates.

**Risk:** HIGH. This retires authentication, execution and reporting surfaces across
Identity, Asset Management, LINE OA Studio and Platform Control. Existing data and
schema remain intact.

## Context

ADR-041, ADR-059, ADR-061 and ADR-087 previously authorized Edge Device pairing,
heartbeat, evidence extraction and harness attribution surfaces. The owner has now
directed that a device is no longer used to connect a worker to LINE OA. A Business
uses the existing browser-provisioned PRP LocalWorker client-key flow instead. The
owner approved removal of the Edge Device feature surfaces, including pairing,
harness, UI and APIs, while preserving existing records and the Knowledge/RAG
runtime.

ADR-100 already defines the PRP path: the Business enters a PRP client key through
the write-only model credential flow; the server supplies the private runtime base
URL; the key is validated against PRP's granted model aliases and is used for PRP's
client inference API. That credential is distinct from both the worker adapter's
service-to-worker credential and PRP's administrative key. This decision does not
create a new PRP endpoint or alter the existing key contract.

## Decision

### D1 — Retire Edge Device and harness product surfaces

Remove the Zuri-owned Edge Device surfaces from the frontend and backend:

- device pairing, credential mint/list/revoke, heartbeat and device registry;
- Edge asset-extraction claim, evidence-download, completion and failure APIs,
  the Edge extraction provider, reference poller and pairing UI;
- Edge-to-Server LINE webhook, delivery and asset-handoff adapters that exist only
  for the retired device connection;
- harness pairing, device management, usage-report authentication and plugin
  surfaces.

The native Server LINE webhook, Conversation Runtime queue/ownership contract,
PRP model-provider key card, ordinary non-Edge asset extraction, Project/Work
writers and Knowledge/RAG runtime remain in their existing owners. In particular,
this decision does not remove or transfer the Knowledge 17-stage pipeline, GenesisRAG,
MSP/GKS, MinIO or Files work.

### D2 — Keep PRP client-key authentication

The Business continues to enter a PRP-issued inference client key through the
existing write-only MODEL_PROVIDER_KEY flow (FR-266/FR-267, ADR-100). The server
validates it against the configured PRP endpoint and uses the fixed PRP client
contract. The private endpoint remains operator-configured; a browser cannot supply
an arbitrary runtime URL.

The PRP client key authenticates only the PRP public client API. It is not an
OperatorKey, ServiceCredential, Edge Device key, LINE channel secret or Zuri
service bearer. It does not grant a chosen actor, Business or tenant authority in
Zuri. Zuri keeps the credential server-side and write-only; runtime traces and job
payloads contain only a credential reference or safe status.

The PRP client OpenAPI/API documents inspected on 2026-09-24 are marked DRAFT and
state that delivery is not implemented or tested by those documents. Local controlled
provider fixtures may verify the Zuri consumer contract, but this ADR does not claim
the PRP producer contract is frozen, hosted, deployed or live-verified. No real model
call is authorized here.

### D3 — Preserve stored records and schema

Do not drop or rewrite existing EdgeDeviceCredential, AssetExtractionJob,
HarnessCredential, HarnessDevice, pairing or usage-report records. Keep their Prisma
models, migration history, backup/restore handling and audit records so
existing data remains recoverable and reviewable. The retired routes and UI stop
creating or changing those records after the removal is separately deployed. This
draft performs no production migration, mass revocation or data deletion.

The existing OpenAI asset-extraction path remains available. New Edge extraction
jobs are not enqueued. Existing AssetExtractionJob rows remain historical data;
they do not resume or dispatch work.

### D4 — No device executor remains for LINE OA

LINE OA answers use the server-owned admission and job system and the selected model
provider, including PRP when configured. No Edge Device claims LINE work, holds LINE
credentials, or competes with the Server/Conversation Runtime executor. Core-owned
routing and fencing in ADR-106 remain the only execution-ownership gate; runtime
health is not authorization or ownership state.

### D5 — Amendments by pointer

This ADR amends the Edge Device scope in ADR-041, ADR-059 and ADR-061, the retained
device scope in ADR-100, and the harness pairing/reporting scope in ADR-087. Those
documents remain historical sources; their ids and original decision records are
not rewritten or reused. FR-141, FR-143, FR-144, SEC-025, SDD-085 and FEAT-017's
Edge-specific behavior, plus FR-220..FR-222 and FEAT-035, are retired from active
product scope by this decision. Their identifiers remain permanently assigned.
No new FR or SDD is reserved by this amendment.

## Alternatives and consequences

- Keeping the Edge pairing UI while asking users to enter a PRP key would expose two
  competing connection models and is rejected.
- Reusing OperatorKey or the worker adapter ServiceCredential as a Business's
  inference key is rejected because those keys have different authorities and
  scopes.
- Deleting historical device, extraction or usage rows would lose audit and
  provenance evidence; records and migrations are preserved.
- Removing the entire apps/edge tree would also remove the Knowledge/RAG runtime;
  it is explicitly out of scope.

## Verification

- Enumerate frontend and backend routes to confirm the retired pairing, heartbeat,
  Edge extraction and harness surfaces are absent.
- Confirm the browser-provisioned PRP model-key path remains and no key is returned
  or logged.
- Confirm Edge/harness tables, migrations, backup handling and historical rows are
  retained without a migration or cleanup operation.
- Confirm Knowledge/RAG source and routes remain unchanged.
- Report local consumer fixtures separately from PRP producer conformance, hosted
  CI, image proof and production evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-24 | approved | Retire Edge Device and harness surfaces; preserve records and Knowledge/RAG; retain PRP LocalWorker client-key flow | working-tree | Codex |

