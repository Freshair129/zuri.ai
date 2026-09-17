---
id: ZAI:PM-SYSTEM-API
title: Project Manager API specification and visual Swagger contract
version: "0.2.1b"
status: candidate
created_at: "2026-09-15T23:49:58+07:00,RWANG,base 087f3025"
last_update: "2026-09-16T03:55:57+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: api-specification
  domain: project-manager
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
  - type: references
    target: ZAI:FR-019
---

# API & Contract Specification

**Version:** 0.2.1b · **Status:** Candidate
Machine-readable source: [openapi.candidate.yaml](contracts/openapi.candidate.yaml)

**Workforce addition:** [workforce.openapi.candidate.yaml](contracts/workforce.openapi.candidate.yaml) adds eight proposed operations and 27 schemas under explicit Business scope, with [synthetic examples](contracts/workforce.examples.json). Main candidate remains 72 operations; combined total is 80. [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) supplies calculation, cohort, concurrency and authorization rules not expressible by JSON shape alone. Before enabling resource writes, reconcile the main candidate's generic AllocationInput with this typed human-allocation contract; do not publish two independent writers.

**Completeness and actual viewer:** [16 Spec readiness & API reference](16-SPEC-READINESS-AND-API-REFERENCE.md) inventories what exists and SPEC-G01–G09 that remain. The local `swagger-api.html` now renders both files with bundled Swagger UI 5.32.15; it is read-only documentation, not a production API. No candidate endpoint is marked implemented by rendering it.

## 1. Scope and authority

The OpenAPI file defines **proposed additions**. Existing CRUD/PlanEnvelope/import/progress routes remain governed by current `GET /api/docs`; this file does not replace or claim to describe all 281 routes in the baseline.

OpenAPI 3.0.3 is chosen for the current `OpenApiGeneratorV3` seam. The format supports operation/schema/security descriptions; a rendered API explorer must still enforce application authorization at request time. [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html).

Before code generation, each operationId must map to canonical requirements, owner charter and runtime Zod schemas. Candidate schemas become the reviewed input for implementation; once approved runtime schemas exist, generated API output is checked against this accepted contract. There are never two independently editable authoritative endpoint inventories.

## 2. API rules

- All examples are synthetic; the candidate server URL uses reserved `.invalid`
- User routes: trusted session + server scope lookup; non-GET cookie requests require CSRF and Origin validation
- Service routes: execution/gateway credentials with a distinct audience. An API key documented in a security scheme does not grant every route
- No client request body supplies tenantId/businessId as authority; infer from authenticated scope and the Project/Connection record
- Nonexistent and unauthorized scoped resource IDs return equivalent 404 shapes
- Mutations create a requestId/command receipt. `Idempotency-Key` is required for create/dispatch/effect-producing operations
- `If-Match` is required for editing/version-sensitive commands. Response ETag represents aggregate version
- Same key + normalized input hash → original receipt; different input → 409
- Lists use opaque cursor, limit default 50/max 200, stable tie-breaker ID and server-side scope-before-filter
- UUID for persisted identities, UTC ISO-8601 timestamps; UI displays Asia/Bangkok or user timezone
- Internal errors are redacted; response contains code, message, requestId, retryable, optional field errors/currentVersion
- Timeout/network outcome is not inferred from HTTP status alone; side-effect uncertainty returns a reconciliation reference
- Foreign $ref URLs are not fetched blindly by API explorer or contract importer; allowlist/local vendoring required

## 3. Endpoint map

`{p}` in this table = `/api/projects/{projectId}`. Exact paths, methods, IDs and schemas are in OpenAPI.

| Area | Endpoint / methods | Owner / contract |
|---|---|---|
| Domain / Feature lenses | GET {p}/domain-view, {p}/feature-view | PM; scoped counts, evidence and source snapshot |
| Feature registry | GET/POST {p}/features; GET/PATCH {p}/features/{featureId} | PM; local feature identity + canonical refs |
| Design versions | GET/POST {p}/design-snapshots; POST {p}/design-snapshots/{snapshotId}/validate | PM; hashes + graph/contract refs |
| Architecture | GET {p}/architecture | PM; layer/snapshot filter, typed graph and drift |
| Visual API | GET {p}/api-catalog; existing GET /api/docs | PM; operationId refs to generated contract |
| Agents | GET/POST {p}/agents; GET {p}/agents/{agentId}; POST {p}/agents/{agentId}/versions | PM project-owned inventory; no credentials |
| Fleets | GET/POST {p}/fleets; GET {p}/fleets/{fleetId}; POST {p}/fleets/{fleetId}/versions | PM; member-version and workflow refs |
| Workflows | GET/POST {p}/workflows; POST {p}/workflows/{workflowId}/versions | PM; declared DAG and pinned refs |
| Reviews | POST {p}/reviews | PM invokes Identity authority; approval bound to resource/hash |
| Run admission | POST {p}/runs/dry-run; GET/POST {p}/runs | PM orchestration → Integration ledger |
| Run control | GET {p}/runs/{runId}; POST {p}/runs/{runId}/commands | PM interface → Integration command port |
| Live evidence | GET {p}/runs/{runId}/events | Integration read port, PM projection; authorized stream |
| Artifact sharing | POST {p}/artifacts/{artifactId}/shares | PM orchestration → Identity grant; exact revision |
| Project support | GET/POST {p}/resource-allocations, risks, issues, change-requests, comments, notification-subscriptions, releases, evaluations, triggers | PM surfaces call owning services; concrete request schemas are in OpenAPI |
| Trigger lifecycle | PATCH {p}/triggers/{triggerId} | Expected-version pause/resume of admission; run cancellation is separate |
| Design import/export | POST {p}/design-bundles/dry-run and /commit; GET {p}/design-bundles/export | PM; exact preview hash and sanitized output |
| Evidence search | POST {p}/search | PM projection through authorized Knowledge/read ports |
| Model connections | GET/POST /api/platform/integrations/model-connections | Integration; reuses connection writer |
| Write-only credentials | POST .../model-connections/{connectionId}/credential; POST .../credential/revoke | Integration; AAL2 + credential manager |
| Model deployments | GET/POST /api/platform/integrations/model-deployments; POST .../{deploymentId}/probe | Integration; approved connection + validated profile |
| MCP bindings | GET/POST /api/platform/integrations/mcp-bindings; POST .../{bindingId}/probe | Integration; schema pin and executor/network profile |
| Executor queue | POST /api/platform/integrations/executors/claim | Integration; execution credential only |
| Executor heartbeat/result | POST /api/platform/integrations/executions/{runId}/heartbeat; POST .../events | Integration; attempt+epoch+scope checks |
| Inference keys | GET/POST /api/identity/inference-keys; POST .../{keyId}/revoke | Identity; owner management + one-time reveal |
| Inference gateway | GET /inference/v1/models; POST /inference/v1/chat/completions; POST /inference/v1/embeddings | Integration; inference-audience key, model allowlist and budgets |

Inventory routes are project-owned initially. Reuse across projects is an explicit version binding with authority checks; copying a definition does not copy rights. “Global fleet library” is not required for initial release.

## 4. Common responses

| HTTP | Code | Client behavior |
|---|---|---|
| 200 / 201 / 202 / 204 | successful read/create/accepted/no claim | Render receipt; accepted command may still be queued |
| 400 | MALFORMED_REQUEST / INVALID_CURSOR | Correct request |
| 401 | AUTH_REQUIRED / CREDENTIAL_EXPIRED | Reauthenticate; no upstream call |
| 403 | CAPABILITY_DENIED / STEP_UP_REQUIRED / REVIEW_CONFLICT | Explain allowed next step without exposing resource |
| 404 | NOT_FOUND | Same shape for unauthorized/nonexistent ID |
| 409 | INPUT_CHANGED / IDEMPOTENCY_CONFLICT / LEASE_LOST / INVALID_TRANSITION | Reload/reconcile; no blind retry |
| 410 | CURSOR_EXPIRED / APPROVAL_EXPIRED | Fetch scoped snapshot / seek new approval |
| 412 | VERSION_CONFLICT | Show current version and compare |
| 413 | PAYLOAD_TOO_LARGE | Reduce/upload through artifact path |
| 422 | CONTRACT_INVALID / TOOL_SCHEMA_CHANGED / CAPABILITY_MISMATCH | Display structured field/edge errors |
| 429 | RATE_LIMITED / BUDGET_EXCEEDED / QUEUE_FULL | Respect Retry-After; no automatic scope widening |
| 503 | EXECUTOR_UNAVAILABLE / PROVIDER_UNAVAILABLE | Block/pause; approved fallback only |

Error bodies never contain raw upstream responses, stack traces, secretRef internals or auth material.

## 5. Dispatch and response example

```json
{
  "workflowVersionId": "00000000-0000-4000-8000-000000000201",
  "fleetVersionId": "00000000-0000-4000-8000-000000000202",
  "designSnapshotId": "00000000-0000-4000-8000-000000000203",
  "inputArtifactId": "00000000-0000-4000-8000-000000000204",
  "dryRunId": "00000000-0000-4000-8000-000000000205",
  "manifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "reason": "Deliver the reviewed project slice"
}
```

Dry-run resolves actual registry versions, effect classifications and budget exposure. Its result includes blockers and requiredApprovalRefs; dispatch revalidates them. The caller cannot replace a dry-run's model/tool policy by editing another field.

Accepted response carries runId, commandId, state=QUEUED, version, eventCursor, requestId. A 202 response means durable admission, not task completion.

## 6. Streaming

- Events API uses `text/event-stream`; event ID is opaque cursor, data is redacted envelope, reconnect uses Last-Event-ID
- Snapshot/list API remains available for clients without SSE
- Server validates scope when stream opens and rechecks on revocation/periodic authorization refresh; active stream cannot retain access indefinitely
- Heartbeat comments every 15s, client reconnect backoff capped 30s; stream cursor expires after retained event window
- Slow clients disconnect with resumable cursor rather than creating unbounded server buffers
- Inference SSE is a separate protocol profile. A partial inference stream cannot be appended to a retry as if one response; each invocation has its own ID and usage receipt

## 7. Visual Swagger implementation contract

1. Use the authenticated spec endpoint/approved source version; display environment and SHA prominently
2. Keep API navigation domain-tagged, feature-filtered and operationId-linked to architecture/test evidence
3. Use local bundled Swagger UI assets with CSP; no third-party validator/network export of private schema
4. Default `supportedSubmitMethods: []` (documentation mode), `persistAuthorization: false`, `validatorUrl: null`
5. Enable a reviewed subset in sandbox mode only; request interceptor supplies same-origin session/CSRF behavior, never provider credentials
6. For explicit live invocation, render concrete method/path/scope/payload and enforce the same capability/approval gate as application UI
7. Sanitize descriptions/Markdown; prohibit arbitrary external specs without approved source policy
8. Regression check auth, model schemas, server selection, redaction and operation-to-route coverage

Swagger UI exposes these configuration controls; their use here is a product design decision. [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/).

## 8. Compatibility and generation

- Current API remains compatible unless a separately approved migration changes it
- Add `x-proposal-requirements`, `x-owner-domain`, `x-effect-class`, `x-approval` and `x-evidence-level` in candidate operations
- P0 maps proposal IDs to canonical IDs and pins operationId. Renaming labels never renames the operation key silently
- Generate runtime Zod validators/DTO/client interfaces only from the approved schema revision, then verify parity using actual requests
- Schema/example parse success does not prove semantic authorization or behavioral correctness
- Workflow JSON Schema supports a bounded structural shape. Semantic checks cover graph cycles, scopes, approved refs, capabilities, handoffs and budgets

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Proposed HTTP surfaces, errors, scopes, SSE and Swagger configuration | base 087f3025 | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Add independent workforce OpenAPI supplement and semantic gates | source 0f5a47fc; uncommitted | RWANG |
| 0.2.1b | 2026-09-16 | candidate | Link Swagger review and distinguish candidate HTTP schemas from complete implementation contracts | design base 087f3025; uncommitted | RWANG |
