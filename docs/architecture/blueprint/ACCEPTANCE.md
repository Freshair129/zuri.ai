---
status: active
superseded_by: null
version: "1.0.0"
artifact_kind: resolved-source-projection
source_revision: "18008b774fc54febd23ca675d142f15da7d67db5"
---

# Acceptance

These are cross-cutting observable target scenarios, not test receipts. The
generated source-linked obligation/oracle index binds each included canonical
statement to its original hash, applicable controlling amendments and relevant
local scenario IDs. It is an index, not a fully decomposed executable testcase
specification. The receiving team derives concrete fixtures and assertions from
the exact source statement, the applicable typed contract and schema. Supporting
test references and implementation status belong in separate evidence artifacts;
historical references do not assert a new PASS. The `AC-*` scenario labels are
local navigation IDs, not canonical requirements.

## Profile and scoped access — AC-SCOPE

| Preconditions | Action | Observable result |
|---|---|---|
| A person has completed identity setup but has no Business grant. | Open the product or join a shared Workspace. | Profile and Workspace collaboration remain available. The product does not create a false Business or Project, and Workspace membership alone does not grant Tenant/Business authority. |
| A Project belongs to a Business-scoped Space and the viewer is outside that Business. | Request the Project or attempt an import. | Core refuses before mutation using the source-defined non-disclosing response. The result does not disclose whether the hidden Business or Project exists. |
| The viewer can access an assigned Business. | Open Project creation while the server supplies the required Space grouping. | The product creates a Project under the authorized Business and required Space relation without requiring the user to treat Space as another authorization level. |

These outcomes are constrained by ADR-027, FR-066/067, FR-072, the Identity
charter and the current schema. A product label or client-supplied ID cannot
override the persisted relationship or server-resolved scope.

## Hierarchy create, read, update and delete — AC-CRUD

For [FR-001](../../requirements/FR-001.md) and
[FR-002](../../requirements/FR-002.md), the concrete CRUD oracle uses the
owning typed contract and pinned schema fields for the selected hierarchy
record:

| Preconditions | Action | Observable result |
|---|---|---|
| The actor is authorized in the target scope and the requested parent is visible and valid for the selected entity. | Create a hierarchy record with the required human-readable code and parent relation. | The owning contract creates the record with its internal identity; a subsequent authorized read returns the same persisted identity, code and parent relation. |
| The actor remains authorized to update the persisted record. | Update an allowed field without supplying a replacement identity or parent. | The persisted identity and schema/source-defined parent invariants remain intact; the authorized read returns the updated record. |
| The actor is outside the owning scope, or the requested parent is outside/invalid for it. | Attempt create, read or update. | The owning contract refuses without partial mutation or disclosure beyond its source-defined response. |
| A delete operation is defined for the selected entity by its owning source/schema. | Request that entity's declared delete lifecycle. | The exact entity lifecycle is followed. No universal soft-delete field or delete behavior is inferred for entities whose schema/source does not declare one. |

FR-002 selectors resolve persisted Portfolio, Business, Workspace and Project
context under the same authorization rules; remembering a prior selection does
not grant access to it.

## Objective and execution modes — AC-MODES

| Preconditions | Action | Observable result |
|---|---|---|
| An authorized user has a Business objective and creates a Project. | Submit the objective and context. | The planning flow decomposes work into Workstreams and chooses from the seven canonical modes; it does not first require an unrelated template choice. |
| A Workstream has a declared canonical mode. | Open its work view. | The matching mode view opens, while the neutral Project/Workstream and shared work primitives remain available. No eighth canonical mode appears. |
| A Project has Workstreams with different evidence and progress strategies. | Review progress. | Each contribution follows the Workstream's declared strategy and weight with its evidence visible. The Project does not substitute a universal completed-task ratio. |

The exact seven mode names and progress contracts are bound in the canonical
requirements and source-bound acceptance matrix.

## Plan import — AC-IMPORT

| Preconditions | Action | Observable result |
|---|---|---|
| The importer has the exact accepted PlanEnvelope/ExecutionPlanBundle schema, and the viewer is authorized for the selected scope. | Submit valid plan data. | Schema validation completes before writes; a dry-run preview shows proposed changes and resolved scope. |
| The plan is invalid, unsupported or outside the viewer's scope. | Preview or commit it. | The operation is refused before business mutation. Validation errors identify correctable source fields; refusal does not reveal inaccessible records. |
| The plan conflicts with current Project state or version. | Review the preview and attempt commit. | The user sees the current/proposed conflict. No data is partially written until the accepted conflict rule is satisfied. |
| The accepted preview is current and all authorization/conflict checks pass. | Commit the plan. | The owning transaction applies the complete accepted plan or none of it; required audit evidence records the mutation. Imported content executes no code and gains no authority. |

## LINE conversation and operations — AC-LINE

| Preconditions | Action | Observable result |
|---|---|---|
| A LINE event is received by the current Server path and passes its accepted ingress checks. | Admit and process the event. | Core owns durable admission, scope, fencing and recovery. The response acknowledgement follows the durable capture/handoff defined by ADR-106. Runtime performs only its versioned contract and cannot write domain tables or call LINE directly. |
| The same canonical event/request is delivered again under a contract-defined idempotency key. | Retry admission or completion. | The operation returns the single durable outcome required by its owning contract. It does not create duplicate accepted work or a duplicate confirmed send. |
| The Runtime or Server is replaced during accepted work. | Restart/recover the process. | Durable state allows the owning Core contract to reconcile the work. Process-local state is not required to prove accepted work or authorization. |
| The LINE provider call times out after dispatch. | View or retry the operation. | The user sees the source-defined unknown/reconciliation state; the product does not call it delivered or repeat the external send blindly. |
| A user configures or operates a LINE account. | Connect, inspect, publish or dispatch through the approved account flow. | The Server and Integration contracts own authorization and provider transport. Secret material is absent from client payloads, responses, logs, audits and user-facing receipts. The UI exposes no Edge pairing, device credential, extraction or device transport route. |

Native LINE target behavior is the exact in-profile behavior of FR-148, FR-149
and FR-265 under ADR-100/106/110. `FR-050` and `FR-140` legacy transport
clauses remain out of this profile until a replacement transport is accepted.
The test oracle does not derive a Runtime tool-loop rule from FR-050.

## Knowledge and file acceptance — AC-KNOWLEDGE

| Preconditions | Action | Observable result |
|---|---|---|
| An authorized active managed FileAsset has a supported PDF, DOCX body XML or static UTF-8 HTML source within the exact FR-288/SDD-114 limits. | Parse and query the source. | Original bytes and digest remain immutable; output carries deterministic typed source locations and exact text spans accepted by the canonical clauses. Image/OCR and omitted auxiliary content are not silently invented. |
| A source is malformed, unsupported, ambiguous or exceeds a canonical bound. | Parse the source. | The operation refuses without presenting a successful partial parse. Remote resources are not fetched and OCR is not invoked. |
| A previously parsed source is replayed or reparsed after its source version changes. | Resolve prior and new citations. | Replay refers to the correct retained version; reparse uses a new artifact identity as required by SDD-114, and no latest-version fallback changes the old citation. |
| A non-operator or an operator requests a source unavailable from the indexed graph or safe repository file set. | Browse Knowledge Studio or open a node. | Non-operators are denied. Operators receive only graph/source data permitted by FR-289; unsafe path, unknown node or missing file is refused. Domain grouping uses explicit relations or metadata, never folder names alone. |

Exact input, archive, page, paragraph, cell, element, output and worker-time
bounds come from FR-288 and SDD-114 in the pinned requirement matrix. No
production activation, OCR or remote fetch is inferred from the schema or test
design.

## Usable state and accessibility — AC-UX

Given any main user journey, the product exposes a distinct loading, empty,
validation-error, denied, conflict, retryable-failure or unknown-external-result
state as applicable. Status is conveyed with accessible text and semantics, not
color alone. Keyboard focus and accessible labels remain available. Current
Zuri Heritage tokens and WCAG-related commitments governed by NFR-008 and
SDD-010 remain in force; ADR-024 removes only the legacy replacement/cutover
tail.

## Oracle and evidence boundary

Every matrix row names one of these observable oracle forms: user-visible state,
persisted state under the owning schema, accepted versioned API request/response,
typed refusal, authorized external side effect and truthful receipt, or a
source-linked audit/job/trace record. A test passing one scenario supports only
that scenario at the inspected revision. A task plan, source review, old test
receipt, route inventory or generated OpenAPI listing is not by itself proof of
runtime behavior, production activation, LINE delivery, OCR support or full
acceptance.
