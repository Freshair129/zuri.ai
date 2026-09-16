---
id: ZAI:RCA-PM-NAVIGATION-SCOPE-20260916
title: Project Manager navigation scope duplication
version: "0.3.0b"
status: candidate
created_at: "2026-09-16T00:52:00+07:00,RWANG,base 087f3025"
last_update: "2026-09-16T02:52:06+07:00,RWANG"
attributes:
  domain: project-manager
  doc_type: root-cause-analysis
relations:
  - type: references
    target: ZAI:PM-NAVIGATION-REFINEMENT
---

# RCA — PM navigation shows overlapping scopes and an incomplete target map

## Review correction after owner clarification

**Second correction — capability semantics before grouping:** The next six-module summary omitted Inventory, retained Resources only through a broad Resource Coordination label, and did not explain the old Team authority. Comparing that table with ProjectTabs (six current + three planned sections), ADR-034/FR-077, the Inventory read model, and the Team page/service confirms a defect in our proposal. We grouped labels before tracing each tab's data/actions/authority. Route-count coverage and a 37-screen gallery did not catch semantic omission: the historical WF-23 title Project Index also narrowed the operational read model's stated purpose. Prevention now requires the [nine-section / fourteen-route semantic audit](../../docs/architecture/project-manager-system/14-EXISTING-PROJECT-TAB-SEMANTICS.md) before any rename/move/merge. Inventory is restored explicitly; planned Risks/Resources remain separate; Membership and resource allocation cannot be conflated. No runtime defect or live-user causal claim follows from this documentation finding.

The owner explicitly reaffirmed Domain bar → subdomain sidebar → local tabs. Source proves that the existing layers intentionally coexist; it does not prove that coexistence caused the reported confusion or that removing tabs is necessary. Ancestor active matching alone also does not establish a defect. The confirmed defect in our earlier proposal is a classification error: it treated project scope as a replacement for domain/module navigation and promoted every feature to a sidebar peer. User-task research is still NOT_RUN, so the broader usability causal claim below is a hypothesis, not a measured finding.

The earlier contextual-sidebar solution and corresponding prevention bullets below are withdrawn. Use [Domain placement and navigation boundaries](../../docs/architecture/project-manager-system/13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md) for the current candidate: preserve navigation levels, classify sections/views/actions, show scope explicitly and map existing routes completely. The remaining original analysis is retained as a dated review record.

## Symptom

On 2026-09-16 Asia/Bangkok the owner supplied two screenshots: a project tab bar (Project, Inventory, Team, Work, Files, Import, More) and the Development sidebar. The owner reported duplicated/incomplete navigation and asked for refinement before further PM expansion.

## Evidence

Source baseline `087f30258a6831865afd751e28804e36505aff30` was verified against the primary checkout. Static route enumeration found 14 project page templates; the live source registry defines 8 Business sidebar destinations.

1. `docs/decisions/ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md`, D4, explicitly preserves the Development sidebar while opening a project and its tabs.
2. `apps/server/src/components/layouts/Sidebar.jsx` derives from the Business domain; it uses prefix matching for non-exact destinations.
3. `apps/server/src/config/domains.js` registers Dashboard at `/projects` without exact matching. Thus a project descendant also matches this ancestor link. This follows directly from the predicate; no runtime authorization fault is claimed.
4. `ProjectTabs.jsx` mounts 6 destinations and 3 planned controls; `WorkViewTabs.jsx` adds 7 local views.
5. `projects/[projectId]/layout.jsx` separately maps repositories to Inventory and execution modes to Project.
6. `tests/unit/project-work-route.test.js` requires disjoint Business/project labels because both navigation layers appear together.
7. The first full PM design's navigation list proposed additional destinations but did not replace or explicitly amend the overlapping arrangement.

## Root Cause

The navigation contract separates data scope correctly in its intent, but presents both scopes concurrently and relies on small group labels and synonyms to explain the difference. Project resources and the import workflow are peers in a second rail; route ownership is maintained separately in several components. The new design had not yet reconciled its full feature map with this existing navigation contract.

This is an evidence-supported information-architecture problem. The screenshots and source review do not prove API scope leakage, runtime data loss or production behavior.

## Why the issue escaped detection

Existing tests enforce the former design: both scopes remain available and their labels differ. That can pass while a human still cannot tell which scope a menu opens. Route existence and inbound-link checks do not assess a coherent whole-system menu or one contextual destination owner.

## Proposed solution

Adopt the candidate contextual-sidebar model and route map in [Navigation refinement](../../docs/architecture/project-manager-system/09-NAVIGATION-REFINEMENT.md). Explicitly amend the relevant ADR-011 presentation rule, keep the Business scope ceiling, preserve all existing URLs and introduce new features only at their own implementation gates.

## Proposed prevention

- Derive project sidebar, Work views, search and active-state ownership from one reviewed navigation definition.
- Check every enumerated route template, scope boundary, URL history transition and unauthorized state.
- Replace old synonym-only expectations with positive checks for contextual navigation; retain all existing isolation assertions.
- Review complete desktop/mobile menus whenever a feature is added; track planned versus implemented reachability explicitly.
- Run product acceptance after code approval; prototype behavior is never reported as product validation.

## Current status

Candidate documentation only. No product fix, source test or UI rollout has occurred in this task.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Evidence-supported navigation RCA and proposed prevention | base 087f3025 | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Correct overstated causal inference and withdraw the earlier solution after owner clarifies the navigation hierarchy | source 000b26f1 | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Identify semantic omission in the six-module proposal and require tab/data/action/authority audit before grouping | source 96630462 | RWANG |
