# Appendix A — API Specification

Version diff 1.93.0b → 1.94.0b (2026-09-24): DRAFT for the integrator — add the Market Intelligence service's private core façade (ADR-108 D4), one dynamic path; current inventory is 337 route-handler paths. Not reachable with a browser session; no production route switch is claimed.

Version diff 1.92.0b → 1.93.0b (2026-09-23): compose the three FR-268 Business Key Result paths with the two FR-272 PM approval gateway paths; current inventory is 336 route-handler paths. Executor admission remains an internal service boundary and production migration/deployment are not claimed.

Version diff 1.90.0b → 1.91.0b (2026-09-22): add the PM-owned execution trace
read/replay route for bounded PlanEnvelope, bundle and meeting-action evidence;
current inventory is 331 route-handler paths. Replay remains a local PM operation
and does not add producer changes to FUNG or Lalin AI.
Version diff 1.89.0b → 1.90.0b (2026-09-22): add the FUNG/Lalin AI meeting
recording-to-PM action handoff preview/commit routes and the owner-attested
meeting identity binding route; current inventory is 329 route-handler paths.

Version diff 1.88.0b → 1.89.0b (2026-09-20): add the six TASK-ZAI-053 supplier cost-sheet paths to the Procurement contract; current inventory is 328 route-handler paths. The migration is written locally and production application remains an ADR-057 operator gate.

Version diff 1.87.0b → 1.88.0b: add FR-254 Knowledge Console routes to the composed FR-252/TaskUsageLedger baseline; target 315 paths and 419 operations. Final composed verification and production delivery remain pending.

Version diff 1.86.0b → 1.87.0b: retain the composed FR-252 Feature operations and add the deployment-authenticated TaskUsageLedger read projection. Composition target is 309 paths and 412 operations; TaskUsageLedger is a pure projection with no database model or migration. Final composed verification and production delivery remain pending.

Version diff 1.85.0b -> 1.86.0b: preserve FR-254 Console and add the approved LINE local execution v2 context/tool routes to the running pricing and CRM baseline; inventory 304 paths and 404 operations. No baseline route is removed.

Version diff 1.83.0b → 1.84.0b: compose FR-253 pricing (six paths/seven operations) with the exact already-deployed CRM legal-hold path. Current inventory is 296 paths and 395 operations; no live CRM route is removed.

| Field | Value |
|-------|-------|
| **Version** | 1.93.0b |
| **Status** | Candidate — current route inventory with explicit deferred contracts |
| **Last Updated** | 2026-09-23 |

ทุก endpoint เป็น local route handler โดย protected routes ใช้ trusted request-session
seam; credential login ออก signed HttpOnly session cookie และไม่มี demo bypass. Six
endpoints — the two SoT decision verbs and, since ADR-067, the four knowledge
ingestion reporter verbs under `/api/pipelines/knowledge/[executionRunId]` —
additionally accept a non-interactive `Authorization: Bearer sdpk_...` FR-102
data-plane key, checked before the session seam and scoped to exactly one tenantId —
`POST /api/platform/sot/decisions` and `GET /api/platform/sot/decisions/export`. The
FR-019 Enterprise API surface (`POST /api/import/dry-run`, `POST /api/import/commit`,
`POST /api/import/bundle/dry-run`, `POST /api/import/bundle/commit`,
`GET /api/resolve`, and non-loopback `GET /api/docs`) likewise accepts a Tenant-bound
`Authorization: Bearer apik_...` FR-106 `ApiAccessKey`, checked before the session seam
and scoped on every request to the key's own Tenant; an invalid, revoked or missing key
answers identically to no credential. The FR-173 knowledge routes also accept an apik credential only when the runtime explicitly grants that service account the exact Tenant/Business read or write action; session access uses existing Business/Project authority. Other routes do not acquire those grants.
Error shape คือ
`{ error, issues? }` — 400 validation/domain, 401 auth, 404 not found,
503 session unavailable และ 500 unexpected failure

<!-- api-spec-counts: route_handlers=337 -->

### CRM legal-hold compatibility (FR-245 / ADR-093 D6)

POST `/api/crm/customers/[customerId]/legal-hold` preserves the approved CRM
peer release while Phase B is composed. Body: `{ businessId, reason, endDate }`,
with a future calendar date `YYYY-MM-DD`. The caller needs CRM visibility and
Business ownership; Customer scope is bounded by that Business's Tenant.
Success returns `{ customerId, legalHoldId, reason, endDate, recordedAt }` and
records `LEGAL_HOLD_RECORDED`. Identity erasure retains the archive key while
an active hold exists and reports that pending state independently of PM text
erasure. This is source compatibility, not a new production verification claim.

Version diff 1.83.0b → 1.84.0b: preserve the peer CRM legal-hold route alongside
the CSRF issuer; 291 handler paths and 389 runtime operations.

### API-write CSRF issuer (FR-252-P2)

GET `/api/auth/csrf` returns the strict `{ token, expiresAt }` DTO for a live
persisted session. The API-write audience is `zuri_api_write.v1`; expiry is the
earlier of 15 minutes and the live session expiry. Responses are `no-store`,
provide no CORS token, and clients keep the token only in memory. Issuance
requires the configured `PUBLIC_BASE_URL` Origin; an absent Origin is accepted
only with `Sec-Fetch-Site: same-origin` or a same-origin Referer. The token grants
no Business capability and cannot be replaced by plugin-consent tokens.

Refusals use `{ code, message, requestId, retryable }` with matching
`X-Request-ID`: 401 `AUTH_REQUIRED`, 403 `CSRF_INVALID`, or 503
`SESSION_UNAVAILABLE`. The published Swagger uses the issuer's runtime Zod
schemas.

### Phase B Feature reads (FR-252 W3)

| Method | Route | Response |
|---|---|---|
| GET | `/api/projects/[id]/feature-view` | FeatureView: each eligible Project WorkItem counted once, including unlinked work |
| GET | `/api/projects/[id]/features` | FeatureRecordPage: lifecycle filter and owner-only deleted tombstones |
| GET | `/api/projects/[id]/features/[featureId]` | FeatureRecord: current scoped Feature and explicit relationships |
| GET | `/api/projects/[id]/governance-snapshots` | GovernanceSnapshotPage: owner-only minimal metadata |

The detail GET supplies the strong Feature ETag. The aggregate GET supplies
Business owners an ETag over all Feature ids/versions/deletion instants,
including tombstones in the same read transaction; shared readers receive no
graph token. Public DTO bodies remain unchanged. Per-record AVAILABLE/PINNED
evidence requires Doc27's bound-commit verifier. Missing checkout, invalid
proof, wrong key or revision preserves historical references with UNAVAILABLE
and null canonicalSubject; snapshot metadata alone is never key proof.

These reads use the actual strict FeatureView, FeatureRecord,
FeatureRecordPage and GovernanceSnapshotPage schemas. The hierarchy is proved
before child reads. Results are no-store. List cursors are signed and scoped;
Feature aggregates stop at 200 rows and pages at 50. Tombstones and snapshot
metadata retain their owner-capability rules. Reads do not update progress,
audit or receipts. Swagger includes aggregate 413, bounded-query 400 and
snapshot-capability 403 refusals.

### Phase B Feature writes and provenance (FR-252 W4/W5)

| Method | Route | Contract |
|---|---|---|
| POST | `/api/projects/[id]/features` | FeatureCreateInput; 201 MutationReceipt on first creation, 200 on same-intent replay |
| PATCH | `/api/projects/[id]/features/[featureId]` | FeaturePatchInput; base fields/lifecycle with Feature CAS |
| DELETE | `/api/projects/[id]/features/[featureId]` | Feature CAS; soft-delete the active relationship cohort |
| PUT | `/api/projects/[id]/features/[featureId]/contributions` | ContributionsReplaceInput; complete supporting Domain set |
| PUT | `/api/projects/[id]/features/[featureId]/work-links` | WorkLinksReplaceInput; per-WorkItem allocation validation |
| PUT | `/api/projects/[id]/feature-work-links` | FeatureWorkGraphInput; exact affected membership under graph CAS |
| PUT | `/api/projects/[id]/features/[featureId]/requirement-bindings` | RequirementBindingsReplaceInput; verified canonical revision membership |
| POST | `/api/projects/[id]/features/[featureId]/restore` | Feature CAS; matching deletion cohort, atomic allocation conflict refusal |
| POST | `/api/projects/[id]/governance-snapshots` | CaptureSnapshotInput; 201 SnapshotCaptureResult `{snapshot,receipt}`, 200 replay |

Every write requires live session authority, exact configured Origin,
X-CSRF-Token and Idempotency-Key. Existing-target writes additionally require
If-Match. Session/CSRF and complete Project scope precede body normalization;
the locked transaction re-proves live authority before receipt replay/effects.
One effect, receipt and AuditEvent commit atomically. Responses are no-store
with matching ETag and X-Request-ID. Errors use the strict
`{code,message,requestId,retryable,currentVersion?,currentEtag?,fields?}` shape:
400 malformed input, 401 authentication, 403 CSRF/capability, redacted 404,
409 conflict, 412 stale CAS, 422 invariant, 428 missing CAS and retryable 503.

Capture accepts only repositoryId, commitSha, manifestHash and SourceManifest
version 1.0.0. The server verifies bounded raw blobs from the exact commit and
operator-registered checkout. Only VALID evidence is persisted; refusal adds
no snapshot, receipt or audit. No public request or response carries an
absolute checkout root. The source verifier and actual runtime Zod schemas
are documented by Swagger; explicit oneOf refinements retain pair and receipt
discriminator rules that cannot be inferred from Zod superRefine alone.

### Local model residency by business hours (FR-244, 2026-09-16)

ADR-094 D6 option A. The compute-owned edge worker polls this to decide whether to keep the local model pinned (`keep_alive: -1`) or release it (`keep_alive: 0`). ADR-061 keeps every LINE identity off this wire, so the answer is one aggregate boolean across every server-enabled `LineOaAccount` — never an account id, a schedule, or which account is currently open.

| Method | Route | Contract | Failure |
|---|---|---|---|
| POST | `/api/edge/model-residency` | **withdrawn (FR-265, ADR-100 D2)** the residency poll existed so a compute-owned edge worker could decide whether to hold a local model in VRAM. LINE conversation work no longer runs on a device, so the poll has no caller. FR-244's declared business hours are unchanged and still shed the model answer for the out-of-hours reply. |

### Programme usage reports (FR-218, 2026-09-13)

ADR-086 D5. An agent without local session logs reports one session's usage for one programme task. Deployment-authenticated like the LINE worker: the bearer is compared in constant time before the body is read, and no browser viewer is resolved.

| Method | Route | Contract | Failure |
|---|---|---|---|
| POST | `/api/platform/programme-usage-reports` | implemented (FR-218): under `Authorization: Bearer $ZURI_PROGRAMME_USAGE_TOKEN` (at least 32 characters), `{ source, sessionId, taskCode, model?, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, requestCount, activeMinutes, startedAt, endedAt }` (strict — no other field, so no prompt or response content) is stored once per `(source, sessionId)` in `ProgrammeUsageReport`; `201 { report, replayed: false }` on create (audited `PROGRAMME_USAGE_REPORT` / `REPORTED`), `200 { report, replayed: true }` when the same payload arrives again. `/control/roadmap` merges the rows with the meter's figures, skipping a session the meter already counted | `401 USAGE_REPORT_CREDENTIAL_REQUIRED`; `400 USAGE_REPORT_INVALID` with `issues`; `404 PROGRAMME_TASK_UNKNOWN`; `409 USAGE_REPORT_CONFLICT` (same session, different payload); `503 USAGE_REPORT_UNAVAILABLE` (database, including a migration not yet applied) |

### Agent harness pairing and devices (FR-220, FR-221, 2026-09-14)

ADR-087. A Claude Code or Codex installation pairs like an Edge Device; its credential (`hrnk_…`) is scoped to usage reporting and is refused by every other route.

| Method | Route | Contract | Failure |
|---|---|---|---|
| POST | `/api/platform/harness-pairing/start` | implemented (FR-220): anonymous, bounded; `{ harness: CLAUDE_CODE \| CODEX, deviceLabel, osUser? }` → `{ state: PENDING, requestId, deviceSecret, checkCode, approvalUrl (/harness/pair#code), pollIntervalMs, expiresAt }`; nothing is minted | `400 HARNESS_REQUIRED \| HARNESS_DEVICE_LABEL_REQUIRED \| PAIRING_JSON_INVALID`; `413`; `429 PAIRING_BUSY_TRY_LATER` |
| POST | `/api/platform/harness-pairing/approve` | implemented (FR-220): trusted browser session with a matching Origin; `{ action: inspect \| approve \| deny, code }`; inspect shows harness, device label, OS user, check code and whether this person may approve; approve is allowed to an operator or a person holding a visible Business, for themselves | `401 AUTH_REQUIRED`; `403 HARNESS_PAIRING_NOT_ALLOWED \| PAIRING_ORIGIN_REFUSED`; `409 PAIRING_ALREADY_DECIDED`; `410 PAIRING_EXPIRED_OR_UNAVAILABLE` |
| POST | `/api/platform/harness-pairing/poll` | implemented (FR-220): `Authorization: Bearer <deviceSecret>`, `{ requestId, cancel? }` → `PENDING \| DENIED \| CANCELLED`, or once `{ state: PAIRED, pairing: { key, installationId, personDisplayName, status: ACTIVE \| PENDING_ACTIVATION, deviceLabel, apiBaseUrl } }`; the credential is minted in a transaction and audited `HARNESS_CREDENTIAL` / `MINTED` without key material | `410 PAIRING_EXPIRED_OR_UNAVAILABLE \| PAIRING_ALREADY_USED_START_AGAIN`; `429 PAIRING_POLL_TOO_FAST`; `403 PAIRING_REDEMPTION_FAILED` (authority lost) |
| GET | `/api/platform/harness-devices` | implemented (FR-220): installation operator only; `{ devices: [{ id, installationId, personDisplayName, harness, deviceLabel, osUser, keyPrefix, status, createdAt, activatedAt, lastUsedAt, revokedAt, version }] }` — never a hash or key | `404` for any non-operator |
| PATCH | `/api/platform/harness-devices/[id]` | implemented (FR-220): operator only; `{ action: activate \| revoke, version, reason? }`; audited `ACTIVATED` / `REVOKED`; effective on the device's next use | `404`; `400 HARNESS_DEVICE_ACTION_INVALID \| HARNESS_DEVICE_VERSION_REQUIRED`; `409 HARNESS_DEVICE_VERSION_CONFLICT \| HARNESS_DEVICE_REVOKED \| HARNESS_DEVICE_NOT_PENDING` |
| GET | `/api/platform/error-events` | implemented (FR-247): installation operator only, audited `ERROR_EVENTS_READ`; `{ events: [{ id, fingerprint, name, message, frames, occurrenceCount, firstSeenAt, lastSeenAt, correlationId, route, resolvedAt, resolvedByPersonId }] }`, active rows before resolved ones, newest active first — never request/response content | `404` for any non-operator |
| PATCH | `/api/platform/error-events/[id]` | implemented (FR-247): operator only, audited `ERROR_EVENT_RESOLVED`; sets `resolvedAt`/`resolvedByPersonId`, stops the fingerprint counting as active | `404` for any non-operator |
| POST | `/api/platform/usage-events` | implemented (FR-248, FR-249): any signed-in person records their own `{ kind: PAGE_VIEW \| ACTION, route?, actionName? }` — a PAGE_VIEW never carries `actionName`, an ACTION never carries `route`; `actionName` is a static label matching `^[\w.:@/-]{1,120}$`, never free text | `400 USAGE_EVENT_KIND_INVALID \| USAGE_EVENT_ROUTE_INVALID \| USAGE_EVENT_ACTION_NAME_INVALID \| USAGE_EVENT_ROUTE_CARRIES_NO_ACTION_NAME \| USAGE_EVENT_ACTION_CARRIES_NO_ROUTE` |
| GET | `/api/platform/usage-events` | implemented (FR-248, FR-249): installation operator only, audited `USAGE_EVENTS_READ`; `{ pageViews: [...], actions: [...] }`, each row `{ target, recentCount, rolledUpCount, totalCount, byPerson }` — `byPerson` reflects only the last 90 days, the only window this carries a person for (ADR-095 D3) | `404` for any non-operator |
| POST | `/api/platform/usage-events/rollup` | implemented (FR-249, NFR-023): deployment-bearer-authenticated (`ZURI_USAGE_ROLLUP_TOKEN`), once-a-day idempotency guard; moves every `UsageEvent` row past its 90-day window into a person-free daily rollup and deletes the rows moved, one audit event per run (same shape as `/api/crm/retention-sweep`) | `401` missing/wrong bearer; `503` on an unhandled failure |
| GET | `/api/platform/task-usage-ledger?taskCode=` | implemented locally (TaskUsageLedger v1): deployment-bearer-authenticated, read-only redacted projection over explicit taskCode reports; plan prediction and measured actual remain separate, lane-only usage is never allocated, optional taskCode filters one known programme task | `401 TASK_USAGE_LEDGER_CREDENTIAL_REQUIRED`; `404 PROGRAMME_TASK_UNKNOWN`; `503 TASK_USAGE_LEDGER_UNAVAILABLE` |
| GET | `/api/platform/programme-usage-reports/whoami` | implemented (FR-220): the only read a harness credential allows — `{ installationId, personDisplayName, deviceLabel, harness, status }` of that credential | `401 HARNESS_CREDENTIAL_REQUIRED`; `503` |

`POST /api/platform/programme-usage-reports` (FR-221) also accepts an active harness credential: the report stores the credential's person and installation, `branch` (key `(source, sessionId, branch)`), optional `repository` and `aiAccount` label, and `taskCode` becomes optional when a branch is named; a resumed session from the same installation whose counts only grow answers `200 { extended: true }` (audited `EXTENDED`); a pending device answers `403 HARNESS_NOT_ACTIVATED` and an unknown or revoked one `401 HARNESS_CREDENTIAL_REQUIRED`.

FR-239 (ADR-086 D7): the body may also carry an optional, strict `detail` object — `reasoningTokens`, `cacheWrite5mTokens`, `cacheWrite1hTokens`, `webSearchRequests`, `webFetchRequests`, `prompts`, `toolCalls`, `toolErrors`, `toolDenials`, `compactions`, `apiErrors` (integers), `tools` (≤ 300 names matching `^[\w.:@/-]{1,120}$`, each `{ calls, errors }`) and `models` (≤ 30 names, each a request count); any other key is `400 USAGE_REPORT_INVALID`, so no text can be stored. The detail is part of the replay digest (a report without it digests as before) and every headline count must also grow for a resumed session to extend. Full contract: [Zuri harness plugin specification](../ZURI-HARNESS-PLUGIN-SPEC.md) §6–7.


### Desktop browser/QR pairing (FR-144, 2026-09-08)

| Method | Route | Contract | Failure |
|---|---|---|---|
| POST | `/api/edge/pairing/start` | Anonymous bounded five-minute request; device ID and label; separate browser approval fragment and private Desktop polling secret. Mints no credential. | 400 invalid input; 429 rate/capacity; 503 origin unavailable |
| POST | `/api/edge/pairing/approve` | Browser session plus same-origin JSON required; inspect lists governable Businesses; owner approves one Business or denies; no raw key returned. | 401 session; 403 origin; 404 Business authority; 409 already decided; 410 expired |
| POST | `/api/edge/pairing/poll` | Initiating Desktop bearer only; pending state or cancellation; approved request reserves one redemption, refreshes owner authority and transactionally mints the existing credential. Returns raw key once. | 410 unavailable/used; 429 polling; 403 authority lost; 503 redemption failed |

### Enterprise IAM MFA & WebAuthn Passkeys (FR-094, FR-095, FR-096, 2026-09-12)

| Method | Route | Contract | Failure |
|---|---|---|---|
| POST | `/api/auth/mfa/totp/enroll` | Authenticated viewer initiates RFC 6238 TOTP enrollment; returns secret and provisioning URI. | 401 auth; 400 validation; 404 person |
| POST | `/api/auth/mfa/totp/verify` | Confirms pending factor with initial 6-digit code; elevates session to AAL2. | 401 auth; 400 invalid code; 404 factor |
| GET | `/api/auth/mfa/factors` | Lists registered MFA factors (secrets redacted). | 401 auth |
| DELETE | `/api/auth/mfa/factors` | Revokes registered MFA factor. | 401 auth; 400 validation; 404 factor |
| POST | `/api/auth/step-up` | Re-verifies MFA factor to elevate session assurance to AAL2. | 401 auth; 400 invalid code |
| POST | `/api/auth/webauthn/register/options` | Authenticated viewer requests WebAuthn creation options and challenge. | 401 auth |
| POST | `/api/auth/webauthn/register/verify` | Completes passkey registration, verifies attestation, stores PasskeyCredential, elevates session. | 401 auth; 400 invalid response/challenge; 409 already registered |
| POST | `/api/auth/webauthn/login/options` | Requests passkey assertion options and challenge (optionally filtered by email). | 400 validation |
| POST | `/api/auth/webauthn/login/verify` | Verifies passkey assertion signature, creates new AAL2 session, and sets cookie. | 400 invalid response; 401 invalid credentials |
| GET | `/api/auth/webauthn/credentials` | Lists active passkeys for authenticated Person. | 401 auth |
| DELETE | `/api/auth/webauthn/credentials` | Revokes registered passkey credential. | 401 auth; 400 validation; 404 passkey |
| POST | `/api/auth/webauthn/step-up` | Re-asserts passkey to elevate existing session assurance to AAL2. | 401 auth; 400 verification failure; 403 forbidden |

Pending capabilities are process-local and capacity bounded; restart/replica change
requires a fresh request. No database migration or production activation is claimed.

This appendix is the human-readable API inventory. The exact machine-readable
request/response schemas are generated by `GET /api/docs` from the live Zod
contracts. A row marked **implemented** must have a corresponding `src/app/api/**/route.js`
handler; a row marked **deferred** is a planned lifecycle contract and is not a
production capability or current route.

## Contract standard for every current endpoint

Each current endpoint is complete only when its owning feature note and live
OpenAPI contract answer all of the following:

| Contract field | Required rule |
|---|---|
| Method and path | exact method/path, including dynamic parameter names |
| Authentication and scope | trusted server viewer/session; Business/Project scope is resolved server-side |
| Request | query, path and body validation; client cannot choose authority or hidden scope |
| Success DTO | stable JSON shape or documented stream/download; no raw Prisma graph |
| Failure matrix | at least validation, auth, not-found/forbidden, unavailable and unexpected failure as applicable |
| Side effects | transaction, audit, external port and cache behavior are named; read routes declare no mutation |
| Limits | pagination/window, hard maximum and truncation semantics are explicit for collections |
| Idempotency/concurrency | retry behavior, unique constraints or version/CAS rule is explicit for mutations |
| Evidence | feature/ADR/SDD reference plus unit, integration or E2E proof where the contract is security-sensitive |

This appendix groups related routes to avoid a second hand-maintained schema
registry. The generated OpenAPI document is the exact request/response authority;
the tables below are the human contract and status authority.

## Scope

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/scope` | รายการ portfolio/tenant/business/workspace/project ทั้งหมด |
| POST | `/api/scope` | สร้าง scope entity: `{entity: portfolio\|tenant\|business\|workspace\|legalEntity\|branch, data}` |
| GET | `/api/viewer` | viewer gate สำหรับ Home: role + ธุรกิจ/โดเมนที่เห็นได้จาก `resolveViewer()` |
| GET | `/api/profile` | resolved local account, linked identity state, and local session boundary |
| PATCH/DELETE | `/api/workspaces/[id]` | แก้ไข / archive workspace |
| GET | `/api/business/strategy?businessId=` | Business-scoped Roadmap, two/three ordered goal horizons, and goal progress read model (FR-041) |
| GET | `/api/people?businessId=` | viewer-filtered Business People Directory over Employment, with system access derived from Membership (FR-042, FR-193) |
| POST | `/api/people/employment` | create an Employment record — an HR fact that grants no access of its own (FR-193, BR-034) |
| PATCH | `/api/people/employment/[employmentId]` | one named `action`: `on_leave`, `reinstate`, or `end` (which requires a `reason`). ENDED is terminal — a re-hire is a new row, never a reopened one (FR-193, ADR-078 D1) |

## Business Strategy mutation (FR-059)

OWNER-only writes. `src/modules/business` stays a read slice (SDD-032) — every
handler here delegates to `src/modules/project-manager/application/business-strategy-mutation-service.js`,
which records one `AuditEvent` per mutation and returns the same serialized
Roadmap/Goal shape the FR-041 GET already produces. A `BusinessRoadmap` always
has 2–3 `horizons`; a Goal↔Project link is rejected when the Project's owning
Business differs from the Goal's (FR-043 isolation, extended to writes).

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/business/roadmaps` | `{businessId, title, description?, status?, startAt?, targetAt?, horizons: [{key, label, position, description?, targetAt?}, ...]}` (2–3 entries) | serialized Roadmap |
| PATCH | `/api/business/roadmaps/[id]` | partial of the same fields; `horizons` present ⇒ reconciled by `key` (2–3 entries); removing a key that still has goals attached is refused, not silently orphaned | serialized Roadmap |
| POST | `/api/business/goals` | `{businessId, roadmapId?, horizonId, title, description?, status?, priority?, progress?, startAt?, targetAt?}` — `horizonId` is required | serialized Goal |
| PATCH | `/api/business/goals/[id]` | partial of the same fields; `horizonId`/`roadmapId` may move a Goal but never explicitly clear it | serialized Goal |
| POST | `/api/business/goals/[id]/projects` | `{projectId}` | serialized Goal (with the link); re-linking an already-linked Project is `409` |
| DELETE | `/api/business/goals/[id]/projects/[projectId]` | — | serialized Goal (without the link) |
| PATCH | `/api/businesses/[id]/capabilities` | `{version, capability: 'physicalStock', enabled}` — OWNER-scoped, expected-version CAS (FR-169) | `{id, version, capabilities: {physicalStock: boolean}}`; `409` on a stale `version`, `404` on an unknown Business, `400` if the viewer does not own it |
| PATCH | `/api/businesses/[id]/knowledge-candidates-toggle` | `{version, enabled, requestedBy, reason?}` — OWNER-scoped, expected-version CAS (FR-236, ADR-090 D6, TASK-ZAI-099); `requestedBy` records who asked, distinct from the acting principal | `{id, version, knowledgeCandidatesEnabled: boolean}`; `409` on a stale `version`, `404` on an unknown Business, `400` if the viewer does not own it or omits `requestedBy` |

Isolation failures (`Roadmap does not belong to Business`, `Horizon does not
belong to Business`, `Project does not belong to Business`, a mismatched
`horizonId`/`roadmapId` pair, or a duplicate horizon `key`/`position`) return
`400`. All six mutations also require the target Business to be in the
viewer's `visibleBusinessIds` (not just `role === 'OWNER'`, which is a global
grant) — see FR-059-business-strategy-mutation.md §1.

## Business Key Results (FR-268, ADR-101 D6 Phase 1)

OWNER-only writes, same authority as the Business Strategy mutations above
(D4 — narrower per-assignee check-in authority is a later FR). Every handler
delegates to `business-strategy-mutation-service.js`'s Key Result functions,
which record one `AuditEvent` per mutation and recompute the parent Goal's
`progress` in the same transaction once it holds a non-archived Key Result
(SDD-107, BR-044) — see FR-268's own feature note for the full contract.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/business/goals/[id]/key-results` | `{title, metric, unit, baseline, target, direction?, dueAt?, ownerPersonId?, confidence?}` — `target` must differ from `baseline` (FR-271 Measurable) | serialized Key Result |
| PATCH | `/api/business/key-results/[id]` | partial of the create fields, plus `status` (`ACTIVE`\|`ARCHIVED`) — archiving is this patch, there is no separate archive verb | serialized Key Result |
| POST | `/api/business/key-results/[id]/check-ins` | `{value, confidence, note?}` — `weekStartAt` is never a client field; the server buckets by `weekStartFor(now)` (Monday 00:00 Asia/Bangkok) and a second check-in the same week upserts rather than duplicating | serialized Key Result (current value, recomputed `progress`/`expectedProgress`, full `checkIns` history) |

A Key Result's `progress`/`expectedProgress`/`status` are never stored columns
— both are recomputed on every read from `(baseline, target, direction,
latest check-in)` (SDD-107), the same pure calculators the Key Result
list/modal UI uses for its live preview.

## Entry and Business Routing (FR-044 and FR-046 implemented beta)

`/login` authenticates an email or account code and password through
`PersonCredential`; successful login issues a signed expiring HttpOnly session and
Business Routing consumes the resulting viewer-scoped entry response. No local-demo
session capability or seeded-owner authentication fallback exists.

| Interface | Contract |
|---|---|
| `GET /api/viewer` | Compatibility endpoint resolved from the same trusted request session; not used by Business Routing. |
| `GET /api/scope` | Internal broad scope-management compatibility interface; entry surfaces do not request it. Production hardening remains separately gated. |
| `BusinessShell guard` | Not an API route: `/overview` and Business domain routes require an authorized `activeBusinessId`; missing selection resolves to `/businesses`, and missing viewer resolves to `/login`. |

The historical FR-044 routing slice did not choose an auth provider; its current
credential implementation is governed by FR-046 and ADR-017. Hosted OIDC, LINE Login,
account recovery, MFA and device management remain separate identity work.

## Verified channel onboarding and identity binding (FR-097 / ADR-045)

Verified channel onboarding and link token lifecycle binding external channel users
(such as LINE OA accounts) to canonical Tenant Person identities. Until an identity is
verified, channel users remain in `PENDING` status and sensitive agent tool executions
fail-closed (`IDENTITY_PENDING`).

| Method | Path | Contract |
|---|---|---|
| POST | `/api/identity/link-tokens` | Issues a single-use time-bounded (`ttlSeconds`, default 900) link token for a tenant/person. Requires authenticated viewer session (`401 AUTHENTICATION_REQUIRED`). Returns `{ token, tokenId, expiresAt }`. |
| POST | `/api/identity/link-tokens/redeem` | Single-use bearer token redemption binding channel account (LINE user) to canonical Person identity (`merge: true` re-points existing unlinked principal). Activates `ChannelIdentity` (`ACTIVE`, sets `verifiedAt` and `linkedAt`). Returns 400 if expired, already consumed, or invalid. |
| GET | `/api/identity/channel-identities` | Query verification status of a channel identity for given `tenantId` and `providerSubject` (optional `channelAccountId`, `channel='LINE'`). Returns `{ found, id, personId, status, verified, verifiedAt, linkedAt, revokedAt }`. |

## Meeting identity binding and action intake (FR-069 / ADR-025)

FUNG and Lalin AI publish meeting events with their own user identifiers. These
routes resolve those identifiers to the canonical Tenant `Person` before PM
work is created. The source application supplies only its provider and subject;
it never supplies a canonical `personId` for an action. Binding is an
owner-attested operation, and action intake is workspace-scoped, idempotent and
single-writer through the PlanEnvelope importer. Unresolved assignees remain
visible as PM review warnings rather than becoming an unverified assignment.

| Method | Path | Contract |
|---|---|---|
| POST | `/api/identity/meeting-bindings` | Owner/operator-attested `{ tenantId?, personId?, sourceApp: FUNG\|LALIN_AI, sourceUserId }` binding. Creates or reactivates a verified `ExternalIdentity` for the canonical Person; refuses an active subject already bound to another Person. |

## Project execution trace and replay (FR-069 / FR-070 / ADR-102)

Project Manager owns the durable run, ordered step and attempt evidence for
PlanEnvelope, bundle and meeting-action commits. The response is scope-filtered
to the requested Project and exposes bounded hashes, failure evidence, audit links
and replay lineage; it never exposes transcript/audio/provider secrets.

| Method | Path | Contract |
|---|---|---|
| GET | `/api/projects/[id]/execution-runs/[executionRunId]` | Returns the authorized PM execution run with ordered steps and attempts; a missing or out-of-scope run is indistinguishable from not found. |
| POST | `/api/projects/[id]/execution-runs/[executionRunId]/replay` | `{ mode: "full"\|"partial", stepKeys? }` replays the retained bounded PlanEnvelope snapshot into a new run with new execution IDs and source lineage; partial replay must include the commit step. |

## Project Manager approval gateway (FR-272 / ADR-103)

Effectful Agent/Fleet steps are admitted only through a PM-owned exact-hash
approval request. The browser can read the scoped reviewer projection and
submit a decision; request creation and executor admission remain application
service boundaries. The response never includes transcript, audio, provider
credentials, executable imported code or the short-lived executor receipt.

| Method | Path | Contract |
|---|---|---|
| GET | `/api/projects/[id]/execution-runs/[executionRunId]/approvals` | Returns `{ executionRunId, approvals[] }` for the authorized Project/run. Each row carries the immutable action/scope/effect/hash/expiry digest and bounded redacted summaries. |
| POST | `/api/projects/[id]/execution-runs/[executionRunId]/approvals/[approvalRequestId]/decision` | Body `{ decision: "APPROVE"\|"REJECT", reason? }`; re-resolves the reviewer capability in the Business scope, refuses requester self-approval, expiry and stale PM input, then records the CAS decision and AuditEvent. |

## Multi-Factor Authentication (TOTP) and Session Assurance (FR-094, FR-095, FR-096 / ADR-045)

P2 Enterprise IAM capabilities: RFC 6238 TOTP enrollment and challenge verification,
session assurance levels (AAL1 standard single-factor, AAL2 multi-factor), and time-bounded
step-up authentication elevation for sensitive administrative operations.

| Method | Path | Contract |
|---|---|---|
| POST | `/api/auth/mfa/totp/enroll` | Starts TOTP factor enrollment for current user. Generates 160-bit cryptographically secure Base32 secret and `otpauth://` URI. Requires active viewer session. Returns `{ factorId, secret, uri }`. |
| POST | `/api/auth/mfa/totp/verify` | Confirms enrollment with initial 6-digit TOTP code, activates factor (`ACTIVE`), and elevates current session to `AAL2`. Requires active viewer session. |
| GET | `/api/auth/mfa/factors` | Lists registered MFA factors for current user with secrets redacted. Requires active viewer session. Returns `{ factors: [{ id, type, label, status, verifiedAt, createdAt }] }`. |
| DELETE | `/api/auth/mfa/factors` | Revokes an MFA factor (`status: 'REVOKED'`). Body: `{ factorId }`. Requires active viewer session. |
| POST | `/api/auth/step-up` | Re-verifies user via active MFA challenge code and elevates current session to `AAL2` for a 15-minute window (`elevatedUntil`). Returns `{ elevated: true, assuranceLevel: 'AAL2', elevatedUntil }`. |

The factor secret is sealed at rest (SEC-029, ADR-088): the enrollment reply is the only response that ever carries it, and the stored column holds an AES-256-GCM envelope. No request or response shape changes. A production deployment without `ZURI_MFA_SECRET_KEY` answers the enroll, verify and step-up operations with 503 `MFA_SECRET_KEY_REQUIRED`; a factor whose stored value cannot be opened answers verify with 503 `MFA_SECRET_UNAVAILABLE` and cannot satisfy step-up (401).

## Plugin authentication and capability discovery (FR-123 / ADR-052)

The canonical public-client boundary for first-party Codex/Claude Code plugins.
Authorization starts from the existing trusted browser session; the plugin never
submits a password, copies `zuri_session` or treats `Mcp-Session-Id` as a grant.
Client id and redirect URI allowlists are environment configuration, matched
**exactly** — `localhost` and `127.0.0.1` are two registrations, not one — and
missing configuration fails closed with `503 PLUGIN_AUTH_CONFIG_MISSING`.

This is not FR-106's `ApiAccessKey`. That credential is a long-lived Tenant-bound
service key for the Enterprise API; a `PluginSession` is a 15-minute delegation
from one signed-in Person to one installation on their own machine.

| Method | Path | Contract |
|---|---|---|
| GET | `/api/plugin/auth/authorize` | renders, never acts (ADR-052 D4). A `302` to `/plugin/authorize` on this request's own origin, carrying the query string unchanged. Reads no session, touches no database, mints nothing — so a top-level GET navigation carrying the `SameSite=Lax` session cookie can no longer issue a code |
| POST | `/api/plugin/auth/authorize` | the consent screen's own form submission, and the only path that mints. Requires a trusted browser session, a session-bound anti-CSRF token, and an HMAC-signed request token (TTL 5 minutes) that is the **sole** source of the authorization parameters — the form carries no `client_id`, `redirect_uri`, challenge or state for the handler to trust. Every signed field is re-validated against live configuration before minting. `decision=approve` issues one hashed 60-second code and `303`s to the exact registered URI with the original `state`; `decision=deny` `303`s there with `error=access_denied` and the original `state`. `401 AUTH_REQUIRED` without a session; `400 INVALID_REQUEST` for a missing, foreign, tampered or expired token; `503 AUTH_UNAVAILABLE` when the session seam is down |
| POST | `/api/plugin/auth/token` | exchanges `{grant_type: authorization_code, code, client_id, redirect_uri, code_verifier, installation_id}`; atomically consumes the code and returns a 15-minute opaque bearer session with no refresh token and no Tenant/Business authority. Replaying a consumed code returns `400 INVALID_GRANT` **and** revokes the session that code already minted |
| GET | `/api/plugin/auth/capabilities` | requires the opaque bearer; resolves the Person through `resolveViewer` (without `platformGrant`); returns a bounded policy snapshot and server-derived capabilities only — never a mutation grant |
| POST | `/api/plugin/auth/revoke` | accepts `{token, token_type_hint?: access_token}`; hash-bound idempotent revoke answering identically whether or not the token existed |

Every response in the family carries `Cache-Control: no-store`, and no error echoes a
raw code, token or internal message. The consent screen at `/plugin/authorize` is a
page rather than an API route; it is `force-dynamic` and its response is no-store too,
because its markup carries the two consent tokens. `POST /token` and `POST /revoke` are structurally exempt
from preflight's route-viewer ratchet for the same reason `/api/auth/login` is:
their only credential is the one presented, and requiring a browser session there
would be the broken boundary.

Local implementation is verified by route/unit tests. Production client registration,
the Supabase migration, device proof-of-possession, live revocation/cross-tenant
evidence and a consent step on `GET /authorize` all remain gated.

## Platform Integrations management surface (FR-080 / ADR-032)

The metadata-only first slice is live in the local route tree. It is owner-only,
Business-scoped and never returns secret material:

### Current implemented endpoints

| Method | Path | Contract |
|---|---|---|
| GET | `/api/knowledge/sources` | FR-254: Business/optional Project, title/status, limit 1–100 and scope-bound cursor; current-authorized source metadata and runtime capabilities. No payload or hidden totals. |
| GET | `/api/knowledge/sources/[sourceId]` | FR-254: current-authorized immutable admission versions with cursor pagination; no source content. Existing DELETE unchanged. |
| GET | `/api/knowledge/console/runs` | FR-254: scoped FR-071 ledger runs, terminal statuses included; unlinked legacy runs remain Business-only. |
| GET | `/api/knowledge/console/runs/[executionRunId]` | FR-254: every reported attempt, gate metadata and verified publication identity; missing/inconsistent publication evidence is explicitly unavailable. |
| GET | `/api/knowledge/corpora` | FR-254: all authorized Business/Project corpora with current generation and cursor pagination. |
| GET | `/api/knowledge/corpora/[corpusId]/generations` | FR-254: validated immutable manifests projected to current-authorized source entries, current/historical generation and cursor. |
| GET | `/api/knowledge/citations/[citationId]/artifact` | FR-254: citation-bound kind=chunk/parsed/raw, exact retained lineage/hash verification and post-read authority recheck. Preview capped at 65,536 characters; download=true returns complete text/plain attachment with fixed filename, nosniff and private/no-store. No arbitrary artifact/path lookup. |
| GET | `/api/platform/integrations` | implemented: trusted Business-scoped provider/connection metadata and redacted Vault status |
| POST | `/api/platform/integrations` | implemented: create draft metadata with fixed `purpose=PHASE1_LINE_LLM`; accepts only `supabase-vault:<uuid>`; working tree implementation is local-only |
| GET | `/api/platform/integrations/line-registry` | implemented: trusted Business-scoped LINE Groups and Users registry with automation jobs |
| POST | `/api/platform/integrations/line-registry` | implemented: register or update LINE Group or User with automation schedules |

### Deferred lifecycle endpoints — not current routes

| Method | Path | Status and required boundary |
|---|---|---|
| PATCH | `/api/platform/integrations/[id]` | deferred: version/CAS guarded non-secret metadata update |
| POST | `/api/platform/integrations/[id]/secret` | deferred: write-only value to an approved external SecretManagerProvisionPort; returns version/expiry only |
| POST | `/api/platform/integrations/[id]/rotate` | deferred: audited rotation command; never returns old/new material |
| POST | `/api/platform/integrations/[id]/revoke` | deferred: external-manager revoke plus runtime-cache purge |
| POST | `/api/platform/integrations/[id]/promote` | deferred: audited connection CAS promotion; cannot enable LINE routing |

These five lifecycle paths are **deferred** and intentionally do not exist under
`src/app/api` yet. They must not be called, linked or counted as live endpoints
until their separate CAS/provisioner contracts, tests and production manager
evidence exist. There is intentionally no read-secret endpoint. The UI is owner-only under the
trusted viewer/Business ownership boundary and cannot activate a LINE binding or
replace FR-053/054/055 canary evidence.

## CRM conversation reader (FR-091 / SDD-049)

The read side of the LINE ingress. Both endpoints are `GET` and the module
behind them exports no writer: the reply owner is the edge runtime (BR-011) and
the only writer of these models is the ingest seam. `businessId` is required
rather than inferred — the question is whether THIS viewer, working in THIS
Business, may read, and a scope taken from the row being read is not a check.
The scope resolved is the **Tenant** of that Business (BR-001), narrowed to
conversations owned by no Business or by one already in the viewer's scope.

| Method | Path | Contract |
|---|---|---|
| GET | `/api/crm/conversations` | implemented: authorized conversation list for the Business's tenant — customer, channel, message count, last-message preview, owning-Business label, plus counts by direction and channel. `limit` is capped server-side at 200 and the response says whether it truncated |
| GET | `/api/crm/conversations/[id]` | implemented: one thread, messages oldest-first, with the customer behind it. A conversation outside the resolved scope answers **404**, never 403 — a "denied" would confirm the row exists |
| POST | `/api/crm/conversations/[id]/reply` | implemented: FR-246 — a Business **owner** sends a reply from the Inbox composer, pushed through the account's LINE transport (never the Reply API) and recorded OUTBOUND with reply source `STAFF`, idempotent on a caller-supplied `clientRequestId` (never the inbound message, so several staff messages may follow one inbound). Refused before any push for a viewer without owner authority, the legacy channel, or an account that is not server-enabled — nothing is recorded on a push LINE does not accept |
| GET | `/api/crm/conversations/search` | implemented: FR-233 third read-only reader — full-text search over `Message.body` (`pg_trgm` on Postgres, `LIKE` on SQLite), scoped to the viewer's visible Businesses within the Tenant `businessId` anchors, optionally to one LINE OA account (`channelAccountId`). A literal path segment ahead of `[id]/route.js`, so it never collides with a conversation id |
| GET | `/api/crm/conversations/event-counts` | implemented: FR-233 per-account follow/unfollow counts from `ConversationEvent`, same scope as search and the inbox |
| POST | `/api/crm/customers/[customerId]/consent` | implemented: FR-103 / SEC-005 PDPA consent attestation — a Business **owner** (not merely a Member) records `GRANTED`/`DECLINED` for a Customer reached through their own Business's tenant (BR-001). Writes only `Customer.consent*`; never touches Conversation or Message |
| POST | `/api/crm/customers/[customerId]/erasure` | implemented: FR-022 PDPA erasure — the production trigger for `erasePrincipal`, which until now had no route, UI or script. Same authority as the consent row above (per-Business **owner** over a Business in the Customer's tenant, BR-001) or the installation operator. Body `{ businessId, confirmation: 'ERASE' }`; any other confirmation is **400** and is checked before any lookup. Every authority refusal is **404**, indistinguishable from a fabricated id (FR-072) — an irreversible action must not double as an existence oracle. Revokes identities/sessions/link tokens, soft-deletes and redacts the Customer, deletes ConversationAnalysis, tombstones `Message.body` and the matching `RawExternalRecord` payloads in one transaction. The response carries counts only, never personal data |
| POST | `/api/crm/customers/[customerId]/chat-evidence/retrieve` | implemented: FR-245 chat evidence archive retrieval (ADR-093 D7, TASK-ZAI-112) — a per-Business **owner** over a Business in the Customer's tenant (BR-001), stepped up to **AAL2** through the same FR-224 gate credential rotation uses. Body `{ businessId, startDate, endDate, caseReference }` (both dates `YYYY-MM-DD`, `caseReference` required and free text). Recovers exactly the Customer's already-**archived** (retention-swept) messages in range, grouped by the `sessionId` `chat-evidence-archive-service.js` already writes into every archived line. Every manifest is re-checked against its own `manifestHash` and its file re-hashed against `fileSha256` before any line is trusted; a missing, unreadable or hash-mismatched manifest or file is reported in `missingMessageIds` rather than failing the whole retrieval. Every call — including an empty result — writes one `ARCHIVE_RETRIEVED` audit event naming the Customer, the range and the case reference. `403 ASSURANCE_LEVEL_INSUFFICIENT` below AAL2; `403` for a Business seen but not owned; `404` for an unknown Business or a Customer outside its tenant |
| POST | `/api/crm/customers/[customerId]/legal-hold` | implemented: SEC-034 legal hold on a Customer's chat evidence archive (ADR-093 D6, TASK-ZAI-113) — a per-Business **owner** over a Business in the Customer's tenant (BR-001); no AAL2 step-up, unlike retrieval above, because this writes a reason and a date rather than reading any archived content, and the erasure it defers has never required one either. Body `{ businessId, reason, endDate }` (`reason` non-empty free text, `endDate` a future `YYYY-MM-DD`); a past or same-day `endDate` is **400** before any lookup. Appends one new `CustomerLegalHold` row — a history, never an update — and writes one `LEGAL_HOLD_RECORDED` audit event. While unexpired (`now < endDate`), a later PDPA erasure of this Customer leaves their archive data key alone instead of destroying it, and the erasure's own response and audit event name the hold. `404` for a Business seen but not owned or for an unknown Business/Customer, same shape as the erasure and retrieval rows above |
| POST | `/api/agent/line-delivery` | implemented: transport delivery receipt endpoint recording outbound LINE reply messages into Conversation/Message history (FR-093 / SDD-051) |

### CRM retention sweep worker (FR-230, ADR-091 D1/D2, 2026-09-15)

The scheduled entry point for the nightly retention sweep (`retention-sweep-service.js`,
built by TASK-ZAI-089): until this route existed nothing in the running system ever
called it. Deployment-authenticated like the LINE worker and the programme usage
reports endpoint — the bearer is compared in constant time before any work happens,
and no browser viewer is resolved. Invoked once a day by
`scripts/server-retention-sweep-worker.mjs`, itself invoked by the host's own
scheduler (see `scripts/register-retention-sweep-task.ps1`) — not by an always-on
container.

| Method | Route | Contract | Failure |
|---|---|---|---|
| POST | `/api/crm/retention-sweep` | implemented (FR-230): under `Authorization: Bearer $ZURI_RETENTION_SWEEP_TOKEN` (at least 32 characters), runs the crm-owned slice of the nightly retention sweep across every Tenant and returns `{ auditEventId, countsByClass, alreadyRanToday }` — the exact per-class counts the sweep's own `RETENTION_SWEEP_COMPLETED` audit event carries, never message or customer content. A second call inside the same UTC day answers from the existing audit event (`alreadyRanToday: true`) instead of running the sweep or writing a second audit event, so a scheduler retry cannot double-count or duplicate the day's audit trail | `401 RETENTION_SWEEP_CREDENTIAL_REQUIRED`; `503 RETENTION_SWEEP_UNAVAILABLE` (database, or the sweep exceeded its own 10-minute bound) |

## Market Intelligence reader and translation trigger (FR-092 / SDD-049 / ADR-038)

The FR-092 translation seam's two surface-reachable endpoints. A `MarketObservation`
has exactly one writer — translation over Integration-owned raw evidence — and both
routes below respect that: the reader is `GET` only, and the trigger is the sole
route that calls it. `businessId` is required rather than inferred on both, and the
scope is exactly that Business within its Tenant; tenant-shared rows are **not**
folded in, because a MarketObservation inherits the Business of the connection
that produced it.

The trigger is an explicit, owner-initiated run over one Business's already-ingested
`MARKET_INTELLIGENCE` raw backlog — not a scheduler, and not a second acquisition
path. Automated/scheduled acquisition stays out of scope pending a source-specific
legal/ToS review (see the FR-092 feature note's "Decision 2026-09-02").

| Method | Path | Contract |
|---|---|---|
| GET | `/api/market/observations` | implemented: translated market observations for one Business, newest `observedAt` first — provider, source entity/external id, source URI, observation type, resolution status/confidence and the normalized candidate fields (title, price, currency, seller, condition) alongside the raw candidate object. `limit` defaults to 50 and is capped server-side at 200; the response carries `counts` (observations, distinct providers, by resolution status) and says whether it truncated. A Business the viewer cannot see answers **403**, an unknown Business **404** |
| POST | `/api/market/translations` | implemented: the production translation trigger. Body `{ businessId, limit? }` (`limit` defaults to 20, capped at 100); translates this Business's untranslated `MARKET_INTELLIGENCE` raw backlog (rows with no `MarketObservation` yet, by unique lineage key) and returns `{ translated, unchanged, failed: [{ rawRecordId, reason }] }`. Owner-only — a translation run is a write — and gated on `ownsBusiness`, not `seesBusiness`; a Business the viewer only sees, or does not own, answers **404** identically to a nonexistent one (no enumeration oracle). One audit event per run (`MarketObservation` / `MARKET_TRANSLATION_RUN`), never per row, and it never carries raw candidate payloads |
| GET, POST | `/api/internal/market-intelligence/v1/[operation]` | draft (ADR-108 D4): core's private `market-core.v1` façade for the separately running Market service. Bearer `MARKET_CORE_TOKEN` only; the end user is re-resolved from their own session token in `x-zuri-subject`, never from service-sent fields. GET `health` or `execution-ownership`; POST `authorize` (feed read: 403 not visible, 404 domain hidden/unknown; translation: identical 404), `raw-candidates` (re-authorizes the subject for translation and checks the tenant; `scanLimit` ≤ 500) and `audit` (counts-only `MARKET_TRANSLATION_RUN` event). Responses use the `{ contractVersion, ok, data }` envelope |

## Customer duplicate review queue (FR-078 / ADR-033)

The queue is a private, Business-scoped review surface for the 130 held
SmartGift rows. It exposes redacted evidence and stable review IDs only; it does
not publish Customers, replay LINE traffic or accept free-text PII notes.

| Method | Path | Contract |
|---|---|---|
| GET | `/api/platform/customer-import-reviews` | list the approved SmartGift review cases and redacted items; requires `customer.import.review.read` |
| GET | `/api/platform/customer-import-reviews/targets` | bounded, masked lookup of same-Business Customer targets for `LINK_EXISTING`; requires `customer.import.review.read` |
| POST | `/api/platform/customer-import-reviews/[caseId]/decisions` | append one decision per held item with optimistic `expectedVersion`; actions are `CREATE_SEPARATE`, `LINK_EXISTING`, `REJECT` or `DEFER`; requires `customer.import.review.decide` |
| GET | `/api/platform/sot/plan` | SoT pipeline plan with per-phase status derived from FR-071 run evidence + FR-100 pending counts, plus the FR-101 graph projection; viewer must see the Business (FR-099) |
| GET | `/api/platform/sot/decisions` | list SoT decisions (default filterable to PENDING) scoped to the viewer's visible Business (FR-100) |
| POST | `/api/platform/sot/decisions` | data-plane batch submit of pending decisions; installation-operator or an FR-102 data-plane key bound to the submitted tenantId, idempotent by canonical payload hash, changed payloads open a new decisionVersion (FR-100, FR-102) |
| POST | `/api/platform/sot/decisions/[decisionId]/decide` | approve or reject one PENDING decision; owner/operator authority, audited, immutable once decided (FR-100) |
| GET | `/api/platform/sot/decisions/export` | pull decided rows in stable (updatedAt,id) cursor order for the data plane to apply to its own stores; installation-operator or an FR-102 data-plane key bound to the queried tenantId (FR-100, FR-102, ADR-046) |

The decision endpoint is append-only and actor-bound. `CUSTOMER_DATA_REVIEWER`
is a separate Business-scoped role; Product Owner, platform authority and
customer-data contract approval do not imply review authority. The queue's
production target remains explicitly gated behind the reviewed private runtime
connection and the approved metadata-only apply step.

### Production-shaped boundary (FR-046 / ADR-017)

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/entry` | `200 { viewer, businesses[] }`; each Business embeds only its required Tenant/Portfolio ancestry | `401 { error: "AUTH_REQUIRED" }`; `503 { error: "SESSION_UNAVAILABLE" }` |
| POST | `/api/auth/login` | verifies `PersonCredential` and sets a signed HttpOnly SameSite=Lax session cookie | `401 { success: false, error: "INVALID_CREDENTIALS" }`; `503 { success: false, error: "AUTH_UNAVAILABLE" }` |
| POST | `/api/auth/logout` | clears the HttpOnly session cookie | `200 { success: true }` |
| POST | `/api/platform/users/password-resets` | implemented (FR-104): a Business owner over a Business the target belongs to, or the installation operator, mints a single-use one-hour reset token — the raw token appears exactly once, in this authenticated response, for out-of-band handover; stored digest-only | `401 AUTH_REQUIRED`; `403` for a viewer without authority over the target; `404 PERSON_NOT_FOUND` |
| POST | `/api/platform/users/memberships` | implemented (FR-038): the OWNER of a Business attaches an EXISTING Person to it — `{ businessId, identifier, domainKeys[] }`, where `identifier` matches `Person.code` or `Person.email` exactly — creating an ACTIVE `MEMBER` Membership with the chosen domain allow-list, audited as `MEMBERSHIP_ADDED`. Never creates a Person (FR-120 / FR-066 own that) and never grants OWNER (that stays the PATCH on `/api/platform/users`) | `404 Business not found` (also for a Business the caller does not own); `409 MEMBERSHIP_EXISTS`; `403` for a caller who owns no Business; `404 PERSON_NOT_FOUND` |
| POST | `/api/platform/users/memberships/[id]/lifecycle` | implemented (FR-191): withdraw or restore one grant — `{ action: SUSPEND / REINSTATE / REVOKE, reason, allowLast? }`. Suspend and revoke cascade to the dependent `RoleBinding` rows (tagged `cascadeOfMembershipId`, so reinstate restores exactly what this grant took down); revoke stamps `revokedAt`, `revokedByPersonId` and `revokeReason` on the row and never deletes it. Authority is `ownsBusiness` for a BUSINESS-scoped grant and `ownsTenant` for a TENANT-scoped one | `404` for a scope the caller does not own AND for a membership that does not exist, byte-identical (SEC-001); `409 LAST_OWNER`; `409 ALREADY_SUSPENDED` / `ALREADY_ACTIVE` / `ALREADY_REVOKED`; `409 REVOKED_IS_TERMINAL`; `400 REASON_REQUIRED`; `400 UNKNOWN_ACTION` |
| POST | `/api/platform/users/offboard` | implemented (FR-191): withdraw every live grant one person holds in a Tenant — `{ personId, tenantId, reason }` — in one transaction, revoking their `Membership` and `RoleBinding` rows and their sessions, and writing both a `PERSON/OFFBOARDED` event and per-grant events. The last-owner guard does not apply: offboarding is deliberate | `404` for a Tenant the caller does not own; `400 REASON_REQUIRED` |
| GET | `/api/platform/access-history?businessId=\|tenantId=\|personId=` | implemented (FR-199): events in the MEMBERSHIP, ROLE_BINDING, ACCESS_INVITE and access-related PERSON families for exactly one scope, newest first, each with `before`/`after` state and the actor joined to `{ id, code, displayName }`. Authority is `ownsBusiness` for a Business, `ownsTenant` for a Tenant, yourself for your own history (`personId` equal to the caller), or the installation operator | `400 EXACTLY_ONE_SCOPE_REQUIRED`; `404` for a scope the caller does not own, byte-identical to one that does not exist (SEC-001) |
| GET | `/api/platform/businesses/[businessId]/grants` | implemented (FR-199): every grant in this Business in every status — current state, not the event stream — with provenance (`grantedBy`, `grantReason`, `grantSource`, `revokedBy`, `revokeReason`). The "who has access right now, and who gave it to them" table no surface produced before this | `404 Business not found` (also for a Business the caller does not own) |
| GET | `/api/platform/api-access-keys` | implemented (FR-106): the installation operator, or an owner in a Tenant, lists the keys of the Tenants they may govern → `{ tenants: [{ id, code, name }], keys: [{ id, label, tenantId, keyPrefix, status, createdAt, revokedAt, lastUsedAt }] }`. Metadata only — `keyHash` is never selected and nothing the secret could be rebuilt from is returned; `keyPrefix` is the 8-character display prefix. Scoped by exactly the authority that mints and revokes | `403 API access keys require operator or Tenant owner authority` |
| POST | `/api/platform/edge-devices/credentials` | implemented (FR-144): a Business OWNER, or the installation operator, pairs a Zuri Edge Device with one Business — `{ businessId, deviceId, label }` mints an `edgk_` bearer whose raw value appears exactly once, in this response, for handover to the device's own local configuration (ADR-041 D3 keeps every edge secret off the cloud console). Stored as a SHA-256 lookup hash plus an 8-character display prefix; audited without key material | `404 Business not found` — also for a Business the caller does not own (FR-072(a)); `400` for a missing businessId, deviceId or label |
| GET | `/api/platform/edge-devices/credentials?businessId=` | implemented (FR-144): the Business's credentials as metadata only — `{ id, deviceId, label, keyPrefix, status, createdAt, lastUsedAt, revokedAt, revokeReason }`. `keyHash` is never selected and no returned field could rebuild a key; a REVOKED row stays listed so an operator can see what was withdrawn | `404 Business not found` |
| DELETE | `/api/platform/edge-devices/credentials/[id]` | implemented (FR-144): revocation by the authority that minted; takes effect on the device's next request with no grace period, and is audited. Revoking twice records one event | `404 Business not found` — an unknown id and a credential outside the caller's Businesses answer identically |
| POST | `/api/platform/api-access-keys` | implemented (FR-106): the installation operator or an owner in the named Tenant mints a Tenant-bound Enterprise API key — the raw `apik_...` secret appears exactly once, in this authenticated response; stored digest-only, audited without token material, never readable back | `401 AUTH_REQUIRED`; `403` for a viewer without operator/Tenant-owner authority; `404 TENANT_NOT_FOUND` (operator only — authority is checked first) |
| DELETE | `/api/platform/api-access-keys/[id]` | implemented (FR-106): same authority as minting, against the key's own Tenant; revocation takes effect on the next request and is audited → `{ id, revoked }` | `401 AUTH_REQUIRED`; `404 API_ACCESS_KEY_NOT_FOUND` for an unknown id and for a key outside the viewer's authority alike (no enumeration oracle) |
| POST | `/api/auth/reset-password` | implemented (FR-104), public: `{ token, newPassword }` sets a new `PersonCredential`, burns the token and revokes every active Session | `400 { error: "INVALID_OR_EXPIRED_TOKEN" \| "PASSWORD_INVALID" \| "TOKEN_AND_PASSWORD_REQUIRED" }` — one generic token failure across unknown/used/expired |
| POST | `/api/auth/signup` | implemented (FR-120), public: `{ displayName, email, password }` creates a `Person` + `PersonCredential`, signs the caller in through FR-046's own minting path with a browser-session cookie (no `maxAge`, AC-046-15's default), and returns `redirect: "/onboarding/profile"`. Grants nothing — no `PlatformGrant`, Tenant, Business, Space, Project or `WorkspaceMembership`. A committed account whose session could not be minted still returns `201 { success: true, session: false, redirect: "/login" }` rather than claiming signup failed | `409 { error: "EMAIL_TAKEN" }` — named plainly, since with no mail transport there is no "check your inbox" to hide it behind (FR-120); `400 { error: "EMAIL_INVALID" \| "DISPLAY_NAME_REQUIRED" \| "PASSWORD_INVALID" }`; `429 { error: "RATE_LIMITED" }` with `Retry-After`; `503 { error: "SIGNUP_UNAVAILABLE" }` |

### Profile-first onboarding and Workspace collaboration (FR-066 / FR-067)

All seven handlers resolve a trusted viewer first (SEC-014); the mutation
subject is always the session principal, never a body claim. "Workspace" here is
the top-level collaboration container, schema `Portfolio` (ADR-027 §D2).

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/onboarding/state` | `200 { profile, nextStep, workspaces[], pendingInvites[], hasBusinessAccess }` — the person's own invites and joined Workspaces only (AC-066.3); no scope inventory | `401 AUTH_REQUIRED`; `503 SESSION_UNAVAILABLE` |
| POST | `/api/onboarding/profile` | `{ displayName, email? }` completes/updates the Profile over the session's own Person; first completion stamps `profileCompletedAt` | `400` validation (the strict schema refuses a body principal claim); `401 AUTH_REQUIRED` |
| POST | `/api/onboarding/workspaces` | `{ name }` creates a top-level Workspace (Portfolio) plus an OWNER WorkspaceMembership in one transaction; zero Tenant/Business/Space/Project rows (AC-066.2) | `403 PROFILE_REQUIRED` before Profile completion; `401 AUTH_REQUIRED` |
| POST | `/api/workspace-invites` | Workspace/Tenant-owner authority mints a single-use, expiring invite; the raw token appears exactly once in this response and is stored digest-only (SEC-014) | `404 Workspace not found` for absent and unauthorized alike; `400 INVITE_ROLE_NOT_ALLOWED` — OWNER is never mintable |
| POST | `/api/workspace-invites/accept` | `{ token }` plus the session principal becomes an audited ACTIVE WorkspaceMembership with the server-decided role | `400 { error: "INVALID_OR_EXPIRED_INVITE" }` — one generic refusal across unknown/replayed/revoked/expired/wrong-target |
| DELETE | `/api/workspace-invites/[id]` | revokes a PENDING invite (same authority as mint); the token then fails the next acceptance closed | `404 Invite not found`; `409 INVITE_NOT_PENDING` |
| GET | `/api/workspace-memberships?portfolioId=…` | Workspace owner roster (FR-067): ACTIVE members (`personId`, `code`, `displayName`, `role`, `joinedAt`, `isSelf` marked by the server) and still-PENDING invites (`id`, `role`, `invitedEmail`, `targetPersonId`, `targetName`, `expiresAt`, `createdAt`); same Workspace-owner authority as mint/revoke/remove; read-only, returns no token material, records no audit event | `404 Workspace not found` — also for a non-owner (ADR-027 D9) |
| DELETE | `/api/workspace-memberships?portfolioId=…&personId=…` | flips the membership to REMOVED, audited; the next protected read re-derives from the row (AC-067.7) | `404 Membership not found`; `404 Workspace not found` without owner authority |

Contract constraints:

- identity is resolved by a trusted server `SessionPort`; client principal, role,
  platform grant, visible IDs and domains are never inputs;
- `/businesses` uses this response alone and stops requesting `/api/viewer` plus
  `/api/scope`;
- authenticated empty scope is `200` with `businesses: []`, not `401`;
- response excludes Membership, Workspace, Project, Branch, LegalEntity, hidden
  Business and unrelated ancestry rows;
- `/api/viewer` remains compatibility-only and must use the same trusted request
  session; `/api/scope` remains outside the pre-shell routing contract;
- no concrete login provider or session persistence model is selected by FR-046.

## LINE OA Studio accounts (FR-146 / ADR-060)

The first runtime surface of the `line-oa-studio` domain: the `LineOaAccount`
aggregate — one LINE Official Account operated by one Business, many per
Business. Reading needs Business visibility plus the `line-oa` domain grant
(FR-061); writing needs Business OWNER or the `LINE_OA_PUBLISHER` role. Every
refusal is `404 Business not found` (FR-072), so the surface enumerates neither
Businesses nor accounts. No operation here reads, returns or creates credential
material, and none activates LINE routing (ADR-020); `health` is computed from
the integration lane's redacted read model and the agent lane's FR-147 binding
contract — `binding.status` is `ACTIVE`, `NOT_ACTIVE`, `NO_BINDING` or
`UNKNOWN` (no LINE runtime database configured in the process), with the reason
in `health.sources.binding`; `effectiveStatus` is `LIVE` only on `ACTIVE`.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/line-oa/accounts?businessId=&includeArchived=` | implemented (FR-146): `{ businessId, accounts[] }` — the Business's accounts (archived ones only with `includeArchived=true`), default first, each with `status`, derived `effectiveStatus`, `transportMode`, `version` and computed `health` (connection status/secret readiness/last webhook receipt, binding status, `transportJobs: null`, `quota: null`, `sources`) | `404 Business not found` (unknown, invisible, or without the `line-oa` grant); `400 LINE_OA_BUSINESS_REQUIRED` |
| POST | `/api/line-oa/accounts` | implemented (FR-146): `{ businessId, integrationConnectionId, code, displayName, basicId?, bindingCode?, transportMode?, isDefaultForBusiness?, botProfile? }` connects an existing same-Business `LINE_OA` connection as an account — `code` unique per Tenant, one account per connection, one binding code per Tenant; `transportMode` defaults to `EDGE` when the Business holds an ACTIVE `EdgeDeviceCredential` (FR-144) and `CLOUD` otherwise; the Business's first account becomes its default; status `CONNECTED` when a binding code is given, else `DRAFT`. Audited as `LINE_OA_ACCOUNT_CONNECTED` with the transport-mode source | `404 Business not found` (also a viewer without publish authority); `404 Integration connection not found` (unknown, foreign-Tenant or non-LINE connection); `409 LINE_OA_CONNECTION_OUTSIDE_BUSINESS \| LINE_OA_CONNECTION_ALREADY_BOUND \| LINE_OA_ACCOUNT_CODE_TAKEN \| LINE_OA_BINDING_CODE_TAKEN`; `400` validation (strict schema: no status, tenant or unknown field rides in) |
| GET | `/api/line-oa/accounts/[id]` | implemented (FR-146): one account with computed `health`; `effectiveStatus` is `LIVE` only when the stored status is `CONNECTED` and the binding reader reports `ACTIVE` | `404 Business not found` — an unknown id and an account in a Business the viewer may not see answer identically |
| PATCH | `/api/line-oa/accounts/[id]` | implemented (FR-146): `{ action, version, transportMode? }` applies one versioned action under publisher authority — `PAUSE` (CONNECTED → PAUSED), `RESUME` (PAUSED → CONNECTED), `ARCHIVE` (any non-terminal → ARCHIVED, clears the default), `SET_DEFAULT` (moves the Business's single default), `CONFIGURE_EXECUTION` (the delivery policy `allowDelayedPush`; it fences queued work). `SWITCH_TRANSPORT_MODE` is **withdrawn** (FR-265, ADR-100 D1) — CLOUD is the only transport owner, so there is nothing to switch between. The update is a compare-and-swap on `(id, version)`; each action writes one audit row without secrets or customer content. There is no DELETE: archiving keeps the row | `404 Business not found`; `409 LINE_OA_ACCOUNT_VERSION_CONFLICT \| LINE_OA_ACCOUNT_TRANSITION_INVALID \| LINE_OA_ACCOUNT_ARCHIVED \| LINE_OA_ACCOUNT_ALREADY_DEFAULT`; `400` validation (`version` required; `allowDelayedPush` required for `CONFIGURE_EXECUTION`; a withdrawn action is refused by the enum) |

## LINE OA Studio rich menus (FR-151 / ADR-060)

The rich menu designer's data for one account: a `LineOaRichMenu` (identity,
alias, default flag) with numbered `LineOaRichMenuVersion` bodies. Reading needs
Business visibility plus the `line-oa` domain (FR-061); writing needs Business
OWNER or `LINE_OA_PUBLISHER`; every refusal is `404 Business not found` (FR-072).
Nothing here talks to LINE: publishing a frozen version, setting the default,
aliases and links are transport jobs of a later slice, and `externalRichMenuId`
stays `null` until that lane writes it.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/line-oa/rich-menus?accountId=&includeArchived=` | implemented (FR-151): `{ accountId, richMenus[] }` — the account's menus (archived only with `includeArchived=true`), default first, each with `status`, `version`, `latestVersionNumber` and `versions[]` (each version with its body, `status`, `issues[]` — what still blocks a freeze — and `externalRichMenuId`) | `404 Business not found` (unknown or invisible account, or no `line-oa` grant) |
| POST | `/api/line-oa/rich-menus` | implemented (FR-151): `{ accountId, code, name, alias?, draft }` creates a menu with version 1 as DRAFT. `draft = { layout, chatBarText (≤14), selected?, imageFileAssetId?, imageWidth, imageHeight, areas[] (≤20, each { bounds, action }) }`; `action.type` is one of MESSAGE / POSTBACK / URI (https or tel) / LIFF / RICHMENU_SWITCH with only that type's fields. A draft may be saved with issues; the image must be a same-Business, live PNG/JPEG `FileAsset` ≤ 1 MiB. Audited as `LINE_OA_RICH_MENU_CREATED` | `404 Business not found` (also a viewer without publish authority); `404 Image file not found` (unknown, foreign-Business or deleted); `409 LINE_OA_ACCOUNT_ARCHIVED \| LINE_OA_RICH_MENU_CODE_TAKEN \| LINE_OA_RICH_MENU_ALIAS_TAKEN`; `422 LINE_OA_RICH_MENU_IMAGE_MIME_UNSUPPORTED \| LINE_OA_RICH_MENU_IMAGE_TOO_LARGE`; `400` validation (strict schema) |
| GET | `/api/line-oa/rich-menus/[id]` | implemented (FR-151): one menu with all versions | `404 Business not found` — unknown id and invisible Business answer identically |
| PATCH | `/api/line-oa/rich-menus/[id]` | implemented (FR-151): `{ action, version, draft?, name?, alias? }` — `SAVE_DRAFT` (edits the open DRAFT in place, or opens the next numbered version when the latest is FROZEN; may rename or re-alias), `FREEZE` (the open DRAFT becomes FROZEN and immutable; the menu becomes READY), `ARCHIVE` (retires the open draft, keeps frozen versions, clears the default). Compare-and-swap on `(id, version)`; one audit row per action, a second on the frozen version. No DELETE | `404 Business not found`; `409 LINE_OA_RICH_MENU_VERSION_CONFLICT \| LINE_OA_RICH_MENU_ARCHIVED \| LINE_OA_RICH_MENU_NO_DRAFT \| LINE_OA_RICH_MENU_ALIAS_TAKEN`; `422 LINE_OA_RICH_MENU_NOT_FREEZABLE` (with the blocking issues); `400` validation (`draft` required for SAVE_DRAFT) |

## LINE OA Studio rich menu publish jobs (FR-152 / ADR-061)

The server-owned lane that carries a frozen rich menu version to LINE. A
publisher queues a job; the server worker executes it on its own tick through
the Integration lane's rich menu port; the routes here never call LINE and
never return a token. Reading needs Business visibility plus the `line-oa`
domain (FR-061); queueing and acknowledging need Business OWNER or
`LINE_OA_PUBLISHER`; every refusal is `404 Business not found` (FR-072).

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/line-oa/rich-menus/[id]/jobs` | implemented (FR-152): `{ richMenuId, jobs[] }` newest first — each with `kind`, `stage`, `status`, `attempts`, `availableAt`, `expiresAt`, `externalRichMenuId`, `providerRequestId`, `errorCode`, `correlationId`, `version` | `404 Business not found` |
| POST | `/api/line-oa/rich-menus/[id]/jobs` | implemented (FR-152): `{ kind, version }` queues one job — `PUBLISH` (the newest FROZEN version), `SET_DEFAULT` or `SET_ALIAS` (a PUBLISHED version with an external id; alias needs the menu's `alias`) — on an account that is CONNECTED, CLOUD and `serverEnabled`; `version` is the menu's compare-and-swap and moves on success. Audited `LINE_OA_RICH_MENU_JOB_QUEUED` | `404 Business not found`; `409 LINE_OA_RICH_MENU_VERSION_CONFLICT \| LINE_OA_RICH_MENU_ARCHIVED \| LINE_OA_ACCOUNT_SERVER_NOT_ENABLED \| LINE_OA_RICH_MENU_JOB_OPEN \| LINE_OA_RICH_MENU_NO_FROZEN_VERSION \| LINE_OA_RICH_MENU_NOT_PUBLISHED \| LINE_OA_RICH_MENU_NO_ALIAS`; `422 LINE_OA_RICH_MENU_LIFF_UNRESOLVED \| LINE_OA_RICH_MENU_NO_AREAS`; `400` validation |
| PATCH | `/api/line-oa/rich-menus/[id]/jobs` | implemented (FR-152): `{ jobId, version, acknowledgePossibleOutcome: true }` closes an `UNKNOWN` job as `CANCELLED` (`OPERATOR_ACKNOWLEDGED_UNKNOWN`) without claiming the menu exists or does not on LINE; the menu may be queued again | `404 Business not found`; `409 LINE_OA_RICH_MENU_JOB_VERSION_CONFLICT`; `400` validation |
| POST | `/api/line-oa/rich-menu-worker` | implemented (FR-152): one bounded worker tick under `Authorization: Bearer $ZURI_LINE_WORKER_TOKEN` (the FR-149 bearer) — expires and unleases, then claims the oldest due job, fences on the account, resolves the credential, executes one stage set and settles; returns `{ status: IDLE \| ACCEPTED \| QUEUED \| FAILED \| UNKNOWN \| CANCELLED \| FENCED \| CONTENDED, id?, stage? }` | `401 WORKER_CREDENTIAL_REQUIRED`; `503 LINE_WORKER_UNAVAILABLE` (server transport disabled or secret mount unavailable) |

## LINE OA Studio LIFF app registry (FR-153)

The per-account registry of LIFF apps. Reading needs Business visibility plus
the `line-oa` domain (FR-061); writing needs Business OWNER or
`LINE_OA_PUBLISHER`; every refusal is `404 Business not found` (FR-072).
Nothing here calls LINE: the `liffId` is recorded from LINE Developers, and
its only use is resolution — a rich menu `LIFF` action publishes through an
ACTIVE app as `https://liff.line.me/{liffId}{path}`.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/line-oa/liff-apps?accountId=&includeArchived=` | implemented (FR-153): `{ accountId, liffApps[] }` — each with `code`, `name`, `description`, `viewSize`, `endpointUrl`, `scopes[]`, `botPrompt`, `status` (DRAFT / ACTIVE / ARCHIVED), `liffId`, `liffUrl`, `version` | `404 Business not found` |
| POST | `/api/line-oa/liff-apps` | implemented (FR-153): `{ accountId, code, name, endpointUrl (https), description?, viewSize?, scopes?, botPrompt?, liffId? }` registers an app — DRAFT without a `liffId`, ACTIVE with one. Audited `LINE_OA_LIFF_APP_REGISTERED` | `404 Business not found` (also a viewer without publish authority); `409 LINE_OA_ACCOUNT_ARCHIVED \| LINE_OA_LIFF_APP_CODE_TAKEN \| LINE_OA_LIFF_ID_TAKEN`; `400` validation (strict schema; `liffId` must look like `1234567890-AbCdEfGh`) |
| GET | `/api/line-oa/liff-apps/[id]` | implemented (FR-153): one app | `404 Business not found` |
| PATCH | `/api/line-oa/liff-apps/[id]` | implemented (FR-153): `{ action, version, fields?, liffId? }` — `UPDATE` (any of the registration fields), `RECORD_LIFF_ID` (records the id, activates the app), `ARCHIVE`. Compare-and-swap on `(id, version)`; one audit row per action. No DELETE | `404 Business not found`; `409 LINE_OA_LIFF_APP_VERSION_CONFLICT \| LINE_OA_LIFF_APP_ARCHIVED \| LINE_OA_LIFF_ID_TAKEN`; `400` validation |

## Inventory — catalogue and stock ledger (FR-154, FR-155)

The Inventory domain (คลังสินค้า, `DOM-INVENTORY`). Every route takes the
Business as a selector (`businessId` in the query or body) that the service
validates against the trusted viewer. Reading needs Business visibility plus
the `inventory` domain (FR-061); writing needs Business OWNER or
`INVENTORY_MANAGER`; every refusal of scope is `404 Business not found`
(FR-072); a reference to a row of another Business is `422` by code. Every
write is one transaction with one audit row. Nothing is deleted.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/inventory/categories?businessId=` | implemented (FR-154): the Business's categories (`code`, `nameTh`, `nameEn`, `slug`, `vibe`, `targetRecipient`, `guardrail`, `status`, `version`) | `404 Business not found` |
| POST | `/api/inventory/categories` | implemented (FR-154): `{ businessId, code, nameTh, nameEn, slug?, vibe?, targetRecipient?, guardrail? }`. Audited `INVENTORY_CATEGORY_CREATED` | `404`; `409 INVENTORY_CATEGORY_CODE_TAKEN \| INVENTORY_CATEGORY_SLUG_TAKEN`; `400` validation |
| GET | `/api/inventory/families?businessId=` | implemented (FR-154): product families | `404` |
| POST | `/api/inventory/families` | implemented (FR-154): `{ businessId, code, name, description? }`. Audited `PRODUCT_FAMILY_CREATED` | `404`; `409 PRODUCT_FAMILY_CODE_TAKEN`; `400` |
| GET | `/api/inventory/factories?businessId=` | implemented (FR-154): factories | `404` |
| POST | `/api/inventory/factories` | implemented (FR-154): `{ businessId, code, name, country?, contact? }`. Audited `FACTORY_CREATED` | `404`; `409 FACTORY_CODE_TAKEN`; `400` |
| GET | `/api/inventory/product-masters?businessId=&categoryId=` | implemented (FR-154): product masters with `specs` parsed | `404` |
| POST | `/api/inventory/product-masters` | implemented (FR-154): `{ businessId, code, categoryId, familyId?, factoryId?, nameTh, nameEn, baseCost?, specs? }`. Audited `PRODUCT_MASTER_CREATED` | `404`; `409 PRODUCT_MASTER_CODE_TAKEN`; `422 INVENTORY_CATEGORY_NOT_FOUND \| PRODUCT_FAMILY_NOT_FOUND \| FACTORY_NOT_FOUND`; `400` |
| GET | `/api/inventory/products?businessId=&productMasterId=&includeArchived=&stockPolicy=&status=&nature=` | implemented (FR-154, FR-201, FR-205): SKUs with `stockPolicy` (TRACKED / UNTRACKED / SERVICE), `trackingMode` (NONE / LOT / SERIAL), `status` (ACTIVE / PHASE_OUT / ARCHIVED), `safetyStock`, `variant` / `variantKey`, `mergedIntoProductId`, `reorderPoint` / `reorderQty` / `leadTimeDays`, `version`; archived rows on request only; `nature` narrows by the master's nature | `404` |
| POST | `/api/inventory/products` | implemented (FR-154, FR-201, FR-202, FR-207): `{ businessId, code, productMasterId, name?, color?, material?, unit?, stockPolicy?, trackingMode?, safetyStock?, variant?, reorderPoint?, reorderQty?, leadTimeDays?, allowLookalike? }` — the policy is derived from the master's nature (a SERVICE master yields SERVICE, a GOOD master refuses it), the variant is keyed against the master's axes, and policy and mode are fixed from here on. Audited `PRODUCT_CREATED` | `404`; `409 PRODUCT_CODE_TAKEN \| PRODUCT_MASTER_ARCHIVED \| INVENTORY_PRODUCT_VARIANT_EXISTS \| INVENTORY_PRODUCT_LOOKALIKE`; `422 PRODUCT_MASTER_NOT_FOUND \| INVENTORY_NATURE_MISMATCH \| INVENTORY_VARIANT_AXES_INCOMPLETE \| INVENTORY_VARIANT_AXIS_UNKNOWN`; `400` |
| GET | `/api/inventory/products/[id]` | implemented (FR-154): one SKU with `onHand` recomputed from the ledger (`null` when UNTRACKED or SERVICE), its `variant` and `mergedIntoProductId` | `404 Business not found` |
| PATCH | `/api/inventory/products/[id]` | implemented (FR-154, FR-205): `{ action, version, fields?, into?, reason? }` — `UPDATE` (`name`, `color`, `material`, `unit`, `safetyStock`, `variant`, `reorderPoint`, `reorderQty`, `leadTimeDays`), `ARCHIVE` (refused while stock or a live reservation remains), `PHASE_OUT` (receipts refused from then on), `REACTIVATE`, or `MERGE { into }` (stock moves through the ledger, references move to the survivor, the duplicate ends ARCHIVED pointing at it). Compare-and-swap on `(id, version)`; one audit row per action, two for a merge. No DELETE | `404`; `409 PRODUCT_VERSION_CONFLICT \| PRODUCT_ARCHIVED \| INVENTORY_PRODUCT_PHASED_OUT \| INVENTORY_PRODUCT_HAS_STOCK \| INVENTORY_PRODUCT_HAS_RESERVATIONS \| INVENTORY_PRODUCT_MERGED \| INVENTORY_PRODUCT_ALREADY_ACTIVE \| INVENTORY_MERGE_* \| INVENTORY_PRODUCT_VARIANT_EXISTS \| INVENTORY_PRODUCT_LOOKALIKE`; `422 INVENTORY_MERGE_TARGET_NOT_FOUND \| INVENTORY_PRODUCT_IS_A_SERVICE`; `400` |
| GET | `/api/inventory/bundles?businessId=` | implemented (FR-154): bundles with `items[]` and `availableSets` — complete sets the ledger allows (`null` when no item is counted) | `404` |
| POST | `/api/inventory/bundles` | implemented (FR-154): `{ businessId, code, name, description?, targetRecipients?, totalPrice?, items: [{ productId, qty }] }`. Audited `PRODUCT_BUNDLE_CREATED` | `404`; `409 PRODUCT_BUNDLE_CODE_TAKEN \| PRODUCT_ARCHIVED`; `422 PRODUCT_NOT_FOUND`; `400` |
| GET | `/api/inventory/lots?businessId=&productId=` | implemented (FR-155): lots (`code`, `factoryId`, `manufacturedAt`, `expiresAt`, `receivedQty`, `status` OPEN / QUARANTINE / CLOSED) | `404` |
| POST | `/api/inventory/lots` | implemented (FR-155): `{ businessId, productId, code, factoryId?, manufacturedAt?, expiresAt?, status? }` for a LOT- or SERIAL-tracked SKU. Audited `PRODUCT_LOT_CREATED` | `404`; `409 PRODUCT_LOT_CODE_TAKEN`; `422 INVENTORY_PRODUCT_NOT_FOUND \| INVENTORY_LOT_NOT_TRACKED \| FACTORY_NOT_FOUND`; `400` |
| GET | `/api/inventory/serial-units?businessId=&productId=&lotId=&status=` | implemented (FR-155): serial units (`serialNo`, `lotId`, `status`). Read-only — units are born and moved by the ledger | `404` |
| GET | `/api/inventory/stock-movements?businessId=&productId=&limit=` | implemented (FR-155): the most recent ledger rows (default 200, max 500), newest first | `404` |
| POST | `/api/inventory/stock-movements` | implemented (FR-155): `{ businessId, productId, kind: RECEIPT \| ISSUE \| ADJUSTMENT, quantity, lotId? \| lotCode?, serialNos?, reason?, reference?, occurredAt? }` → `{ productId, kind, quantity (signed), onHandBefore, onHandAfter, lotId, movements[] }`. Audited `STOCK_<KIND>_RECORDED` (+ `SERIAL_UNIT_RECEIVED` / `SERIAL_UNIT_ISSUED` per serial) | `404`; `409 INVENTORY_PRODUCT_ARCHIVED \| INVENTORY_INSUFFICIENT_STOCK \| PRODUCT_LOT_CLOSED \| INVENTORY_SERIAL_ALREADY_IN_STOCK \| INVENTORY_SERIAL_NOT_IN_STOCK`; `422 INVENTORY_PRODUCT_NOT_FOUND \| INVENTORY_PRODUCT_UNTRACKED \| INVENTORY_LOT_REQUIRED \| INVENTORY_LOT_NOT_TRACKED \| PRODUCT_LOT_NOT_FOUND \| INVENTORY_SERIAL_NOT_TRACKED \| INVENTORY_SERIAL_COUNT_MISMATCH \| INVENTORY_SERIAL_DUPLICATE \| INVENTORY_SERIAL_ADJUSTMENT_NOT_ALLOWED`; `400` |
| GET | `/api/inventory/stock?businessId=&includeArchived=` | implemented (FR-155): `{ businessId, products: [{ productId, code, stockPolicy, trackingMode, unit, safetyStock, onHand (null when UNTRACKED), belowSafetyStock }], counts: { products, tracked, untracked, services, phaseOut, belowSafetyStock, belowReorderPoint } }` — since FR-201 `untracked` excludes services and `services` is its own count; each row also carries `status`, `reorderPoint` and `belowReorderPoint` (FR-205, FR-207) — on-hand recomputed on this read | `404` |
| GET | `/api/inventory/recipes?businessId=&productId=&includeArchived=` | implemented (FR-156): recipes with `lines[]` (`componentProductId`, `qty` per batch, `unit`, `fixed`, `note`), `batchSize`, `yieldQty`, `status`, `version` | `404` |
| POST | `/api/inventory/recipes` | implemented (FR-156): `{ businessId, code, productId, name, batchSize, yieldQty?, unit?, notes?, lines: [{ componentProductId, qty, unit?, fixed?, note? }] }` — one recipe per (product, batchSize). Audited `PRODUCT_RECIPE_CREATED` | `404`; `409 PRODUCT_RECIPE_CODE_TAKEN \| PRODUCT_RECIPE_BATCH_TAKEN \| PRODUCT_ARCHIVED`; `422 PRODUCT_NOT_FOUND \| PRODUCT_RECIPE_SELF_REFERENCE`; `400` |
| GET | `/api/inventory/recipes/[id]?quantity=` | implemented (FR-156): the recipe plus `requirements` exploded to `quantity` (default its batch size) — per line `required`, `issueQty` (whole units), `onHand` (null when uncounted), `shortage` — `canBuild`, `producedQty`, and `maxBuildableQuantity` from on-hand recomputed on this read | `404 Business not found` |
| PATCH | `/api/inventory/recipes/[id]` | implemented (FR-156): `{ action, version, fields? }` — `UPDATE` (`name`, `yieldQty`, `unit`, `notes`, `lines` replaces the whole set) or `ARCHIVE`. Compare-and-swap on `(id, version)`; one audit row per action. No DELETE | `404`; `409 PRODUCT_RECIPE_VERSION_CONFLICT \| PRODUCT_RECIPE_ARCHIVED`; `422 PRODUCT_NOT_FOUND \| PRODUCT_RECIPE_SELF_REFERENCE`; `400` |
| POST | `/api/inventory/recipes/[id]/build` | implemented (FR-156): `{ businessId, quantity, outputLotCode?, reason?, reference?, occurredAt? }` → `{ quantity, factor, producedQty, consumed: [{ componentProductId, quantity, onHandAfter, allocations }], produced: { productId, quantity, onHandAfter, lotId } \| null, reference }` — one transaction: every counted component issued (FEFO for lots), the output received when counted. Audited `PRODUCT_RECIPE_BUILT` plus the ledger's own rows | `404`; `409 INVENTORY_RECIPE_SHORTAGE` (with `details: [{ componentProductId, code, required, onHand, shortage }]`) `\| PRODUCT_RECIPE_ARCHIVED \| PRODUCT_ARCHIVED`; `422 INVENTORY_RECIPE_SERIAL_COMPONENT \| INVENTORY_RECIPE_SERIAL_OUTPUT \| INVENTORY_LOT_REQUIRED`; `400` |

#### FR-182 — SCM operations console (ADR-074)

Thirteen handlers over the services FR-174…FR-181 already shipped. Each is thin: resolve the viewer, call one exported service, return what it returns. Every refusal below is the service's, not the handler's.

| Method | Path | Contract | Refusals |
|---|---|---|---|
| GET | `/api/inventory/locations?businessId=&type=&includeArchived=` | implemented (FR-174): warehouse locations with `code`, `name`, `type` (nine supply-chain buckets), `isVirtual`, `status`, `version` | `404 Business not found` |
| POST | `/api/inventory/locations` | implemented (FR-174): `{ businessId, code, name, type, isVirtual?, address? }`. Audited `WAREHOUSE_LOCATION_CREATED` | `404`; `409 WAREHOUSE_LOCATION_CODE_TAKEN`; `400` |
| GET | `/api/inventory/locations/[id]` | implemented (FR-174): one location | `404` |
| PATCH | `/api/inventory/locations/[id]` | implemented (FR-174): `{ businessId, action: UPDATE \| ARCHIVE, version, fields? }` — compare-and-swap on `version`. No DELETE: ledger rows point at a location | `404`; `409 WAREHOUSE_LOCATION_VERSION_CONFLICT \| WAREHOUSE_LOCATION_NOT_EMPTY \| WAREHOUSE_LOCATION_ARCHIVED`; `400` |
| GET | `/api/inventory/location-stock?businessId=&productId=` | implemented (FR-174): on-hand per location recomputed from the located ledger, always with `unlocated` beside `total` — a movement written before ADR-074 names no location and is never folded into one (BR-026) | `404` |
| POST | `/api/inventory/transfers` | implemented (FR-174): `{ businessId, productId, sourceLocationId, targetLocationId, quantity, lotId? \| lotCode?, serialNos?, costSatang?, reason?, reference? }` — one ISSUE at the source and one RECEIPT at the target in a single transaction, so Business-wide on-hand is unchanged. Audited `STOCK_TRANSFER_RECORDED` | `404`; `409 INVENTORY_INSUFFICIENT_STOCK \| INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE \| INVENTORY_LOT_STORAGE_EXPIRED \| INVENTORY_TRANSFER_LOT_UNKNOWN`; `422 WAREHOUSE_LOCATION_NOT_FOUND \| INVENTORY_PRODUCT_NOT_FOUND`; `400` |
| GET | `/api/inventory/customization-work-orders?businessId=&status=&salesOrderId=` | implemented (FR-176): work orders with `grossIssueQty` and the run reconciliation | `404` |
| POST | `/api/inventory/customization-work-orders` | implemented (FR-176): `{ businessId, rawProductId, technique, netQuantity, outputProductId?, scrapAllowanceFactor?, customerId?, salesOrderId?, logoArtworkUrl?, pantoneColors?, setupCostSatang?, runCostSatang?, sourceLocationId?, wipLocationId?, scrapLocationId?, scheduledDate?, notes? }` — creates the branded `CUSTOM_COMPONENT` output SKU when none is named. Audited `CUSTOMIZATION_WORK_ORDER_OPENED` | `404`; `409 INVENTORY_CUSTOM_COMPONENT_ALREADY_BRANDED \| PRODUCT_ARCHIVED`; `422 INVENTORY_CUSTOMIZATION_SERIAL_UNSUPPORTED \| INVENTORY_PRODUCT_UNTRACKED`; `400` |
| GET | `/api/inventory/customization-work-orders/[id]` | implemented (FR-176): one work order | `404` |
| PATCH | `/api/inventory/customization-work-orders/[id]` | implemented (FR-182): `{ businessId, action: RELEASE \| COMPLETE \| CANCEL, version, completedQty?, scrapQty?, outputLotCode?, reason? }` — only COMPLETE carries counts. RELEASE stages the gross quantity; COMPLETE consumes, scraps, produces the branded SKU and returns the buffer | `404`; `409 CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT \| ..._ALREADY_RELEASED \| ..._NOT_RELEASED \| ..._COMPLETED \| ..._CANCELLED \| ..._OVER_ISSUED`; `400` |
| GET | `/api/inventory/kitting-work-orders?businessId=&status=&salesOrderId=` | implemented (FR-177): work orders with their frozen `plannedLines` | `404` |
| POST | `/api/inventory/kitting-work-orders` | implemented (FR-177): `{ businessId, recipeId, plannedQty, customerId?, salesOrderId?, laborCostSatang?, sourceLocationId?, wipLocationId?, targetLocationId?, scrapLocationId?, outputLotCode?, notes? }` — explodes with the recipe's scrap allowance, checks ATP not on-hand, freezes the lines. Audited `KITTING_WORK_ORDER_OPENED` | `404`; `409 INVENTORY_KITTING_SHORTAGE \| PRODUCT_RECIPE_ARCHIVED`; `422 INVENTORY_FINISHED_SET_SKU_MISSING \| INVENTORY_FINISHED_SET_SKU_INVALID \| INVENTORY_LOT_REQUIRED`; `400` |
| GET | `/api/inventory/kitting-work-orders/[id]` | implemented (FR-177): one work order | `404` |
| PATCH | `/api/inventory/kitting-work-orders/[id]` | implemented (FR-182): `{ businessId, action: RELEASE \| COMPLETE \| CANCEL, version, assembledQty?, scrapQty?, reason? }` — COMPLETE receives the sets at their blended landed unit cost (FR-175) | `404`; `409 KITTING_WORK_ORDER_VERSION_CONFLICT \| ..._ALREADY_RELEASED \| ..._NOT_RELEASED \| ..._COMPLETED \| ..._CANCELLED \| ..._OVER_ASSEMBLED \| ..._OVER_ISSUED`; `400` |
| GET | `/api/inventory/reservations?businessId=&productId=&status=` | implemented (FR-180): reservations with a computed `live` — a hold whose clock ran out is already spent though its stored status is still ACTIVE | `404` |
| POST | `/api/inventory/reservations` | implemented (FR-180): `{ businessId, productId, quantity, purpose?, customerId?, salesOrderId?, quoteReference?, customerCompany?, contactHandle?, holdDays?, expiresAt?, notes? }` — refused when the quantity exceeds what is still available. Audited `STOCK_RESERVATION_CREATED` | `404`; `409 STOCK_RESERVATION_INSUFFICIENT_ATP`; `422 INVENTORY_PRODUCT_UNTRACKED \| STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER`; `400` |
| PATCH | `/api/inventory/reservations/[id]` | implemented (FR-180): `{ businessId, action: RELEASE \| CONVERT, version, salesOrderId?, reason? }` — CONVERT ends the quote hold and creates the committed one in the same transaction. No DELETE and no single-row GET: a hold is never deleted | `404`; `409 STOCK_RESERVATION_VERSION_CONFLICT \| STOCK_RESERVATION_NOT_ACTIVE \| STOCK_RESERVATION_ALREADY_COMMITTED`; `400` |
| GET | `/api/inventory/atp?businessId=&productId=&recipeId=&quantity=` | implemented (FR-180): with `recipeId`, the sets the bill of materials still allows from ATP (not on-hand); otherwise per product — `onHand`, `committed`, `reservedForQuotes`, `available`, `overCommitted`, with `available: null` for an uncounted product | `404`; `409 PRODUCT_RECIPE_ARCHIVED` |
| GET | `/api/inventory/shelf-life?businessId=&thresholdDays=&includeEmpty=` | implemented (FR-179): every lot of every ageing product as OK / DUE / EXPIRED, with its age, deadline and on-hand | `404` |
| POST | `/api/inventory/shelf-life` | implemented (FR-179): `{ businessId, lotId, note?, maintainedAt? }` — records that a batch was restored, which resets its storage clock. Touches no quantity. Audited `PRODUCT_LOT_MAINTAINED` | `404`; `409 PRODUCT_LOT_CLOSED`; `422 INVENTORY_PRODUCT_DOES_NOT_AGE`; `400` |
| POST | `/api/inventory/de-kitting` | implemented (FR-178): `{ businessId, recipeId, quantity, sourceLocationId?, targetLocationId?, destroyedComponentProductIds?, lotId?, reason?, reference? }` — issues the sets and receives the survivors; named components are written off. Audited `STOCK_DE_KITTED` | `404`; `409 INVENTORY_INSUFFICIENT_STOCK \| INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE`; `422 PRODUCT_RECIPE_NOT_FOUND \| INVENTORY_DEKIT_LOT_COMPONENT`; `400` |

### Physical stocktake (FR-184)

| Method | Route | Contract | Refusal |
|---|---|---|---|
| POST | `/api/inventory/stocktakes/preview` | Explicit NONE/LOT lines with nullable location/lot and non-negative integer countedQuantity; returns a persisted preview, snapshot token, completeness and missing buckets without changing stock | 400 invalid payload; 404 scope; 422 reference/SERIAL refusal |
| POST | `/api/inventory/stocktakes/commit` | Business, previewId, snapshotToken, idempotencyKey and exact normalized lines; one fenced atomic adjustment/no-op with saved per-line balances | 409 stale, incomplete or conflicting retry; no partial mutation |
| GET | `/api/inventory/stocktakes/[id]` | Business-scoped persisted preview or commit result; reload retains identity and balances | 404 absent or hidden scope |
| GET | `/api/inventory/products/resolve?businessId=&identifier=` | implemented (FR-203): which SKU an identifier names — the `code`, the FlowAccount code or any ACTIVE identifier, in that order — `{ matchedBy: CODE \| FLOWACCOUNT_SKU \| IDENTIFIER \| null, product, matchedIdentifier?: { kind, value, unit, factor }, unitConversions, redirectedFrom }`; a merged duplicate is followed to its survivor; a miss is `{ product: null }` with 200 | `404` unseen Business |
| GET | `/api/inventory/products/[id]/identifiers?includeRetired=` | implemented (FR-203): the SKU's identifiers, ACTIVE unless asked | `404` |
| POST | `/api/inventory/products/[id]/identifiers` | implemented (FR-203): `{ businessId, kind (GTIN / BARCODE / SUPPLIER_CODE / MANUFACTURER_PART / LEGACY_CODE), value, issuer?, unit? }` — a GTIN needs a valid check digit; unique per Tenant per kind, the two scannable kinds sharing one value space; `unit` must be the base unit or a declared conversion. Audited `PRODUCT_IDENTIFIER_ADDED` | `404`; `409 INVENTORY_IDENTIFIER_TAKEN \| PRODUCT_ARCHIVED`; `422 INVENTORY_PRODUCT_NOT_FOUND \| INVENTORY_UNIT_UNKNOWN`; `400` |
| PATCH | `/api/inventory/products/[id]/identifiers` | implemented (FR-203): `{ identifierId, action: RETIRE, version }` — compare-and-swap; the row stays and its value still blocks | `404`; `409 PRODUCT_IDENTIFIER_VERSION_CONFLICT \| PRODUCT_IDENTIFIER_RETIRED`; `400` |
| GET | `/api/inventory/products/[id]/unit-conversions?includeRetired=` | implemented (FR-204): `{ baseUnit, conversions: [{ unit, name, factor, usage, status, version }] }` | `404` |
| POST | `/api/inventory/products/[id]/unit-conversions` | implemented (FR-204): `{ businessId, unit, name?, factor (integer base units per unit), usage? (PURCHASE / SALES / ANY) }`. Audited `PRODUCT_UNIT_CONVERSION_ADDED` | `404`; `409 INVENTORY_UNIT_TAKEN \| PRODUCT_ARCHIVED`; `422 INVENTORY_UNIT_IS_BASE \| INVENTORY_UNIT_NOT_FOR_SERIAL \| INVENTORY_PRODUCT_IS_A_SERVICE`; `400` |
| PATCH | `/api/inventory/products/[id]/unit-conversions` | implemented (FR-204): `{ conversionId, action: UPDATE \| RETIRE, version, fields? (name, factor, usage) }` — compare-and-swap | `404`; `409 PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT \| PRODUCT_UNIT_CONVERSION_RETIRED`; `400` |
| GET | `/api/inventory/catalog-hygiene?businessId=&dormantDays=` | implemented (FR-206): `{ businessId, catalogue: { masters, products, live }, generatedAt, dormantDays, counts (by kind), bySeverity, total, findings: [{ kind, severity, message, suggestion, productIds, codes, masterId?, … }] }` — read-only, computed by a pure function on every read | `404` |
| GET | `/api/inventory/replenishment?businessId=` | implemented (FR-207): `{ businessId, rows: [{ productId, code, name, unit, onHand, threshold, reorderPoint, safetyStock, suggestedQty, leadTimeDays }], counts: { counted, suggested } }` — counted ACTIVE SKUs below `reorderPoint ?? safetyStock`; a suggestion, never a purchase order | `404` |
| GET | `/api/inventory/catalog-intakes?businessId=&limit=` | implemented (FR-208): recent catalogue intakes, newest first, as summaries `{ id, code, sourceChannel, sourceCorrelationId, status (PREVIEWED / COMMITTED / CANCELLED), committable, itemCount, planHash, expiresAt, committedAt, cancelledAt, requestedById, version }` without plans | `404` |
| POST | `/api/inventory/catalog-intakes/preview` | implemented (FR-208): envelope `{ schemaVersion: "1.0", businessId, source: { channel: REST_API \| EXCEL \| LINE_OA \| WEB, correlationId }, items[1..500]: { ref?, sku: { code, name?, color?, material?, unit?, variant?, stockPolicy?, trackingMode?, safetyStock?, reorderPoint?, reorderQty?, leadTimeDays?, allowLookalike? }, master: { code, categoryCode?, nameTh?, nameEn?, nature?, defaultStockPolicy?, variantAxes? }, identifiers?[], unitConversions?[] } }` → `{ replayed, intake: { …summary, plan: { items: [{ index, ref, code, decision: CREATE \| MATCH \| UNCHANGED \| CONFLICT \| INVALID, matchedBy?, product?, master?, actions[], issues[], warnings[] }], counts, committable } } }`. Each item is resolved by active identifiers then SKU code before a create is planned. Idempotent per (Business, channel, correlation). Writes no catalogue row. Audited `INVENTORY_CATALOG_INTAKE_PREVIEWED` / `_REPREVIEWED` | `404`; `409 INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED`; `400` envelope header |
| POST | `/api/inventory/catalog-intakes/commit` | implemented (FR-208): `{ businessId, intakeId, planHash }` — re-plans in one transaction, applies every action through the catalogue writers (each audited) or nothing, marks COMMITTED with `result: { created[], matched[], unchanged[], mastersCreated[] }`. A committed intake replays. Audited `INVENTORY_CATALOG_INTAKE_COMMITTED` | `404`; `409 INVENTORY_CATALOG_INTAKE_PLAN_STALE \| INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE (details: refs) \| INVENTORY_CATALOG_INTAKE_EXPIRED \| INVENTORY_CATALOG_INTAKE_CANCELLED \| INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT`, or a writer's own refusal; `400` |
| GET | `/api/inventory/catalog-intakes/[id]` | implemented (FR-208): one intake with its `plan` and, once committed, its `result` | `404` |
| PATCH | `/api/inventory/catalog-intakes/[id]` | implemented (FR-208): `{ action: CANCEL, version }` — compare-and-swap; the row stays. Audited `INVENTORY_CATALOG_INTAKE_CANCELLED`. No DELETE | `404`; `409 INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT \| INVENTORY_CATALOG_INTAKE_ALREADY_COMMITTED \| INVENTORY_CATALOG_INTAKE_CANCELLED`; `400` |
| GET | `/api/inventory/catalog-intakes/template?businessId=` | implemented (FR-209): `.xlsx` — `Products` (header row 2 is the contract, dropdowns from `enums.js`), `Lookups` (this Business's categories and masters) and a read-me | `404` as JSON |
| POST | `/api/inventory/catalog-intakes/xlsx` | implemented (FR-209): multipart `businessId` + `file` (`.xlsx`, ≤ 5 MiB); authority before reading; rows become items unjudged and preview under correlation `xlsx:<sha256>` — the preview response above. Never commits | `404`; `400` not multipart / not `.xlsx`; `413`; `422 INVENTORY_CATALOG_WORKBOOK_UNREADABLE \| _SHEET_MISSING \| _HEADER_MISMATCH (details: columns) \| _EMPTY \| _TOO_MANY_ROWS` |

## CRM sales tasks (FR-161, ADR-064)

The follow-ups a Business's sales team owes customers — a CRM activity record,
not a Development WorkItem. Reading needs Business visibility plus the
`customer` domain (FR-061; the FR-072 `404 Business not found` without it);
writing needs Business OWNER or `SALES_REP` (`403` for a member who holds the
domain). `businessId` is a selector the service validates against the trusted
viewer. Due state and the summary are computed against the Business calendar
(Asia/Bangkok) on every read.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/crm/sales-tasks?businessId=&status=&assigneePersonId=&customerId=&conversationId=&due=&includeClosed=&limit=` | implemented (FR-161): `{ businessId, tasks[], summary: { open, inProgress, overdue, dueToday, mine, unassigned } }` — each task with `code` (`TSK-YYYYMMDD-NNN`), `title`, `type`, `priority`, `status`, `scheduleKind`, `dueDate`, `startDate`, `timeStart`, `timeEnd`, `assignee { id, code, displayName }`, `customer { id, code, displayName }`, `conversationId`, `outcome`, `dueState` (OVERDUE / TODAY / UPCOMING / NONE), `version`. Open tasks by default; `assigneePersonId=me` resolves to the caller; `due` filters by due state | `404 Business not found`; `400` validation |
| POST | `/api/crm/sales-tasks` | implemented (FR-161): `{ businessId, title, dueDate, type?, priority?, scheduleKind?, startDate?, timeStart?, timeEnd?, customerId?, conversationId?, assigneePersonId?, description? }` — a Conversation supplies its Customer when none is named. Audited `SALES_TASK_CREATED` | `404`; `403` (no OWNER / SALES_REP); `422 CUSTOMER_NOT_FOUND \| CONVERSATION_NOT_FOUND \| CONVERSATION_CUSTOMER_MISMATCH \| ASSIGNEE_NOT_MEMBER`; `400` validation (schedule rules: a SINGLE task has no `startDate`, a RANGE task needs one no later than `dueDate` and no time window; `timeEnd` after `timeStart`) |
| GET | `/api/crm/sales-tasks/[id]` | implemented (FR-161): one task with its due state | `404 Business not found` |
| PATCH | `/api/crm/sales-tasks/[id]` | implemented (FR-161): `{ action, version, fields?, assigneePersonId?, outcome?, reason? }` — `UPDATE` (the schedule rules apply to the merged row), `ASSIGN` (`null` unassigns), `START`, `COMPLETE` (`outcome`), `CANCEL` (`reason`), `REOPEN`. OPEN → IN_PROGRESS → DONE; cancel from either open state; reopen out of a closed one; UPDATE / ASSIGN refused on a closed task. Compare-and-swap on `(id, version)`; one audit row per action. No DELETE | `404`; `403`; `409 SALES_TASK_VERSION_CONFLICT \| SALES_TASK_STATUS_INVALID`; `422 ASSIGNEE_NOT_MEMBER`; `400` |

## Commerce — orders, payments, revenue (FR-166, FR-163, ADR-065)

What the Business sold and how it settled. Every route takes the Business as a
selector the service validates against the trusted viewer. Reading needs
Business visibility plus the `commerce` domain (FR-061; the FR-072
`404 Business not found` without it). Writing an order and recording a payment
need Business OWNER or `SALES_REP`; verifying or rejecting a payment needs
Business OWNER or `PAYMENT_VERIFIER`. Money is baht with at most two decimals
in every request and response (integer satang in storage). Total, paid,
balance due and payment state are computed on every read from the lines and
the VERIFIED payments.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET, POST | `/api/commerce/pricing-rules` | FR-253: OWNER-scoped list/template and create draft; businessId plus name/rules for POST | 404 scope; 422 rule schema |
| PATCH | `/api/commerce/pricing-rules/[id]` | FR-253: version/name/rules/reason; draft-only optimistic update | 404 scope; 409 revision/immutable; 422 formula |
| POST | `/api/commerce/pricing-rules/[id]/actions` | FR-253: APPROVE with effectiveFrom/expiresAt or REVOKE; version/reason required | 404 scope; 409 state/revision; 422 dates |
| POST | `/api/commerce/pricing-rules/preview` | FR-253: server evaluator, rules/input and optional compareRuleSetId; simulation only | 404 scope; 422 formula/input |
| POST | `/api/commerce/pricing-rules/calculate` | FR-253: active rule, input and idempotencyKey; immutable USER_ENTERED result, not publishable | 404 scope; 409 inactive/idempotency; 422 input |
| POST | `/api/commerce/pricing-rules/catalog` | FR-253: OWNER scoped product/expected rule/quantities/reason/idempotencyKey; previewOnly returns exact ledger prices and previewHash without writes; confirmation requires previewHash and uses existing Knowledge admission, never publication success | 404 scope; 409 stale preview/policy; 422 missing cost; runtime/storage/admission errors |
| GET | `/api/commerce/orders?businessId=&status=&origin=&customerId=&conversationId=&includeClosed=&limit=` | implemented (FR-166): `{ businessId, orders[], summary: { open, unpaid, pendingPayments } }` — each order with `code` (`ORD-YYYYMMDD-NNN`), `origin` (CHAT / WALK_IN / ONLINE), `attributed`, `status`, `lines[]` (`productId`, `description`, `qty`, `unitPrice`, `discount`, `lineTotal`), `subtotal`, `discount`, `total`, `paid`, `refunded`, `net`, `pending`, `balanceDue`, `paymentState` (UNPAID / PARTIAL / PAID / OVERPAID / REFUNDED), `payments[]`, `customer`, `version`. Open orders by default | `404 Business not found`; `400` validation |
| POST | `/api/commerce/orders` | implemented (FR-166): `{ businessId, lines: [{ productId?, description?, qty, unitPrice, discount? }], customerId?, conversationId?, origin?, discount?, notes?, orderedAt?, currency? }` — a Conversation supplies its Customer and makes the origin CHAT; a product must be an ACTIVE SKU of the same Business. Audited `SALES_ORDER_CREATED` | `404` (also a viewer without OWNER / SALES_REP); `409 PRODUCT_ARCHIVED`; `422 CUSTOMER_NOT_FOUND \| CONVERSATION_NOT_FOUND \| CONVERSATION_CUSTOMER_MISMATCH \| PRODUCT_NOT_FOUND`; `400` validation (a line needs a product or a description; a discount within its line; two-decimal amounts) |
| GET | `/api/commerce/orders/[id]` | implemented (FR-166): one order with its lines, payments and money | `404 Business not found` |
| PATCH | `/api/commerce/orders/[id]` | implemented (FR-166): `{ action, version, fields?, issueStock?, reason? }` — `UPDATE` (`lines` only while DRAFT; `customerId`, `discount`, `notes`, `orderedAt` while open), `CONFIRM`, `COMPLETE` (with `issueStock: true` every counted line is issued through the Inventory ledger, reference `ORDER:<code>`, or nothing), `CANCEL` (`reason`). Compare-and-swap on `(id, version)`; one audit row per action. No DELETE | `404`; `403 COMMERCE_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY`; `409 SALES_ORDER_VERSION_CONFLICT \| SALES_ORDER_STATUS_INVALID \| SALES_ORDER_LINES_LOCKED \| COMMERCE_STOCK_SHORTAGE` (with `details: [{ productId, code, required, onHand, shortage }]`) `\| PRODUCT_ARCHIVED`; `422 COMMERCE_SERIAL_LINE_UNSUPPORTED \| CUSTOMER_NOT_FOUND \| PRODUCT_NOT_FOUND`; `400` |
| GET | `/api/commerce/orders/[id]/payments` | implemented (FR-163): `{ orderId, payments[], summary: { paid, refunded, net, pending } }` | `404` |
| POST | `/api/commerce/orders/[id]/payments` | implemented (FR-163): `{ method, amount, kind?, bankReference?, slipFileAssetId?, note?, paidAt? }` records a PENDING payment (default) or refund. Audited `PAYMENT_RECORDED` | `404`; `409 PAYMENT_REFERENCE_TAKEN \| SALES_ORDER_CANCELLED` (a payment, not a refund); `422 PAYMENT_SLIP_NOT_FOUND`; `400` |
| GET | `/api/commerce/payments/[id]` | implemented (FR-163): one payment | `404` |
| PATCH | `/api/commerce/payments/[id]` | implemented (FR-163): `{ action, version, reason? }` — `VERIFY` or `REJECT` a PENDING payment; answers `{ payment, order }` with the order's money recomputed. Audited `PAYMENT_VERIFIED` / `PAYMENT_REJECTED`. No DELETE | `404` (also a viewer without OWNER / PAYMENT_VERIFIER); `409 PAYMENT_VERSION_CONFLICT \| PAYMENT_STATUS_INVALID \| PAYMENT_REFUND_EXCEEDS_PAID`; `400` |
| GET | `/api/commerce/revenue?businessId=&from=&to=` | implemented (FR-163): `{ verifiedNet, refunded, byOrigin: { CHAT, WALK_IN, ONLINE }, byDay: [{ day, net }], pending: { count, amount }, orders: { open, completed } }` — VERIFIED payments net of VERIFIED refunds on the day paid (Asia/Bangkok); `from` / `to` as YYYY-MM-DD | `404`; `400` |

### Commerce — Billing documents and POS (FR-186, FR-183)

Billing uses the Business's configured LegalEntity/Branch identity, tax policy and
verified PromptPay recipient. Preview is non-persistent; issue is an immutable
document with a Business/type/year sequence and idempotency hash. POS composes an
existing SalesOrder, a PENDING payment and the Inventory append-only movement;
verification remains the existing payment authority. The slice accepts THB only.

| Method | Route | Contract | Failure |
|---|---|---|---|
| GET | `/api/commerce/billing/config?businessId=` | implemented (FR-186): active Business billing profile, authoritative LegalEntity link and active Branch choices; missing/inactive configuration is `UNAVAILABLE` | `404` scoped Business |
| PATCH | `/api/commerce/billing/config?businessId=` | implemented (FR-186): OWNER updates Business tax/non-VAT/walk-in/PromptPay settings and selects an existing active Branch; LegalEntity address changes are refused when shared | `404`; `409 BILLING_PROFILE_VERSION_CONFLICT \| BILLING_SHARED_LEGAL_ENTITY`; `422` configuration/recipient/Branch validation |
| POST | `/api/commerce/billing/documents/preview` | implemented (FR-186): `{ orderId, branchId, documentType, buyer: { source: ISSUANCE_INPUT \| ANONYMOUS_WALK_IN, ... }, includePromptPay? }` returns a tax/payment snapshot with no number, persistence or audit event | `401`; `404`; `422 BILLING_CURRENCY_UNSUPPORTED \| BILLING_TAX_NOT_CONFIGURED \| BILLING_NON_VAT_POLICY_DENIED \| BILLING_WALK_IN_POLICY_DENIED \| PROMPTPAY_NOT_CONFIGURED` |
| POST | `/api/commerce/billing/documents` | implemented (FR-186): same request plus required `idempotencyKey`; atomically persists the immutable snapshot, request hash, audit event and per-Business/type/year sequence; identical retries return the original | `400`; `404`; `409` idempotency/sequence conflict; `422` configuration, payment or THB validation |
| GET | `/api/commerce/billing/documents/[id]` | implemented (FR-186): reads one immutable document only when the viewer can view its Business; response includes document number, request hash and parsed snapshot | `404` for missing or out-of-scope document |
| GET | `/api/commerce/pos/catalogue?businessId=&branchId=&warehouseLocationId=` | implemented (FR-183): active Inventory products and available on-hand quantities for a configured Business Branch/WarehouseLocation | `404`; `422` invalid or inactive location |
| POST | `/api/commerce/pos/checkout` | implemented (FR-183): `{ businessId, branchId, warehouseLocationId, lines, payment }` creates the existing SalesOrder, records a PENDING payment and appends counted Inventory movements; no provider call or same-request verification | `400`; `403` missing Commerce/Inventory write authority; `404`; `422` monetary, quantity, stock or location validation |

## Procurement — suppliers, purchase orders, goods receipts (FR-164, FR-165, ADR-066)

What the Business buys and what arrived. Every route takes the Business as a
selector the service validates against the trusted viewer. Reading needs
Business visibility plus the `procurement` domain (FR-061; the FR-072
`404 Business not found` without it). Keeping suppliers and purchase orders
needs Business OWNER or `PROCUREMENT_BUYER`; posting a receipt needs the same
plus — for the lines that land in the stock ledger — Inventory's write
authority (OWNER or `INVENTORY_MANAGER`). Money is baht with at most two
decimals in every request and response (integer satang in storage). Total,
received and outstanding value, each line's received and outstanding quantity
and the order's `receiptState` are computed on every read from the lines and
the receipt lines.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/procurement/receipts?businessId=&limit=&offset=` | FR-165: scoped receipt registry, latest first; `{ receipts, hasMore, limit, offset }`; limit 1–200 (default 50), nonnegative offset; persisted PO/supplier/line joins | `404 Business not found`; `400` validation |
| GET | `/api/procurement/receipts/[id]` | FR-165: one scoped persisted receipt, PO/supplier and purchase-order-line joins with lot, expiry and serial values | `404` |
| GET | `/api/procurement/suppliers?businessId=&includeArchived=` | implemented (FR-164): the ACTIVE suppliers (archived on request), each with `code`, contact, `paymentTerms`, `leadTimeDays`, `status`, `purchaseOrders` (count), `version` | `404 Business not found`; `400` |
| POST | `/api/procurement/suppliers` | implemented (FR-164): `{ businessId, code, name, taxId?, contactName?, phone?, email?, address?, paymentTerms?, leadTimeDays?, notes? }` — `code` unique per Tenant. Audited `SUPPLIER_CREATED` | `404` (also a viewer without OWNER / PROCUREMENT_BUYER); `409 SUPPLIER_CODE_TAKEN`; `400` validation |
| GET | `/api/procurement/suppliers/[id]` | implemented (FR-164): one supplier | `404` |
| PATCH | `/api/procurement/suppliers/[id]` | implemented (FR-164): `{ action, version, fields?, reason? }` — `UPDATE` (any supplier field) or `ARCHIVE`. Compare-and-swap on `(id, version)`; one audit row. No DELETE | `404`; `409 SUPPLIER_VERSION_CONFLICT \| SUPPLIER_STATUS_INVALID`; `400` |
| GET | `/api/procurement/purchase-orders?businessId=&status=&supplierId=&includeClosed=&limit=` | implemented (FR-164): `{ businessId, orders[], summary: { open, draft, awaitingDelivery, partiallyReceived, outstandingValue } }` — each order with `code` (`PO-YYYYMMDD-NNN`), `supplier`, `status`, `total`, `receivedValue`, `outstandingValue`, `receiptState` (NONE / PARTIAL / COMPLETE), `receiptCount`, `lines[]` (`productId`, `description`, `qty`, `unitCost`, `lineTotal`, `receivedQty`, `outstandingQty`, `product`), `receipts[]`, `version`. Open orders (DRAFT, SENT) by default | `404`; `400` |
| POST | `/api/procurement/purchase-orders` | implemented (FR-164): `{ businessId, supplierId, lines: [{ productId?, description?, qty, unitCost }], expectedAt?, notes?, orderedAt?, currency? }` — the supplier must be ACTIVE and of the same Business; a product a non-archived SKU of the same Business. Audited `PURCHASE_ORDER_CREATED` | `404`; `409 SUPPLIER_ARCHIVED \| PRODUCT_ARCHIVED`; `422 SUPPLIER_NOT_FOUND \| PRODUCT_NOT_FOUND`; `400` (a line needs a product or a description; two-decimal amounts) |
| GET | `/api/procurement/purchase-orders/[id]` | implemented (FR-164): one order with its lines, receipts and the money computed on this read | `404` |
| PATCH | `/api/procurement/purchase-orders/[id]` | implemented (FR-164): `{ action, version, fields?, reason? }` — `UPDATE` (`lines` and `supplierId` only while DRAFT; `expectedAt`, `notes`, `orderedAt` while open), `SEND`, `CLOSE` (`reason`), `CANCEL` (`reason`; refused once a receipt exists). Compare-and-swap on `(id, version)`; one audit row per action. No DELETE | `404`; `409 PURCHASE_ORDER_VERSION_CONFLICT \| PURCHASE_ORDER_STATUS_INVALID \| PURCHASE_ORDER_LINES_LOCKED \| PURCHASE_ORDER_SUPPLIER_LOCKED \| PURCHASE_ORDER_HAS_RECEIPTS \| SUPPLIER_ARCHIVED \| PRODUCT_ARCHIVED`; `422 SUPPLIER_NOT_FOUND \| PRODUCT_NOT_FOUND`; `400` |
| GET | `/api/procurement/purchase-orders/[id]/receipts` | implemented (FR-165): `{ purchaseOrderId, purchaseOrderCode, receipts[] }` — each with `code` (`GRN-YYYYMMDD-NNN`), `supplierReference`, `receivedAt`, `lines[]` (`purchaseOrderLineId`, `qty`, `lotCode`, `expiresAt`, `serialNos[]`) | `404` |
| POST | `/api/procurement/purchase-orders/[id]/receipts` | implemented (FR-165): `{ lines: [{ purchaseOrderLineId, qty, lotCode?, expiresAt?, serialNos? }], supplierReference?, notes?, receivedAt? }` posts a receipt against a SENT order; counted lines land in the Inventory ledger (reference `PO:<code>/GRN:<code>`); the receipt that completes every line makes the order RECEIVED. Answers `{ receipt, order, posted[] }`. Audited `GOODS_RECEIPT_POSTED` (and `PURCHASE_ORDER_RECEIVED`). No PATCH, no DELETE | `404`; `403 PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY`; `409 PURCHASE_ORDER_NOT_RECEIVABLE \| PROCUREMENT_RECEIPT_EXCEEDS_ORDERED` (with `details: [{ purchaseOrderLineId, description, ordered, received, outstanding, requested }]`) `\| PRODUCT_ARCHIVED \| INVENTORY_*`; `422 PROCUREMENT_RECEIPT_LINE_NOT_FOUND \| PROCUREMENT_RECEIPT_LINE_NOT_COUNTED \| INVENTORY_LOT_REQUIRED \| INVENTORY_SERIAL_COUNT_MISMATCH`; `400` (an order line once per receipt) |

### Supplier cost-sheet intake (TASK-ZAI-053; proposal cost/quote engine)

The Procurement source snapshot is Business-scoped and idempotent on the file
hash. Preview stores the normalized source and mapping suggestions only. Commit
requires the stored preview hash and a person-confirmed mapping for every source
SKU; it writes the confirmed price breaks and delegates Product carton facts to
Inventory. The migration is additive and locally authored, not production-applied.

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/procurement/cost-sheets?businessId=&supplierId=&status=&limit=` | Business-scoped source-sheet summaries, newest first | `404 Business not found`; `400` validation |
| POST | `/api/procurement/cost-sheets/preview` | `{ businessId, supplierId, currency, fxRateLocked, sourceRef?, sourceSha256?, lines[] }` → persisted DRAFT preview with locked-rate suggestions; same source hash replays | `404`; `409 PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED`; `422` supplier or line validation |
| POST | `/api/procurement/cost-sheets/xlsx` | bounded `.xlsx` upload converted to the same preview contract with a byte SHA-256 | `404`; `400` workbook/header/row validation; `413` upload too large |
| POST | `/api/procurement/cost-sheets/commit` | `{ businessId, sheetId or sourceSha256, previewHash, mappings[] }` → confirmed sheet, price-break lines and atomic Product carton updates | `404`; `409` stale/superseded/version conflict; `422 PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED or PRODUCT_NOT_FOUND or PROCUREMENT_COST_SHEET_CARTON_CONFLICT` |
| GET | `/api/procurement/cost-sheets/template` | Procurement-owned empty `.xlsx` template with the canonical CostSheet header | `404`; `400` validation |
| GET | `/api/procurement/cost-sheets/[id]` | one Business-scoped source sheet with locked FX, preview and confirmed lines | `404` |

## Project Execution Domains — FR-251 approved contract

Handler and runtime Swagger implemented and verified locally on 2026-09-17;
hosted CI and production release are separate gates recorded in PR443.
`GET /api/projects/{projectId}/domain-view` is the read-only Phase A contract in
[baseline 23](../architecture/project-manager-system/23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md)
and the [FR-251 note](../domains/project-manager/features/FR-251-project-execution-domains.md).
The Next.js handler uses the existing `[id]` folder. Resolve the request viewer and
`assertProjectRoadmapReadable` before aggregates. Return 401 `AUTH_REQUIRED`
or the same redacted 404 `RESOURCE_NOT_FOUND` for missing/deleted/foreign/invalid hierarchy.
200 returns schemaVersion, projectId, observedAt, unique Project work total, unbound
Workstream count and deduplicated primary/supporting domain rows; technical owners
are separate. Snapshot, blocker, contract, gap and Feature authority remain explicitly
unavailable/not bound. GET has no persistence, cache or AuditEvent side effect.
Runtime Swagger carries the exact DTO under `/api/projects/{id}/domain-view`, using
the existing route-inventory parameter name `id`; this is the same wire URL as
`{projectId}` in the design contract. Other candidate operations
remain deferred.

## Project core

| Method | Path | ทำอะไร |
|---|---|---|
| GET/POST | `/api/projects` | list (filter: workspaceId, businessId, tenantId, status, q, limit, view) → `{ items, limit, truncated }` / create; `view=overview\|timeline\|workspace` are explicit relation-rich compatibility reads for existing consumers; create derives `businessId` from the target Space and rejects owner/Space mismatch |
| GET/PATCH/DELETE | `/api/projects/[id]` | detail (includes direct Business owner and Space context) / update with owner/Space invariant / archive |
| GET | `/api/projects/[id]/inventory` | implemented: trusted-viewer, read-only `PROJECT_INVENTORY` DTO v1.0 with bounded work, milestones/gates, contained dependencies, file metadata, repository links, team, progress/evidence and redacted activity sections |
| GET | `/api/projects/[id]/domain-view` | FR-251: authorized read-only Project Execution Domains DTO v1.0; deduplicated primary/supporting Workstream bindings and work counts, technical owners separate, unknown and unavailable sources explicit; correlated typed errors and no writes |
| GET/POST/PATCH/DELETE | `/api/projects/[id]/team` | team in business scope / add member / change role / remove business-scoped member |
| GET/POST | `/api/projects/[id]/files` | list/add ProjectFile metadata reference; optional WorkItem must belong to Project |
| DELETE | `/api/projects/[id]/files/[fileId]` | delete ProjectFile reference within its owning Project |
| GET | `/api/projects/[id]/dependencies` | project-local Dependency Map graph; includes only edges whose endpoints both belong to the opened Project |
| GET | `/api/projects/[id]/roadmap` | implemented: trusted-viewer, read-only `EXECUTION_ROADMAP` DTO v1.0 with authorized Business Goal projections, seven-mode execution vocabulary, work hierarchy, dependencies, roster and closure gates; unsupported owner/risk/source/tag/criteria/evidence fields are explicit unavailable states |
| GET | `/api/projects/overview` | FR-086: trusted-viewer, read-only `PROJECTS_DASHBOARD` DTO v1.0 — status counts over the whole scope, headcount and team count as two separate figures, the enriched row list with size/progress/PIC/priority, and the Top-5-by-priority panel with an explicit empty state. Additive: `/api/projects` is untouched (SDD-047) |
| GET/POST/DELETE | `/api/projects/[id]/teams` | FR-089: Teams attached to this Project / attach / detach. Authorizes the Project **and** the Team, and refuses a cross-Business attach even from a viewer who owns both (ADR-037 D2) |
| GET/POST | `/api/teams` | FR-089: list Teams in a Business scope / create. A Team is an organisational grouping and grants nothing (BR-018) |
| GET/PATCH/DELETE | `/api/teams/[id]` | FR-089: detail / update (Business is immutable) / archive |
| POST/DELETE | `/api/teams/[id]/members` | FR-089: add or remove a Person. Writes no `Membership` row, so team membership can never widen authority (BR-018) |
| GET/PATCH | `/api/platform/users` | OWNER-only list/update of Membership role and domain allow-list |
| GET/POST | `/api/workstreams` | list (filter: projectId, executionMode) / create |
| PATCH/DELETE | `/api/workstreams/[id]` | update / archive |
| GET/POST | `/api/work` | list work items (filter: projectId, workstreamId, executionMode, subtype, status, q) / create |
| PATCH/DELETE | `/api/work/[id]` | update (metrics merge) / soft delete |
| POST, PATCH | `/api/containers`, `/api/containers/[id]` | create / update container |
| GET/POST, PATCH | `/api/milestones`, `/api/milestones/[id]` | list milestones+gates / create / update |
| POST, PATCH | `/api/gates`, `/api/gates/[id]` | create / update gate (evidence merge) |
| GET/POST, DELETE | `/api/dependencies`, `/api/dependencies/[id]` | list resolved edges (filter projectId) / create (cycle-checked) / delete |
| GET/POST, PATCH | `/api/repositories`, `/api/repositories/[id]` | list / register / update repo metadata |
| POST, DELETE | `/api/repositories/link`, `/api/repositories/link/[id]` | link / unlink project↔repo |
| GET | `/api/resolve?type=&code=` | human code → internal id |

`GET /api/projects` returns a machine-checked Project list projection. Each item
contains `id`, `code`, `name`, `description`, `type`, `status`, `businessId`,
`workspaceId`, `workspace { code, name, scopeType }`, ISO `startAt`/`targetAt`,
and `workstreamCount`. Archived rows (`deletedAt IS NOT NULL`) are excluded;
the default and hard maximum limit is 500, and `truncated` discloses when the
most recent window is incomplete. Filters compose with `AND`, Business filters
use direct `Project.businessId`, and ordering is `updatedAt DESC, id DESC`.

`view=list` is the default stable Project list contract. `/overview`, the global
Schedule, and Space detail send `view=overview`, `view=timeline`, and
`view=workspace` explicitly and receive their existing relation-rich array shape;
these compatibility reads are not second stable list DTOs and are not used by
`/projects`.

## Progress / Import / Backup / Audit

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/progress/workstream/[id]` | strategy progress + evidence + warnings |
| GET | `/api/progress/project/[id]` | weighted roll-up + per-workstream results |
| GET | `/api/progress/portfolio` | portfolio/group progress reporting API; not the operational `/overview` landing (FR-041 / ADR-013) |
| POST | `/api/import/dry-run` | `{plan, workspaceId?}` → valid/errors + preview (insert/update/conflict) — read-only |
| POST | `/api/import/commit` | เหมือน dry-run แล้ว commit ใน transaction เดียว + audit |
| POST | `/api/import/bundle/dry-run` | `{bundle}` (ExecutionPlanBundle) → one combined programme preview: strategy + per-Project PlanEnvelope dry-runs + cross-Project dependencies + symbol resolution — read-only, authorized เหมือน commit (FR-108, ADR-049 D5/D7) |
| POST | `/api/import/bundle/commit` | `{bundle}` → atomic single-transaction commit ของทั้ง programme ผ่าน orchestrator ที่เรียกเฉพาะ service เดิม; bundle receipt + idempotent replay ด้วย `trace.idempotencyKey` (FR-108, ADR-049 D8/D9) |
| POST | `/api/import/meeting-actions/dry-run` | `{intake, workspaceId?, projectId?}` → validates a strict FUNG/Lalin AI meeting-action envelope, resolves source identity and target scope, previews WorkItems and reports unresolved/out-of-scope assignees without persistence. |
| POST | `/api/import/meeting-actions/commit` | Same meeting-action contract after dry-run; commits through the existing PlanEnvelope transaction and AuditEvent path with `trace.idempotencyKey`. |
| GET | `/api/backup/export` | full snapshot JSON |
| POST | `/api/backup/import` | `{snapshot}` = preview; `{snapshot, confirm:true}` = restore |
| GET | `/api/audit` | events (filter: entityType, entityId, limit), plus `entityTypes: [{value, count}]` — every entityType present in the log with how many rows carry it. The facet is **unfiltered**: it counts the whole table, not the current `where`, so choosing one option never removes the others and the counts stay true past the `limit` window. The audit console builds its filter from this instead of a hand-kept list, which covered 15 of the 57 entityTypes the codebase writes (FR-014) |

## Managed local files (FR-045 — implemented beta)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/files` | viewer-authorized FileAsset query / managed ingest by Business or Project scope |
| GET | `/api/business/files?businessId=` | selected Business plus its owned Projects, one row per asset |
| GET/POST | `/api/projects/[id]/files` | existing compatibility contract backed by the new read/write service after migration |
| GET | `/api/files/[id]/content` | authorized content stream or download; no arbitrary filesystem path input |
| POST | `/api/files/[id]/relink` | explicitly confirm a contained new relative path for a missing asset |
| POST | `/api/files/[id]/reveal` | local-runtime capability only; hosted mode returns capability-disabled |
| POST | `/api/files/reconcile` | dry-run by default; confirm applies audited missing/untracked decisions |
| POST | `/api/files/cache/rebuild` | rebuild disposable projections from SQLite/content metadata |
| GET/POST | `/api/files/mounts` | list or upsert a device-local Business mount |
| POST | `/api/files/migrate` | owner/dev dry-run or confirmed ProjectFile migration |
| DELETE | `/api/files/[id]` | soft-delete managed metadata; physical content is not silently deleted |

Storage-kind requests are Zod-validated and scope is resolved server-side. No
content endpoint accepts an absolute client-supplied path. The existing Project
Files endpoints remain available through the compatibility boundary.

## Intake surfaces (FR-017..FR-020 — shipped)

| Method | Path | ทำอะไร |
|---|---|---|
| POST | `/api/import/xlsx` | อัปโหลด workbook → envelope → dry-run รายแถว (FR-018) |
| GET | `/api/import/template` | generate Excel template จาก Zod schema (FR-018) |
| GET | `/api/docs` | OpenAPI 3 spec generated from the live Zod schemas (FR-019) |
| GET | `/api/resolve?system=&value=` | external ID → internal id via ExternalRef; 404 unmapped, 410 dangling (FR-019) |
| POST | `/api/mcp` | MCP JSON-RPC transport for `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`; resolves the trusted request viewer before any session or tool operation; requires `Mcp-Session-Id` after initialization; exposes `project_manager.plan_dry_run`, `project_manager.plan_commit`, scoped `project_manager.work_read`, and authorized `project_manager.work_status_update`, plus the separate `data_pipeline.*` run/document/event/monitor/replay namespace (FR-069/FR-071) |
| POST | `/api/agent/line-webhook` | Local-disabled compatibility: `{tenantId, businessId?, events[]}`. Enabled production contract: `{bindingId, destination, displayName?, events[]}` with strict rejection of caller `tenantId/businessId`; bearer + active binding resolve immutable scope before `handleAgentTurn` (FR-028/050/051) |
| GET/POST/DELETE | `/api/agent/heartbeat` | FR-141: Business-scoped Edge Device heartbeat registry (ADR-041 D3). Every method resolves the trusted viewer first (401 otherwise). `POST` records a validated heartbeat for a Business the viewer owns (400 on a failed parse, 403 unowned; `deviceToken` accepted but never stored or returned); `GET` lists the viewer's owned devices with `online` = healthy and heard from within 120 s (`?businessId=` narrows to one owned Business); `DELETE ?deviceId=` removes one device, `DELETE` alone clears the viewer's owned scope. Process-local per instance by decision; registration, status transitions and removals are audited (SEC-008, SEC-001) |
| GET | `/api/health` | FR-142: deployment liveness probe (ADR-058). No session required; runs one trivial `SELECT 1` against the configured database and answers `{status:'ok', db:'ok', uptimeSeconds, dbLatencyMs, checkedAt}` (200) or `{status:'degraded', db:'unreachable', …}` (503), `cache-control: no-store`. Never carries an error message, host or credential (SEC-009). Docker Compose polls it to mark `web` healthy and to start ngrok after it |
| GET | `/api/projects/[id]/tree` | nested project → part-projects → part-tasks → workpackages for the Structure Plan (WBS) canvas |

## Asset Management intake validation (FR-133..136 — foundation preview)

| Method | Path | Contract |
|---|---|---|
| POST | `/api/assets/intakes/validate` | trusted viewer plus selected visible Business and `assets` domain grant; the request body is one strict `AssetIntakeEnvelope` (including its Business and optional depreciation input) → `{mode: PREVIEW_ONLY, applied: false, validation, depreciationPreview?, unavailableAdapters}`. The server derives Tenant/Business authority, rejects cross-Business input and performs no upload, OCR/Vision call, LINE retrieval, Sheet synchronization, Procurement lookup, registration, Finance approval, journal posting or other provider action. Validation candidates remain human-review evidence (FR-133..136, SEC-023, ADR-055). |

## Asset evidence execution (FR-137..140)

Browser evidence/workbook mutations carry the selected Business in
`x-zuri-business-id` so viewer/domain/write authority can be resolved before multipart
bytes are parsed. JSON routes carry a Business in their canonical body and still derive
Tenant/authority server-side. All collection/workbook surfaces are capped; no route
returns an object-store credential, raw blob reference or public evidence URL.

| Method | Path | Contract and side effects |
|---|---|---|
| POST | `/api/assets/evidence` | multipart `file`, selected Business header, owner/`ASSET_RECEIVER`; allow-listed magic bytes and 20 MiB cap → `{evidence:{id,code,name,mime,size,sha256,status}}`. Private object upload precedes MANAGED_BLOB FileAsset metadata; metadata failure best-effort removes the object; same-Business active duplicate hash returns the existing FileAsset. |
| POST | `/api/assets/evidence/[id]/extract` | selected Business header and write authority; reads one active same-Business FileAsset, invokes the configured OpenAI Responses adapter with `store:false` and strict structured output, stores `EXTRACTED` candidate/provenance and audit evidence. It cannot review or approve. Provider/config/timeout/schema failure changes no review/readiness state. |
| GET | `/api/assets/evidence/[id]/extraction-job` | implemented (FR-143): the latest extraction job for one piece of evidence, so the review surface can show that a device holds the work — `{ job: { id, status, claimedByDeviceId, claimedAt, leaseExpiresAt, attempts, lastError, provider, model, … } }` or `{ job: null }`. Read-only; it never queues, claims or cancels Refusals: `400` without `x-zuri-business-id`; `404 Asset evidence not found` outside the caller's write scope |
| POST | `/api/edge/extraction-jobs/claim` | implemented (FR-143, device-authenticated): a Zuri Edge Device claims the oldest waiting job of the Business its credential names → `200 { job }`, or `204` with no body when the queue is empty. The request body must be empty: everything that decides which job this is comes from the credential, so a device cannot name a Business, a device id or a job (ADR-059 D2) Refusals: `401` without an `edgk_` bearer; `400` for any body |
| GET | `/api/edge/extraction-jobs/[id]/evidence` | implemented (FR-143, device-authenticated): the evidence bytes for a job this device currently holds, served by the application with the `FileAsset` MIME. No bucket URL, signed link or storage credential ever crosses to the device (ADR-041 D3, SEC-025) Refusals: `401` without a credential; `404` for another device's job, another Business's job, an expired lease or an unknown id — all identical |
| POST | `/api/edge/extraction-jobs/[id]/complete` | implemented (FR-143, device-authenticated): `{ candidate, model }`. The candidate is validated with the same schema the cloud adapter asks its provider for (SDD-085) and written exactly as `extractAssetEvidence` writes one — `extractionJson`, evidence `EXTRACTED`, one `ASSET_EVIDENCE_EXTRACTED` audit event naming provider `edge`, the model and the device. It sets no review or approval state (BR-025) Refusals: `400` for a candidate the schema rejects — which also fails the job with the reason recorded; `404` for a job this device does not hold, including a late reply after the lease expired |
| POST | `/api/edge/extraction-jobs/[id]/fail` | implemented (FR-143, device-authenticated): `{ reason }`. Below three attempts the job returns to the queue for another try; at the ceiling it stays FAILED with the reason the reviewer sees Refusals: `401` without a credential; `404` for a job this device does not hold |
| POST | `/api/assets/evidence/[id]/review` | selected Business header plus owner/`ASSET_REVIEWER`; strict `{decision: ACCEPT, CORRECT or REJECT; corrections[]; note?}` appends a review version, reviewer/time and audit evidence, then recalculates intake readiness without overwriting extraction. |
| POST | `/api/assets/intakes` | one canonical `AssetIntakeEnvelope`; owner/receiver; all FileAsset refs must be active and same-Business. Persists normalized/validation snapshots, evidence and typed refs transactionally. `Business + channel + correlation` replay returns the prior intake only when payload hash agrees; otherwise 409. Highest result is `READY_FOR_REGISTRATION`. |
| GET | `/api/assets/import/template?businessId=` | authorized read; returns generated `.xlsx` with Read Me, Assets, Evidence, ProcurementRefs and Lookups. No mutation. |
| POST | `/api/assets/import/xlsx` | selected Business header, owner/receiver and multipart `.xlsx` up to 10 MiB; returns envelopes, validations and sheet/row/column errors. No persistence. |
| POST | `/api/assets/import/sheets` | strict `{businessId,spreadsheetId,revisionId,range,rows}` with at most 500 rows; returns server snapshot hash plus canonical preview. No Google OAuth, remote fetch, polling, two-way sync or apply. |
| GET | `/api/assets/intakes/export?businessId=` | authorized read; returns at most 500 active intake snapshots as Google Sheets-ready `.xlsx`, excluding blob refs/credentials/raw bytes. |
| POST | `/api/agent/line-asset-handoff` | trusted binding/correlation plus 1..20 opaque FileAsset IDs. zuri-cli owns LINE verification and bytes. The body schema rejects Tenant/Business/tokens/secrets/URLs; zuri-ai derives Business from the server binding and writes through the idempotent canonical intake service. |

Runtime configuration for provider-backed calls is server-only:
`SUPABASE_URL`, `SUPABASE_STORAGE_SERVICE_ROLE_KEY` (or existing service-role alias),
`ZURI_ASSET_EVIDENCE_BUCKET`, `OPENAI_API_KEY`, and optional
`ZURI_ASSET_EVIDENCE_MODEL`. The bucket must already exist and remain private.

## Asset Register management (FR-133, FR-135)

| Method | Path | Contract and side effects |
|---|---|---|
| GET | `/api/assets/lookup` | authorized fast read; `{businessId, code? \| token? \| id?}` resolves registered asset by Asset Code, QR lookup token, or serial number with active custodian, location, and project allocation. |
| GET | `/api/assets/register` | authorized read; `{businessId, search?, categoryCode?, status?, branchId?, limit?, cursor?}` returns paginated registered assets list with counts and facets. |
| POST | `/api/assets/register` | owner/writer; `{businessId, intakeId, assetCode?}` promotes a READY_FOR_REGISTRATION intake into canonical `RegisteredAsset`, mints formatted `AST-YYYY-XXXXX` and QR token, and records `ASSET_REGISTERED` audit event. |
| GET | `/api/assets/register/[id]` | authorized read; `{businessId}` with route param `id` returns registered asset detail, location history, and responsibility history. |
| POST | `/api/assets/register/[id]/responsibility` | owner/writer; `{businessId, role, personId, orgUnitRef?, effectiveFrom?, note?}` closes current active responsibility interval and creates new `AssetResponsibility` with audit logging. |
| POST | `/api/assets/register/[id]/relocate` | owner/writer; `{businessId, branchId?, locationCode, locationName, isPrimary?, effectiveFrom?, note?}` closes current primary location interval and creates new `AssetLocationHistory` with audit logging. |
| POST | `/api/assets/register/[id]/allocate` | owner/writer; `{businessId, projectId, workstreamId?, quantity?, exclusive?, effectiveFrom?, purpose?}` allocates asset to project/workstream, sets status to `IN_USE` with audit logging. |
| POST | `/api/assets/register/[id]/return` | owner/writer; `{businessId, allocationId?, returnCondition?, effectiveTo?, note?}` closes project allocation, updates condition, sets status to `ACTIVE` when unallocated with audit logging. |
| POST | `/api/assets/register/[id]/verify` | owner/writer; `{observedLocationName?, observedBranchId?, condition?, notes?, relocateIfMismatch?}` records physical stocktake scan observation, updates condition and location if requested, emitting `ASSET_PHYSICALLY_VERIFIED` audit event. |
| GET | `/api/assets/register/[id]/depreciation` | authorized read; `{businessId, usefulLifeMonths?, residualValue?, recalculate?}` returns deterministic straight-line depreciation schedule preview and persists preview candidate (FR-136). |
| GET/POST | `/api/assets/register/[id]/maintenance` | owner/writer; GET lists service history logs from audit stream; POST creates maintenance ticket (`action: CREATE`, status → `MAINTENANCE`) or completes repair (`action: COMPLETE`, status → `ACTIVE`/`IN_USE`) with audit logging (FR-133, FR-135). |
| GET/POST | `/api/assets/register/[id]/dispose` | owner/writer; GET lists disposal records from audit stream; POST finalizes decommissioning & disposal (`method: SCRAP\|SELL\|DONATE\|LOSS_THEFT`, status → `DISPOSED`), verifies no active project allocation, and records `ASSET_DISPOSED` audit event (FR-133, FR-135). |

## SmartGift document intake (FR-071 — staging receiver)

These routes are the CloudSoTAgent boundary for the local SmartGift
`smartgift.document-intake.v1` contract. They resolve the IntegrationConnection
server-side and never accept Tenant or Business authority from the request body.
The receiver writes only to the existing private `RawExternalRecord` application
staging layer, creates an `IngestionRun` and `AuditEvent`, and does not promote
Product or Customer data into canonical tables.

| Method | Path | Contract |
|---|---|---|
| POST | `/api/ingest/documents` | installation-operator only; `{connectionId, contract}`; validates artifact hash/document id, Thai document evidence, domain allowlist, classification and staging target; exact idempotent replay returns `UNCHANGED`; response contains receipt IDs/hashes/counts only |
| GET | `/api/ingest/documents` | Business-visible read; `{businessId, rawRecordId?, domain?, limit?}` resolves the active primary document-intake connection server-side, while `{connectionId, ...}` remains available to operators; returns `configured: false` when no receiver is provisioned and otherwise returns bounded monitor metadata (IDs, hashes, counts, status and methods) with raw payload, source path and restricted fields redacted |

The connection must be an active primary connection with
`provider=SMARTGIFT_DOCUMENT_INTAKE` and
`purpose=DATA_DOCUMENT_INGESTION`. Production provisioning of that connection,
remote Supabase/RLS evidence, and the later validated canonical promotion remain
explicit gates outside this receiver slice.

The Codex bridge uses `data_pipeline.document_stage` so the server resolves the
active connection from the server-owned `PipelineRun`; the local outbox cannot
choose `tenantId`, `businessId` or `connectionId`.

## SmartGift full pipeline tracking (FR-071 — local ledger and monitor)

These server-owned routes expose only redacted run/step/record/reconciliation/
gate evidence. Pipeline events are validated against the FR-071 identity and
transition contract; replay creates a queued lineage request and does not claim
that a Codex worker or Supabase apply executed.

| Method | Path | Contract |
|---|---|---|
| GET | `/api/pipelines/health` | FR-215 (ADR-085 D5): bounded live health read model for the active Business only — authorizes the Knowledge and owning-domain scope, reads `PipelineRun`, `LineConversationJob`, `LineOaRichMenuJob` and `AssetExtractionJob` through one bounded read port each, returns counts/failures/last-run timestamps when available, and returns unavailable/null on failed reads without inventing zeroes |
| GET | `/api/pipelines/runs` | scope-filtered bounded run list; `businessId`, `status`, `limit` and provenance filters are server-validated |
| POST | `/api/pipelines/runs` | installation operator creates one idempotent `QUEUED` run envelope; source/artifact identity and scope are explicit |
| GET | `/api/pipelines/runs/[executionRunId]` | server-filtered monitor read model with stage timeline, first failure, redacted record outcomes, reconciliation, gate evidence, freshness and lineage |
| POST | `/api/pipelines/runs/[executionRunId]/events` | installation operator/allow-listed worker submits stage, record, heartbeat, reconciliation or gate event with exact idempotency |
| POST | `/api/pipelines/runs/[executionRunId]/replay` | authorized operator creates a new queued full/stage/record/provenance replay lineage after source/hash/scope checks |
| GET | `/api/pipelines/knowledge/[executionRunId]` | FR-109/FR-110 (ADR-067): one `pipeline_job_id` resolves a `DPL-KNOWLEDGE-INGEST-V1` run, its seventeen step identities (the `executionStepId`/`attemptId` a reporter must echo), gate decisions and the clockless §5 job state; readable by whoever may read the run and by the run's Tenant's FR-102 data-plane key |
| POST | `/api/pipelines/knowledge/[executionRunId]/stages` | FR-110 (ADR-067): GKS/GenesisBlockDB report one Stage 9–16 occurrence — strict envelope of control identity, scope, `outcome`, BR-022 `failure`, `startedAt`/`finishedAt` and the six NFR-020 counters; a Tier 1 stage id is refused, a step/attempt/stage that disagree with the materialised row is 409, the same report replays `UNCHANGED`, a conflicting retry is 409 |
| POST | `/api/pipelines/knowledge/[executionRunId]/gate` | FR-110 AC-110.4 (ADR-067): the Stage 17 decision, recorded as `PipelineGateDecision` evidence (verdict, snapshot, five dimensions) with an FR-071 ledger status; the shared envelope refuses an `APPROVED` row whose verdict or dimensions block publication |
| POST | `/api/pipelines/knowledge/[executionRunId]/finish` | FR-110 (ADR-067 D3): closes the run from the ledger — `SUCCEEDED` only with every executed stage 2–17 succeeded behind an approved, publishable gate, `FAILED` on any failed stage or rejected gate, otherwise 409 with the list of what is still owed; the body carries no status |
| POST | `/api/pipelines/knowledge/evidence/pull` | FR-110 (ADR-068): one installation-operator tick of the evidence pull — `zuri-ai → MSP → gks_stage_evidence_export` for one `KnowledgeScope` (`{ scope, limit?, maxPages? }`), every attributable Stage 9–16 row applied through the reporter receiver, the per-scope cursor advanced only past rows that landed; returns `applied` / `unattributed` / `held` / `blocked`; 503 when `ZURI_MSP_COMMAND` is not configured |

## Verification and release boundary

`scripts/doc-preflight.mjs` performs the mechanical checks:

- every current API route handler is represented by a current path in this
  appendix;
- the `api-spec-counts` route-handler marker matches the route-file enumeration;
- the interface inventory separately covers every current page route and its
  published operational domain counts; and
- generated graph/projection freshness is checked by `npm run docs:check`.

Missing current paths are release-blocking documentation drift. Planned/deferred
paths are allowed only in the explicitly labelled deferred section and are not
included in the current handler count. A passing local check still does not prove
production identity, external Secret Manager availability, LINE activation or
canary evidence; those remain owner-gated release criteria.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.92.0b | 2026-09-22 | candidate | FR-268 (ADR-101 D6 Phase 1): three handler files under `/api/business/goals/[id]/key-results` and `/api/business/key-results/[id]`(`/check-ins`) — create/patch a Key Result and record a weekly check-in, OWNER-only, write-through recompute of the parent Goal's progress (SDD-107, BR-044). Route handler count 331 -> 334 | working-tree | Claude Sonnet 5 |
| 1.90.0b | 2026-09-22 | candidate | FR-069: add owner-attested FUNG/Lalin AI meeting identity binding plus strict meeting-action dry-run/commit handoff into the PM PlanEnvelope single-writer path; route handler inventory 326 -> 329 | working-tree | Codex |
| 1.88.0b | 2026-09-19 | candidate | Compose FR-254 Knowledge Console source, scoped run/corpus/citation routes and artifact lineage contract with the current 309-path baseline; target 315 paths/419 operations | 2bd61b49 | RWANG |
| 1.87.0b | 2026-09-18 | candidate | Add authenticated TaskUsageLedger projection and explicit taskCode attribution; reconcile composed inventory to 309 paths/412 operations; no database model or migration | 56ae925a | RWANG |
| 1.86.0b (LINE local execution v2) | 2026-09-17 | beta | Preserve the live FR-254 Knowledge Console and add approved LINE local execution v2 context/tool routes on the pricing and CRM baseline; route handler inventory 302 -> 304 and operations 402 -> 404. Production activation remains separate. | composition-2bd61b49-0c7fd884 | RWANG |
| 1.86.0b | 2026-09-17 | candidate | Compose eight Feature writes, snapshot capture, strict schemas/refinements and owner read-side CAS headers; target 308 paths/411 operations, final composed verification pending | 052821a7 + 892f23f3 | RWANG |
| 1.85.0b | 2026-09-17 | candidate | Compose FR-252 CSRF and four Feature GET routes with main 892f23f3; preserve Pricing, CRM and LINE. Inventory 303 paths/402 operations; read/API tests locally pass, full composed gates pending | 052821a7 + 892f23f3 | RWANG |
| 1.84.0b | 2026-09-17 | beta | Compose FR-253 Pricing, deployed CRM legal hold and LINE context/tool routes; 298 paths/397 operations | 892f23f3 | RWANG |
| 1.83.0b (PM branch) | 2026-09-17 | candidate | Add FR-252 Identity CSRF issuer and typed runtime Swagger; one GET handler (289 to 290), implementation verification in progress | bd99651f | RWANG |
| 1.83.0b | 2026-09-17 | beta | Approved LINE local execution v2: negotiated deadline, scoped memory/corpus context, invocation receipts; add device-scoped context and Project/Work tool routes (296 → 298). Production activation remains separate. | working-tree | RWANG |
| 1.83.0b | 2026-09-17 | candidate | FR-254 adds six console route handlers and GET source history; current authority, cursor pages and immutable citation artifacts | working-tree | RWANG |
| 1.82.0b | 2026-09-17 | candidate | Implement and locally verify owner-approved FR-251 read-only Domain-view contract and runtime Swagger; one GET handler added (288 → 289), typed scope refusals and operation-only SessionAuth verified | reviewed baseline 7465080f; PR443 | RWANG |
| 1.82.0b | 2026-09-16 | candidate | SEC-034 (ADR-093 D6, TASK-ZAI-113): one handler file, `POST /api/crm/customers/[customerId]/legal-hold` — records an OWNER-recorded legal hold on a Customer's chat evidence archive; while active, a PDPA erasure defers destroying the archive key instead of destroying it. Route handler count 288 -> 289 | working-tree | Claude Sonnet 5 |
| 1.82.0b (Knowledge branch) | 2026-09-16 | candidate | FR-215: add `GET /api/pipelines/health` as a Business-scoped local read model backed by four owning-domain ports; unavailable reads remain null and unbacked edges have no number. Route handler count 288 -> 289 | working-tree | RWANG |
| 1.81.0b | 2026-09-16 | candidate | FR-248, FR-249 (ADR-095 D2, D3): two handler files, `POST/GET /api/platform/usage-events` (record one's own usage; operator reads the breakdown) and `POST /api/platform/usage-events/rollup` (deployment-authenticated 90-day rollup, same shape as the retention sweep). Route handler count 286 -> 288 | working-tree | Claude Sonnet 5 |
| 1.80.0b | 2026-09-16 | candidate | FR-247 (ADR-095 D1): two handler files, `GET /api/platform/error-events` and `PATCH /api/platform/error-events/[id]` — the deduplicated error list and its resolve action, both operator-only and audited, never request/response content. Route handler count 284 -> 286 | working-tree | Claude Sonnet 5 |
| 1.79.0b | 2026-09-16 | candidate | FR-245 (ADR-093 D7, TASK-ZAI-112): one handler file, `POST /api/crm/customers/[customerId]/chat-evidence/retrieve` — the archive's one retrieval path, OWNER at AAL2 through the FR-224 gate, grouped by session, every attempt audited. Route handler count 283 -> 284 | working-tree | Claude Sonnet 5 |
| 1.78.0b | 2026-09-16 | candidate | FR-244 (ADR-094 D6 option A, TASK-ZAI-109): one handler file, `POST /api/edge/model-residency` — the compute-owned edge worker's identity-free residency poll, returning one aggregate `shouldBeWarm` boolean derived from every server-enabled account's declared business hours, never an account id or a per-account schedule (ADR-061). Route handler count 282 -> 283 | working-tree | Claude Sonnet 5 |
| 1.77.0b | 2026-09-16 | candidate | FR-246 (ADR-093 evidence gap, TASK-ZAI-110): one handler file, `POST /api/crm/conversations/[id]/reply` — the staff reply writer, a Business owner replying from the Inbox composer, pushed through the LINE transport and recorded only on acceptance. Route handler count 281 -> 282 | working-tree | Claude Sonnet 5 |
| 1.76.0b | 2026-09-15 | candidate | FR-230 (ADR-091 D1, D2): one handler file, `POST /api/crm/retention-sweep` — the missing scheduled entry point for the nightly retention sweep, deployment-authenticated, same-UTC-day idempotency guard against a scheduler retry. Route handler count 280 -> 281 | working-tree | Claude Sonnet 5 |
| 1.75.0b | 2026-09-15 | candidate | FR-236 (ADR-090 D6, TASK-ZAI-099): one handler file, `PATCH /api/businesses/[id]/knowledge-candidates-toggle` — the only writer of `Business.knowledgeCandidatesEnabled`, gating LINE FAQ knowledge candidate drafting per Business (off by default). Same shape as the `capabilities` route (FR-169). Route handler count 279 -> 280 | working-tree | Claude Sonnet 5 |
| 1.74.0b | 2026-09-14 | candidate | FR-237 (ADR-090 D7): one handler file, `GET /api/knowledge/gap-report` — aggregates `EVIDENCE_SELECTED` trace events with `reason=NO_EVIDENCE` per Business, returning counts, product locators and last-seen times only, never the question text. Route handler count 276 -> 277 | working-tree | Claude Sonnet 5 |
| 1.73.0b | 2026-09-14 | candidate | FR-236 (ADR-090 D6): four handler files under `/api/knowledge/candidates` — list/draft, read/edit one, and the audited APPROVE/REJECT decision that admits an approved candidate through the existing ADR-072 admission service. Route handler count 273 -> 276 | working-tree | Claude Sonnet 5 |
| 1.67.0b | 2026-09-13 | candidate | FR-208 / FR-209 (ADR-084 catalogue intake): six handler files under `/api/inventory/catalog-intakes` — the list, preview, commit, one intake (GET + CANCEL), the Business-specific workbook template and the workbook upload preview. Route handler count 257 -> 263 | working-tree | Claude Opus 5 |
| 1.66.0b | 2026-09-13 | candidate | FR-201..FR-207 (ADR-083 SKU governance): five new handler files under `/api/inventory` — `products/resolve` (GET), `products/[id]/identifiers` and `products/[id]/unit-conversions` (GET/POST/PATCH), `catalog-hygiene` and `replenishment` (GET) — plus the nature / variant / lifecycle fields and refusals on the product collection and item and the `services` / `phaseOut` / `belowReorderPoint` counts on the stock summary. Route handler count 252 -> 257 | working-tree | Claude Fable 5.1 |
| 1.65.0b | 2026-09-12 | candidate | FR-193 (ADR-078 D1): added the Employment WRITE path, which had been declared and built as a service and then left unreachable — `POST /api/people/employment` and `PATCH /api/people/employment/[employmentId]` (`on_leave` / `reinstate` / `end`, the last requiring a reason). `employment-service.js` shipped all four operations in 1.63.0b-era work and no route imported it, so the People Directory could only show rows the ADR-078 backfill created — and on production that was none, because no `Membership.employeeRef` values existed to carry over. The page told the owner to add a record and offered no control that wrote one. Route handler count 250 -> 252 | working-tree | Claude Opus 5 |
| 1.64.0b | 2026-09-12 | candidate | FR-198 / FR-199 (ADR-080): added the access-review read surface that had no route — `GET /api/platform/access-history?businessId=\|tenantId=\|personId=` (the event stream for one scope, authority `ownsBusiness`/`ownsTenant`/self/operator, 404-shaped identically for unowned and nonexistent per SEC-001) and `GET /api/platform/businesses/[businessId]/grants` (current-state roster with provenance). Route handler count 248 -> 250 | working-tree | Claude Opus 5 |
| 1.63.0b | 2026-09-12 | candidate | FR-191 / FR-192 (ADR-077): added the grant-withdrawal surface that did not exist — `POST /api/platform/users/memberships/{id}/lifecycle` (suspend / reinstate / revoke) and `POST /api/platform/users/offboard`. Before this, `Membership.status` had no writer anywhere in the repository, so removing someone's access meant SQL against production (`.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md`). Route handler count 246 -> 248 (242 before this pair of branches; FR-094/095/096 took it to 246 in 1.62.0b) | working-tree | Claude Opus 5 |
| 1.62.0b | 2026-09-12 | candidate | FR-094/FR-095/FR-096: added MFA TOTP and step-up session assurance endpoints — `POST /api/auth/mfa/totp/enroll`, `POST /api/auth/mfa/totp/verify`, `GET/DELETE /api/auth/mfa/factors`, and `POST /api/auth/step-up`. Route handler count 242 -> 246 | working-tree | Antigravity |
| 1.61.0b | 2026-09-12 | candidate | FR-097: added verified channel onboarding and identity binding endpoints — `POST /api/identity/link-tokens`, `POST /api/identity/link-tokens/redeem`, and `GET /api/identity/channel-identities`. Single-use time-bounded link tokens with fail-closed channel identity verification before agent tool execution. Route handler count 239 -> 242 | working-tree | Antigravity |
| 1.60.0b | 2026-09-12 | candidate | FR-190: added `GET /api/line-oa/accounts/[id]/transport-health` — silence and endpoint-agreement states for a serverEnabled LINE account, read-only. Route handler count 238 -> 239 | working-tree | CLAUDE |
| 1.57.0b | 2026-09-11 | candidate | Reconcile SCM, receipt reads and approved Billing/POS routes: 231 handlers | working-tree | RWANG |
| 1.56.0b | 2026-09-11 | candidate | FR-186/FR-183: registered the Business-scoped billing configuration, preview/issue/read document routes and POS catalogue/checkout routes; the current route-handler marker is 216. Preview remains non-persistent, issue persists an immutable THB snapshot with idempotency, and POS leaves payment PENDING until the existing verifier acts | working-tree | RWANG |
| 1.56.0b | 2026-09-11 | candidate | FR-165: scoped paginated receipt registry and persisted receipt detail; 210 → 212 handlers, existing posting contract retained | working-tree | RWANG |
| 1.55.0b | 2026-09-10 | candidate | FR-149: added `GET /api/line-oa/jobs/failures?businessId=` — the honest count of terminal FAILED conversation jobs behind the Studio's red failure card. Also corrected the webhook row (since PR #306 the 200 acknowledges evidence capture, not admission) and recorded the worker tick's new abandoned-admission sweep. Route handler count 209 → 210 | working-tree | Claude Opus 5 |
| 1.51.0b | 2026-09-07 | candidate | FR-110 (ADR-068): added the evidence pull tick `POST /api/pipelines/knowledge/evidence/pull` (operator; zuri-ai → MSP → GKS). Route handler count 198 → 199 | working-tree | Claude Fable 5.1 |
| 1.50.0b | 2026-09-07 | candidate | FR-110 (ADR-067): added the knowledge ingestion reporter surface — `GET /api/pipelines/knowledge/[executionRunId]` and `POST …/stages`, `…/gate`, `…/finish`, each accepting the run's Tenant's FR-102 data-plane key ahead of the session. Route handler count 194 → 198 (rebased onto main after the Commerce/Procurement families landed) | working-tree | Claude Fable 5.1 |
| 1.50.0b | 2026-09-07 | candidate | FR-169 (ADR-069): added `PATCH /api/businesses/[id]/capabilities` — the only writer of `Business.capabilitiesJson`, gating the Warehouse slot. Route handler count 199 → 200 | working-tree | Claude Sonnet 5 |
| 1.49.0b | 2026-09-07 | candidate | FR-164/FR-165 (ADR-066): added the Procurement family — `GET/POST /api/procurement/suppliers`, `GET/PATCH /api/procurement/suppliers/[id]`, `GET/POST /api/procurement/purchase-orders`, `GET/PATCH /api/procurement/purchase-orders/[id]`, `GET/POST /api/procurement/purchase-orders/[id]/receipts`. Route handler count 177 → 182 | working-tree | Claude Fable 5.1 |
| 1.48.0b | 2026-09-07 | candidate | FR-166/FR-163 (ADR-065): added the Commerce family — `GET/POST /api/commerce/orders`, `GET/PATCH /api/commerce/orders/[id]`, `GET/POST /api/commerce/orders/[id]/payments`, `GET/PATCH /api/commerce/payments/[id]`, `GET /api/commerce/revenue`. Route handler count 181 → 186 | working-tree | Claude Fable 5.1 |
| 1.47.0b | 2026-09-07 | candidate | Reconcile FR-161 CRM Sales Tasks and FR-162 Marketing Operations; the combined API inventory contains 184 route handlers and the generated OpenAPI document contains 252 operations | working-tree | RWANG |
| 1.46.0b | 2026-09-07 | candidate | FR-161 (ADR-064): added the CRM sales-task pair `GET/POST /api/crm/sales-tasks` and `GET/PATCH /api/crm/sales-tasks/[id]`. Route handler count 179 → 181 | working-tree | Claude Fable 5.1 |
| 1.45.0b | 2026-09-06 | candidate | Reconcile Warehouse and Marketing; 179 paths and 243 operations in the Server app | See git history | RWANG |
| 1.42.0b | 2026-09-06 | candidate | FR-133/FR-135: added Decommissioning & Disposal lifecycle endpoints (`GET/POST /api/assets/register/[id]/dispose`). Route handler count 153 → 154 | working-tree | Antigravity |
| 1.41.0b | 2026-09-06 | candidate | FR-133/FR-135/FR-136: added Straight-line Depreciation Schedule preview (`GET /api/assets/register/[id]/depreciation`) and Preventive Maintenance & Repair Ticketing (`GET/POST /api/assets/register/[id]/maintenance`) endpoints. Route handler count 151 → 153 | working-tree | Antigravity |
| 1.40.0b | 2026-09-06 | candidate | FR-133/FR-135: added Fast QR lookup (`GET /api/assets/lookup`) and Physical Verification / Stocktake observation (`POST /api/assets/register/[id]/verify`) endpoints. Route handler count 149 → 151 | working-tree | Antigravity |
| 1.39.0b | 2026-09-06 | candidate | FR-133/FR-135: added the three Asset Register endpoints (`GET/POST /api/assets/register` and `GET /api/assets/register/[id]`) for asset master listing, detail with history, and transactional promotion from READY_FOR_REGISTRATION. Route handler count 141 → 143 | working-tree | Antigravity |
| 1.36.0b | 2026-09-04 | candidate | `GET /api/audit` additionally returns an `entityTypes` facet — every entityType present in the log with its row count, counted across the whole table rather than the current filter. The audit console's entity filter is built from it; the hand-kept list it replaces offered 15 of the 57 entityTypes this codebase writes, and missed four of the seven types actually present in production. Additive: no request parameter changes and no existing response field moves. | working-tree | Claude Code |
| 1.38.0b | 2026-09-06 | candidate | FR-146 adds the LINE OA Studio account surface: `GET/POST /api/line-oa/accounts` and `GET/PATCH /api/line-oa/accounts/[id]` — connect an existing LINE_OA connection as an account, list/read with computed health, versioned actions as compare-and-swap; archive is an action, never a DELETE. Route handler count 129 → 131 | working-tree | Claude Fable 5.1 |
| 1.35.0b | 2026-09-04 | candidate | FR-144 adds the three edge device credential operations under `/api/platform/edge-devices/credentials`; FR-143 adds the four device-authenticated job operations under `/api/edge/extraction-jobs` and the review surface's `GET /api/assets/evidence/[id]/extraction-job`, and gives the existing extract route a provider choice (202 + job on the edge path). Route handler count 122 → 129 | working-tree | Claude Code |
| 1.34.0b | 2026-09-03 | candidate | FR-092 gains its production trigger: `POST /api/market/translations` (owner-only, body `{ businessId, limit? }`, one audit event per run). Closes D2-domain-market-intelligence-07 and D3-integration-knowledge-document-intake-05 — the translation seam had no caller outside tests. Acquisition adapters stay unwired pending a source-specific legal/ToS review (FR-092 feature note, "Decision 2026-09-02"); route handler count 118 → 119 | working-tree | Claude Code |
| 1.33.0b | 2026-09-02 | candidate | Gap-fix wave 2 integration: FR-038 `POST /api/platform/users/memberships` (an owner attaches an existing Person to an owned Business as MEMBER — the first surface that can create a Business-level Membership for somebody other than the caller); FR-106 `GET /api/platform/api-access-keys` (metadata-only listing under the mint/revoke authority); FR-061/062 domain grants are now enforced server-side on the crm, market and people families — a caller whose Membership lacks the domain receives `404 Business not found`, indistinguishable from an unknown Business. Handler-count marker reconciled to the route tree | — | Claude Code |
| 1.32.0b | 2026-09-02 | candidate | FR-022: added `POST /api/crm/customers/[customerId]/erasure`, the first production path to PDPA erasure (the function existed and nothing could call it — D2-domain-identity-09, D3-line-agent-crm-flow-03). The same change completes the erasure itself: `Message.body` and the matching `RawExternalRecord` payloads are now tombstoned inside the transaction, so the erased person's own words no longer survive the request (D3-line-agent-crm-flow-08). Route handler count 118 → 119 | working-tree | Claude Fable 5.1 |
| 1.31.0b | 2026-09-02 | candidate | Gap-fix wave 1 integration: FR-067 gains `GET /api/workspace-memberships?portfolioId=` (owner roster — one more operation on an existing path); the FR-092 observation reader and the FR-141 heartbeat rows landed under their own revisions in the same wave; the handler-count marker is unchanged by this row | — | Claude Code |
| 1.30.0b | 2026-09-02 | beta | Added nine FR-137..140 evidence/intake/import/export/LINE route contracts; handler count 108 → 117 | working-tree | RWANG |
| 1.29.0b | 2026-09-02 | candidate | Added the preview-only `POST /api/assets/intakes/validate` boundary for FR-133..136; route handler count 107 → 108. It resolves viewer/Business/domain authority before validating and explicitly performs no persistence or provider actions | working-tree | Codex |
| 1.27.0b | 2026-08-30 | candidate | FR-123 / ADR-052: added the four-route plugin authorization boundary — `GET /api/plugin/auth/authorize`, `POST /api/plugin/auth/token`, `GET /api/plugin/auth/capabilities`, `POST /api/plugin/auth/revoke`. `token` and `revoke` join login/logout/signup/reset-password in preflight's structural route-viewer exemption rather than its baseline, for the same reason: the only credential either one has is the one-time code or the opaque bearer it was handed, so requiring a browser viewer would be a second, wrong identity boundary rather than a check. `authorize` is deliberately not exempt — it is the one route in the family that must have a browser session, and it resolves one. Route handler count 103 → 107 | working-tree | Claude Opus 5 |
| 1.26.0b | 2026-08-29 | candidate | FR-120: added `POST /api/auth/signup` — the first public route that creates an identity rather than consuming one, which is also why it joins login, logout and reset-password in preflight's structural route-viewer exemption rather than its baseline: demanding a viewer from someone who does not yet have an account is a broken authentication boundary, not accepted debt; route handler count 102 → 103 | working-tree | Claude Opus 5 |
| 1.25.0b | 2026-08-27 | candidate | FR-108: added `POST /api/import/bundle/dry-run` and `POST /api/import/bundle/commit` (ExecutionPlanBundle orchestration above PlanEnvelope, ADR-049); both accept the FR-106 `apik_` key like the rest of the FR-019 surface; route handler count 100 → 102 | working-tree | Claude Fable 5 (subagent) |
| 1.24.0b | 2026-08-26 | candidate | FR-106: the FR-019 Enterprise API surface now accepts a Tenant-bound `apik_` bearer key ahead of the session seam; added `POST /api/platform/api-access-keys` (operator/Tenant-owner mint) and `DELETE /api/platform/api-access-keys/[id]` (revoke); route handler count 98 → 100 | working-tree | Claude Fable 5 |
| 1.23.0b | 2026-08-26 | candidate | FR-066/FR-067: added the seven onboarding and Workspace-collaboration handlers (`/api/onboarding/state\|profile\|workspaces`, `/api/workspace-invites` mint/accept/revoke, `/api/workspace-memberships` removal); route handler count 91 → 98 | working-tree | Claude Fable 5 (subagent) |
| 1.22.0b | 2026-08-26 | candidate | FR-104: added `POST /api/platform/users/password-resets` (owner/operator mint) and `POST /api/auth/reset-password` (public consume); route handler count 89 → 91 | working-tree | Claude Fable 5 |
| 1.21.0b | 2026-08-26 | candidate | FR-103 / SEC-005: added `POST /api/crm/customers/[customerId]/consent` (owner-gated PDPA consent attestation); route handler count 88 → 89 | working-tree | Claude Fable 5 |
| 1.20.0b | 2026-08-24 | candidate | FR-102: `POST /api/platform/sot/decisions` and `GET /api/platform/sot/decisions/export` now also accept a Tenant-bound FR-102 data-plane bearer key ahead of the session seam; route handler count remains 88 | working-tree | Claude Fable 5 |
| 1.18.0b | 2026-08-23 | candidate | Added the scoped PM MCP work read/status loop after PlanEnvelope commit; route handler count remains 84 | working-tree | ATHER |
| 1.19.0b | 2026-08-24 | candidate | FEAT-011 SoT Pipeline Console: four /api/platform/sot handlers (plan, decisions list+submit, decide, export); route handler count 84 → 88 | working-tree | Claude Fable 5 |
| 1.17.0b | 2026-08-22 | candidate | Replaced credential-free session login with `/api/auth/login` and `/api/auth/logout`, signed sessions, and updated the handler count to 84 | working-tree | ATHER |
| 1.16.0b | 2026-08-21 | candidate | Removed the retired `/api/session/demo` route from the current API inventory; handler count is 82 | working-tree | ATHER |
| 1.15.0b | 2026-08-21 | candidate | Added the Codex-mediated FR-071 `data_pipeline.*` MCP bridge contract; route handler count remains 80 | working-tree | ATHER |
| 1.14.0b | 2026-08-21 | candidate | Added the FR-071 full-pipeline tracking route contract and updated the handler count to 80 | working-tree | ATHER |
| 1.13.0b | 2026-08-21 | candidate | Wired the FR-071 Business-visible redacted staging monitor and added Business-based connection resolution | working-tree | ATHER |
| 1.12.0b | 2026-08-21 | candidate | Added the FR-071 SmartGift document intake staging receiver and updated the handler count to 76 | working-tree | ATHER |
| 1.11.0b | 2026-08-20 | candidate | Added the FR-091 CRM conversation reader (list + thread) and updated the handler count to 75 | working-tree | ATHER |
| 1.10.0b | 2026-08-18 | candidate | Added the protected PM MCP JSON-RPC route contract and exact current handler count | working-tree | ATHER |
| 1.9.0b | 2026-08-18 | candidate | Added the FR-078 duplicate review queue API inventory and updated the route handler count to 66 | working-tree | ATHER |
| 1.8.0b | 2026-08-18 | candidate | Promote the Project Inventory endpoint from working-tree evidence to implemented local MVP after scoped publication | working-tree | ATHER |
| 1.7.0b | 2026-08-18 | candidate | Added contract completeness standard, current/deferred integration split, 63-handler evidence marker and release-boundary rules | working-tree | ATHER |
| 1.6.0b | 2026-08-18 | draft | Added Phase 1 integration metadata and Project Inventory route inventory | c519d0b | ATHER |


## Server LINE and optional compute (ADR-061)

| Method | Path | Authority and behavior |
|---|---|---|
| POST | `/api/line-oa/accounts/[id]/webhook` | Native LINE HMAC over raw bytes plus exact destination; scoped evidence capture is what the 200 acknowledges (PR #306), and atomic CRM/job admission runs after it, in-process and reconcilable; non-2xx redelivery, unique event/inbound keys. 1 MiB, 1000 events maximum. |
| POST | `/api/line-oa/worker` | Deployment bearer token, minimum 32 characters; bounded execution/send/reconciliation tick. Also sweeps at most 5 LINE evidence rows left `ADMITTING` for over 60 s and re-admits them from the stored payload, reporting `reconciled: { scanned, admitted, skipped, failed }` beside the tick result; a reconciler failure is reported, never raised. No browser or device authority. |
| GET | `/api/line-oa/accounts/[id]/jobs` | Studio Business visibility; latest 100 status DTOs, no message text/recipient/token. |
| GET | `/api/line-oa/accounts/[id]/transport-health` | Studio Business visibility; FR-190 reachability of a serverEnabled account: inbound silence state and whether the endpoint LINE has configured is still this deployment own route. States, timestamps and durations only — no channel credential, and never the other endpoint URL. Paused, draft and archived accounts answer `monitored:false` with the reason. |
| GET | `/api/line-oa/jobs/failures?businessId=` | Studio Business visibility (same 404 for unknown, invisible or ungranted); read model only, never a retry or acknowledgement. `{ businessId, total, byErrorCode[], failures[] }` — the honest unwindowed count of `FAILED` conversation jobs for the Business, a per-`errorCode` breakdown (a null code is reported as `null`, never relabelled) and the 20 most recently updated rows in the same DTO shape as the per-account list. `400 LINE_OA_BUSINESS_REQUIRED`. |
| POST | `/api/line-oa/jobs/[id]/acknowledge-unknown` | Studio publisher; `{version,acknowledgePossibleDelivery:true}` terminal audited closure without resend or delivery claim. |
| GET | `/api/line-oa/jobs/[id]/trace` | Business owner plus Studio visibility; exact persisted execution evidence and read-only playback. Derives Tenant/Business from the job; no model, tool or transport calls. Missing or erased evidence returns `REPLAY_INCOMPLETE`. |
| POST | `/api/edge/conversation-jobs/*` | **withdrawn (FR-265, ADR-100 D2)** claim, context, tools, complete and fail. LINE conversation execution is server-only; `/api/edge/extraction-jobs/*` and `/api/edge/pairing/*` are untouched. |
| POST | `/api/line-oa/connections` | Business owner. Body `{businessId,name,destination,secretRef:"deployment-secret:…"}` registers connection metadata for a mounted secret (FR-149). Body `{businessId,name,channelId,channelSecret,channelAccessToken?}` connects write-only (FR-223, FR-224, FR-226, ADR-089): ACTIVE TOTP factor and live AAL2 step-up (403 `MFA_FACTOR_REQUIRED` with `details[0].enrolmentPath`, 403 `ASSURANCE_LEVEL_INSUFFICIENT`), rate limit (429 `CREDENTIAL_RATE_LIMITED` + `retryAfterSeconds` and `Retry-After`), writable store required (503 `CHANNEL_SECRET_STORE_UNAVAILABLE`), live LINE validation (422 `LINE_CREDENTIALS_REJECTED` for a wrong Channel ID or secret alike, 422 `LINE_TOKEN_REJECTED`, 503 `LINE_UNAVAILABLE`), claim (409 `LINE_CHANNEL_ALREADY_CONNECTED` / `LINE_CHANNEL_CLAIMED_ELSEWHERE`, Thai sentence in `details`), then vault write (500 `CREDENTIAL_ORPHAN_PURGED` after compensation). Response `{connection,credential:{status,version,secretStore,displayHint,lastValidatedAt,expiresAt},bot,claim}` — never material. Body ≤ 16 KiB (413 `CREDENTIAL_INPUT_TOO_LARGE`), generic 400 `CREDENTIAL_INPUT_INVALID`, `Cache-Control: no-store`. |
| POST | `/api/line-oa/connections/[id]/credential` | Business owner; FR-223/FR-224 rotation `{channelId,channelSecret,channelAccessToken?}` with the same gate, limit and validation; 422 `LINE_CHANNEL_MISMATCH` when the pair belongs to another bot; 409 `LINE_CONNECTION_NOT_ACTIVE`. The previous version resolves until the new one validates; no epoch bump. Response `{credential,bot}`; `no-store`. |
| POST | `/api/line-oa/connections/[id]/credential/revoke` | Business owner; FR-223/FR-224 `{reason,confirmation:"REVOKE"}` with the gate and limit; fences the LINE OA account (server ownership off, epoch +1, queued jobs cancelled) before every version's material is purged. Response `{credential:{status,version}}`; `no-store`. |
| POST | `/api/line-oa/connections/[id]/credential/validate` | Business owner; FR-223/FR-224 empty body with the gate and limit (a rejected validation counts twice); re-proves the stored credential with LINE bot information and records `lastValidatedAt`/`lastValidationCode`; 409 `CREDENTIAL_REENTRY_REQUIRED` when it no longer resolves, 422 `LINE_CHANNEL_MISMATCH`. Response `{credential,bot}`; `no-store`. |
| GET | `/api/integration/model-providers?businessId=` | Business owner (FR-266, ADR-100 D4); no write gate a read of whether a key exists must not itself require a step-up. Response `{modelCredential:{connectionId,provider,model,status,secretStore,lastValidatedAt,lastValidationCode,version} or null, providers, suggestedModels}`; never material, and no `displayHint` field at all because a model key has no non-secret identifier (SDD-101). `lastValidationCode` is the outcome of the last check (`MODEL_KEY_VALIDATED:<PROVIDER>`, `MODEL_KEY_REJECTED`, `MODEL_NOT_FOUND`): a refused re-validation still stamps `lastValidatedAt`, so a reader of the time alone would show a key that just failed as ready. `providers` includes `prp` (FR-267, the operator's Private Runtime Platform) only when the server has `ZURI_PRIVATE_RUNTIME_BASE_URL` configured, and lists it first; its suggested model comes from `ZURI_PRIVATE_RUNTIME_MODEL` when set. `no-store`. |
| POST | `/api/integration/model-providers` | Business owner; FR-223/FR-224 gate and limit; `{businessId,provider,model,apiKey}`, both trimmed (a pasted key routinely carries a trailing newline); the key *and the model* are proved live together by reading that one model from the provider — no tokens spent — before anything is stored (422 `MODEL_KEY_REJECTED` for the key, 422 `MODEL_NOT_FOUND` when the key works but this model is not available to it, 400 `MODEL_ID_INVALID`, 503 `MODEL_PROVIDER_UNAVAILABLE`, 400 `MODEL_PROVIDER_UNSUPPORTED`), then written through the SecretStorePort as `MODEL_PROVIDER_KEY`. For `provider: "prp"` (FR-267) the address is the server's configured `ZURI_PRIVATE_RUNTIME_BASE_URL`, never a request field, and the proof is PRP's `GET /v1/models` granted-alias list — the chosen alias must be in it; 503 `PRIVATE_RUNTIME_NOT_CONFIGURED` when the server has no runtime configured. Entering a first key and rotating are the same call; a key for a different vendor replaces the connection's provider rather than creating a second one. Response `{connectionId,provider,providerChanged,credential}`; `no-store`. |
| POST | `/api/integration/model-providers/[id]/revoke` | Business owner; `{reason,confirmation:"REVOKE"}` with the gate and limit; purges every version. It does **not** fence the LINE OA account the next answer fails closed when the key will not resolve (SDD-106), and pausing the account as well would be this route deciding availability for the owner. Response `{credential:{status,version}}`; `no-store`. |
| POST | `/api/integration/model-providers/[id]/validate` | Business owner; empty body with the gate and limit; re-proves the stored key *and the stored model* with the provider and records `lastValidatedAt`/`lastValidationCode` including on rejection, so the readiness journey stops reporting an older success — this is how an owner learns a provider has since retired their model, before a customer does. 409 `CREDENTIAL_REENTRY_REQUIRED` when it no longer resolves, 422 `MODEL_KEY_REJECTED`, 422 `MODEL_NOT_FOUND`. Unavailability is not recorded, so a provider's bad minute cannot demote a working key. Response `{credential,provider}`; `no-store`. |

Execution contract: `contracts/line-conversation-execution.schema.json` — **withdrawn for new work by FR-265 / ADR-100 D2**; the file stays because a deployed daemon still speaks it until upgraded and ADR-061 cites it. Job errors are redacted; Edge validation 400, missing credentials 401, unavailable/disabled 503, invisible job 404, stale lease/version 409. Transport ownership and execution policy changes increment account epoch and cancel waiting jobs; SENDING or unacknowledged UNKNOWN blocks handoff.


## Marketing Strategy and PM handoff (FR-159, FR-158)

| Method | Path | Authority and behavior |
|---|---|---|
| GET / POST | `/api/growth/plans` | Business growth visibility for list; same-Business OWNER creates a strict Strategy draft. |
| GET / PATCH | `/api/growth/plans/[id]` | Business-scoped detail/history; OWNER revision, independent review, decision or archive with expectedVersion. |
| POST | `/api/growth/plans/[id]/handoff` | OWNER previews or commits to an authorized same-Business Workspace; exact live approval, preview hash and transactional PM receipt. |

[Request/response and acceptance contract](../domains/marketing/features/FR-159-strategy-plans.md). Scope refusals are 404, stale versions or approval conflicts 409, validation 400. No provider request occurs. Version diff 1.41.0b → 1.42.0b adds this approved Marketing slice; runtime verification is recorded in the tracking plan.


## Marketing Campaign initiatives (FR-160)

| Method | Route | Contract |
|---|---|---|
| GET / POST | `/api/growth/campaigns` | Growth-visible scoped list; Business owner atomically creates initiative and immutable Strategy brief. |
| GET / PATCH | `/api/growth/campaigns/[id]` | Scoped detail with PM execution projection; audited versioned revise, explicit receipt binding, close and cancel. |

[Request/response contract](../domains/marketing/features/FR-160-campaign-initiatives.md).
No raw Project ID is accepted as proof of a handoff. Hidden identities return 404,
stale writes or invalid associations 409, input validation 400. Results without an
approved source remain unavailable. Campaign addition: two paths, four operations.

## Marketing Content and Creative (FR-157)

| Method | Route | Contract |
|---|---|---|
| GET / POST | `/api/growth/content` | Scoped bounded collection; owner creates immutable creative intent with validated Files/PM references. |
| GET / PATCH | `/api/growth/content/briefs/[id]` | Current/history DTO; audited CAS revise, independent review, exact expiring decision or archive. |
| GET | `/api/growth/content/assets/[id]` | Immutable ContentVersion identity, source/rights/review and current usability; never a FileAsset primary-key alias. |
| GET | `/api/growth/content/references` | Sanitized bounded owner-authorized Files, Projects and selected Project WorkItems. |

## Marketing Operations coordination (FR-162)

| Method | Path | Contract |
|---|---|---|
| GET / POST | `/api/growth/operations` | One Business-scoped aggregate for Intake, PM Calendar, Marketing Approvals and validated Handoffs; POST creates an audited Intake request only. |
| GET / PATCH | `/api/growth/operations/intake/[intakeId]` | Exact Business-scoped Intake detail; PATCH updates or archives through expected-version CAS and one AuditEvent. |
| GET | `/api/growth/operations/handoffs/[handoffId]` | Read-only validated owner receipt and PM roadmap projection; invalid or unavailable source remains explicit. |

[Operations contract](../domains/marketing/features/FR-162-operations-coordination.md). The aggregate is bounded and source-aware; it does not create PM tasks, CRM conversations, Commerce stock or provider actions.

## Marketing broadcast planning and read projections (FR-185)

| Method | Path | Contract |
|---|---|---|
| GET / POST | `/api/growth/broadcast-intents` | Business-scoped list or OWNER create of a strict LINE planning intent. The persisted identity carries immutable content/account/consent references and an unavailable audience reference; it never stores private CRM text and never dispatches. Create is idempotent on the original request identity. |
| GET / PATCH | `/api/growth/broadcast-intents/[id]` | Scoped current/history read; OWNER revise or archive with expected-version CAS. Revisions are append-only and source references are rechecked on read; stale or unavailable owner evidence stays visible. |
| GET | `/api/growth/paid-media` | Read-only owner projection over Marketing, Integration and Commerce DTOs. Paid provider metrics are `UNAVAILABLE` with null values; verified Commerce revenue remains separately sourced and no CRM audience reader or provider call is made. |
| POST | `/api/growth/ask-marketing` | Deterministic, read-only question classifier for the approved overview, ROAS and fatigue questions. Unsupported questions and unavailable paid metrics return explicit unavailable states; no LLM, provider, CRM audience or send action is invoked. |

[Broadcast planning and projection contract](../domains/marketing/features/FR-185-broadcast-planning-intent.md). Hidden Business scope is 404, invalid input is 400, stale writes are 409, and owner read failures remain UNKNOWN. The LINE dispatch boundary and CRM audience resolution remain unavailable by contract.

Version diff 1.57.0b → 1.58.0b: add the four FR-185 route families and reconcile the current route-handler marker to 235; planning and projections remain local, read-only where stated, and provider activation is not claimed.

[Contract](../domains/marketing/features/FR-157-content-creative.md). Hidden scope 404,
stale/archived/changed evidence 409, validation 400. No binary locator, provider
request or PM mutation is exposed by Content. Four paths, six operations.

Version diff 1.43.0b → 1.44.0b: four Content route handlers, six operations; local validation is recorded in the [Content phase report](../roadmap/marketing/PHASE-CONTENT-2026-09-06.md).

Version diff 1.45.0b → 1.46.0b: add the three Marketing Operations route families and update the handler count to 182; Intake writes remain Marketing-owned and Calendar/Handoffs remain owner projections.

## FR-173 — Shared knowledge admission and corpus serving (ADR-072)

Five paths / six operations share the [admission contract](../plans/KNOWLEDGE-ADMISSION-CONTRACT.md). A public runId identifies the admission job; executionRunId separately identifies its actual 17-stage execution. Scope, policy and runtime credentials are never caller-selected.

| Method | Path | Contract |
|---|---|---|
| POST | `/api/knowledge/ingestions` | `{businessId,projectId?,idempotencyKey,source}`; TEXT contains sourceKey/version/content and optional title; FILE names an existing readable text/Markdown fileAssetId. Returns durable QUEUED identity, never synthetic stage success. |
| GET | `/api/knowledge/ingestions` | Business/optional Project list with limit; job/source/publication metadata, no raw content. |
| GET | `/api/knowledge/ingestions/[runId]` | Authorized admission state and separate executionRunId when attached. |
| POST | `/api/knowledge/catalog-files` | `{businessId,projectId?,name,contentBase64}`; `name` must end in `.json`. Validates the bytes as a SmartGift catalog before storing anything, stores them on the private knowledge store (MinIO) at `knowledge/raw/<tenant>/<business>/catalog-files/<sha256>/<uuid>.json` as a `MANAGED_BLOB` FileAsset (identical bytes reuse the existing asset), then admits it with `format: SMARTGIFT_CATALOG_V1`. Returns `{fileAssetId,fileName,sha256,recordCount,reused,admission}`; 422 for a non-catalog file, 503 when the private store is not enabled. |
| POST | `/api/knowledge/queries` | `{businessId,projectId?,query,topK?}`; pins one corpus manifest, queries explicit native snapshots through MSP, checks lineage and current access, returns ranked results and citationId. |
| GET | `/api/knowledge/citations/[citationId]` | Resolves a historical source/version/chunk only while current corpus/source/file/project access permits it. |
| DELETE | `/api/knowledge/sources/[sourceId]` | `{expectedVersion}`; corpus writer atomically withdraws membership, retaining immutable history. This does not modify the FileAsset, and remains available to clean up membership after a file is deleted. |
| GET | `/api/knowledge/candidates` | `?businessId&status?`; lists `KnowledgeCandidate` rows for a Business, domain-visible (`knowledge`) read only. |
| POST | `/api/knowledge/candidates` | `{businessId,conversationId,messageIds?,question,answer,idempotencyKey?}`; drafts one candidate from a consent-GRANTED Conversation (crm read projection); OWNER/LINE_OA_PUBLISHER only; Zero-PII checked; idempotent on (businessId, idempotencyKey). |
| GET | `/api/knowledge/candidates/[id]` | Reads one candidate, domain-visible (`knowledge`) read only. |
| PATCH | `/api/knowledge/candidates/[id]` | `{question?,answer?,version}`; edits a PENDING_REVIEW draft; OWNER/LINE_OA_PUBLISHER only; Zero-PII re-checked; optimistic concurrency on `version`. |
| POST | `/api/knowledge/candidates/[id]/decision` | `{decision:APPROVE\|REJECT,version,reason?}`; audited. APPROVE admits one immutable `LINE_FAQ_CANDIDATE` TEXT source through the existing ADR-072 admission service; REJECT never calls it. OWNER/LINE_OA_PUBLISHER only (FR-236, ADR-090 D6). |
| GET | `/api/knowledge/gap-report` | `?businessId?`; omit to aggregate every Business the viewer sees under the `knowledge` domain. Reads `EVIDENCE_SELECTED` trace events with `reason=NO_EVIDENCE` and returns counts, product locators (where the traced query names one) and last-seen times only — never the question text (FR-237, ADR-090 D7). |

Validation: 400 invalid body, 401 no session/key, 404 inaccessible target, 409 version/hash/CAS conflict, 413 over 1 MiB, 415 unsupported file type, 422 invalid UTF-8/empty content, 503 unconfigured runtime. Machine grants are explicit per action; MCP continues using its existing session resolver. Isolated acceptance is not production activation.

### Version diff 1.52.0b → 1.53.0b

Added FR-173's five paths/six operations and explicit API grant boundary; handler count 201 → 206. Registered the same paths in the OpenAPI source inventory; its route-enumeration test remains the drift gate.

### Version diff 1.53.0b → 1.54.0b

Integrate FR-144 Desktop browser/QR pairing with the current Server contracts: three POST paths increase the route handler inventory from 206 to 209. Existing trace, capability and knowledge admission routes remain in the combined inventory.

Version diff 1.58.0b → 1.59.0b: add the three approved FR-184 handlers and reconcile the enumerated handler count to 238.

Version diff 1.65.0b → 1.66.0b (2026-09-13): add the nine FR-203 / FR-204 / FR-206 / FR-207 handlers under `/api/inventory` (resolve, identifiers, unit conversions, catalog-hygiene, replenishment), the FR-201 / FR-202 / FR-205 fields and refusals on the product collection and item, and the `services` / `phaseOut` / `belowReorderPoint` counts on the stock summary (ADR-083).

Version diff 1.67.0b → 1.68.0b (2026-09-13): add `POST /api/platform/programme-usage-reports` (FR-218, ADR-086 D5) — agent usage reports under a deployment bearer; handler count 263 → 264.

Version diff 1.68.0b → 1.69.0b (2026-09-14): add the six FR-220 harness pairing, device and whoami handlers and the FR-221 attribution contract on the usage report endpoint (ADR-087); handler count 264 → 270.

Version diff 1.69.0b → 1.70.0b (2026-09-14): no route added or changed; record that the MFA factor secret is sealed at rest (SEC-029, ADR-088) and the two 503 refusals that follow from a missing key or an unopenable factor. Handler count unchanged.

Version diff 1.70.0b → 1.71.0b (2026-09-14): FR-239 optional `detail` object on `POST /api/platform/programme-usage-reports` (ADR-086 D7); no new handler.

Version diff 1.71.0b → 1.72.0b (2026-09-14): ADR-089 Phase 1 (branch `feat/integration-secret-store-vault`, not merged) — the write-only Channel ID and secret body on `POST /api/line-oa/connections` and three new handlers under `/api/line-oa/connections/[id]/credential` (rotate, revoke, validate), all behind the FR-224 step-up gate and rate limit; 429 responses now carry `retryAfterSeconds` and `Retry-After`. Handler count 270 → 273.

Version diff 1.78.0b → 1.79.0b (2026-09-21): FR-265/FR-266 under ADR-100 — withdraw the five `/api/edge/conversation-jobs/*` operations and `POST /api/edge/model-residency`, and add the three Business-owner model provider credential handlers under `/api/integration/model-providers`. Handler count 328 → 325 (six removed, three added). Registered the same paths in the OpenAPI source inventory; its route-enumeration test remains the drift gate.

Version diff 1.79.0b → 1.80.0b (2026-09-21): FR-266 under ADR-100 D4 — the model provider handlers now prove the key *and the model* in one call by reading that model from the provider, adding 422 `MODEL_NOT_FOUND` (key works, model not available to it) and 400 `MODEL_ID_INVALID`; the key is trimmed before its pattern check; the status read gains `lastValidationCode`, and the rows now also state `model` in the POST body and `model`/`suggestedModels` in the GET response, which the 1.79.0b rows omitted. No handler added or removed; count stays 325.

Version diff 1.80.0b → 1.81.0b (2026-09-21): FR-267 under ADR-100 D7 — provider `prp`, the operator's Private Runtime Platform, on the same three model-provider handlers. Its address is server configuration (`ZURI_PRIVATE_RUNTIME_BASE_URL`), never a request field; it is proved against PRP's granted-alias list; the status read offers it only where configured; 503 `PRIVATE_RUNTIME_NOT_CONFIGURED`. No handler added or removed; count stays 325.
