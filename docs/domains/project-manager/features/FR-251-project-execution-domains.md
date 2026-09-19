---
id: ZAI:FR-251-NOTE
title: Project Execution Domains view
feature: FR-251
domain: project-manager
source: v2-native
version: "0.1.2b"
status: beta
created_at: "2026-09-16T23:01:00+07:00,RWANG,reviewed baseline 7465080f"
last_update: "2026-09-17T02:46:11+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-251
  - type: references
    target: ZAI:FR-070
  - type: references
    target: ZAI:FR-250
  - type: references
    target: ZAI:PM-PROJECT-DOMAIN-FEATURE-BASELINE
---

# FR-251 — Project Execution Domains view

## Behavior and ownership

The owner approved MA-I02 Phase A on document commit `7465080f` on 2026-09-16.
This is C-2 / MEDIUM, a read-only extension of Project Manager. It projects actual
FR-070 Workstream bindings; it is not a DDD bounded-context registry, Feature
authority or operational-domain grant. Phase B is separately approved under [FR-252](FR-252-project-feature-authority.md); its implementation and production gates remain open. No schema, migration, progress algorithm or existing writer changes.

Delivery Design gains **Execution Domains** only in authorized Project context,
at `/projects/{projectId}/domain-view`. Business Delivery Design and Features,
Requirements, Architecture, API, Docs & Decisions remain visibly planned. Preserve
all FR-250 routes, context/back behavior and the single Import action.

The exact catalog, DTO, file allowlist and phase boundaries are in
[baseline 23 v0.4.0b](../../../architecture/project-manager-system/23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md).
Runtime labels come from the seven explicitly mapped existing `DOMAINS` entries.
The immutable DOM key stays unchanged when a label changes. Business Home owns no
domain; unknown imported bindings remain `UNMAPPED`. Technical owners remain a
separate ID list. Root counts include unbound active work; overlapping domain
counts are never summed to calculate Project total or progress.

## Input, output and failures

- `GET /api/projects/{projectId}/domain-view`; use the existing Next `[id]` folder.
- Resolve the request viewer and authorize the Project hierarchy with
  `assertProjectRoadmapReadable` before reading aggregate data. Retain the existing
  authorized TENANT/PORTFOLIO shared-Workspace policy.
- Return 401 `AUTH_REQUIRED`; missing, deleted, foreign and invalid-hierarchy
  Projects share redacted 404 `RESOURCE_NOT_FOUND`, with no counts or identifiers.
- Success is the exact versioned `ProjectDomainView` DTO: sorted immutable domain
  rows, primary/supporting counts, separate technical owners, deduplicated active
  WorkItems and Workstreams, root unique work and unbound Workstream counts.
- Exclude soft-deleted Projects/WorkItems and use `activeWorkstream()` for active
  Workstreams. WorkContainer has no soft-delete column. A linked container must
  belong to the same Workstream. Duplicate supporting or primary/support overlap
  cannot inflate counts.
- Empty/no-binding Project returns HTTP 200 and `domains: []`. Unknown IDs survive.
  Snapshot is null/UNAVAILABLE; featureIds/evidence are empty; featureState is
  NOT_BOUND; blockerCount is null; blocker/contract/gap states are UNAVAILABLE.
- Reads perform no writes, AuditEvent append, cache mutation or grant creation.
  Existing strategy-weighted Project progress is unchanged.

## Acceptance criteria

1. Unit proof covers all seven catalog bindings, unknown IDs, role separation,
   duplicate bindings/items, unbound totals, empty rows and inactive exclusions.
2. Integration proof covers authorized owned/shared reads; 401; identical redacted
   404 for missing/deleted/foreign tenant/Business/hierarchy; authorization before
   aggregates; container mismatch exclusion; unchanged audit/progress state.
3. Runtime OpenAPI exposes the exact DTO and refusal contract; unavailable values
   cannot be forged as available counts. The full-system candidate is not all live.
4. Browser proof covers Project-only Delivery Design activation, all planned peers,
   loading/error/empty/unassigned/unmapped states, context and browser Back,
   keyboard use and 390px readability. Existing FR-250 routes remain reachable.
5. Root runs governance, required unit/integration tests, build and browser gates;
   separate Luna Max verification precedes root final integration. Record actual
   evidence only. Hosted CI and production are separate gates.

## Current delivery state

A1 is approved. A2 passed the sanctioned ID writer and governance (0 critical,
2 existing warnings) before code dispatch. Phase A is implemented and verified
locally on 2026-09-17:

- Full server suite: 5,956 passed, 32 existing skips, zero failures.
- Production build: passed locally. Governance: zero critical findings, two
  existing warnings and 24 informational findings.
- Full browser suite: 199 passed, four existing skips, zero failures and zero
  flaky cases. All four new FR-251 cases and ten FR-250 regressions passed.
- Independent Luna Max source review and root integration/visual review: passed.
  Desktop capture uses the isolated seeded API; the 390px capture uses a
  synthetic intercepted DTO to exercise long IDs and unknown bindings.
- Candidate OpenAPI validates; nine positive/negative DTO checks passed, with
  other candidate operations and schemas unchanged.

The initial browser run's two locator failures, their evidence and the bounded
corrections are preserved in the
[integration RCA](../../../../.brain/rca/2026-09-16-fr251-domain-view-integration.md).
Hosted CI is associated with the implementation commit in
[PR443](https://github.com/Freshair129/zuri.ai/pull/443); it is a separate gate
from these local results.

### Release on 2026-09-17

PR444's archive/rollup repair was merged first at `db84ff39`; PR443 composed it
with this slice. Required hosted checks passed on composition
`ecc30b94f545ac1e9ddde3b59618c89f558bdc49`, with a fresh local full browser result
of 199 passed, four existing skips and zero failures/flakes. Merge commit
`c07cfaba8eedb53f677e313977a1e2344fb5c8c5` has the identical tested tree.

The clean-archive runner image `zuri-ai-web:release-c07cfaba` was promoted to web
and LINE worker. Read-only schema inspection found all 2355 expected columns;
no schema diff or migration was required. Local/public health and login passed,
unauthenticated Project/Domain APIs returned 401, fresh worker ticks returned
200/IDLE, and all 11 public JS bundles matched the image bytes. Environment,
mounts and ngrok topology were preserved; the previous `release-e8fc84bd` image
remains available for rollback. Authenticated production Domain behavior was
not exercised; its behavior proof is the isolated local browser suite.

The existing application database role bypasses RLS. This pre-existing P1 was
carried forward without a credential/grant change; catalog correctness is not
proof of effective runtime isolation. The [runtime-role RCA](../../../../.brain/rca/2026-09-17-pm-release-runtime-role-carry-forward.md)
records the observation and requires separately reviewed remediation before
Phase B production writes. Archive keys/mount activation, retention scheduling,
usage-rollup activation and KI17 runtime activation were not introduced.

Main's required server/Edge checks passed for the merge SHA. Its separately
scheduled post-merge browser job is recorded in the release QA packet; it must
not be inferred from those required checks. This release does not complete
MA-I02 or approve Phase B.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Register and implement owner-approved read-only Phase A; record local server, build, browser, contract and independent review proof | reviewed baseline 7465080f; implementation tracked in PR443 | RWANG |
| 0.1.1b | 2026-09-17 | beta | Record merged/deployed revision, exact-tree and live evidence, rollback and the carried-forward runtime-role limitation | c07cfaba | RWANG |
| 0.1.2b | 2026-09-17 | beta | Link separately approved FR-252 Phase B; Phase A behavior unchanged | approved e5ccfd7a | RWANG |
