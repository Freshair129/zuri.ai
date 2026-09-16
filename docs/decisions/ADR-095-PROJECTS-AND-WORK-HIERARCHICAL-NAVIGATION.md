---
id: ZAI:ADR-095
title: Projects and Work uses domain, module and local view navigation
version: "0.2.1b"
status: beta
created_at: "2026-09-16T14:38:26+07:00,RWANG,base eddd3dd8"
last_update: "2026-09-16T16:00:03+07:00,RWANG"
author: RWANG
attributes:
  doc_type: architecture-decision
  domain: project-manager
relations:
  - type: relates_to
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-071
  - type: references
    target: ZAI:ADR-036
  - type: references
    target: ZAI:PM-DOMAIN-NAV-BOUNDARIES
  - type: references
    target: ZAI:PM-EXISTING-TAB-SEMANTICS
---

# ADR-095 — Projects and Work uses domain, module and local view navigation

**Status:** Approved for application implementation by the owner's explicit “approve” on 2026-09-16, following the review of commit `3f36668fbe70bc447a0f0da4fd7dfcdfbae66617`. Independent Luna verification and root document acceptance passed before this approval. Production release is separate.

## Context

The owner clarified that the top domain bar selects a business domain, the sidebar selects a subdomain or functional module, and tabs select views inside that module. Business Home links to frequently used owner surfaces. The existing Development sidebar lists individual cross-project views while Project sections and Work views add two more navigation rows. The candidate JSON also retained a withdrawn design that would replace the sidebar with every Project feature.

Document 13 supplies the target hierarchy and document 14 inventories the existing meaning of nine Project sections, fourteen Project route templates and seven Work views. The owner requested this menu refinement before the wider PM capabilities and authorized the reviewed Luna Max delivery plan with “ลุย” on 2026-09-16.

## Decision

### D1 — Preserve identity and amend the displayed label

The existing domain displays **Projects & Work**. Its key and grant remain `projects`, its root remains `/projects`, its stable product identity remains `DOM-DEVELOPMENT`, and its technical owner remains `project-manager`. This amends only ADR-071 D4's decision to leave the Development label unchanged. SCM/CRM groups, other domains and their grants retain their meaning.

### D2 — Six logical modules in the sidebar

| Module | Existing entry with Business context | Entry with an authorized Project context |
|---|---|---|
| Project Management | /projects | /projects/{projectId} |
| Work Management | /work | /projects/{projectId}/structure |
| Delivery Design | Planned | Planned |
| Resource Coordination | /files | /projects/{projectId}/team |
| Delivery Governance | Planned | Planned |
| Agent Delivery | Planned | Planned |

These are presentation groupings inside the existing domain, not six new grants, bounded contexts or routes. Planned modules expose their named planned capabilities without links to nonexistent pages. Delivery Design includes Requirements; Delivery Governance includes Risks. Resources remains a distinct planned capability within Resource Coordination; it does not become Team, Files or Repositories.

This narrowly amends ADR-036 D1's **sidebar position and label** for the projects domain: the first sidebar item is Project Management and opens the existing Dashboard/Projects surface at `/projects`. The route and its overview behavior remain. Other domains retain their Dashboard-first sidebar rule.

### D3 — Place existing destinations in the selected module

Business Work tabs retain All Work, Execution, Timeline, Dependencies and Milestones & Gates. Business Resource Coordination retains Files and Repositories. Project Management retains Project and operational Inventory; execution mode routes keep their Project parent. Project Work retains all seven existing Work views and Structure Plan as its entry. Project Resource Coordination retains Team, Files and Repositories. The old repositories URL remains valid even though its module-level location moves from Inventory to Resource Coordination; Inventory can still link to it.

Import remains a one-click **Import plan** action on every authorized Project page, with an explicit current-page cue on its existing route. It is not duplicated as a section tab. All nine old section meanings and fourteen routes are accounted for in the navigation crosswalk. Preserving a capability does not require preserving its old row location.

The implementation may refactor ProjectTabs to render the selected module's local sections. It must not retain a full six-section row above the seven Work views. One active module and one active local destination identify the current location.

### D4 — Context and access remain separate

Business is the shell scope ceiling. A Project is an authorized route/resource context, not a new global selector. Context links derive from the existing BusinessShellGuard and scoped Project inventory; path parameters, local storage, Employment and TeamMembership are never grants. Direct API authorization remains authoritative.

Module changes preserve a Project context where an existing destination supports it. Returning to Business context is an explicit action. Unknown or unauthorized projects do not contribute names, IDs, counts or links to the navigation. Existing shared projects with a null direct Business owner retain the existing guard semantics.

Business Home shortcuts remain references to their target owner routes and preserve current access checks. This slice adds no shortcut personalization, new Home data store, or permission widening.

### D5 — Observable and accessible behavior

Match complete path segments, not substring occurrences. Preserve deep links, browser history and the seven canonical execution modes. Navigation has named landmarks, an unambiguous active cue, keyboard access, visible planned explanations and usable narrow-screen behavior. A planned destination cannot be offered as a successful link.

## Alternatives and consequences

Keeping eight sidebar views and all old tabs would preserve the duplication the owner asked to remove. Replacing the sidebar with every Project feature would violate the domain/module hierarchy. A new ERP parent with a single child, new permission keys, a new database or service split has no justification for this navigation change.

This slice changes presentation and route selection; it adds no database model, API, workforce calculation, risk register or agent runtime. Workforce and provider work have their own dependencies and evidence gates.

## Verification

The composed model must enumerate all existing routes and preserve their behavior. Required implementation proof covers click-based Import and seven-view reachability, Project/Business switching, missing/foreign Project refusal, unrelated SCM/CRM navigation, keyboard handling and a narrow viewport. Source-string tests that encoded the old layout must be replaced by tests of the approved behavior, with no loss of reachability or authorization assertions.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Scope the owner-requested hierarchy and exact preservation/amendment boundaries | eddd3dd8; uncommitted | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Explicitly amend ADR-036 D1 only for the PM sidebar, retaining its existing Projects dashboard destination | eddd3dd8; uncommitted | RWANG |
| 0.2.1b | 2026-09-16 | beta | Record explicit owner approval to implement the reviewed navigation slice; decision scope unchanged | approved baseline 3f36668f | RWANG |
