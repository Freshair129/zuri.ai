---
id: ZAI:PM-CONTRACT-FOUNDATION
title: Shared allocation, identity and transport contract foundation
version: "0.3.1b"
status: candidate
created_at: "2026-09-16T14:35:11+07:00,Luna Max worker, MA-D01 attempt 2"
last_update: "2026-09-17T02:03:00+07:00,RWANG final integrator"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: "Bounded design closure for SPEC-G01 and PM/Workforce transport/security portion of SPEC-G05"
  evidence_level: "DESIGN_ONLY; PROPOSED_NOT_IMPLEMENTED"
  proposal_id: "PROPOSAL:PM-CONTRACT-FOUNDATION-D01-A3"
  attempt: 3
  canonical_id_status: "NO_FR_FEAT_ADR_IDS_ALLOCATED"
relations:
  - type: references
    target: ZAI:PM-WORKFORCE-DESIGN
  - type: references
    target: ZAI:PM-SPEC-READINESS
  - type: references
    target: ZAI:PM-TABLES-ERD
---

# Shared allocation, identity and transport contract foundation

**Phase B refinement:** [24 Feature implementation plan](24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md)
selects a concrete Identity-owned API CSRF proposal for Feature, graph and snapshot
mutations, with issuance, expiry, live-session binding, explicit Origin and refusal
rules. Its selected API/data overlays are the Phase B authority pending B1 owner
approval and B2 registration. This selection does not implement the port or approve
Workforce writes; the historical `NEEDS_OWNER_BINDING` findings below describe the
earlier Workforce packet. Plugin-consent tokens remain a separate audience.

Phase B retains this document's common error fields (`path`, `code`, `message`),
fresh request correlation and scoped replay rules. Its typed receipt uses an integer
version for a Feature, and a null version with a strong digest ETag for graph/snapshot
resources. Those selected resource forms do not change the Workforce receipt below.

## 1. Packet boundary and outcome

This is the worker proposal for packet PM-20260916-D01-01 / MA-D01. It resolves the design ambiguity in SPEC-G01 for the proposed human allocation profile. SPEC-G05 is only partially reconciled; the generic Identity CSRF owner port remains NEEDS_OWNER_BINDING.
It does not close SPEC-G02, SPEC-G03, SPEC-G04, SPEC-G06, SPEC-G07, SPEC-G08 or
SPEC-G09. The twelve workforce metric definitions, policy review, time-log
lifecycle and provider/ledger contracts remain with their assigned packets.

The result is a composition-ready contract decision. It is not an implementation,
service test, migration, runtime authorization proof, or release approval.
PMR-033 remains proposal-local; this packet allocates no canonical FR, FEAT or ADR
identifier.

## 2. Single allocation authority

Project Manager owns the human WorkAllocation and WorkforcePlan aggregates. One
PM allocation writer accepts normalized human commands. People and CRM provide
read ports for employment/person facts; Identity provides the trusted viewer and
permission decision; TeamMembership, Employment and UI labels never grant access.
Integration does not write this aggregate.

| Surface | Contract role | Write effect |
|---|---|---|
| POST /api/projects/{projectId}/resource-allocations | PM compatibility adapter | Resolves project Business scope, normalizes legacy or canonical input, then delegates to the one PM allocation writer. It is not a second writer. |
| POST /api/businesses/{businessId}/workforce/plans/preview | PM workforce plan owner | Validates canonical human changes and pins source versions. Preview has no allocation effect. A durable preview may be recorded only by the PM plan owner. |
| POST /api/businesses/{businessId}/workforce/plans/commit | PM workforce plan owner | Revalidates the exact preview, versions and capacity, then writes WorkAllocation, WorkforcePlan state and AuditEvent atomically. |
| GET allocation/workforce reads | PM read ports | Authorizes before filtering and composes scoped records. No read endpoint becomes a write path. |

The canonical persistence profile is the proposed WorkAllocation dictionary in
data-model.candidate.json: internal id, tenantId, businessId, workItemId,
assignmentId, estimateId, personId, optional creditedTeamId, startsAt, endsAt,
remainingMinutes, placement, state, version and audit-preserving timestamps.
The API spells the interval startAt/endAt; the owner adapter maps those names to
storage startsAt/endsAt. No new Prisma model or migration is implied here.

## 3. Person/resource and scope compatibility

The Workforce contract is human-only. Its canonical subject is personId. A
canonical command must carry resourceType=PERSON, compatibilityProfile=HUMAN_PERSON_V1,
personId, workItemId, assignmentId, estimateId, startAt, endAt, remainingMinutes
and placement.

The main PM resource-allocations endpoint is candidate-only. It keeps a versioned
compatibility branch for earlier draft payloads; this does not imply a deployed
legacy endpoint or existing client compatibility:

* resourceId is accepted only under compatibilityProfile=HUMAN_PERSON_V1.
  The adapter resolves it to exactly one in-scope Person. Unknown or foreign
  identifiers return the same redacted 404 as an unknown target. An existing
  in-scope target whose declared type is not PERSON returns 422
  RESOURCE_TYPE_UNSUPPORTED. An in-scope Person that cannot resolve exactly one
  WorkAssignment or WorkEstimate returns 422
  ALLOCATION_COMPATIBILITY_INCOMPLETE.
* The legacy branch may supply effortHours instead of remainingMinutes. The
  adapter must resolve the effective WorkAssignment and WorkEstimate before
  calling the writer. Missing, ended, ambiguous or cross-Business records are
  refused; the adapter never invents assignmentId or estimateId.
* The canonical branch uses remainingMinutes as the only effort authority.
  effortHours is a response/display compatibility projection and must not be
  used to overwrite minutes.
* A request containing both effortHours and remainingMinutes is rejected with
  ALLOCATION_UNIT_CONFLICT, even when the numbers happen to agree.
* Hours conversion is exact: parse the supplied JSON number as a finite decimal,
  multiply by 60, and accept only a positive integer number of minutes within
  the safe integer range. A fractional result, non-finite value, zero for an
  active allocation, overflow or precision loss returns
  ALLOCATION_UNIT_CONVERSION_REQUIRED.
* API intervals are half-open [startAt,endAt). FIXED_SLOT requires
  remainingMinutes to equal the interval duration after timezone/DST resolution.
  DAILY_BUDGET is a planning budget and is not a meeting reservation.

This packet closes only the PMR-033 human allocation branch. PMR-017's generic
non-human resource family remains future-scoped design; this proposal neither
implements it nor removes it from the wider candidate contract.

The request path and trusted viewer establish tenantId/businessId. A body-supplied
tenantId or businessId is not authority. A project path is resolved to its
Business before the adapter calls Identity. A Business, Project, WorkItem,
Person, Employment, WorkAssignment or WorkEstimate outside that scope has the
same 404 body shape as an unknown target.

Employment identifies who works in the Business and bounds effective assignment
and calendar data. Membership and the live Session identify who may call the
operation. TeamMembership only groups people. None of these relationships is
created, changed or used as a side effect of an allocation command.

## 4. Normalized command and state rules

The normalized writer command is:

| Field | Rule |
|---|---|
| compatibilityProfile | Required HUMAN_PERSON_V1 for this slice |
| resourceType | Required PERSON |
| personId | Required, resolved to a CRM/People owner-read Person in the trusted Business |
| workItemId | Required, PM WorkItem in the same Business |
| assignmentId | Required, PM WorkAssignment matching workItemId/personId and effective interval |
| estimateId | Required, PM WorkEstimate for workItemId; a null estimateMinutes value is UNKNOWN and cannot be silently treated as zero |
| startAt/endAt | Required UTC instants after IANA timezone validation; endAt must be after startAt |
| remainingMinutes | Required nonnegative integer; active confirmed slices must be positive |
| placement | Required DAILY_BUDGET or FIXED_SLOT |
| creditedTeamId | Optional Team in the same Business; it is attribution only and grants no authority |
| capacityOverrideReason | Optional normally; required with workforce.plan.override and recorded in the receipt when used |

PreviewAllocationChange always has state=DRAFT and an explicit intent. UPSERT produces CONFIRMED on commit; CANCEL produces CANCELLED and requires an existing allocation id/version plus remainingMinutes=0. New UPSERT carries null id/version together; updates carry both existing id and version. A cancelled record echoes its existing interval for audit; the active FIXED_SLOT duration rule does not demand positive effort for cancellation. The preview performs no allocation mutation.

sourceVersions is nonempty. Before accepting preview, the PM owner verifies a complete, deduplicated set of affected WorkItem, Estimate, Assignment, existing Allocation and applicable Calendar, Availability and TeamShare versions. Inapplicable sources may be absent; missing required sources return 422 SOURCE_VERSION_SET_INCOMPLETE. The server cannot infer full capacity or silently accept an unpinned read. Exact input owner ports remain SPEC-G02; schema validation alone cannot prove source-set completeness.

When an authorized override is applied, PMMutationReceipt/WFPlanReceipt must contain capacityOverrideReason equal to the accepted input and auditRef must address the corresponding immutable authorized audit event. A multi-change plan uses one reviewed reason for all overrides; differing reasons require separate plans or 422 validation. An absent or different reason on an overridden effect is a contract failure, including on idempotent replay. Confirmed live future slices
for one WorkItem cannot exceed its known remaining estimate. Concurrent plans
serialize the affected Business/person/work period and recheck capacity inside
the owner transaction.

## 5. Shared transport contract

The following rules apply to the main PM allocation operation and the Workforce
preview/commit operations. The scoped error shape applies only to these three covered operations. Other Workforce operations retain the earlier Error schema with correlationId; their transport and lifecycle reconciliation remain OPEN under SPEC-G05.

| Concern | Exact rule |
|---|---|
| requestId | Fresh server-generated UUID per HTTP attempt. Return it in the JSON body and X-Request-ID response header. It is correlation evidence, never caller authority. |
| receiptId | Durable UUID created by the owner command. A successful idempotent replay returns the same receiptId, resourceId, status, version, recordedAt, auditRef and ETag, but a fresh requestId/X-Request-ID for the new HTTP attempt. The response is therefore receipt-identical, not byte-identical. |
| ETag | Every successful mutation receipt and preview response returns a strong quoted ETag in the form `"<aggregate>/<uuid>/v<version>"`. The body version is the same CAS version. |
| If-Match | Required for commit and every future update/cancel of an existing allocation. The value must exactly match the current ETag. Missing precondition is 428 PRECONDITION_REQUIRED; stale value is 412 VERSION_MISMATCH with currentVersion and currentEtag only. |
| Idempotency-Key | Required for createResourceAllocation, previewWorkforcePlan and commitWorkforcePlan; 8–128 characters. The server derives an idempotency scope from method + path + trusted tenantId/businessId + authenticated principalId. It looks up the key only inside that scope. Same scoped key and normalized hash replays the durable receipt; same scoped key with a changed hash returns 409 IDEMPOTENCY_KEY_REUSED. The same raw key in another scope is independent and never reveals whether a row exists there. |
| CSRF | Candidate transport name is X-CSRF-Token, but the generic Workforce/API issuance and verification port is **NEEDS_OWNER_BINDING**. Identity must own that port, bind its API-audience token to the live `zuri_session` session, expose an approved same-origin client delivery path, and perform the Origin check before mutation. The pinned `plugin-consent.js` names (`pluginConsentSessionBindingFromRequest`, `assertPluginConsentCsrfToken`, `zuri_pcsrf.`) are source evidence for cookie binding only; their plugin-consent audience must not be silently reused for Workforce/API mutations. This packet has not established the generic API issuer, verifier or Origin-check owner binding. |
| Session | zuri_session is transport only. Identity resolves a live, active, unexpired Session row and then resolveViewer recomputes Membership/role bindings. Missing, invalid, revoked or expired session is 401 AUTH_REQUIRED; session-store failure is 503 SESSION_UNAVAILABLE. |
| Scope refusal | An unknown or foreign scoped target returns 404 RESOURCE_NOT_FOUND with the same redacted shape. An existing in-scope non-Person resource returns 422 RESOURCE_TYPE_UNSUPPORTED; an in-scope Person with incomplete assignment/estimate mapping returns 422 ALLOCATION_COMPATIBILITY_INCOMPLETE. An authenticated caller in an authorized Business without workforce.plan receives 403 CAPABILITY_DENIED. |
| Redaction | Do not return foreign IDs, person names, hidden project counts, capacity diagnostics or raw internal errors in refusal bodies. |

The common JSON error body is:

    code, message, requestId, retryable, currentVersion?, currentEtag?,
    fields[]?

It deliberately has no correlationId alias. Legacy internal correlation IDs may
remain in audit/event records, but they are not a second public transport
contract. fields entries contain path, code and message only.

Required refusal mapping for this slice:

| HTTP | code | Use |
|---:|---|---|
| 401 | AUTH_REQUIRED | No valid live session |
| 403 | CAPABILITY_DENIED | Identity denied workforce.plan or override capability in an otherwise authorized scope |
| 403 | CSRF_INVALID | Missing, invalid or cross-origin session mutation token |
| 404 | RESOURCE_NOT_FOUND | Unknown or foreign scope/resource, redacted |
| 409 | IDEMPOTENCY_KEY_REUSED | Key reused with a different normalized command |
| 409 | CAPACITY_CONFLICT | Concurrent plan, overlap, dependency or capacity conflict after recheck |
| 409 | PREVIEW_EXPIRED | Commit references an expired or already-consumed preview |
| 412 | VERSION_MISMATCH | If-Match or pinned source version is stale |
| 422 | RESOURCE_TYPE_UNSUPPORTED | An existing in-scope target is not a Person in the human contract |
| 422 | ALLOCATION_COMPATIBILITY_INCOMPLETE | An in-scope Person cannot resolve exactly to an effective Assignment/Estimate |
| 422 | ALLOCATION_UNIT_CONFLICT | Both hour and minute authorities were supplied |
| 422 | ALLOCATION_UNIT_CONVERSION_REQUIRED | Hours cannot be converted exactly to integer minutes |
| 422 | INVALID_INTERVAL | Invalid timezone, DST, interval or placement duration |
| 503 | SESSION_UNAVAILABLE | Identity/session store unavailable; no mutation occurs |

## 6. Required negative and race behavior

1. Two commits for the same person and overlapping capacity execute
   concurrently: at most one consumes the unreserved capacity. The loser
   receives CAPACITY_CONFLICT or VERSION_MISMATCH and no partial WorkAllocation,
   WorkforcePlan or AuditEvent is left behind.
2. The client retries after a successful commit: the same scoped idempotency key
   and canonical hash returns the same durable receiptId, effect fields and ETag,
   while requestId/X-Request-ID are fresh for the new HTTP attempt. A changed
   interval, person, hours, minutes or scope in that scope returns
   IDEMPOTENCY_KEY_REUSED; the same raw key in another scope is independent.
3. A still-valid preview whose pinned sources changed, a stale allocation ETag or changed WorkAssignment/WorkEstimate returns 412 with the current version and no write. Expired or consumed preview is 409 PREVIEW_EXPIRED; successful idempotent replay is checked first.
4. Missing, forged or session-bound-to-another-cookie CSRF token returns 403
   before the request body can disclose validation details. A cross-origin Origin
   is refused even when the token string is present.
5. A revoked/expired session returns 401; a session resolver outage returns 503.
   Neither case falls through to a body role or TeamMembership.
6. A foreign Business, Project, WorkItem, Person, Employment, Assignment or
   Estimate returns the same redacted 404 shape as an unknown id.
7. An unknown or foreign resourceId returns 404. A known in-scope asset/agent
   target returns 422 RESOURCE_TYPE_UNSUPPORTED; a known in-scope Person with
   incomplete assignment/estimate mapping returns 422
   ALLOCATION_COMPATIBILITY_INCOMPLETE. No phantom employee capacity,
   Membership grant, Team membership or CRM Person is created.
8. effortHours=1.25 converts to 75 minutes; effortHours=1.333 or any value
   producing fractional minutes is rejected. Supplying effortHours and
   remainingMinutes together is rejected.
9. Employment ending before the planned interval or an assignment outside its
   effective range is refused; historical attribution remains read-only and is
   not rewritten.

## 7. Composition and approval gates

Attempt 2 supplies full composed replacement YAML files rather than partial
operation replacements. The main POST replacement preserves its operationId,
path parameters, requestBody and response status set while using the scoped
`PMMutationReceipt`, `PMStandardError`, `PMIdempotency` and `PMCsrf`
components. Workforce preview and commit preserve their operationId, path
parameters, requestBody and success schemas; commit uses the shared-shape
`WFPlanReceipt` and wires the 428 PRECONDITION_REQUIRED response to If-Match.
The PM and Workforce receipt schemas have the same durable fields; ETag and
X-Request-ID stay HTTP headers, outside the JSON receipt body. Scoped transport
components keep the candidate change from silently changing unrelated operations
that still reference the original document components.
Root remains the single integrator for candidate files, generated viewers,
document graph, registries and implementation code.

A composed contract still requires independent structural verification, canonical
ID/ledger review, owner approval, runtime schema implementation, service tests,
migration/RLS review and the parent final gate before any code entry. The CSRF
issuer/verifier and client delivery path remain an explicit Identity-owner gate;
this packet does not close that security sub-gap and forbids a duplicate cookie
reader or plugin-consent token reuse as a workaround.

The proposed design closes the allocation/receipt/error shape at design level only.
It does not prove that the existing route helper emits this envelope: the current
runtime helper still returns a legacy {error,...} body, no generic CSRF
issuer/verifier or Origin checker exists in the pinned Identity source, and no
Workforce route or WorkAllocation Prisma model exists at the pinned commit.
Those are implementation and migration evidence gates. Identity must first name
and own the generic API CSRF port and its client delivery surface before G05's
CSRF sub-gap can be accepted.

## 8. Evidence references

* Document 15 §4–5 and §9: owner/write direction, integer minutes, assignment,
  concurrency, PMR-033 A–P and capability names.
* Document 16 §3: SPEC-G01 and PM/Workforce portion of SPEC-G05.
* Document 18 WorkAllocation dictionary: assignmentId, estimateId, personId,
  startsAt/endsAt, remainingMinutes and serialization requirements.
* Main candidate OpenAPI: resource allocation path, Error, AllocationInput,
  AllocationRecord and common header parameters.
* Workforce candidate OpenAPI: preview/commit paths, AllocationChange,
  PreviewInput, CommitInput, Receipt and divergent Error.
* Runtime source: identity/auth-service.js (`AUTH_SESSION_COOKIE = "zuri_session"`),
  identity/plugin-consent.js (`CSRF_PREFIX = "zuri_pcsrf"`,
  `pluginConsentSessionBindingFromRequest`, and
  `assertPluginConsentCsrfToken`),
  app/api/plugin/auth/authorize/route.js (the existing form field is
  `csrf_token`; it is plugin-consent-specific and is not an API CSRF delivery
  surface), identity/request-viewer.js, identity/session-port.js,
  identity/authorization-context.js, identity/resolve-viewer.js,
  people/application/people-service.js, project-manager/project-authorization.js,
  app/api/_helpers.js and Prisma schema Membership/Employment/WorkItem/Team models.
  The same-origin verifier is not bound by this packet; the same-origin check is an
  explicit implementation obligation, not evidence of an existing runtime gate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-16 | candidate | Attempt 2: strict branch-local oneOf inputs, full composed operation replacements, durable receipt versus fresh request correlation, scoped idempotency, exact 404/422/resource rules, source-bound CSRF names and wired 428 response | eddd3dd8d884a0b19a65f9a3019758c05c815b48; worker-local proposal | Luna Max worker, MA-D01 |

## Attempt 3 correction evidence

Independent review found missing source pins, overloaded preview/record states and unrepresentable override evidence. This revision adds PreviewAllocationChange, explicit cancel intent, nonempty/complete source-set rules, matching receipt reason fields, and examples for every declared response status. The fixture-only `http` key is routing metadata and must be removed before validating an error body. It never appears on the wire. All other source/lifecycle gaps remain open as stated.

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.0b | 2026-09-16 | candidate | Repair all six independent attempt-2 findings with explicit draft intent and conformance examples | isolated document composition | RWANG |
| 0.3.1b | 2026-09-17 | candidate | Link the selected Phase B CSRF and typed-receipt proposal while preserving Workforce scope and pending approval | planning base ecc30b94 | RWANG |
