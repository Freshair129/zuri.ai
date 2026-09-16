---
id: ZAI:FR-247-NOTE
title: Hierarchical Projects and Work navigation
feature: FR-247
domain: project-manager
source: v2-native
version: "0.2.1b"
status: beta
created_at: "2026-09-16T14:38:26+07:00,RWANG,base eddd3dd8"
last_update: "2026-09-16T18:13:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-247
  - type: references
    target: ZAI:ADR-095
  - type: references
    target: ZAI:PM-DOMAIN-NAV-BOUNDARIES
  - type: references
    target: ZAI:PM-EXISTING-TAB-SEMANTICS
---

# FR-247 — Hierarchical Projects and Work navigation

## Behavior and ownership

The domain bar displays Projects & Work using the existing `projects` key. Its sidebar selects one of six logical modules. Only the current module's sections or views appear in the content navigation. This implements the owner's Domain → subdomain → tabs hierarchy.

Project Management, Work Management and Resource Coordination open existing destinations. Delivery Design, Delivery Governance and Agent Delivery show named planned capabilities without fabricated routes. Requirements, Risks and Resources remain distinct; the last one belongs to Resource Coordination and is not implemented by showing Team.

Project Management retains Project/Inventory. Work Management retains all seven Work views. Resource Coordination retains Team/Files/Repositories. Import is one persistent Project action. Business views remain reachable inside the corresponding module using their existing URLs.

The project-manager lane owns this presentation. Domain/grant identity, API ownership, scoped data authorization and the seven execution modes are unchanged. Business Home links to the same owners and creates no new authority.

## Input, output and failures

- Input: current pathname, selected Business and authorized Project inventory supplied by the existing guarded shell.
- Output: active module, its local view navigation, Project or Business context, and existing hrefs.
- An unknown route has no invented selected view. Complete path segments prevent similarly named routes from matching accidentally.
- Unknown or foreign Project context exposes no Project labels or navigation; the existing shell and API refusal behavior remains authoritative.
- A planned capability has an explicit visible explanation and no href. Loading/error states do not fall back to another Project.
- A switch between supported modules retains the authorized Project. Returning to all projects uses an explicit Business-context action.

## Acceptance criteria

1. Exactly six logical module entries appear under Projects & Work. No second domain/group or grant key is created.
2. All eight Business destinations and fourteen existing Project route templates remain reachable. The crosswalk covers all nine original section meanings and seven Work views.
3. Work has a single seven-view local navigation row with Structure Plan as its entry. The old full Project section row is not stacked above it.
4. Project Management exposes Project and read-only Inventory. Resource Coordination exposes Team, Files and Repositories at the same existing URLs, preserving their distinct owners and data meanings.
5. Import plan is reached by a real click from each authorized Project module; its route displays a current-page cue and a return path.
6. Requirements, Risks and Resources remain discoverable by name with Planned explanations, no fake URLs or successful mutations.
7. Module selection and browser history retain the authorized Project, while explicit all-projects navigation clears that context. Boundary matching rejects partial paths.
8. Missing/foreign Project, Business change, grant denial and session failure retain existing isolation behavior. Navigation is never the authorization check.
9. All seven canonical execution routes retain their Project parent/return path. No new mode is introduced.
10. SCM/CRM grouping and other domain navigation still work. Business Home shortcuts remain owner links and cannot grant access.
11. Named landmarks, one current module/view, keyboard-operable disclosures, focus return, readable explanations and narrow-screen behavior pass browser checks.

## Current delivery state

The owner subsequently instructed **"fix it"** for the two cross-domain browser failures. The bounded correction is implemented at `86de7f61`: Knowledge SVG nodes activate with Enter/Space, and the CRM session test identifies one current thread by its unique customer name while checking all three messages and both distinct session codes. Navigation source is unchanged by this follow-up.

The normal complete browser run now passes **194 cases, with the same 4 existing skips, 0 failures and 0 flaky cases**, exit 0. All 198 case identities and the skipped-case inventory match the original run. FR-213 passes 3/3, FR-243 1/1 and FR-247 10/10. The correction also passes 47 relevant unit/integration checks and the optimized build. Independent Luna Max source/test review and root runtime verification are separate receipts under `pm-execution-qa/regression-fix-20260916/`.

The local browser gate is passing. Hosted CI, merge and production remain unperformed. The earlier full unit run is retained below as historical evidence; 47 affected checks ran on the correction.

## Original navigation validation — historical evidence at d33254aa

The owner explicitly approved ADR-095 / FR-247 on 2026-09-16 after reviewing document commit `3f36668fbe70bc447a0f0da4fd7dfcdfbae66617`. The composed document/prototype gate passed 35 navigation checks, 148 contract checks and root browser review. These are design evidence, not application implementation evidence.

The implemented application source and acceptance tests are frozen at `d33254aa`, based on upstream integration `d23a9396`. Luna Max authored the source and test packets separately; an independent Luna Max verifier reviewed the source, rendered-link coverage and final corrections. Root composed the packets and ran the application gates. The initial 62-unit/20-browser baseline remains historical evidence only.

| Gate | Local result | Evidence and limits |
|---|---|---|
| Source and test review | PASS | Luna source review of `a37ca6dd`, followed by a hash-pinned delta PASS covering desktop labels, mobile disclosure reset and bare execution-route rejection; no unresolved source findings |
| Full unit/integration suite | 5,843 passed; 32 existing skipped | `npm --prefix apps/server test`; 702 passing files, 6 skipped files; exit 0 and nonzero-execution wrapper passed |
| Final focused unit checks | 67 passed | Navigation registry, rendered hrefs, local module separation, sidebar and existing Business shell guard after final corrections |
| Focused browser run | 72 passed; 4 existing skipped | Import clicks from all three live modules, all eight Business destinations, all seven Work views, Project context/history, planned disclosures, Inventory drilldown, seven execution modes, and 390px layout |
| Build | PASS | `npm --prefix apps/server run build`; optimized build completed on the composed application source |
| Governance | PASS with existing warning | Graph/check/strict preflight: 0 CRITICAL; 1 existing warning for synthetic unknown requirement IDs in the program-task-evidence test fixture |
| Full browser regression | 192 passed; 4 skipped; 2 failed; 0 flaky | Frozen source at `d33254aa`; all 10 FR-247 cases pass. FR-213 keyboard selection and FR-243 retired thread locator fail in unchanged files; repository-wide browser gate is not green |
| Pre-navigation comparison | Same two test cases fail on both attempts | Original specs on `d23a9396`, isolated port/database, normal warmup; baseline harness stalled after tests during final cleanup, so no normal exit or completed gate is claimed. See cross-domain RCA and final gate receipt |
| Root visual review | PASS | Actual seeded application at 1440px and 390px; full-word labels, one Work view row, Import reachability and keyboard focus return inspected |
| Hosted CI / production | NOT_RUN | These local results do not claim a production release |

The complete run logs, screenshots and independent receipts are retained in the task artifact folder `pm-execution-qa/navigation-implementation/`. The source delta does not change API handlers, Prisma schema, ScopeContext or BusinessShellGuard. Existing null-owner shared Projects retain the same guard semantics. The first failed unit assertions and visual findings are preserved in [the integration RCA](../../../../.brain/rca/2026-09-16-fr247-navigation-integration.md).

The two original complete-suite failures and their subsequent correction are recorded in the [cross-domain gate RCA](../../../../.brain/rca/2026-09-16-fr247-baseline-regression-gates.md). The table above preserves the original failed run. Current full-browser evidence is stated in Current delivery state; no production release is claimed.

No new API, database schema, resource calculation, risk register, agent executor or provider registry is included in this slice. Those remain explicit work packages in the PM delivery plan.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Register the owner-requested navigation behavior and preservation checks | eddd3dd8; uncommitted | RWANG |
| 0.1.1b | 2026-09-16 | beta | Record owner approval and start bounded application implementation; preserve all acceptance criteria | approved baseline 3f36668f | RWANG |
| 0.2.0b | 2026-09-16 | beta | Record implemented navigation, independent source review, runtime evidence and release limits | implementation d33254aa | RWANG |
| 0.2.1b | 2026-09-16 | beta | Record owner-authorized cross-domain fixes and normal full browser pass; retain original failed run as historical evidence | correction 86de7f61 | RWANG |
