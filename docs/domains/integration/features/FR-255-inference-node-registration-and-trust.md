---
id: "ZAI:FR-255-NOTE"
title: "Inference node registration and trust"
version: "0.1.1b"
status: approved
approval_scope: design-and-documentation
approved_on: "2026-09-18"
approved_by: "Owner via conversation"
integration_status: pending
implementation_status: not-started
created_at: "2026-09-17"
last_update: "2026-09-18"
author: ChatGPT
domain: integration
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
feature: FR-255
module: integration
source: pending
relations:
  - type: references
    target: "ZAI:FR-255"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:DOMAIN-INTEGRATION"
---

# FR-255 — Inference node registration and trust

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


## Behavior and ownership

Integration provides Business-scoped registration and qualification of self-hosted inference endpoints. It reuses `IntegrationConnection` and existing secret-resolution/provisioning abstractions. The selected product scope is a Business, not an arbitrary caller-supplied tenant. Identity verifies the viewer; only the owning Business's approved manager may select/register within the operator's allowed network targets. Raw key provisioning/rotation requires the established step-up assurance policy.

The network-target allowlist is installation-operator configuration, separate from a Business owner's provider selection. Being an installation operator does not silently grant access to Business prompts, model keys or customer records. Sharing a physical engine across Business pools is not part of the first release.

### Proposed data and ownership

| Entity | Owner | Required meaning |
|---|---|---|
| IntegrationConnection | integration, existing | Scoped node connection; proposed self-hosted provider code; metadata excludes secrets |
| IntegrationCredential / secret references | integration, existing | Write-only secret versions; no second API-key database |
| InferencePool | integration, proposed | UUID/code, tenant/business, logical model alias, immutable versioned profile, lifecycle/version |
| InferencePoolMember | integration, proposed | Pool/node connection reference, priority, calibrated slot/token budget, epoch/version |
| InferenceNodeObservation | integration, proposed | One latest bounded normalized observation per connection; observed/received time, epoch and evidence quality |

A member and pool must have the same Tenant/Business. Each node connection belongs to one active pool in the first release. The target engine identity is canonicalized so aliases cannot enroll the same engine twice and evade capacity accounting. This is an operator/configuration assertion plus endpoint checks, not cryptographic physical-device attestation.

Use UUIDs internally, human-readable codes for management, and versioned audited services for mutations. SQLite development and PostgreSQL production schemas/migrations must agree. Only implemented models enter charter `owns_models`.

### Administrative lifecycle

`DRAFT → QUALIFYING → QUALIFIED → ENABLED → DRAINING → DISABLED → ARCHIVED`.

Qualification may end `FAILED`; an explicit new qualification creates a new attempt. Observed health is independent of lifecycle: `ENABLED` does not imply `READY`. Drain stops new assignments while existing attempts may settle. Archive is refused while references or unsettled reservations require the record. Emergency revoke fences new dispatch and stale completion according to the LINE/Agent policy; it is not equivalent to a graceful drain.

## Input, output and failures

### Registration contract (proposed, not an existing endpoint)

`registerInferenceNode(viewer, { businessId, code, endpointOrigin, apiBasePath, modelProfileRef, credentialInput, expectedVersion })`.

`businessId` is a locator checked against the authenticated viewer; the resolved trusted scope is authoritative. `apiBasePath` is `/v1` in the initial profile. Origin excludes path, query, fragment and userinfo. Endpoint values come only from authorized management, never LINE text, a model's tool arguments or an Edge job.

`credentialInput` is either a supported write-only provision operation or an opaque reference to the selected SecretStorePort. A raw key must never appear in a read response, audit payload, request log, model context, metrics label or error message. Storage uses the approved backend; do not assume ADR-061's LINE-token mount exemption authorizes model secrets.

Read output: internal ID/code, redacted endpoint label, profile metadata, administrative lifecycle, credential status/version, last qualification timestamp and bounded error code. Physical endpoints are shown only to the properly authorized manager/operator surface, not a general Business viewer.

### Proposed API ownership

Management routes stay under Integration's existing `src/app/api/platform/integrations/**` ownership. Candidate subpaths are `inference-pools`, `inference-nodes`, `inference-nodes/[id]/qualify`, and lifecycle actions. They are names to register and test, not routes present at the baseline. Thin handlers call management services under `src/modules/integration/application/`; network/provider code stays under `src/platform/integrations/` and imports no business domain.

### Qualification protocol

1. Resolve viewer scope, endpoint allowlist and secret reference. Validate origin, DNS/address family, permitted CIDR/host/port and route policy before any socket is opened.
2. Establish the configured authenticated transport. Verify TLS hostname/certificate where HTTPS is used. Reject redirects and DNS rebinding; all resolved destinations must remain in the approved target set at connection time.
3. Read the protected model-list endpoint with the valid credential. In an equivalent authenticated network context, repeat with absent and deliberately incorrect Bearer credentials; both must be rejected by the configured access boundary.
4. Confirm the expected served model alias. Compare against the operator-provided immutable deployment profile. `/v1/models` alone is not proof of weights revision, GPU type or quantization.
5. Run one bounded synthetic text request without customer data. Validate response shape, nonempty output, allowed model identity and a useful end-to-end timing sample. A successful HTTP status with malformed/empty output is failure.
6. Run capability tests required by the target workload, especially tool-call syntax/arguments and reasoning behavior. Mark untested capabilities `UNVERIFIED`, not supported.
7. Persist a redacted qualification receipt bound to endpoint, credential version, profile hash, configuration epoch and test revision. Enablement is an explicit action after gates pass.

A successful health probe is not an authentication test. Model alias equality is not cryptographic deployment attestation. Mutual TLS can authenticate deployed service identities, but does not prove what model/hardware the process actually runs. [V1] [V2]

### Security controls

Allow only the exact required methods/paths: protected model listing and Chat Completions, plus the selected management-network observation endpoints. Deny arbitrary admin, debug, filesystem, weight loading, sleep/wake or cache-reset endpoints. A future tokenizer endpoint is separately allowlisted after its release-specific schema/auth behavior is verified.

Reject link-local metadata addresses, loopback management targets, multicast, public Internet targets outside policy, nonapproved private hosts/ports, userinfo, redirects and unbounded bodies. Private RFC1918 addresses are not automatically trusted. With a private VPN, peer identity, subnet routes and ACLs must be provisioned before enrollment; an IP string alone is not pairing.

Hard limits proposed for management probes: connect 2 s; header 3 s; normalized response cap 64 KiB for model metadata, 1 MiB for metrics; qualification generation 15 s/32 output tokens unless a reviewed hardware profile sets stricter limits. These are initial **policy defaults**, not measured engine guarantees. Do not disable certificate validation to make qualification succeed.

### Rotation and recovery

Stage a new secret version, qualify against the node's configured credential set, then atomically select it for new requests. Never log a key for troubleshooting. If the deployed engine cannot rotate without restart, drain, restart through the operator's deployment tooling, requalify and resume; the application does not invent a hot-reload feature. Revocation prevents new dispatch immediately and records in-flight uncertainty honestly.

| Failure code | Result |
|---|---|
| INFERENCE_SCOPE_DENIED | Refuse without exposing other Business existence |
| INFERENCE_ENDPOINT_FORBIDDEN | No network request |
| INFERENCE_TLS_INVALID | No credential transmission over an untrusted connection |
| INFERENCE_AUTH_INVALID | Node ineligible until credential repair |
| INFERENCE_AUTH_NOT_ENFORCED | Qualification refused even if valid-key probe succeeded |
| INFERENCE_MODEL_MISMATCH | No production prompt dispatched |
| INFERENCE_CAPABILITY_UNVERIFIED | Required workload cannot select this node |
| INFERENCE_QUALIFICATION_TIMEOUT | Failed receipt, no auto-enable |
| INFERENCE_SECRET_UNAVAILABLE | Fail closed, no anonymous request |

## Acceptance criteria

- NODES-01: An authorized same-scope registration creates exactly one connection and no readable key; another Business gets a refusal with no disclosure.
- NODES-02: Good credentials pass; absent/wrong credentials fail. A health-only success cannot mark authentication qualified.
- NODES-03: A supplied URL cannot access metadata services, another internal application or a rebinding/redirect destination.
- NODES-04: Missing/wrong model, unverified tool behavior or a changed profile/credential epoch prevents admission until requalification.
- NODES-05: Drain/resume/revoke/rotation use versioned audited transitions and cannot resurrect archived/revoked nodes.
- NODES-06: Duplicate endpoint aliases cannot create two independent capacity budgets for one physical engine.
- NODES-07: Restored metadata starts disabled/unqualified; backups contain only the existing approved secret-reference representation, never raw node keys. Credentials must be revalidated before activation.
- NODES-08: A generation probe uses synthetic content only and leaves no customer prompt in observations.

Verification and phase handoff: [[ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL]], [[ZAI:PLAN-FEAT-043-PHASES]].

[V1]: https://docs.vllm.ai/en/stable/usage/security/
[V2]: https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/

## Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/integration/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md) — Provider/credential ownership, management surfaces, production-provider restrictions.
- [apps/server/src/modules/agent/model-provider.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/model-provider.js) — Production provider restrictions and actual HTTP/usage/trace adapter.
- [apps/server/src/modules/agent/phase1-runtime.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/phase1-runtime.js) — Production provider selection and secret/Vault configuration gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
