---
id: ZAI:PM-PIPELINE-CONTRACT-FOUNDATION
title: Pipeline Builder contract foundation
doc_type: technical-supplement
status: approved
version: "0.1.5"
source_revision: "635120c552de9b456b6ab80e98b529211fc3d888"
relations:
  - type: references
    target: ZAI:ADR-035
  - type: references
    target: ZAI:FEAT-007
  - type: references
    target: ZAI:FR-084
  - type: references
    target: ZAI:FR-085
  - type: references
    target: ZAI:PM-PIPELINE-PLAN-20261023
---

# Pipeline Builder contract foundation

## 1. Authority and adoption boundary

**Adopted 2026-10-24:** owner approved the exact v0.1.5 D1–D6 at `1b76049a`.
[Canonical reconciliation](../../change-requests/PM-PIPELINE-C0-ADOPTION-20261024.md)
preserves that normative revision; C1 is selected. The original preparation
account below describes its pre-adoption state, not a continuing approval block.
No implementation, test or production acceptance is inferred.

Audience: product owner, PM implementer and independent reviewer. This is C0's
**adopted technical supplement**, prepared against source `635120c5`, after
PR730 and approved at `1b76049a`. D1–D6 govern the selected C1 implementation.
C2–C4 remain later implementation tasks; adopting their contract does not claim
their implementation or acceptance.

Controlling sources are [ADR-035](../../decisions/ADR-035-DIRECT-MANIPULATION-PIPELINE-CANVAS.md),
[FR-082](../../features/FEAT-007/requirements/FR-082.md),
[FR-083](../../features/FEAT-007/requirements/FR-083.md),
[FR-084](../../features/FEAT-007/requirements/FR-084.md),
[FR-085](../../features/FEAT-007/requirements/FR-085.md),
[BR-017](../../requirements/BR-017.md), [SDD-046](../../requirements/SDD-046.md)
and [NFR-008](../../requirements/NFR-008.md). Their reviewed lifecycle reconciliation is recorded in the adoption migration. [The implementation plan](../../plans/PM-PIPELINE-BUILDER-20261023.md)
owns sequencing; this supplement proposes the missing technical choices.

Adoption must name this document's exact revision and the accompanying
[examples](contracts/pipeline-contract.examples.json), resolve section 11's
source interpretation, amend ADR-035's implementation disposition, and complete
the reviewed canonical-record workflow for the design-only rows. A review PASS
is not product adoption, a DB migration, environment authority or deployment.
Developer DDC procedures are retired under ADR-113.

## 2. Verified source baseline and writer census

All paths below are Server-relative under `apps/server/`.

| Current source | Observed behavior; consequence for C |
| --- | --- |
| `prisma/schema.prisma`, models Dependency and Gate | Dependency has five endpoint/type fields plus id/createdAt, no contract/version; Gate has Project, optional Workstream, status/evidence, no version/deletedAt |
| `src/lib/validation/enums.js` | Six endpoint types, seven dependency types, seven WorkItem statuses and four Gate statuses; do not invent extra canonical modes or statuses |
| `application/dependency-service.js` in PM | Both endpoint writers authorized before a global cycle scan; global Prisma reads/create/audit are separate, not serialized in one transaction; delete also uses global Prisma |
| `application/work-service.js` in PM | createItem/updateItem accept supplied db; container and delete paths still use global Prisma; current statuses have no handoff enforcement |
| `import/plan-schema.js`, `contracts/plan-envelope.schema.json` | Full PlanEnvelope 1.0/1.1/1.2; 1.2 requires trace/domain/execution bindings; no delta or inverse command reader |
| `import/plan-import-service.js` | dryRunPlan/commitPlan use a db seam and PlanImportReceipt; idempotency applies to1.2; dependencies are written directly inside tx; raw item writes bypass work-service |
| `src/app/api/import/{dry-run,commit}/route.js` | Existing routes read body.plan, resolve API-key/session viewer and authorize Workspace; no new canvas route is needed |
| `import/bundle/{bundle-schema,bundle-commit-service}.js` | Bundle1.0 can write cross-Project dependencies directly; adopting Plan1.3 alone would leave this writer open |
| `src/app/api/dependencies/route.js`, PM DependenciesView | Existing global register POST delegates to createDependency; project-local graph read is separate and both endpoints must be contained |
| `src/modules/agent/line-project-work-tools.js` | Item mutations call owning work-service; full import still has its own raw item writes |

The path prefix for application/import/view files is
`src/modules/project-manager/`. Existing `evaluateBlocked` is a separate legacy
status-based read: BLOCKS holds its target; REQUIRES holds its source. It is not
FR-085 contract enforcement. Do not relabel its old output as this new policy.
The current cycle detector treats **all seven types** as directed stored edges;
retain that compatibility rule in one transaction-aware implementation.

Before C1 activation, repeat the census across src/scripts/seed and every
dependency write, Gate update/delete, hierarchy change and protected item write.
This bounded source inspection is not proof that all future writers are covered.
Read-model/progress consumers and backup inventory changes also need tests.

## 3. Selected proposal and alternatives

Recommended implementation choices are fixed below for review. They are not
runtime facts. Alternatives were: a contract table/version column; a new canvas
API; or treating every stored arrow as a release direction. Prefer one nullable
JSON-string column, CAS content hashes, existing import routes and the explicit
type table below. This keeps IDs/ownership and existing intake identity intact.

The release table interprets which edge has a successor; it requires the
explicit canonical reconciliation in section 11. The alternative of holding
every inbound lineage/related edge is possible but would make provenance links
stop execution. Do not choose between these silently during C4 implementation.

## 4. Handoff payload, stored representation and CAS

Candidate client HandoffContractV1 (strict object; no unknown keys):

```json
{"version":1,"deliverable":"Signed drawing","acceptance":{"kind":"MANUAL","satisfied":false}}
```

The alternative acceptance object is `{"kind":"GATE","gateId":"<UUID>"}`.
Deliverable is trimmed NFC text,1–2000 Unicode code points; IDs are internal
UUIDs. No HTML/code execution, arbitrary metadata, actor, time or audit reference
is accepted from a client. Manual true/false decisions require the authenticated
writer to own both endpoint Businesses; server derives canonical Person.id,
UTC decisionAt and the same transaction's auditEventId. At rest manual acceptance
adds exactly `actorPersonId`, `decisionAt` and `decisionAuditEventId`. The initial
false mark also has provenance. Gate acceptance stores no copied status or
manual satisfaction. Gate is authorized before lookup facts are returned.

These three fields are inside acceptance alongside kind/satisfied, not at the
root. decisionAt is UTC YYYY-MM-DDTHH:mm:ss.sssZ. Explicit contract edits, even
an unchanged false/true mark, create new server provenance; idempotent retries
retain the original provenance. Gate stored/client shapes are identical. The
examples include both persisted shapes and non-null/legacy-null hash vectors.
Actor/audit records must resolve and match the original decision scope.

Gate must belong to the predecessor endpoint's Project. A Workstream-scoped Gate
may govern only a predecessor within that Workstream; a Project endpoint cannot
bind a narrower Workstream Gate. Referencing a foreign Project Gate is refused
even when the writer owns that other Project. No implicit Gate is created. Gate satisfaction reads the full current Gate scalar
row (including status/evidenceJson); historical Gate AuditEvents are not another
satisfaction predicate or mandatory decision pointer. Manual decision provenance
and undo audit rows remain required as specified separately. The full Gate vector
binds status and evidence changes to STALE_PREVIEW without inventing a Gate version.

At rest add **only** nullable `Dependency.contractJson` String. SQL NULL is
legacy `UNDECLARED`; the JSON literal null, malformed JSON, unsupported versions
and missing evidence on a declared row are `INVALID`, never legacy/satisfied.
Canonical storage is UTF-8 JSON with object keys recursively sorted by Unicode
code point, compact separators, normalized text and no undefined/non-finite values.
Do not Unicode-normalize UUIDs or historical stored string bytes for hashing.

`expectedDependencyHash = sha256(UTF8("pm-dependency:v1\n") || canonicalJSON({id,
sourceType,sourceId,targetType,targetId,dependencyType,createdAt,contractJson}))`.
createdAt uses UTC ISO8601 with exactly3 fractional digits. contractJson is the
exact stored string or JSON null for SQL NULL. Thus legacy null is unambiguous
and a repair/reformat of stored content invalidates old previews. Hash output is
lowercase64hex. create requires expected absence at its unique endpoint/type key;
update/delete requires the current hash. No Dependency version column is added.

Dependency identity/type/endpoints are immutable after creation; changing them is
delete+create in one delta, under the same locks and both endpoint authorities.
Stored state derives as UNDECLARED, DECLARED, SATISFIED or INVALID. Manual true
or Gate PASSED/WAIVED is SATISFIED. OPEN/BLOCKED is DECLARED. Missing Gate/actor/
audit provenance is INVALID and holds an ordering successor. Gate.required does
not waive a declared contract. Predecessor DONE alone does not satisfy it.

## 5. Exact release and endpoint interpretation proposed for adoption

| Dependency type | Predecessor | Successor | Release obligation |
| --- | --- | --- | --- |
| BLOCKS | source | target | before starting or finishing |
| REQUIRES | target | source | before starting or finishing |
| START_AFTER | source | target | before starting |
| FINISH_BEFORE | source | target | before finishing |
| RELATES_TO | none | none | descriptive; no release hold |
| SUPERSEDES | none | none | lineage; no release hold |
| DERIVES_FROM | none | none | lineage; no release hold |

All newly created edges, including descriptive/lineage edges, still require a
declared contract. The cycle rule continues to consider stored source→target
for every type. Effective ordering cycles caused by REQUIRES/aggregate expansion
must also be refused by the **same owning cycle service**, not a canvas copy.
The additional effective-cycle check is an adoption change, not current behavior.

| Endpoint type | WorkItems governed when it is the successor |
| --- | --- |
| PROJECT | all non-deleted items in non-deleted Workstreams of this Project |
| WORKSTREAM | all non-deleted items in this non-deleted Workstream |
| WORK_CONTAINER | items in this container and its active descendant containers, same Workstream |
| WORK_ITEM | this one non-deleted item |
| MILESTONE | its Workstream's items if bound; otherwise its Project's items |
| GATE | its Workstream's items if bound; otherwise its Project's items |

Scope membership is recalculated transactionally, never a frozen child list.
The same mapping defines aggregate predecessor containment for reflexive/effective
cycle refusal. A nonempty intersection of predecessor/successor item sets on an
ordering edge is refused as REFLEXIVE_SCOPE. Aggregate empty sets hold no cards
until items exist; creating/moving an item into scope repeats release checks.
Predecessor's completion/progress is not another acceptance predicate. Deleted
endpoints fail writes; a dangling declared ordering edge holds previously scoped
items until authorized repair rather than becoming undeclared. C1 must retain
the last authorized scope locator in the audit evidence to support this failure
case, and refuse destructive endpoint deletion until repaired in one transaction.

Protect transitions **into** IN_PROGRESS or REVIEW (start) and DONE (finish),
from any different status, plus create/import initially in those statuses.
An identical-status patch is not a new transition. PLANNED,READY,BLOCKED,CANCELLED
remain available so a user can pause/cancel or correct work. No new HOLD status.
For START_AFTER, entry to DONE also implies start, so both phases are tested.
FINISH_BEFORE permits IN_PROGRESS/REVIEW and checks DONE. Reopening DONE into
IN_PROGRESS/REVIEW repeats start rules. Satisfied/undeclared contracts do not hold;
DECLARED/INVALID hold only the phases above. This policy is independent of
existing required-Gate progress caps; no second progress calculator is introduced.

Gate/manual-decision changes can make existing active/DONE work visibly held;
do not rewrite historical WorkItem status. Refuse the next protected transition,
explain on the Board before an attempted move, and record the evidence change.

Authorized release DTO:
`{held:boolean,blockers:[{dependencyId,predecessor:{type,id,label,href},state,reason}],truncated:boolean,restricted:boolean}`.
state is DECLARED or INVALID; reason is UNSATISFIED or EVIDENCE_UNAVAILABLE.
All four root fields are required; restricted:false for fully readable results.
href is an app-owned relative route. Sort blockers by dependencyId; max100
visible blockers, truncated:true when more exist.
If a predecessor's scope is unreadable, return only
`{held:true,blockers:[],truncated:false,restricted:true}`; no ID/title/count leak.
Authorize the WorkItem before deriving anything. Public API cannot enumerate
foreign Gates by switching an error code.

## 6. Delta1.3 request, preview, commit and errors

Existing `body.plan` becomes a strict discriminated union; versions1.0/1.1/1.2
retain their full-envelope shapes. New variant:

```json
{"plan":{"schemaVersion":"1.3","kind":"PROJECT_DELTA","projectId":"<UUID>","trace":{"correlationId":"<UUID>","idempotencyKey":"<UUID>"},"expectedPreviewHash":null,"commands":[{"op":"dependency.create","clientRef":"edge-1","source":{"type":"WORK_ITEM","id":"<UUID>"},"target":{"type":"WORK_ITEM","id":"<UUID>"},"dependencyType":"BLOCKS","contract":{"version":1,"deliverable":"Drawing","acceptance":{"kind":"MANUAL","satisfied":false}}}]}}
```

Dry-run request has expectedPreviewHash:null; commit requires a64hex hash.
workspaceId remains an outer context hint resolved/authorized by existing routes;
Project's actual Workspace/Business/Tenant are resolved server-side, never trusted
from the hint. One Project per delta; references must already exist or name a
unique earlier command clientRef. UUIDs for newly created nodes/edges are
deterministically derived from a namespaced hash of actorPersonId,Project,
idempotencyKey and clientRef so preview/commit/retry preserve identity. Exact
algorithm: UUIDv5, URL namespace 6ba7b811-9dad-11d1-80b4-00c04fd430c8, UTF-8 name
`zuri.pm.pipeline.v1/<actorPersonId>/<projectId>/<idempotencyKey>/<clientRef>`.
UUID inputs are lowercase canonical strings; clientRef is case-sensitive.

Ref is exactly one of `{type,id}` or `{type,ref}`. id is an existing UUID; ref
names an earlier node.create clientRef of matching type. Both id/ref, forward
refs and edge refs are INVALID_ENVELOPE. Project always uses id. Existing node
IDs for move or dependency update/remove cannot use ref. New-parent
expectedParentHash is null; existing-parent hash is required64hex. Create
parents enter the preview read-set even without a separate expectedParentHash.

| Allowed op | Exact operation-specific fields beyond op |
| --- | --- |
| dependency.create | clientRef,source:Ref,target:Ref,dependencyType,contract |
| dependency.contract | id,expectedDependencyHash,contract |
| dependency.remove | id,expectedDependencyHash |
| node.create | clientRef,type,parent:Ref,fields |
| node.move | type,id,expectedEntityHash,parent:Ref,expectedParentHash |
| undo | originalAuditEventId,expectedAfterHash |

node.create types are WORKSTREAM,WORK_CONTAINER,WORK_ITEM. The frozen field and
parent contract is section6.1. WorkItem explicit protected status is rechecked;
omission defaults PLANNED. One undo command alone per delta;
do not mix inverse replay with other commands. No free JSON patch, status command,
Gate mutation or arbitrary executable/metadata command exists in1.3.

### 6.1 Frozen node-create fields and hierarchy

All fields objects are strict. Required common fields: code (ASCII
`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`); title for container/item or name for Workstream
(trimmed NFC1–240 code points). Container/item subtype is required, trimmed
1–100 code points and valid in its mode. Parent comes only from Ref. No IDs,
version, timestamps, grants, viewConfig, metadata, metrics or free JSON keys
are admitted in fields. All defaults apply before preview hashing.

| Type | Legal parent | Exact extra fields/defaults |
| --- | --- | --- |
| WORKSTREAM | PROJECT whose id equals target Project | executionMode required; progressStrategy optional but must equal mode default below; progressWeight finite positive default1; status PLANNED/ACTIVE/ON_HOLD/DONE/ARCHIVED default PLANNED |
| WORK_CONTAINER | WORKSTREAM or WORK_CONTAINER in target Project | status PLANNED/ACTIVE default PLANNED; startAt,targetAt optional nullable timestamps |
| WORK_ITEM | WORKSTREAM or WORK_CONTAINER in target Project | seven-status vocabulary default PLANNED; assigneeRef optional nullable authorized Person UUID; weight finite positive default1; numericValue optional nullable finite number; probability optional nullable0–1; startAt,targetAt optional nullable timestamps |

Timestamp input is valid ISO8601 with explicit offset, normalized to UTC
milliseconds; omitted nullable fields become null. Dates stay optional. Unique
code, Person scope and mode/subtype numeric semantics are checked by the owning
domain under the transaction. Parent Workstream is resolved server-side.
Mode/default pairs: SOFTWARE_SPRINT/TASK_WEIGHT,DATA_MIGRATION/RECORD_VALIDATION,
B2B_SALES/WEIGHTED_PIPELINE,B2C_CAMPAIGN/KPI_ATTAINMENT,
PRODUCT_LAUNCH/MILESTONE_READINESS,OPERATIONS/SLA_SCORE,
BUSINESS_EXPANSION/EXPANSION_READINESS. Execution mode/contract IDs and version
are server-resolved from the authoritative execution catalogue; missing or
incompatible bindings refuse MODE_INCOMPATIBLE. New Workstreams use the pinned mode defaults from DEFAULT_DOMAIN_BINDINGS and
domainBindingForMode in plan-schema.js (technical owner TD-PROJECT-MANAGER);
examples.executionCatalog includes each exact tuple. Existing bindings are unchanged.
Project has no domain-binding scalar fields. This wire contract does not change when a mutable input schema
adds fields; changing it requires a versioned contract revision.

Safe numeric limits: weight/progressWeight >0 and <=1,000,000; numericValue
between -1,000,000,000,000 and +1,000,000,000,000; probability0–1. All admit at
most6 fractional decimal digits and reject non-finite values. Existing mode
semantics can narrow these ranges. Every affected progress sum/product/division
intermediate and result must remain finite using the existing calculators;
otherwise422 NUMERIC_OVERFLOW rolls back the delta. This includes aggregation
with legacy rows; bounded new values alone cannot prove old aggregates safe.

The exact subtype/default/metric-key catalogue is frozen in examples.executionCatalog,
extracted from EXECUTION_MODE_CONTRACTS in enums.js at635120c5; its source SHA
is in schemaPins. C1 must compare that immutable catalogue and reject drift until
a reviewed revision, not read an unpinned mutable list. Its H(pm-execution-catalog:v1,
{sourceRevision,contracts}) catalogueHash is a required preview read-set field.

### 6.2 Bounds, response and hash framing

Bounds:1MiB UTF-8 request body,1–50 commands,clientRef1–64 ASCII alphanumeric/
hyphen/underscore, at most2000 affected nodes/edges per delta, delivery text as
section4, at most100 blockers returned. Oversized requests refuse before graph
expansion/commit with413 PAYLOAD_LIMIT. Exceeding an affected-node bound returns
422 GRAPH_LIMIT; no partial apply. Larger workflows must submit separate,
independently validated deltas; no bypass flag.

Dry response: `{valid,errors,conflicts,preview,previewHash,projectId}`; preview
is `{commands,changes,releaseEffects}` as specified below. No writes,
trace creation, audit or grants during preview. Hash covers actor identity,
authorized scope, normalized commands (excluding expectedPreviewHash), sorted
read-set fingerprints (including relevant Gate/provenance and hierarchy),
proposed result and contract version. An identical unchanged preview is stable;
permissions and live read-set must still be rechecked at commit.

Commit success: `{committed:true,projectId,executionRunId,executionStepId,attemptId,
stepKey:"plan.import.commit",status:"SUCCEEDED",auditEventId,deltaReceipt}`.
deltaReceipt is `{version:1,payloadHash,previewHash,beforeHash,afterHash,changes,
undoable}`. Existing trace row retains `plan.commit`; receipt compatibility label
retains plan.import.commit. Store additive deltaReceipt in the existing immutable
audit payload, linked by PlanImportReceipt.auditEventId; do not add an unrelated
receipt table. Recovery must retain that payload and existing trace/receipt IDs.
changes contains only authorized changed IDs/hashes. dry-run afterHash is a
proposal fingerprint; committed afterHash additionally binds server provenance.

All DTOs are strict and all arrays required, even when empty. changes rows are
exactly `{type,id,action,beforeHash,afterHash}`, sorted type/id, max2000; action
CREATE/UPDATE/DELETE. beforeHash:null only for CREATE, afterHash:null only for
physical Dependency DELETE or the unreferenced WorkContainer undo deletion
specified in section8; soft-delete is UPDATE. Type is a six-endpoint type or
DEPENDENCY. Limit full canonical affected before/after state to4MiB; excess is
GRAPH_LIMIT, never partial apply. Receipt changes use actual committed hashes.

releaseEffects is sorted by workItemId, with exact rows
`{workItemId,before:ReleaseDTO|null,after:ReleaseDTO}` for affected authorized items;
before:null only for a newly created WorkItem. Rows are
max2000 within the same4MiB budget. Opaque/unauthorized effects fail the whole
preview SCOPE_UNAVAILABLE; no partial foreign scope projection. errors is max50
rows `{code,path,message}` sorted path/code, message max240 code points.
conflicts is max50 rows `{code,path,expectedHash,actualHash}`, sorted path/code,
hashes null when absent. Semantic refusals have errors and empty conflicts;
stale/CAS/undo conflicts additionally give an authorized conflict row. Unauthorized
resources use one generic safe error, no conflicts or foreign hashes.

Dry success has exactly valid:true,errors:[],conflicts:[],preview,previewHash,
projectId. Dry failure keeps those keys, valid:false,preview:null,previewHash:null;
projectId:null on scope refusal. Commit failure has committed:false,errors,conflicts
only. Commit success has the listed success fields plus replay:boolean,
errors:[],conflicts:[]. deltaReceipt additionally contains idempotencyKey and
inverseOfAuditEventId (null except undo). No implicit receipt expiry.

Define C as compact UTF-8 JSON with recursive Unicode-code-point key ordering;
arrays retain declared order; finite IEEE754 numbers use JSON.stringify encoding
(-0 becomes0). DateTime scalars use UTC milliseconds. Scalar JSON strings stay
strings. Define `H(label,value)=sha256(UTF8(label + "\n" + C(value)))`.

| Fingerprint | Exact frame/value |
| --- | --- |
| Dependency | section4 pm-dependency:v1 and its exact eight-key projection: id,sourceType,sourceId,targetType,targetId,dependencyType,createdAt,contractJson |
| Entity row | H(pm-entity:v1,{type,id,row}); row contains all scalar columns of schema.prisma at635120c5, nullable missing values null, no relation objects; pinned schema.postgres.prisma must have matching scalar names/types and uses the same provider-neutral projection |
| Parent/subtree | H(pm-subtree:v1,{root:{type,id,hash},descendants:[{type,id,hash}]}); all current descendants sorted type/id |
| Read-set | H(pm-readset:v1,{scope:{tenantId,businessId,workspaceId,projectId},authorityHash,catalogueHash,graph:[{id,hash}],entities:[{type,id,hash}],gates:[{id,hash}],evidence:[{id,hash}],resolutions:[{type,code,id}]}); graph is exclusively Dependency, gates Gate, evidence AuditEvent; sort by id, entities by type/id, resolutions by type/code. id:null represents code absence. Code lookups are global per the pinned unique code constraints and are authorized before preview |
| Before/after aggregate | H(pm-delta-state:v1,{rows:[{type,id,hash}]}); sorted type/id, fixed full affected set, missing/proposed-deleted row hash:null |
| Payload | H(pm-delta-payload:v1,{schemaVersion,kind,projectId,actorPersonId,trace,commands}); normalized/defaulted input excluding expectedPreviewHash and server fields |
| Preview | H(pm-delta-preview:v1,{contractVersion:"1",payloadHash,readSetHash,beforeHash,proposedAfterHash,changes,releaseEffects}); preview manual acceptance uses client shape; committed afterHash separately binds actual server provenance |

authorityHash is H(pm-authority:v1,rows), a sorted model/id list of
`{model,id,row}` for current Person/account/credential, Membership/RoleBinding
and scope records contributing to the existing Identity resolver's answer. Each row
contains all scalar columns of its pinned Prisma model, never relation fields;
SQLite/PostgreSQL scalar inventories must agree. The frame is internal only.
Re-resolve Identity inside the transaction, not from a stale supplied viewer;
read-lock contributing authority records until commit or use an equivalent
Identity-owned revocation fence. Graph locks alone do not serialize IAM changes.
C1 tests must pin its complete resolver read-set/fence before activation without
exposing these records to clients. Preview hash never grants permission.

Minimal complete read-set is mandatory, not merely illustrative: every existing
endpoint; its complete ancestor chain to Project; all descendant membership rows
used for aggregate release/effective-cycle evaluation; source and target parents/
subtrees for move; relevant Gate rows and manual-decision audit rows; all existing Dependency rows
used by stored/effective cycle checks. Tenant/Business/Workspace and identity
scope rows enter authorityHash. Undo additionally binds the original audit and
every current after-image/reference used to validate its inverse. New-code
lookups add resolutions with actual id or null. Deterministically allocated new
rows enter proposed changes; existing parents still enter entities. A graph
lock plus repeat query fences membership/absence phantoms. No successful preview
may omit a row whose change could alter authority, membership, release or result.
Fixtures expose row images as well as hashes so completeness and stale-read
vectors can be checked independently.

For newly proposed rows, server-owned createdAt/updatedAt and manual provenance
are null in preview fingerprints; version is its proposed initial value. They
are replaced with actual values only in committed hashes. This keeps unchanged
dry runs deterministic without trusting a client clock. trace in1.3 is strict:
exactly correlationId and idempotencyKey UUIDs; inverse lineage comes only from
the undo command and original audited receipt, never arbitrary trace fields.

Idempotency lookup is the existing globally unique key, but current scope and
actor authorization run first. payloadHash is SHA256 of canonical version/kind/
Project/actor/trace/commands, excluding expectedPreviewHash and server fields.
Same key/hash returns original authorized receipt with replay:true and no writes
even when old preview is stale. Different payload or actor returns409
IDEMPOTENCY_CONFLICT without disclosing original scope. Failed validation/rollback
does not consume a success key. Key creation and all mutations/audit/trace are
one transaction. The key remains globally unique independently of graph locking: a key
unique violation must roll back the whole losing transaction, including all
mutation/audit/trace writes, then reauthorize/re-read the winner in a fresh
transaction. Same authorized actor/scope/hash replays; otherwise generic
IDEMPOTENCY_CONFLICT. Never continue inside an aborted PG transaction or commit
business writes before claiming the key. Use the same three-retry/5s budget;
unrelated constraint violations are not idempotency replays. Receipt lookup
follows current actor/scope authorization but precedes stale-preview/CAS/graph
validation. This deliberately differs from current commitPlan's dry-run-first
ordering, so an identical retry after later edits still returns its old receipt.

Every refusal returns `{committed:false,errors:[{code,path,message}],conflicts}`
or the analogous dry valid:false shape, with no success receipt. Codes/statuses:
400 INVALID_ENVELOPE;401 UNAUTHENTICATED;413 PAYLOAD_LIMIT;404 SCOPE_UNAVAILABLE (missing or foreign
resources share shape);422 CONTRACT_REQUIRED/INVALID_CONTRACT/INVALID_PARENT/
MODE_INCOMPATIBLE/SELF_DEPENDENCY/CYCLE/REFLEXIVE_SCOPE/GRAPH_LIMIT/NUMERIC_OVERFLOW;
409 STALE_PREVIEW/STALE_ENTITY/UNDO_CONFLICT/IDEMPOTENCY_CONFLICT/RELEASE_HELD/UPGRADE_REQUIRED/CONTRACT_CONFLICT;
503 GRAPH_BUSY after bounded contention retries. Auth errors never include
foreign names/IDs. Validation paths are input JSON pointers; generic safe text
is not a SQL error. C1 must mirror JSON Schema/Zod/OpenAPI and test exact DTOs.

## 7. Serialization, scope and move matrix

Every graph/status/Gate/acceptance/hierarchy writer acquires the same global
graph lock before reads used for cycle/release/CAS, including all import,
register, undo, repair and compatibility writers across every Tenant. Cross-Project register
edges are allowed within one Tenant only, with both governing Businesses owned.
Cross-Tenant new edges refuse SCOPE_UNAVAILABLE. A Project-local delta accepts
only endpoints contained by its Project; global register keeps cross-Project
authority and calls the same domain writer, not Project delta with hidden scope.

PG uses transaction-scoped advisory lock on the **first8 digest bytes**, interpreted
as signed big-endian two's-complement int64, of SHA256(UTF8(
`pm.pipeline.graph:v1`)). Pass the exact decimal
string as PostgreSQL bigint, never a JS Number or two-int32 alternative. The
examples lockVector freezes input/digest/key. Use SERIALIZABLE transaction/retry. Acquire this global lock first; any additional maintenance locks follow in
ascending signed-key order. SQLite
uses the existing provider adapter's immediate write transaction or equivalent
single-writer serialization, with bounded busy retry; never nest BEGIN inside
an importer transaction. Three serialization/busy retries with a total5s budget;
fresh read-set and authority each attempt. There is no process-only lock proof.

The current stored-cycle scan is global; Dependency has no Tenant key and old
authorized endpoints could be in different Tenants. Preserve those legacy rows
without automatic repair, and retain the global stored-edge scan/read-set across
all dependency types, including cross-Tenant bridges. Internal graph hashes/rows
must never expose foreign metadata through preview/error/receipt DTOs. Tenant
authorization still restricts edits; the lock grants no wider authority. This
intentionally serializes unrelated Tenants in V1. Per-Tenant locking is not an
equivalent optimization without a separately reviewed partition/census policy.
Activation refuses while any writer can bypass this shared transaction boundary.

C1 PG acceptance must use separate real-runtime-role connections in two Tenants
with preserved A2→B1 and B2→A1 legacy edges. Race authorized A1→A2 against B1→B2: each
is acyclic alone, the union cycles. Exactly one creation may commit; the other
must re-read and refuse CYCLE with no partial audit/trace/receipt writes. Include
a barrier proving both operations use the same global key, bounded retry, and
recovery that retains both legacy bridges. The examples freeze this topology as
globalGraphIsolationCase; this is a required future runtime test, not a claim
that a synthetic fixture proves database serialization.

| Node being moved | Legal parent | Required behavior |
| --- | --- | --- |
| WORKSTREAM | same PROJECT only | no cross-Project move; own Project is an idempotent no-op |
| WORK_CONTAINER | WORKSTREAM or WORK_CONTAINER in same Project | reject self/descendant; update subtree Workstream IDs and every contained item's Workstream atomically |
| WORK_ITEM | WORKSTREAM or WORK_CONTAINER in same Project | set Workstream and optional container together |
| PROJECT, MILESTONE, GATE | none in C3 | INVALID_PARENT; their existing CRUD is not a canvas reparent operation |

Prospective validation checks every descendant subtype/strategy against the
destination's existing seven-mode contracts, preserves all stable IDs and
Feature links, checks effective cycles/release and rejects mixed incompatible
moves before preview and again under lock. node.move expectedEntityHash and
existing-parent expectedParentHash both use the subtree frame, including leaf
roots with an empty descendants list. Change rows use scalar-row hashes instead.
Source/destination hashes cover rows plus ordered descendant IDs/hashes; Gate and
Dependency lack versions, so hashes must not pretend a version exists. Removed
or newly added descendants make the previous move stale. No silent subtype,
mode, numeric progress or acceptance conversion occurs.

## 8. Undo and audit contract

One delta emits one aggregate PLAN_DELTA_COMMITTED audit event with actor,
scope,original normalized command hash,ordered before/after images and receipt
link; preserve per-step PM trace identities without a second aggregate audit
for the same business delta. Replayed commits emit no second business audit.

An inverse delta is generated server-side from that original event, authorized
again, locked and checked against **all** current after-images and dependent
references. expectedAfterHash is the receipt's committed afterHash. Foreign or
missing original audit is SCOPE_UNAVAILABLE; later edits, missing provenance,
changed descendants, newly referenced created nodes or adopted-contract mismatch
are UNDO_CONFLICT. Also recheck current Gates, release and cycle predicates;
undo is no permission to resume held work.

Moves and contract edits invert to prior values; dependency remove may restore
the same id and prior contract only if uniqueness and endpoints still hold.
Creating nodes/edges may invert only if nothing subsequently refers to them.
Workstream/WorkItem removal uses their deletedAt soft-delete; WorkContainer has
no deletedAt at the pinned schema and can be physically removed only after its
created child references have been inversed, with no remaining references. Do not
invent another schema column. References added after the original audit refuse
the whole inverse. Do not rewind
other events, grants, progress check-ins or manually supplied snapshots. Restoring
a prior manual mark copies its original immutable provenance and adds inverse
audit linkage; it does not forge a new acceptance decision by the undoing actor.
An undo has its own trace/idempotency/audit, inverseOfAuditEventId; no redo command
in1.3. Undoing an undo is explicitly refused.

## 9. Compatibility, activation and recovery

Adoption order: additive nullable migration/readers/recovery first; transaction
writer and mandatory global-register form second; then activate **all writers**;
only then enable C2/C3; C4 release activation follows independent acceptance.
Before handoff activation, do not expose any new canvas writer. After activation:

| Writer/input | New edges | Existing identical legacy rows |
| --- | --- | --- |
| Dependency API/global register | required V1 contract through shared writer | read undeclared; explicit contract edit needs CAS |
| Full Plan1.0/1.1/1.2 | CONTRACT_REQUIRED in dry-run and commit when an edge would be created | preserve existing null, no synthesized backfill |
| Full Plan1.3 delta | strict declared contract | explicit hash-protected edit/removal |
| Bundle1.0 | refuse newly created bare edges transactionally | retain identical rows only |
| Proposed Bundle1.1 | additive contract field on cross-Project edges; same shared writer | preserve null unless explicitly amended |
| Seed/scripts/doc-graph imports | migrate callers or refuse activation; no automatic satisfied contract | test-only fixture exceptions must never run as runtime bypasses |

Bundle1.1 requires an explicit additive schema/reader change in C1; preserve1.0
recovery/read support. No compatibility endpoint may clear a declared contract
to null. Older payloads may read/replay a previously successful authorized
receipt, but cannot create an undeclared edge. Undo may restore a historical null
only for the same audited pre-activation legacy edge under unchanged hashes.

Before activation C1 must qualify SQLite and PG additive migration, six endpoint
families, contract/provenance/audit/receipt retention, nullable legacy round trip,
full and protected recovery and frozen inventory binding updates. Unknown declared
version/corrupt JSON refuses restore before mutation; no stripping unknown fields.
Recovery into a target without the matching schema is refused. A code downgrade
that would drop/ignore contract/release enforcement is not a valid rollback;
retain migrated data and disable new writes until a compatible artifact is restored.
No production environment is selected by this document.

### 9.1 Exact global register/API adapter

POST /api/dependencies accepts `{plan: RegisterDelta}` after activation.
RegisterDelta has exactly schemaVersion:"1.3",kind:"DEPENDENCY_REGISTER",
projectIds (1–2 distinct existing UUIDs sorted lexically),trace,expectedPreviewHash,
commands (exactly one dependency.create/contract/remove from section6). It has no
projectId field. Resolve both endpoints' real Projects and compare the exact
Project set to projectIds; own both Businesses in the same Tenant. No node/undo
commands, client refs to nonexistent nodes or client-chosen wider authority.
expectedPreviewHash:null is read-only preview;64hex is commit. This is the same
internal delta/transaction writer with a server-controlled REGISTER scope option;
/api/import always permits PROJECT_DELTA only, so a canvas cannot widen scope.

Primary projectId for the receipt/read-set and UUIDv5 create-name frame is the
lexical first authorized root projectIds entry. Root projectIds carries the full
set; ProjectExecutionRun.projectIdsJson stores its canonical JSON array. The
execution-trace DTO exposes the parsed array as projectIds; wire trace remains
correlationId/idempotencyKey only. Register payload
hash uses H(pm-delta-payload:v1,{schemaVersion,kind,projectId,projectIds,
actorPersonId,trace,commands}), all other frames/DTOs and replay rules unchanged.
Global register can edit/remove a cross-Project contract with the same CAS.
DELETE /api/dependencies/{id} accepts the identical RegisterDelta wrapper with
one dependency.remove whose id matches the URL. Bare legacy POST without contract
returns422 CONTRACT_REQUIRED; other old mutation shapes/param-only DELETE return
409 UPGRADE_REQUIRED after authorization, with the same safe errors/conflicts DTO.
The updated form uses preview before commit; cancellation leaves no row/audit.
Existing authorized GET shape is preserved, adding contractState and
expectedDependencyHash only after both endpoints' read scopes are authorized.

### 9.2 Exact Bundle1.1 additive adapter

Keep the existing /api/import/bundle/dry-run and /commit `{bundle:...}` wrapper.
Bundle1.1 is the **exact pinned Bundle1.0 schema**, changing schemaVersion to1.1,
adding required expectedPreviewHash (null for dry run,64hex for commit), requiring
trace.correlationId/idempotencyKey UUIDs, and adding required contract:V1 to each
root dependencies[] row. Keep row keys sourceProjectRef,targetProjectRef,relation,
description?,metadata? exactly; no arbitrary endpoint type/ID. It still produces
PROJECT→PROJECT rows. New contract is not nested in metadata or description.
All other keys/bounds/strict rules, including nested full plans1.0/1.1/1.2,
are pinned by bundle-schema.js and the full-plan JSON schema SHA in schemaPins;
nested PROJECT_DELTA/DEPENDENCY_REGISTER is refused. Source/target refs must
resolve to included distinct Projects in the authorized Business; Gate acceptance
uses the effective predecessor Project after ref resolution. New Projects can
use manual contracts; an existing Gate cannot belong to a not-yet-created Project.

Allocate new Project IDs using the same UUIDv5 namespace and name
`zuri.pm.bundle.v1/<actor>/<idempotencyKey>/<bundleProjectRef>`; retain existing
IDs for existing codes. Pass allocations as trusted internal import options,
never extra fields in a full PlanEnvelope. Preview binds code→ID resolution;
a competing code claimant makes commit stale. All nested plans, cross-Project
edges, provenance, trace/audit and receipt commit in the existing outer transaction.
No extra aggregate PLAN_DELTA audit is emitted for individual bundle edges;
manual decisionAuditEventId links to the existing bundle aggregate audit event.

Every new graph-visible nested Workstream/WorkContainer/WorkItem/Milestone/Gate
uses UUIDv5 with name `zuri.pm.bundle.entity.v1/<actor>/<key>/<encoded>` where
encoded is unpadded base64url(UTF8(C({bundleProjectRef,type,code}))). Root edge
IDs use `zuri.pm.bundle.edge.v1/<actor>/<key>/<encoded>` with
C({sourceProjectRef,targetProjectRef,relation}) encoded identically. Duplicate
same-type codes or duplicate edge tuples are INVALID_ENVELOPE. Existing code/
endpoint/type bindings retain their IDs and hashes. Allocate all visible IDs
before preview; internal audit/trace IDs and server timestamps do not enter
proposed fingerprints, but their actual values enter committed receipts.

Bundle root dependencies are create-only, not a hidden contract editor. Absent
row creates V1 with provenance; existing legacy NULL remains UNDECLARED, visibly
reported as preserved legacy in preview; existing declared row with identical
canonical client contract (strip only server manual provenance) is unchanged.
Different declared content refuses409 CONTRACT_CONFLICT; use the register's CAS
contract command instead. Never refresh provenance or clear NULL implicitly.
The supplied V1 is still fully validated/authorized even when preserving a legacy
row. Receipt existed/state/hash reflect the actual stored result.

Bundle1.1 preview/receipt/error fields retain the exact pinned implementation
shapes of bundle-dry-run.js,bundle-commit-service.js,bundle-receipt.js except:
dry success adds previewHash; commit receipt adds handoffReceipt:
`{version:1,previewHash,beforeHash,afterHash,changes}` and every receipt.dependencies[]
row adds expectedDependencyHash (the full row hash in section4) and contractState. Failure for1.1 uses section6.2
typed errors/conflicts plus committed:false (or valid:false,preview:null,
previewHash:null for dry failure);1.0 response shapes stay unchanged. Replayed
1.1 receipts retain these fields unchanged. Examples pin full serialized requests
and these additive response fixtures alongside the base source-file SHA bindings.

Bundle payloadHash is H(pm-bundle-payload:v1,{actorPersonId,bundle}) over normalized
bundle excluding expectedPreviewHash. Bundle previewHash is H(pm-bundle-preview:v1,
{payloadHash,readSetHash,beforeHash,proposedAfterHash,changes}); use section6.2's
state/row/catalogue/authority frames over all graph-visible pipeline rows of all
included Projects. The change-type allow-list remains the six endpoints plus
DEPENDENCY; unrelated Strategy/Repository/ExternalReference writes retain the
pinned base bundle's receipt/audit/transaction semantics and are not represented
as new Pipeline entities. Their authorization still runs in the existing lane.
Read-set primary scope is first lexical Project, entities include every Project
and resolved scope. Apply1MiB body/4MiB state/2000 affected-row limits, no50-command
limit on existing bundle arrays; their pinned old cardinalities remain in force.

For1.1, continue reserving the global key in the existing PlanImportReceipt
inside the outer transaction, preserving the current bundle.import.commit
compatibility stepKey and first-committed-Project/bundleRunId anchor. Store
schemaVersion:"1.1" and existing correlationId/audit link. The read-set's lexical
primary scope does not change that compatibility anchor. Keep the existing bundle audit receipt as the outward authoritative DTO;
this guard row prevents key races, it is not another aggregate or new table.
The Plan/REGISTER/Bundle shared key namespace and whole-transaction rollback/
fresh reauthorization/replay ordering are identical. A key used by another
transport/payload refuses IDEMPOTENCY_CONFLICT. C1 must extend existing receipt,
trace,backup and recovery consumers for this additive version before activation.

The normalized writer modules are shared; these adapters do not introduce a
second cycle/release implementation. Bundle1.0/new nested bare-edge creations
still refuse CONTRACT_REQUIRED rather than bypassing the invariant.

## 10. Examples and verification boundary

[Machine-readable candidate examples](contracts/pipeline-contract.examples.json)
cover all six endpoint types, seven dependency types, statuses, legacy null,
Gate/manual decisions, authorization, stale/CAS/idempotency and inverse behavior.
Fixtures describe **expected future results**, not executed app acceptance.
Serialized command-family fixtures use a synthetic authorized context and state
images/hash frames. They are protocol examples, not captured app calls; omitted
Identity catalogue/query context must be supplied by C1 integration fixtures.
Schema/coverage validation proves fixture consistency only; C1–C4 require real
adapter/browser/race tests from their plan, including two opposing concurrent
edges, release vs evidence changes, stale moves/undo and no partial audit writes.

C0 runs governance, profile/reader tests and the existing dependency/import
regressions unchanged. No DB migration or app UI test can be claimed for new
functionality that does not exist. Required staged-patch review must check
the same examples and this source baseline before contract adoption is requested.

## 11. Exact adoption decisions and canonical impact

| Decision | Proposed disposition | Adoption consequence |
| --- | --- | --- |
| D1 persistence/provenance | section4 strict V1 + nullable string/CAS | FR-084 clarification and ADR-035 addendum; no extra model/version |
| D2 delta/receipt/undo | sections6–8, Plan1.3 and Bundle1.1 | preserve old trace receipt compatibility; C1 implements all affected readers/writers |
| D3 direction/non-ordering | section5 typed successor, REQUIRES reverse, lineage/related nonholding | FR-085's literal “inbound edges” and BR-017's general successor wording need explicit reviewed clarification; current source does not supply this table |
| D4 aggregate scope/status phases | section5 expansion and protected transitions | FR-085/ADR-035 reviewed clarification; MILESTONE/GATE descendants are a new proposed policy, not current source truth |
| D5 moves/locks | same-Project matrix; global stored-graph serialization | C1/C3/C4 must share locks with Gate and all status writers; cross-Project canvas moves excluded |
| D6 compatibility/activation | section9 refuses old new-bare-edge writes | migrate API/full-plan/bundle/tools before activation; legacy reads/restore preserved |

All six decisions require acceptance of the exact supplement/examples. In
particular D3/D4 cannot be inferred from the earlier implementation-plan approval.
If the owner chooses different release behavior, revise the examples, supplement
and C1–C4 tests before application code. No canonical row is changed in this patch;
their migration remains a separate reviewed adoption step, preserving IDs,
subject anchors, provenance and generated-export discipline.

## Version history

0.1.0 (2026-10-23): source-qualified C0 proposal, selected semantics and
compatibility/transaction/undo boundaries for review. ADR-035 remains proposed;
C1–C4 application implementation has not started. No runtime/production claim.

0.1.1 (2026-10-23): independent-review precision pass: strict Ref/node fields,
UUID/hash/DTO frames, persisted provenance and global idempotency race ordering.
Serialized examples remain proposed; no product adoption is inferred.

0.1.2 (2026-10-24): close adapter, lock-key, numeric-bound and reproducible
catalogue/provider/hash-vector gaps found in re-review. All transport additions
are still proposals; C1 must implement and verify them after exact adoption.

0.1.3 (2026-10-24): make read-set coverage and all Bundle visible-ID allocations
explicit; correct physical-undo hashes, existing-edge CAS compatibility and
register trace naming. Replace illustrative incomplete vectors with row-bound
fixtures. Adoption and C1–C4 remain pending.

0.1.4 (2026-10-24): correct authority scalar projections and Bundle Project names;
pin source mode domain bindings and add Gate evidence/staleness vectors.

0.1.5 (2026-10-24): bind preserved cross-Tenant legacy bridges and the global
cycle read-set to one global graph lock; require the two-Tenant opposing-writer
PG acceptance case before activation. No legacy repair or runtime change here.
