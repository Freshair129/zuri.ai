---
id: ZAI:PM-NAV-IMPLEMENTATION-BASELINE
title: "Project Manager Six-Module Navigation Implementation Baseline"
version: "0.3.1b"
status: "beta"
created_at: "2026-09-16T15:22:16+07:00, Luna Max worker A, source eddd3dd8d884a0b19a65f9a3019758c05c815b48"
last_update: "2026-09-16T16:00:03+07:00,RWANG final integrator"
superseded_by: null
attributes:
  doc_type: "implementation-baseline"
  domain: "project-manager"
  scope: "six logical modules, typed local surfaces, shared Import action, explicit legacy classifications"
  packet: "PM-20260916-D02-01-A3"
  work_package: "MA-D02"
  attempt: 3
  source_commit: "eddd3dd8d884a0b19a65f9a3019758c05c815b48"
---

# 22 — Navigation Implementation Baseline, Attempt 3

## 1. Decision boundary

**Approval transition, 2026-09-16:** the owner approved ADR-095 / FR-247 after
independent document verification and root review of commit `3f36668f`.
The application navigation implementation may proceed within that exact scope.
The attempt-specific evidence and limitations below describe the preserved design
packet; current implementation evidence belongs to the
[FR-247 delivery record](../../domains/project-manager/features/FR-247-hierarchical-project-navigation.md).

This is a design candidate for the Projects & Work navigation slice. It does not claim a runtime implementation, route migration, data migration, generated canonical ID, governance pass, test pass, browser pass, or deployment. Attempt 2 remains immutable in ../attempt-2/.

The full UX candidate retains all 37 source screens. Code generation is limited to the explicitly listed core surfaces and one shared action. Planned, deferred, detail, and out-of-scope screens remain reviewable design records with no generated href.

## 2. Shape and source-backed counts

| Evidence | Candidate value | Boundary |
|---|---:|---|
| Logical sidebar modules | 6 | 3 live entries; 3 planned no-route entries |
| Business destination relocations | 8 | existing URLs retained as module-local surfaces |
| Project section meanings | 9 | Work is a typed view group; Import is a typed action |
| Project route templates | 14 | route crosswalk covers source enumeration |
| Project Work views | 7 | Structure Plan is default; Calendar is deferred |
| Full UX screens | 37 | 10 core, 15 planned no-route, 4 preserved no-route, 8 preserved out of D02 |
| Source route enumeration | 8 business, 14 project, 7 Work | read-only file existence check in validate-attempt-3.cjs |

## 3. Shared Import action contract

pm.import has exactly one definition owned by module.project-management. It is a persistent Project-scoped header action referenced by Project Management, Work Management, and Resource Coordination live module shells when the viewer is authorized for the Project. All three references point to /projects/{projectId}/import; no local Import tab or second route is introduced. The action carries a current-page cue and returns to /projects/{projectId} after the existing validate -> dry-run -> conflicts -> commit -> receipt lifecycle.

The candidate does not grant access. Existing Business/project shell and target API authorization remain the authority. Planned modules have no active action reference and no href.

## 4. Typed surfaces and identity rules

section.work resolves to the declared wm.project-work-views VIEW_GROUP, whose seven concrete views are wm.roadmap, wm.structure, wm.board, wm.work-items, wm.schedule, wm.milestones, and wm.dependency-map. section.import has surfaceKind ACTION, actionId pm.import, localSurfaceId null, and localTab false.

The canonical /work identity is b.all-work. The source UX value b.work is retained only as a source alias correction (b.work -> b.all-work) and is never emitted as an active canonical navigation id.

WF-13 remains Docs & Decisions. Its planned semantics include revision-pinned document reading, diff/comments/review references, and architecture decision reading/review. No route is invented.

## 5. Legacy-reference and codegen policy

Every raw legacy id in the base UX is classified exactly once as mapped, actionMigrated, deferredNonGeneratable, or preservedOutOfD02. The generator reads composed typed navIds and actionIds; it never reads raw base navIds or emits an unclassified legacy id. p.calendar is explicit deferred non-generatable. p.settings, b.create, and i.registry are explicit out-of-D02 preservation records. Planned surfaces keep their names, noHref true, and no route.

## 6. Owner and authority boundaries

- Project Management owns module-local project and inventory navigation plus the shared Import action.
- Work Management owns the seven Work views and the business Work destinations.
- Resource Coordination owns Files, Repositories, and Team navigation; Team membership remains Identity-owned Business/Tenant Membership.
- Inventory remains a read-only projection. Navigation does not create grants, memberships, allocations, provider connections, or agent execution.
- Workforce Resources remains deferred to MA-D02W; provider/registry and Agent Delivery operations remain out of this packet.

## 7. Evidence and verification

The validator parses the full candidate, applies keyed patch expectations against the source UX bytes, checks typed references, verifies the full 37-screen composition, checks legacy classification coverage, and enumerates source route files. It reports structural results only. Product tests, browser checks, accessibility execution, governance, migration, and deployment are NOT_RUN.

| Source | SHA-256 |
|---|---|
| .claude/AGENTS.md | 8ed8cb219ca741335ec21f04ecd87ce5e662422a109af3cf28475b142d97ac1c |
| apps/server/src/config/domains.js | d9ceddb59ed9418c3cb0d60b10d68f332aaf5d115b0ef4194b2d32343a672031 |
| apps/server/src/config/modules.js | 38f5424eb599ed15136db9314fd6171944a9ff4f449fa106c7d453c2035c4523 |
| apps/server/src/components/layouts/DomainBar.jsx | 4c7427d6090be101b9fdb0f29647a80bfcbdd319db830d17d93595aa96328cd4 |
| apps/server/src/components/layouts/Sidebar.jsx | 23dcc8cdbc2b7ab51789d40c20d505ee6fc3c7430eccdc9d7e1f40a8f2173f9f |
| apps/server/src/modules/project-manager/components/ProjectTabs.jsx | 94dbb00da8e58e3423844bf45d8b1904ae1e076496a20265aa8e16548fca5a9c |
| apps/server/src/modules/project-manager/components/WorkViewTabs.jsx | f2d2bc70a773d08424f1feb85d995497b8f327c4a53c71ac9c1c36b523ac2267 |
| apps/server/src/app/(pm)/projects/[projectId]/layout.jsx | 70fc128a033c50e480c9c5d419452bb0e0699003957a67688fe145048aa12c1f |
| apps/server/src/app/api/projects/[id]/route.js | 91bd62228435c6b1bfabd6e29c7b79a7b1e5cb63fa481724e2b338d38bc5eaab |
| apps/server/src/lib/business-shell-guard.js | bf33386aec4ce709aa011d9f0e701967489aaef002d35d9e7829aedaf6080efc |
| apps/server/src/context/ScopeContext.jsx | 7a506330489937ea795cf9f51fd6b989fddccf677e2bb5543cc7cfaaecaa7ad4 |
| apps/server/src/app/(pm)/overview/page.jsx | e50d2de9f14b957e0adf1f43db8c2016ec9baf16a0acd7977158bf8c0fe1673b |
| apps/server/tests/unit/domain-navigation.test.js | f92c95a7bf8b37f27f2a5860acaf40198c46f4ab68e7b9ca2c40f97e9604d823 |
| apps/server/tests/unit/project-work-route.test.js | 8c62be6207ae531da978090aa8e698429dd0bfd8af3a196fc29abcfa0e7fd77e |
| apps/server/tests/e2e/navigation-reachability.spec.js | a4c77dedc19d9dfe40b2824d1efe22728788b0d632c26bcbcb9cf9f6aa796eec |
| docs/decisions/ADR-036-PROJECTS-OVERVIEW-AND-THE-FIELDS-IT-NEEDS.md | fbcfebeb63f386895a7464db057f341d5fac91f1930d7eb7d3863d18982a65d3 |
| docs/architecture/project-manager-system/13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md | b7834a2e8087c1582af327d633e778e0945839d0ed0f09a3bbce5ba472edf498 |
| docs/architecture/project-manager-system/14-EXISTING-PROJECT-TAB-SEMANTICS.md | 9d3c9b5938e06ac50d85183c11a352a8be0a8c2544153d913ca66115ed32b4c4 |
| docs/architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md | 244792688df0daa70ca9c73b74b49f85fc16ba49346622b6afe12130254c7524 |
| docs/decisions/ADR-095-PROJECTS-AND-WORK-HIERARCHICAL-NAVIGATION.md | 38cab0c22e4f08940dda6c7f2689ea076deabeca47eaed80335ae01d6cf5b3a2 |
| docs/domains/project-manager/features/FR-247-hierarchical-project-navigation.md | 4ccaac73e12cf8715dd61422ca681ece5b2ea7d20d685d9d37a6d24a90aa85bc |

## 8. Source route evidence

The route files below were enumerated read-only from the pinned source worktree; existence is evidence of source shape, not runtime reachability.

| Category | Count |
|---|---:|
| Business route files | 8 |
| Project route files | 14 |
| Project Work route files | 7 |
| Logical modules in candidate | 6 |
- apps/server/src/app/(pm)/projects/page.jsx — 296bcc4793a22063fe6bd771bdef4c47275007515047350b8565bc997d116136
- apps/server/src/app/(pm)/work/page.jsx — fe2cdb0bffc00cf0cb3a7cb4761e31450bec497c358c2c52982673ca2dcede5d
- apps/server/src/app/(pm)/execution/page.jsx — eb324307adfeaaba196b65e906360e52150d08bb156194d5ca229763e49dbbcc
- apps/server/src/app/(pm)/timeline/page.jsx — cbe559bcf581661086e5fc53febbfeaa2da24d51e52d61418f9738762d3e3f15
- apps/server/src/app/(pm)/dependencies/page.jsx — d7e3ed47728b07f0fe91326ce26171d1dbd72e031562ec6e5bba34101a41898d
- apps/server/src/app/(pm)/milestones/page.jsx — 631d088e55b70ade87584a4368f76b00fc0a3eeaf163f8f544df377947dc190e
- apps/server/src/app/(pm)/files/page.jsx — daddb9b8e8b226000c635f47b07a5374ada7bc1f44d34eb4db3a2c04b3d5be47
- apps/server/src/app/(pm)/repositories/page.jsx — 5c4ac0065d2ca5fd77e52e8c5b9c78d6d25a547af9a9c6f5baf2a4be3ea58abd
- apps/server/src/app/(pm)/projects/[projectId]/page.jsx — 6eda73bf122f8909a5c7c803f58f0be0de79cf125929fc35830cdbb1b46c57fe
- apps/server/src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx — 50ab64353cac5a462114b9b3ea8d092af1b27e268fad75d30a9205a2f15aa160
- apps/server/src/app/(pm)/projects/[projectId]/inventory/page.jsx — f1bb3903f774ef9f3be954ebf7abc182d75f7d5425b9c1ac8d0727ae93fb6cfe
- apps/server/src/app/(pm)/projects/[projectId]/repositories/page.jsx — dd20d40fc9ac56cda67b3a0a931e6063d8a77b3e592b5b3742723404f973d48b
- apps/server/src/app/(pm)/projects/[projectId]/team/page.jsx — 442128d5df6e99eca5aa24dae8ac2b0ea04bbb1d3c11ede491f30ba66d7711e6
- apps/server/src/app/(pm)/projects/[projectId]/files/page.jsx — 05ce2ad5ffecc68dcb2b23e2057ace60b9fc7bfce3265c6ebd551749329a73e9
- apps/server/src/app/(pm)/projects/[projectId]/import/page.jsx — 191450cdcd6d55ad33c9d1fa1db744d13610bd38d30cdb017db243f6cfc6cc86
- apps/server/src/app/(pm)/projects/[projectId]/roadmap/page.jsx — 504430447cb97dbe6e67721ef6fcf670ce633faac09d6214e5e45dcb2adfffc7
- apps/server/src/app/(pm)/projects/[projectId]/structure/page.jsx — 6e3d433a723e85e125b1a81f0135e4f4e496a8b4640ae8bb08ebc562b3913ed1
- apps/server/src/app/(pm)/projects/[projectId]/board/page.jsx — a1a2a9ee6be0e1e03329270111b010330cd61cbdb37b89124f1b3f3ecce306b0
- apps/server/src/app/(pm)/projects/[projectId]/all-work/page.jsx — 5c5c4992491fbbce7b9f044942a5a3defcf3bd1854a706365298920b7454f3e7
- apps/server/src/app/(pm)/projects/[projectId]/timeline/page.jsx — cbdbe45afac5023e04d150f45d1013257a6dfd88a662812a4590eb5d2d2ef4c2
- apps/server/src/app/(pm)/projects/[projectId]/milestones/page.jsx — 2c9cdc844eedcb0eef84fc8133a5c2f08c758487a605e66b1f36ec4979c96d50
- apps/server/src/app/(pm)/projects/[projectId]/dependencies/page.jsx — d662191b9629829efc7f3df0c751bb209986846f96b728917cc6a011ffdeef4f

## 9. Approval gates

Root must independently verify this attempt, reconcile shared files, allocate or confirm canonical IDs through the project ledger, and obtain required architecture/document approval before any canonical document or product source change. A later implementation worker must separately prove route generation, authorization, current-page/return behavior, accessibility, and runtime tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.0b | 2026-09-16T15:22:16+07:00 | candidate | Attempt 3 closes D08-001..005 at design level with shared action, typed refs, legacy policy, /work identity correction, and full UX composition | eddd3dd8d884a0b19a65f9a3019758c05c815b48 | Luna Max worker A |
| 0.3.1b | 2026-09-16 | beta | Record owner approval and bind subsequent application evidence to FR-247; preserve the immutable attempt record | approved baseline 3f36668f | RWANG |
