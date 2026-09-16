---
id: ZAI:FR-247-NOTE
title: Hierarchical Projects and Work navigation
feature: FR-247
domain: project-manager
source: pending
version: "0.1.1b"
status: beta
created_at: "2026-09-16T14:38:26+07:00,RWANG,base eddd3dd8"
last_update: "2026-09-16T16:00:03+07:00,RWANG"
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

## Validation and delivery state

The owner explicitly approved ADR-095 / FR-247 on 2026-09-16 after reviewing document commit `3f36668fbe70bc447a0f0da4fd7dfcdfbae66617`. The composed document/prototype gate passed 35 navigation checks, 148 contract checks and root browser review. These are design evidence, not application implementation evidence.

Application implementation is now in progress. The existing baseline has 62 passing unit tests and 20 passing product browser scenarios plus warmup. New FR-247 application checks remain pending until the implementation is integrated and tested. Root owns canonical documentation, generated governance and final acceptance; separate Luna max workers own application source, tests and independent verification.

No new API, database schema, resource calculation, risk register, agent executor or provider registry is included in this slice. Those remain explicit work packages in the PM delivery plan.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Register the owner-requested navigation behavior and preservation checks | eddd3dd8; uncommitted | RWANG |
| 0.1.1b | 2026-09-16 | beta | Record owner approval and start bounded application implementation; preserve all acceptance criteria | approved baseline 3f36668f | RWANG |
