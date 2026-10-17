---
title: "TASK-ZAI-026 implementation contract — Business-scoped Knowledge Node View"
doc_id: "TASK-ZAI-026-NODE-VIEW-CONTRACT"
status: "candidate"
version: "0.3.0"
updated: "2026-10-18"
owner: "Codex"
source_of_truth: false
live_document: true
---

# TASK-ZAI-026 — Business-scoped Knowledge Node View

**Lifecycle:** Candidate for root adoption. This document recommends a concrete implementation boundary for TASK-ZAI-026. It does not amend canonical requirements or roadmap state, approve `ZAI:FEAT-007` or `ZAI:ADR-035`, authorize code work beyond the accepted task, or claim runtime/test evidence.

**Source revision reviewed:** `7a661d95c7db57122a0899652c354831cac559ac`.

## 1. Recommended contract

Implement TASK-ZAI-026 as a read-only 3D view over a server-built Zuri relation projection for one currently authorized Business. The first view is rooted at that Business and shows its Customers and each Customer's associated Person:

- Depth 0: the selected Business.
- Depth 1: Customers whose `tenantId` and `businessId` match the authorized Business, excluding soft-deleted Customers.
- Depth 2: each in-scope Customer's associated Person, rendered with the type-only label “Person”.

Search returns the exact path from the Business root to a matching visible node, up to the fixed maximum depth of 2. Person identity and profile fields are not searchable or returned; the type-only “Person” query can find Person nodes without exposing names. The request cannot choose a tenant, graph source, traversal depth, or arbitrary path.

Use the existing Zuri relation projection vocabulary from `ZAI:FR-024`, but build the view DTO from rows queried inside the authorized Business. Do not call the tenant-wide `projectKnowledgeGraph` and filter its completed output. Do not present this as a live GKS/GenesisBlockDB traversal: `ZAI:FR-024`'s graph reader is principal-scoped and has no user-facing Business graph contract. A later live GKS view needs an explicit Business-scoped graph-query contract through the approved service boundary.

For this proposed slice, “over the governed relation graph” means a Business-authorized Zuri read model using `ZAI:FR-024`'s relation vocabulary; it does not mean a live GKS query. Canonical adoption should make that boundary explicit. If the product intent requires traversal of live GKS data, defer implementation until an approved Business-rooted query contract exists through MSP. Do not present the Zuri read model as a live GKS result.

Keep TASK-ZAI-027 as a separate Project Manager Pipeline Builder task. It owns the proposed `ZAI:FR-082`–`ZAI:FR-085` structure editing, edge creation, handoff contracts, and Board gating. TASK-ZAI-026 is read-only Knowledge navigation. The existing TASK-ZAI-024 dependency is already recorded as done/merged in the canonical roadmap; retain it as a satisfied prerequisite without reopening that task. TASK-ZAI-027 has no semantic dependency on TASK-ZAI-026, so root should remove the current TASK-ZAI-027 → TASK-ZAI-026 edge when reconciling the canonical roadmap.

No DDC migration, DDC runtime, provider activation, credential use, or production state is needed for this slice.

## 2. Source reconciliation and implementation status

| Source | Status and evidence | Consequence |
|---|---|---|
| `docs/roadmap/ROADMAP.md`, TASK-ZAI-026 | Canonical delivery row: “Interactive Node View 3D over the governed relation graph”; `planned / UNKNOWN / NOT_STARTED`; depends on TASK-ZAI-024. Its evidence says `ZAI:FR-082`–`ZAI:FR-085` / `ZAI:ADR-035` is design-only and that no approved node, traversal, or redaction contract or implementation evidence exists. | Preserve the task ID and TASK-ZAI-024 dependency. Adopt a distinct Knowledge contract and requirement before implementation. |
| `docs/roadmap/ROADMAP.md`, TASK-ZAI-027 | Canonical row: “Structure and edge direct manipulation with handoff contracts”; `planned / UNKNOWN / NOT_STARTED`; depends on TASK-ZAI-026; evidence points to FEATURE-MAP `ZAI:FR-082`–`ZAI:FR-085`. | The dependency is inconsistent with the two task meanings. Recommend removing it; the existing Project work-view baseline is the relevant PM foundation. |
| `docs/roadmap/ROADMAP-zuri-ai-24w-program.md`, TC-TASK-ZAI-026 | Version 0.4.36 declares `source_of_truth: false`, `derived_from: docs/roadmap/ROADMAP.md`, and ROADMAP.md as `status_source`. Its DoD says search a seeded graph and return the correct path to the agreed depth; when over node budget, bound depth instead of silently dropping edges; and assert a known path in the traversal suite. Its code link points at old Project Manager CSS and its test link is unavailable. | Treat the task container as detailed DoD, not an independent delivery-state source. This contract fixes proposed depth at 2, specifies all-or-nothing depth reduction and a known-path assertion, and supplies current Knowledge-owned paths. |
| `docs/roadmap/ROADMAP-zuri-ai-24w-program.md`, TC-TASK-ZAI-027 | Projected DoD refuses an invalid reparent before writing, cancels edge creation when the mandatory contract dialog is cancelled, and holds a WorkItem for an unsatisfied declared inbound contract while naming the predecessor. | These are Pipeline Builder behaviors, not Node View behaviors. Keep them with `ZAI:FEAT-007` / `ZAI:FR-082`–`ZAI:FR-085`. |
| `docs/features/FEAT-007/feature.md` and `requirements/FR-082.md`–`FR-085.md` | Source-preserved, pinned `ZAI:FEAT-007` “Pipeline Builder” and four design-only requirements. `ZAI:FR-082`/`ZAI:FR-083` define direct manipulation; `ZAI:FR-084` defines the Handoff Contract on `Dependency`; `ZAI:FR-085` defines contract-gated Board release. | Preserve all four IDs, meanings, feature membership, and proposed lifecycle. Do not reuse them for graph search, rendering, redaction, or navigation. |
| `docs/decisions/ADR-035-DIRECT-MANIPULATION-PIPELINE-CANVAS.md` | Status is “Proposed — design only”; it explicitly says it authorizes no implementation. It concerns the Project Structure Plan, Dependency Map, and Board. | `ZAI:ADR-035` neither specifies nor authorizes the Knowledge Node View. Keep its lifecycle unchanged; a future TASK-ZAI-027 implementation adopts it separately. |
| `docs/requirements/FR-024.md` and `apps/server/src/modules/knowledge/project-graph.js` | `ZAI:FR-024` says the projection is library-complete and tested, but neither its GKS write path nor graph read side has a production caller. The code is deterministic and tenant-scoped with an `assertNoLiveFacts` guard. It queries the Tenant, all tenant Businesses, Customers, Conversations, and Memberships; the DTO includes internal IDs/codes, Person display names, Conversation thread IDs, and membership roles. The current source lists `tests/integration/knowledge-project.test.js`; this worker did not execute it. | This is the relation vocabulary/reference projection, not a safe Business-view response. Do not expose its unfiltered DTO. Keep live facts in Zuri queries and out of this graph. |
| `apps/server/src/modules/knowledge/graph-query.js` and `query.js` | `createGraphKnowledgeReader` accepts an injected `traverse({ tenantId, principalId })`; its executable code falls back to `queryKnowledge` for an empty relation array, but traversal exceptions propagate despite the JSDoc mentioning `throws`. `queryKnowledge` reads a principal's tenant Customers, Conversations, Business and memberships. Neither accepts a Business-rooted graph request. | This is an agent-side principal neighborhood, not a user-facing Business traversal API. Do not bind directly to GenesisBlockDB or use the principal reader as a substitute. |
| `apps/server/src/app/api/knowledge/queries/route.js` and enumerated `apps/server/src/app/api/knowledge/` routes | Existing `/queries` is authenticated corpus search. Enumeration contains no `/graph` route. | A Business relation-graph GET endpoint is missing. Corpus search is not graph traversal. |
| `apps/server/src/modules/knowledge/knowledge-authorization.js` and `knowledge-http.js` | Implemented `assertKnowledgeBusinessReadable` reloads and validates a live Business, derives its Tenant, and checks current visible-Business access or an exact API read grant. `resolveKnowledgeRequestViewer` resolves API access or the trusted session viewer. | Reuse these boundaries; never trust a client Tenant ID or a domain-visible flag as Business authorization. |
| `apps/server/src/app/api/projects/[id]/dependencies/route.js`, `modules/project-manager/application/dependency-service.js`, and `ZAI:FR-040` | The API route is a read-only `GET`: it checks visibility of the target Project and returns the Project-contained graph. The service separately exposes dependency create/delete operations and cycle checks under `ZAI:FR-007`; these are not the direct-manipulation canvas or Handoff Contract behavior in `ZAI:FEAT-007`. | Related PM graph surface, but its Project/work-item nodes and scope are not Knowledge relations or a Business graph. Do not make TASK-ZAI-026 a mutation surface. |
| `ZAI:FEAT-033` and `apps/server/src/modules/knowledge/pipeline-map/DataPipelineMap3D.jsx` | Implemented Data Pipeline Map: 3D stages and flows, using generated pipeline-map data and the installed Three.js dependency. The Knowledge dashboard is at `apps/server/src/modules/knowledge/pipeline-map/KnowledgeDashboard.jsx`. | Reuse only the installed renderer dependency and dashboard slot. The pipeline stages/data are not Business relation nodes; do not reuse their DTO or authorize a relation graph with pipeline-map admission alone. |
| TASK-ZAI-026 read-only Knowledge Node View | Missing at this revision: Business-scoped graph endpoint/service, node search/path response, 3D relation renderer, accessible relation-list twin, and their focused tests. | This contract proposes their ownership and acceptance below; it does not assert implementation. |

The task-container compatibility projection is generated: `apps/server/src/modules/platform-control/program-roadmap-containers.js` says it is generated from the markdown task containers. Do not hand-edit that output. The ROADMAP.md ledger remains the delivery-state authority.

## 3. Scope, query, traversal, and response contract

### Scope and graph construction

1. The client supplies the selected `businessId` only. Require a UUID-form Business ID and reject malformed values before any Business or graph-data query. The server resolves a trusted viewer, calls `assertKnowledgeBusinessReadable(viewer, businessId)`, and derives `tenantId` from the returned live Business. The route accepts no `tenantId`, portfolio, workspace, graph-source, depth, or arbitrary traversal-path parameter.
2. Every page and search request repeats Business authorization. The Customer data query includes `tenantId`, `businessId`, and `deletedAt: null`; this prevents a Business grant from expanding into the rest of its Tenant. Soft-deleted or unassigned Customers are excluded.
3. Only the relation set Business → Customer (`HAS_CUSTOMER`) → Person (`IS_PRINCIPAL`) is in scope. Do not include Tenant, Conversation, `MEMBER_OF`, membership roles, or traversal from Person to any other Customer or Business.
4. The maximum traversal depth is fixed at 2 and computed server-side. A search hit returns its complete path from the Business root: Business for a Business hit, Business → Customer for a Customer hit, and Business → Customer → Person for a Person-type hit.
5. The default view returns a stable page of up to 40 in-scope Customers plus the root. It may include the Person leaf for each Customer only when the full depth-2 layer fits the 64-node response budget. If including that full layer would exceed the budget, omit the entire depth-2 layer and return every depth-1 Customer edge on that page with `effectiveDepth: 1`, `truncatedAtDepth: 2`, and a user-visible explanation. Never drop an arbitrary subset of nodes or edges to fit the budget.
6. Search matches visible labels only: `Business.name`, `Customer.displayName`, and the literal type-only Person label. Normalize `q` to Unicode NFC, trim it, and apply case-insensitive substring matching; accept at most 120 Unicode code points. Do not search Person identity/profile fields. Return at most 20 matching node paths per search page, each complete to depth 2. A type-only “Person” search may return Person paths without disclosing identity.
7. Sort Customer rows by normalized display label and then internal ID before assigning response-local node keys. Give each Customer-associated Person a separate view-local node, even if the same internal Person is encountered elsewhere. Internal IDs may be used for joins and ordering only; they never become response keys or cross-request identifiers.
8. Use fixed page sizes, zero-based integer `page` values 0 through 99, and no caller-selected `limit`. Default pages advance through up to 4,000 Customers. Search pages advance through up to 2,000 node matches. On page 99, probe for one extra in-scope result; if one exists, set `limitReached: true`, `hasMore: false`, and `nextPage: null`. Do not advertise page 100. Earlier pages expose `nextPage` only when another page is navigable. A page is a fresh, reauthorized read; after the cap, the user must narrow the search.
9. The strict response contains only response-local `key`, `type`, safe `label`, relation type, source/target local keys, match path keys, paging metadata, `effectiveDepth`, and truncation state. The Business root may use its name; a Customer may use its displayName under the Business read grant; Person is type-only. Serialize no database IDs, codes, Person identity/profile fields, Tenant IDs, Conversation identifiers/content, contacts, membership roles, corpus/source/embedding payloads, transactional facts, or arbitrary model properties.
10. Use `ZAI:FR-024`'s approved relation vocabulary only; this view is a new Business-scoped Zuri read model, not a wrapper around an unscoped projection. No write method or graph mutation route is added.

### Response envelope

Every successful default or search response uses this shape; `matches` is empty for the default view. Keys are local to this response and are never accepted on a later request:

```json
{
  "nodes": [
    { "key": "n0", "type": "Business", "label": "Business A" },
    { "key": "n1", "type": "Customer", "label": "Customer C" },
    { "key": "n2", "type": "Person", "label": "Person" }
  ],
  "edges": [
    { "sourceKey": "n0", "relation": "HAS_CUSTOMER", "targetKey": "n1" },
    { "sourceKey": "n1", "relation": "IS_PRINCIPAL", "targetKey": "n2" }
  ],
  "matches": [{ "nodeKey": "n2", "pathKeys": ["n0", "n1", "n2"] }],
  "page": 0,
  "hasMore": false,
  "nextPage": null,
  "limitReached": false,
  "effectiveDepth": 2,
  "truncatedAtDepth": null
}
```

`effectiveDepth` is the greatest returned path depth from the Business root. `truncatedAtDepth` is `2` only when the default view omits the complete Person layer to stay within budget; otherwise it is `null`. A successful search response includes only the union of complete matching paths plus the Business root. A successful default response with no Customers still contains the authorized Business root and is distinct from an error.

### HTTP and authorization boundary

- New endpoint: read-only `GET /api/knowledge/graph?businessId=…&page=…&q=…`.
- Accept only one `businessId`, optional one `page`, and optional one `q`; reject duplicate or unknown keys. `businessId` is a UUID, `page` is ASCII decimal digits for an integer from 0 through 99, and `q` is at most 120 Unicode code points after NFC normalization and trimming. Validate these bounds before any Business or graph-data query. Missing or empty `q` means the default view; missing `page` means page 0.
- Resolve the viewer with `resolveKnowledgeRequestViewer`; the service calls `assertKnowledgeBusinessReadable` before reading Customers. Pass a request-bound current-viewer resolver and repeat authorization after the read, following the revalidation pattern in `knowledge/queries/route.js` and `knowledge-corpus-service.js`, so a revoked session or API grant cannot disclose a late result.
- A same-Tenant viewer without this Business grant and a viewer from another Tenant receive the same non-enumerating not-found response as a nonexistent Business. An API viewer needs the existing exact Tenant + Business + `read` grant. Keep the database query constrained to that authorized Business even after authorization.
- No fallback to the tenant-wide projector, principal-neighborhood query, corpus search, unscoped query, external graph service, or provider is allowed on error.

### Failure states

- `400`: duplicate/unknown query key, invalid Business UUID, malformed/negative/non-integer/out-of-range page, or `q` above 120 code points; rejected before Business/customer reads.
- `401`: missing or invalid viewer/session under the existing Knowledge route pattern.
- Non-enumerating `404`: nonexistent or unreadable Business.
- Typed `409`: the live Business/Tenant scope is inconsistent.
- `503`: graph read service or database is unavailable.
- A successful empty Customer page is distinct from an unavailable service. The UI must not convert an error into “empty” or “complete.”

## 4. 3D view and accessible interaction

- Layout is deterministic and derived from relation depth: Business root, Customer layer, Person leaves. Persist no node positions or camera state. No add, move, reparent, connect, handoff-contract, or Board action is available.
- A pointer may select a node and orbit/zoom the camera; it never moves a node or writes a relation. Provide explicit reset and zoom controls. Respect reduced-motion preferences and do not autoplay rotation.
- Keep a semantic HTML node list and relation-path list as the keyboard-operable twin. Native buttons expose node type, visible label, and selected state; Enter/Space selects, and focus remains usable when the 3D renderer fails. Selection is shared between 3D, list, and details panel and announced politely.
- Hide the canvas from assistive technology when the equivalent semantic list is present. Distinguish node type/selection without color alone. If WebGL is absent, context creation fails, rendering throws, or the user chooses list mode, the complete returned graph/path and selection remain usable in the list.
- Every drag gesture used to orbit the 3D camera has single-pointer button equivalents for rotate left/right/up/down, as required by the WCAG 2.2 AA baseline in `ZAI:NFR-008`. Zoom and reset also have buttons.
- The dashboard link belongs in `apps/server/src/modules/knowledge/pipeline-map/KnowledgeDashboard.jsx`. Do not modify the Data Pipeline Map's stage model, generated projection, or current pipeline-map access contract.

## 5. Exact future implementation paths

| Path | Responsibility |
|---|---|
| `apps/server/src/modules/knowledge/knowledge-node-view-service.js` (new) | Business authorization, scoped Customer reads, fixed depth/path search, node-budget reduction, redaction, local keys, and paging. Read-only; no provider or graph-client binding. |
| `apps/server/src/app/api/knowledge/graph/route.js` (new) | Strict GET query parsing before data reads; resolve viewer; call the service with a request-bound resolver for post-read authorization. |
| `apps/server/src/app/(pm)/knowledge/graph/page.jsx` (new) | Knowledge route shell using the selected Business context. The page may pass a selected Business ID, but only the API's live grant check authorizes graph data. Do not use `requirePipelineMapViewer` or `visibleDomains` alone as the Business data grant. |
| `apps/server/src/modules/knowledge/ui/KnowledgeNodeView.jsx` (new) | Fetch state, query/search, pagination, shared selected key, 3D/list switch, and error/empty/truncation states. |
| `apps/server/src/modules/knowledge/ui/KnowledgeNodeView3D.jsx` (new) | Three.js relation rendering, camera controls, and node selection only. Use the existing `three` dependency; do not add another renderer for this slice. |
| `apps/server/src/modules/knowledge/ui/KnowledgeNodeList.jsx` (new) | Semantic accessible node, edge, and matched-path list sharing selection with the 3D view. |
| `apps/server/src/modules/knowledge/pipeline-map/KnowledgeDashboard.jsx` (modify) | Add a distinct “Relation graph” link; preserve existing Data Pipeline Map, Knowledge Console, and document links. |
| `apps/server/tests/integration/knowledge-node-view.test.js` (new) | Tenant/Business isolation, exact paths, depth-budget behavior, pagination, and response redaction. |
| `apps/server/tests/unit/knowledge-node-view-route.test.js` (new) | Strict query parsing, current-grant revalidation, non-enumerating failures, and no data query for invalid parameters. |
| `apps/server/tests/unit/knowledge-node-view-ui.test.js` (new) | Shared selection, keyboard/list parity, loading/empty/error/truncation states, and WebGL fallback. |

The parent Knowledge dashboard currently admits the general Knowledge slot. The new graph API must enforce Business read access itself on every request; the dashboard's domain-slot admission does not grant a Business graph read.

## 6. Focused acceptance for the later implementation task

1. With a seeded Business A → Customer C → Person P fixture, searching the visible Customer label returns the deterministic Business A → Customer C path; searching the type-only “Person” returns Business A → Customer C → Person with edge types `HAS_CUSTOMER` then `IS_PRINCIPAL`. The traversal suite asserts exact path keys/types/relations, not a screenshot.
2. A second Business in the same Tenant and a Business in another Tenant contribute no node, edge, label, code, or membership information to Business A's response. A Business grant never widens the Customer query beyond the selected `tenantId + businessId + deletedAt: null`.
3. A viewer lacking the Business grant and a cross-Tenant viewer receive the same non-enumerating 404 as an unknown Business. An API viewer succeeds only with its exact Tenant + Business + read grant. Revoking a session or grant during a slow read prevents serialization; a new page request always re-resolves and reauthorizes.
4. A Customer page with enough Person leaves to exceed 64 nodes returns all Business → Customer edges for that page, omits the complete Person layer, and states `effectiveDepth: 1` and `truncatedAtDepth: 2`. It never drops selected Person nodes or edges silently. Search paths remain complete to depth 2 and bounded to 20 matches.
5. Stable ordering and unchanged fixtures produce the same visible path; the same internal Person is not exposed as an ID or joined across Business boundaries. Soft-deleted and unassigned Customers are absent.
6. No response contains Tenant, Conversation, external thread ID/content, membership role, Person email/phone/name/code, customer code, raw DB ID, corpus/source/embedding payload, price, credit, invoice, payment, stock, schedule, or arbitrary model fields.
7. Unknown query keys (including `tenantId`, `depth`, `limit`, and graph-source overrides) and malformed, negative, non-integer, or greater-than-99 pages return 400 before Business/customer data reads. Invalid input never reaches an unscoped fallback.
8. Page 99 never advertises page 100. Additional results beyond the 4,000-Customer or 2,000-search-match cap set `limitReached` and give the user an accessible prompt to narrow the search.
9. Loading, empty, unavailable, unauthorized, retryable error, and depth-truncated states are distinct. Failed database reads are not rendered as an empty graph.
10. Keyboard users can reach and select every returned node using the semantic list, and selection/details match the 3D view. WebGL failure retains the list and selection. Reduced-motion users receive no autoplay; each camera drag action has a single-pointer button equivalent.
11. Existing Knowledge Data Pipeline Map and Project Dependency Map behavior remain unchanged. No `ZAI:FR-082`–`ZAI:FR-085` mutation or handoff-contract interaction is added to TASK-ZAI-026.

These are proposed acceptance criteria and test paths, not test results. No runtime, browser, database, or provider evidence is claimed by this contract.

## 7. Alternatives and root adoption

| Decision | Recommended choice | Other considered choice and reason to defer |
|---|---|---|
| Graph authority | Server-built, Business-scoped Zuri relation read model with `ZAI:FR-024`'s allowlisted relation types. | Query GKS directly: no existing Business-scoped GKS reader or HTTP contract exists; the current reader accepts tenant/principal and is agent-side. A future GKS view needs its own explicit service contract. |
| Projection source | Query only the authorized Business's Customer rows and their Person relation, then construct a redacted DTO. | Call `projectKnowledgeGraph({ tenantId })` and filter afterward: it reads all Tenant Businesses, Customers, Conversations, and Memberships and emits IDs, codes, names, thread IDs, and roles before filtering. |
| First graph slice | Business → Customer → type-only Person, max depth 2; no Conversation, Membership, or cross-Business traversal. | Full tenant relation graph: not compatible with one-Business authorization or bounded redaction for this first slice. |
| Large graph behavior | Complete depth-2 layer when within the node budget; otherwise complete depth-1 graph for that page with explicit truncation; page Customers and search paths. | Keep arbitrary first nodes/edges or silently clip: violates the projected TASK-ZAI-026 DoD. |
| Task titles and dependencies | Preserve TASK-ZAI-026 identity, clarify its title as “Business-scoped Knowledge Node View (3D and accessible list),” retain its already-satisfied TASK-ZAI-024 dependency, and remove TASK-ZAI-027 → TASK-ZAI-026. TASK-ZAI-027 remains the separate Pipeline Builder task grounded in `ZAI:FR-040` and `ZAI:FEAT-007` / `ZAI:FR-082`–`ZAI:FR-085`. | Keep the current ambiguous title and Task027 edge: the edge implies a dependency unsupported by either task's scope or the existing Project work-view baseline. |
| Node names | Business name and Customer displayName under the authorized Business grant; Person remains type-only. | Expose Person profile fields or codes: unnecessary for relation paths and increases disclosure. |

The root task mandate delegates in-scope technical/product resolution to root. Root may adopt or revise these recommendations under that mandate; no second user approval is implied here. This candidate is not itself adoption, a requirement, a grant, or implementation authority.

Before assigning runtime implementation, root/integrator should:

1. In `docs/roadmap/ROADMAP.md`, preserve TASK-ZAI-026's stable ID and TASK-ZAI-024 dependency, change its title to “Business-scoped Knowledge Node View (3D and accessible list),” and replace the current evidence with the adopted Business scope, relation-source meaning, node/path/depth-budget behavior, authorization/redaction, accessible-list behavior, new requirement reference, and focused acceptance. Keep status planned until implementation evidence satisfies the DoD.
2. Issue a new Knowledge-owned feature and FR through the sanctioned identity/record-migration workflow. Use the next eligible FEAT/FR IDs selected by the ID ledger; do not assign an ID in this candidate. Put canonical records in `docs/features/FEAT-<assigned>/feature.md` and `docs/features/FEAT-<assigned>/requirements/FR-<assigned>.md`; map the FR explicitly to the new feature. Reference `ZAI:FR-024` for relation vocabulary, `ZAI:NFR-008` for WCAG 2.2 AA, and the current Business authorization boundary. Do not extend `ZAI:FEAT-033` or silently broaden `ZAI:FR-024`.
3. Reconcile TASK-ZAI-027 in `docs/roadmap/ROADMAP.md`: preserve its ID/title, remove its dependency on TASK-ZAI-026, and map its evidence/DoD explicitly to `ZAI:FEAT-007` / `ZAI:FR-082`–`ZAI:FR-085`. The existing `ZAI:FR-040` Project work views and `ZAI:FR-007` Dependency service are its PM baseline; do not create a false Knowledge dependency. Keep its own proposed lifecycle separate.
4. If Task027 proceeds, adopt `ZAI:FEAT-007` and `ZAI:ADR-035` separately under their own record lifecycle. This is not a prerequisite to TASK-ZAI-026.
5. Align the detailed TC-TASK-ZAI-026 / TC-TASK-ZAI-027 records in `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` with the adopted contracts, retaining that document's `source_of_truth: false` and ROADMAP.md status source. Regenerate `program-roadmap-containers.js` and other generated consumers from their owning source; do not hand-edit generated containers, `roadmap-sot.js`, registry exports, graph, views, or ID ledger.
6. After canonical adoption, let the root/integrator run the required registry, graph/view generation and governance in one composed worktree. The present worker changes none of those sources or generated outputs.

Parent/peer impact: TASK-ZAI-024 remains a satisfied Knowledge/retrieval prerequisite. `ZAI:FR-024` remains a relation projection/library contract, not a Business graph HTTP API. `ZAI:FEAT-033` remains the Data Pipeline Map. `ZAI:FEAT-013` remains Knowledge ingestion and corpus serving. `ZAI:FEAT-007`, `ZAI:FR-082`–`ZAI:FR-085`, and `ZAI:ADR-035` retain their Project Manager Pipeline Builder meanings.

## 8. Document20 rule-check record

- `taskId`: TASK-ZAI-026-CONTRACT-20261017
- `action`: Draft the source-backed TASK-ZAI-026 implementation contract and resolve in-scope technical/product alternatives; do not adopt canonical rows or execute runtime work.
- `trigger`: TASK_START.
- `source document ID`: ZAI:PM-MULTI-AGENT-DELIVERY.
- `source path`: `docs/architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md`.
- `source version`: 0.9.33b, status candidate.
- `source revision`: `7a661d95c7db57122a0899652c354831cac559ac`.
- `raw-byte SHA-256`: `FED035C70C4D88DF8F82F6707158CF5B9E031A00D4D2E894B5EA5C1DD6367D6C`.
- `section locators`: `#pm-task-rule-entry`; §2 `#pm-roles`; §4 `#pm-gates`; §5 `#pm-packet` and `#pm-rule-check`; §6 `#pm-composition`.
- `relevant clauses`: `#pm-task-rule-entry` requires checking the exact task/scope/source and attaching a rule-check; session history is a pointer, and reading a rule is not approval or dispatch authority. §2 marks its old role/capacity profile as historical and points to the active model-policy contract. §4 separates worker, verifier, integration and release evidence and rejects unsupported PASS claims. §5 defines this rule-check's fields and requires exact revision/scope/evidence in a worker submission. §6 assigns shared roadmap, registry and generated outputs to root; workers stay within their allowlist.
- `applicability`: These clauses apply to this bounded documentation submission and its handoff. The active repository v4 policy and the current trusted worker binding control this session; the accepted write scope allows only this contract file and explicitly leaves fixed checks to root. Canonical adoption and generated outputs are root work; this proposal grants neither.
- `read-command/evidence locator`: This session read `git rev-parse HEAD` as `7a661d95c7db57122a0899652c354831cac559ac`; read Document20 using PowerShell `Get-Content` for lines 1–225 plus focused excerpts covering lines 47–63, 91–112, 113–168, 169–212 and 213–225; and ran `Get-FileHash -Algorithm SHA256` on the source path, which returned the digest recorded above. The task ID, base, scope, dependency and check prohibitions came from the trusted accepted binding in this user prompt.
- `uncertainty`: Document20 is explicitly `candidate`; its source notice says remote freshness is unknown. No separate repository decision-receipt file was supplied; the current accepted task binding in the trusted prompt is the authority for this worker action, and the previous session note is treated only as historical context. The command output did not capture a read timestamp, so read time is `UNKNOWN`. The active v4 procedure controls where Document20's historic profile differs.

## 9. Worker evidence and handoff

- Changed path: `docs/plans/TASK-ZAI-026-NODE-VIEW-CONTRACT.md` only.
- Current implementation evidence: a source-backed candidate contract. No runtime code or tests were changed.
- Required task checks `git diff --check` and `node tools/document-registry.mjs --check`: NOT_RUN by worker; PENDING_ROOT under the trusted root runner. This document does not claim they passed.
- Next role: root reviews/adopts or revises the candidate, then owns canonical record migration, generated views, and the fixed task checks. Independent verification and any implementation task remain separate.

## Version diff

0.1.0 → 0.2.0: reconciles the canonical roadmap row with the projected task-container DoD; adds exact search/path and whole-depth node-budget behavior; corrects the Knowledge dashboard and renderer paths; distinguishes current `ZAI:FR-024` library code, principal traversal, corpus API, Project Dependency Map, and Data Pipeline Map; records the selected Document20 rule-check with revision and raw-byte digest; and clarifies that TASK-ZAI-027 is a separate Pipeline Builder change with an unsupported dependency edge.
0.2.0 → 0.3.0: verifies the 24-week task-container source metadata and completed TASK-ZAI-024 dependency; distinguishes the injected principal reader from a Business graph API, including its executable empty-result fallback behavior; records the existing Project Dependency service's mutation boundary; makes the roadmap phrase “governed relation graph” explicitly a Business-scoped Zuri read model for this candidate; fixes request bounds and response shape; adds single-pointer camera controls for WCAG 2.2 AA; and refreshes the Document20 rule-check evidence and root adoption instructions. No canonical record or runtime code changes.
