---
id: ZAI:PM-DOMAIN-SRS
title: Project Manager linked domain SRS
doc_type: domain-srs-view
domain: project-manager
domain_id: project-manager
status: proposed
version: "0.1.0"
source_revision: "6c4d001eec5f389a80e16cf2e4dcbcd34e0515e4"
relations:
  - type: references
    target: CHARTER.md
  - type: references
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-113
---

# SRS — Project Manager

> Proposed source-linked reading view. Requirement statements, acceptance criteria,
> lifecycle and explicit feature membership remain in the canonical records.
> This document adds no product requirement or delivery approval.

## 1. Purpose and boundary

Use this view to read the confirmed [Project Manager charter](CHARTER.md) through
the exact records located by the [canonical registry](../../../registry/document-registry/index.json).
It covers scope and work planning, execution views and progress, intake, Business
strategy, Project composition and PM execution evidence. The charter's existing
`project-manager` key is repeated as `domain_id`; no new catalog identity is issued.

The [canonical format](../../migrations/document-reintegration/CANONICAL-FORMAT.md)
and [ADR-025](../../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) control requirement authority and domain ownership.
An explicit FEAT membership is a bundle relationship, not an ownership claim.
Identity remains the authority for access grants; the People read-slice, Team and
Employment references here do not transfer that authority. Files compatibility
records remain with their existing owner until a reviewed cohort migration, as
recorded by the [File Management charter](../file-management/CHARTER.md).

The separate [full-system candidate SRS](../../architecture/project-manager-system/17-SRS.md)
indexes the PMR proposal catalog, including Workforce and peer-owner extensions.
It retains its candidate lifecycle and source bodies. This linked view covers
registered behavior and named dependencies; it does not adopt that proposal as
a whole. [The PMR index](requirements/README.md) retains proposal trace keys;
[PMR-013](requirements/PMR-013-proposal-requirement.md) records its promotion to
[ZAI:FR-272](../../requirements/FR-272.md). No other PMR-to-FR equivalence is inferred from a context link.

Source inspection is bounded to the revision above, including its branch-local
application fixes. It is not a claim about a fresh remote head or running system.
The [roadmap](../../roadmap/ROADMAP.md) owns delivery state; the requirement table
below owns neither implementation status nor a percentage-complete calculation.

## 2. Process and capability map

Each FR link goes to its registry-selected canonical record. “Unbundled” means
no explicit FEAT membership; the source charter still decides ownership.

| Verified process or capability | Canonical FEAT | Canonical FR records | Source evidence |
|---|---|---|---|
| Scope creation and Business bootstrap | Unbundled | [ZAI:FR-001](../../requirements/FR-001.md), [ZAI:FR-074](../../requirements/FR-074.md), [ZAI:FR-286](../../requirements/FR-286.md) | [Charter boundaries](CHARTER.md#boundaries); [Business template contract](../../change-requests/business-provisioning/STANDARD-BUSINESS-TEMPLATE-V1.md) |
| Project and neutral work structure | Unbundled | [ZAI:FR-003](../../requirements/FR-003.md), [ZAI:FR-004](../../requirements/FR-004.md), [ZAI:FR-005](../../requirements/FR-005.md), [ZAI:FR-006](../../requirements/FR-006.md), [ZAI:FR-007](../../requirements/FR-007.md), [ZAI:FR-040](../../requirements/FR-040.md), [ZAI:FR-043](../../requirements/FR-043.md) | [Charter](CHARTER.md); [ADR-012](../../decisions/ADR-012-PROJECT-WORK-VIEWS-AND-DEPENDENCY-BOUNDARY.md); [ADR-014](../../decisions/ADR-014-PROJECT-BUSINESS-OWNERSHIP-AND-SPACE-CONTEXT.md) |
| Seven execution views and progress | Unbundled | [ZAI:FR-009](../../requirements/FR-009.md), [ZAI:FR-010](../../requirements/FR-010.md), [ZAI:FR-011](../../requirements/FR-011.md) | [Charter calculators](CHARTER.md#boundaries); [execution identities](features/FR-070-stable-execution-domain-and-tag-identities.md) |
| Human, Excel and API intake | Unbundled | [ZAI:FR-012](../../requirements/FR-012.md), [ZAI:FR-017](../../requirements/FR-017.md), [ZAI:FR-018](../../requirements/FR-018.md), [ZAI:FR-019](../../requirements/FR-019.md), [ZAI:FR-065](../../requirements/FR-065.md) | [Charter import lane](CHARTER.md#boundaries); [PlanEnvelope schema](../../../apps/server/contracts/plan-envelope.schema.json) |
| Roadmap, Blueprint and execution identities | [ZAI:FEAT-003](../../features/FEAT-003/feature.md) | [ZAI:FR-068](../../features/FEAT-003/requirements/FR-068.md), [ZAI:FR-069](../../features/FEAT-003/requirements/FR-069.md), [ZAI:FR-070](../../features/FEAT-003/requirements/FR-070.md) | [ADR-028](../../decisions/ADR-028-HUMAN-VISIBLE-EXECUTION-ROADMAP.md); [ADR-029](../../decisions/ADR-029-STABLE-IDENTITY-BINDINGS-FOR-EXECUTION-PLANS.md); [ADR-102](../../decisions/ADR-102-PM-EXECUTION-TRACE-AND-REPLAY.md) |
| Multi-Project bundle orchestration | [ZAI:FEAT-012](../../features/FEAT-012/feature.md) | [ZAI:FR-108](../../features/FEAT-012/requirements/FR-108.md) | [ADR-049](../../decisions/ADR-049-EXECUTION-PLAN-BUNDLE-IMPORT-ORCHESTRATION.md); [bundle explanation](EXECUTION-PLAN-BUNDLE.md) |
| Business Home, objectives and scorecards | [ZAI:FEAT-002](../../features/FEAT-002/feature.md) | [ZAI:FR-041](../../features/FEAT-002/requirements/FR-041.md), [ZAI:FR-060](../../features/FEAT-002/requirements/FR-060.md), [ZAI:FR-268](../../features/FEAT-002/requirements/FR-268.md), [ZAI:FR-269](../../features/FEAT-002/requirements/FR-269.md), [ZAI:FR-270](../../features/FEAT-002/requirements/FR-270.md), [ZAI:FR-271](../../features/FEAT-002/requirements/FR-271.md) | [Charter strategy sections](CHARTER.md); [ADR-101](../../decisions/ADR-101-BUSINESS-GOALS-BECOME-OKR-SMART-BSC-4DX.md) |
| Strategy mutation | Unbundled | [ZAI:FR-059](../../requirements/FR-059.md) | [Strategy mutation note](features/FR-059-business-strategy-mutation.md) |
| Shell, context and work navigation | Unbundled | [ZAI:FR-002](../../requirements/FR-002.md), [ZAI:FR-015](../../requirements/FR-015.md), [ZAI:FR-020](../../requirements/FR-020.md), [ZAI:FR-032](../../requirements/FR-032.md), [ZAI:FR-033](../../requirements/FR-033.md), [ZAI:FR-034](../../requirements/FR-034.md), [ZAI:FR-035](../../requirements/FR-035.md), [ZAI:FR-039](../../requirements/FR-039.md), [ZAI:FR-044](../../requirements/FR-044.md), [ZAI:FR-046](../../requirements/FR-046.md), [ZAI:FR-056](../../requirements/FR-056.md), [ZAI:FR-063](../../requirements/FR-063.md), [ZAI:FR-064](../../requirements/FR-064.md), [ZAI:FR-250](../../requirements/FR-250.md) | [Charter UI scope](CHARTER.md); [ADR-008](../../decisions/ADR-008-BUSINESS-CENTRIC-SHELL-AND-SCOPE-LENS.md); [Identity entry boundary](../identity/CHARTER.md); [ADR-096](../../decisions/ADR-096-PROJECTS-AND-WORK-HIERARCHICAL-NAVIGATION.md) |
| Project dashboard, priority, accountable owner and Team grouping | [ZAI:FEAT-008](../../features/FEAT-008/feature.md) | [ZAI:FR-086](../../features/FEAT-008/requirements/FR-086.md), [ZAI:FR-087](../../features/FEAT-008/requirements/FR-087.md), [ZAI:FR-088](../../features/FEAT-008/requirements/FR-088.md), [ZAI:FR-089](../../features/FEAT-008/requirements/FR-089.md) | [Dashboard note](features/FR-086-projects-dashboard.md); [Charter Team boundary](CHARTER.md#boundaries) |
| Team, People read-slice and repository references | Unbundled | [ZAI:FR-008](../../requirements/FR-008.md), [ZAI:FR-036](../../requirements/FR-036.md), [ZAI:FR-042](../../requirements/FR-042.md), [ZAI:FR-073](../../requirements/FR-073.md) | [Charter satellite modules](CHARTER.md#satellite-modules-in-this-lane); [ADR-037](../../decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md); [Identity grant ownership](../identity/CHARTER.md) |
| Employment and legal-entity context | [ZAI:FEAT-028](../../features/FEAT-028/feature.md) | [ZAI:FR-193](../../features/FEAT-028/requirements/FR-193.md), [ZAI:FR-194](../../features/FEAT-028/requirements/FR-194.md) | [Charter](CHARTER.md); [ADR-078](../../decisions/ADR-078-ORG-EMPLOYMENT-LEGAL-ENTITY.md) |
| File compatibility and managed workspace | [ZAI:FEAT-001](../../features/FEAT-001/feature.md) | [ZAI:FR-037](../../features/FEAT-001/requirements/FR-037.md), [ZAI:FR-045](../../features/FEAT-001/requirements/FR-045.md), [ZAI:FR-058](../../features/FEAT-001/requirements/FR-058.md) | [PM charter](CHARTER.md); [Files cohort boundary](../file-management/CHARTER.md) |
| Read-only Project Inventory | [ZAI:FEAT-005](../../features/FEAT-005/feature.md) | [ZAI:FR-077](../../features/FEAT-005/requirements/FR-077.md) | [ADR-034](../../decisions/ADR-034-PROJECT-INVENTORY-READ-MODEL.md); [Asset boundary](../asset-management/CHARTER.md) |
| Project Domain and Feature lenses | Unbundled | [ZAI:FR-251](../../requirements/FR-251.md), [ZAI:FR-252](../../requirements/FR-252.md) | [Phase A note](features/FR-251-project-execution-domains.md); [ADR-097](../../decisions/ADR-097-PROJECT-FEATURE-AUTHORITY-AND-WRITE-CONTRACT.md); [Phase B note](features/FR-252-project-feature-authority.md) |
| Execution-step approval | Unbundled | [ZAI:FR-272](../../requirements/FR-272.md) | [ADR-103](../../decisions/ADR-103-PM-APPROVAL-GATEWAY-ADMISSION.md); [Identity capability boundary](../identity/CHARTER.md) |
| Backup, audit and demo fixtures | Unbundled | [ZAI:FR-013](../../requirements/FR-013.md), [ZAI:FR-014](../../requirements/FR-014.md), [ZAI:FR-016](../../requirements/FR-016.md) | [Charter](CHARTER.md); [Server testing](../../services/server/TESTING.md) |
| Product-readiness contribution | Unbundled | [ZAI:FR-124](../../requirements/FR-124.md) | [PM note](features/FR-124-product-readiness-dashboard.md); [Platform Control consumer](../platform-control/CHARTER.md) |
| Proposed canvas interaction extension | [ZAI:FEAT-007](../../features/FEAT-007/feature.md) | [ZAI:FR-082](../../features/FEAT-007/requirements/FR-082.md), [ZAI:FR-083](../../features/FEAT-007/requirements/FR-083.md), [ZAI:FR-084](../../features/FEAT-007/requirements/FR-084.md), [ZAI:FR-085](../../features/FEAT-007/requirements/FR-085.md) | [Pipeline design note](features/FR-082-pipeline-canvas.md); canonical lifecycle remains planned |
| Shared persistence, viewer and authorization dependencies | Unbundled | [ZAI:FR-030](../../requirements/FR-030.md), [ZAI:FR-031](../../requirements/FR-031.md), [ZAI:FR-061](../../requirements/FR-061.md), [ZAI:FR-067](../../requirements/FR-067.md), [ZAI:FR-072](../../requirements/FR-072.md) | [Identity charter](../identity/CHARTER.md); [ADR-017](../../decisions/ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md); [ADR-077](../../decisions/ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md); [PM mutation note](features/FR-065-import-target-authorization.md) |

## 3. Requirements index

The index covers every FEAT/FR in the capability map and the selected shared
constraints linked by the charter and those processes. It is not an allocation
of every global constraint to PM. Follow linked peer charters for their full
requirements. Canonical lifecycle is the graph-normalized `current`, `planned`
or `superseded` value derived from the preserved row at the source revision;
`source-preserved` and `reviewed-migration` describe provenance instead.
`current` does not mean implemented, verified or deployed. Lifecycle/source
conflicts are listed in section 6 without rewriting the pinned rows.

| Canonical ID | Exact source path | Canonical lifecycle | Applicability or controlling decision |
|---|---|---|---|
| ZAI:FEAT-001 | [FEAT-001](../../features/FEAT-001/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-002 | [FEAT-002](../../features/FEAT-002/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-003 | [FEAT-003](../../features/FEAT-003/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-005 | [FEAT-005](../../features/FEAT-005/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-007 | [FEAT-007](../../features/FEAT-007/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-008 | [FEAT-008](../../features/FEAT-008/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-012 | [FEAT-012](../../features/FEAT-012/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FEAT-028 | [FEAT-028](../../features/FEAT-028/feature.md) | current | Explicit canonical bundle; charter retains ownership |
| ZAI:FR-001 | [FR-001](../../requirements/FR-001.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-002 | [FR-002](../../requirements/FR-002.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-003 | [FR-003](../../requirements/FR-003.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-004 | [FR-004](../../requirements/FR-004.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-005 | [FR-005](../../requirements/FR-005.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-006 | [FR-006](../../requirements/FR-006.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-007 | [FR-007](../../requirements/FR-007.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-008 | [FR-008](../../requirements/FR-008.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-009 | [FR-009](../../requirements/FR-009.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-010 | [FR-010](../../requirements/FR-010.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-011 | [FR-011](../../requirements/FR-011.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-012 | [FR-012](../../requirements/FR-012.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-013 | [FR-013](../../requirements/FR-013.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-014 | [FR-014](../../requirements/FR-014.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-015 | [FR-015](../../requirements/FR-015.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-016 | [FR-016](../../requirements/FR-016.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-017 | [FR-017](../../requirements/FR-017.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-018 | [FR-018](../../requirements/FR-018.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-019 | [FR-019](../../requirements/FR-019.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-020 | [FR-020](../../requirements/FR-020.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-030 | [FR-030](../../requirements/FR-030.md) | current | Shared persistence profile; see section 6 |
| ZAI:FR-031 | [FR-031](../../requirements/FR-031.md) | current | Shared [Identity](../identity/CHARTER.md) dependency |
| ZAI:FR-032 | [FR-032](../../requirements/FR-032.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-033 | [FR-033](../../requirements/FR-033.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-034 | [FR-034](../../requirements/FR-034.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-035 | [FR-035](../../requirements/FR-035.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-036 | [FR-036](../../requirements/FR-036.md) | current | Historical Team surface; see section 6 and Identity owner |
| ZAI:FR-037 | [FR-037](../../features/FEAT-001/requirements/FR-037.md) | current | PM file compatibility; [Files](../file-management/CHARTER.md) boundary |
| ZAI:FR-039 | [FR-039](../../requirements/FR-039.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-040 | [FR-040](../../requirements/FR-040.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-041 | [FR-041](../../features/FEAT-002/requirements/FR-041.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-042 | [FR-042](../../requirements/FR-042.md) | current | PM People read-slice; [CRM](../crm/CHARTER.md) / Identity sources |
| ZAI:FR-043 | [FR-043](../../requirements/FR-043.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-044 | [FR-044](../../requirements/FR-044.md) | current | Entry UX; [Identity](../identity/CHARTER.md) route boundary |
| ZAI:FR-045 | [FR-045](../../features/FEAT-001/requirements/FR-045.md) | current | PM file compatibility; [Files](../file-management/CHARTER.md) boundary |
| ZAI:FR-046 | [FR-046](../../requirements/FR-046.md) | current | Entry projection; [Identity](../identity/CHARTER.md) authority |
| ZAI:FR-056 | [FR-056](../../requirements/FR-056.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-058 | [FR-058](../../features/FEAT-001/requirements/FR-058.md) | current | PM file compatibility; [Files](../file-management/CHARTER.md) boundary |
| ZAI:FR-059 | [FR-059](../../requirements/FR-059.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-060 | [FR-060](../../features/FEAT-002/requirements/FR-060.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-061 | [FR-061](../../requirements/FR-061.md) | current | Shared [Identity](../identity/CHARTER.md) dependency |
| ZAI:FR-063 | [FR-063](../../requirements/FR-063.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-064 | [FR-064](../../requirements/FR-064.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-065 | [FR-065](../../requirements/FR-065.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-067 | [FR-067](../../requirements/FR-067.md) | current | Shared [Identity](../identity/CHARTER.md) dependency |
| ZAI:FR-068 | [FR-068](../../features/FEAT-003/requirements/FR-068.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-069 | [FR-069](../../features/FEAT-003/requirements/FR-069.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-070 | [FR-070](../../features/FEAT-003/requirements/FR-070.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-072 | [FR-072](../../requirements/FR-072.md) | current | PM writer authorization; Identity grants |
| ZAI:FR-073 | [FR-073](../../requirements/FR-073.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-074 | [FR-074](../../requirements/FR-074.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-077 | [FR-077](../../features/FEAT-005/requirements/FR-077.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-082 | [FR-082](../../features/FEAT-007/requirements/FR-082.md) | planned | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-083 | [FR-083](../../features/FEAT-007/requirements/FR-083.md) | planned | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-084 | [FR-084](../../features/FEAT-007/requirements/FR-084.md) | planned | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-085 | [FR-085](../../features/FEAT-007/requirements/FR-085.md) | planned | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-086 | [FR-086](../../features/FEAT-008/requirements/FR-086.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-087 | [FR-087](../../features/FEAT-008/requirements/FR-087.md) | current | [PM charter](CHARTER.md) Project capability |
| ZAI:FR-088 | [FR-088](../../features/FEAT-008/requirements/FR-088.md) | current | [PM charter](CHARTER.md) Project capability |
| ZAI:FR-089 | [FR-089](../../features/FEAT-008/requirements/FR-089.md) | current | [PM charter](CHARTER.md) Team grouping; [Identity](../identity/CHARTER.md) retains grant authority |
| ZAI:FR-108 | [FR-108](../../features/FEAT-012/requirements/FR-108.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-124 | [FR-124](../../requirements/FR-124.md) | current | PM port; [Platform Control](../platform-control/CHARTER.md) consumer |
| ZAI:FR-193 | [FR-193](../../features/FEAT-028/requirements/FR-193.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-194 | [FR-194](../../features/FEAT-028/requirements/FR-194.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-250 | [FR-250](../../requirements/FR-250.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-251 | [FR-251](../../requirements/FR-251.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-252 | [FR-252](../../requirements/FR-252.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-268 | [FR-268](../../features/FEAT-002/requirements/FR-268.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-269 | [FR-269](../../features/FEAT-002/requirements/FR-269.md) | planned | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-270 | [FR-270](../../features/FEAT-002/requirements/FR-270.md) | planned | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-271 | [FR-271](../../features/FEAT-002/requirements/FR-271.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-272 | [FR-272](../../requirements/FR-272.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:FR-286 | [FR-286](../../requirements/FR-286.md) | current | [PM charter](CHARTER.md) capability or named dependency |
| ZAI:NFR-001 | [NFR-001](../../requirements/NFR-001.md) | current | Profile-specific; see section 6 |
| ZAI:NFR-002 | [NFR-002](../../requirements/NFR-002.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:NFR-003 | [NFR-003](../../requirements/NFR-003.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:NFR-004 | [NFR-004](../../requirements/NFR-004.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:NFR-005 | [NFR-005](../../requirements/NFR-005.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-001 | [BR-001](../../requirements/BR-001.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-002 | [BR-002](../../requirements/BR-002.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-003 | [BR-003](../../requirements/BR-003.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-004 | [BR-004](../../requirements/BR-004.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-005 | [BR-005](../../requirements/BR-005.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-006 | [BR-006](../../requirements/BR-006.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-007 | [BR-007](../../requirements/BR-007.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-008 | [BR-008](../../requirements/BR-008.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-009 | [BR-009](../../requirements/BR-009.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-010 | [BR-010](../../requirements/BR-010.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-018 | [BR-018](../../requirements/BR-018.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-034 | [BR-034](../../requirements/BR-034.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-043 | [BR-043](../../requirements/BR-043.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:BR-044 | [BR-044](../../requirements/BR-044.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SEC-002 | [SEC-002](../../requirements/SEC-002.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SEC-003 | [SEC-003](../../requirements/SEC-003.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SEC-008 | [SEC-008](../../requirements/SEC-008.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SDD-009 | [SDD-009](../../requirements/SDD-009.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SDD-039 | [SDD-039](../../requirements/SDD-039.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SDD-040 | [SDD-040](../../requirements/SDD-040.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SDD-045 | [SDD-045](../../requirements/SDD-045.md) | current | Shared constraint for the mapped scope; original record controls |
| ZAI:SDD-107 | [SDD-107](../../requirements/SDD-107.md) | current | Shared constraint for the mapped scope; original record controls |

## 4. Domain and service contracts

- Domain-owned models, routes and public ports: [PM charter](CHARTER.md).
  [Core / Server](../../services/server/SERVICE.md) owns the execution boundary;
  [Server testing](../../services/server/TESTING.md) and the
  [verification policy](../../architecture/VERIFICATION-POLICY.md) select checks.
- Project intake: [PlanEnvelope](../../../apps/server/contracts/plan-envelope.schema.json);
  programme transport: [ExecutionPlanBundle](../../../apps/server/contracts/execution-plan-bundle.schema.json).
  [ADR-049](../../decisions/ADR-049-EXECUTION-PLAN-BUNDLE-IMPORT-ORCHESTRATION.md) and the [domain bundle note](EXECUTION-PLAN-BUNDLE.md)
  explain their relationship. The wider candidate OpenAPI is not runtime proof.
- Feature authority: [ADR-097](../../decisions/ADR-097-PROJECT-FEATURE-AUTHORITY-AND-WRITE-CONTRACT.md), its [selected API contract](../../architecture/project-manager-system/contracts/phase-b/openapi.candidate.json)
  and [data contract](../../architecture/project-manager-system/contracts/phase-b/data-model.candidate.json).
  Entry decisions, implementation and production evidence remain individually scoped.
- Trace and replay: [ADR-102](../../decisions/ADR-102-PM-EXECUTION-TRACE-AND-REPLAY.md) and the
  [execution-trace phase](features/PHASE-FR-069-P1-execution-trace-replay.md).
  Effect approval: [ADR-103](../../decisions/ADR-103-PM-APPROVAL-GATEWAY-ADMISSION.md) and the
  [approval note](features/FR-272-approval-gateway-admission.md).
- Peer ownership: [Identity](../identity/CHARTER.md),
  [CRM](../crm/CHARTER.md), [Agent](../agent/CHARTER.md),
  [Files](../file-management/CHARTER.md), [Asset Management](../asset-management/CHARTER.md),
  [Integration](../integration/CHARTER.md) and [Platform Control](../platform-control/CHARTER.md)
  retain their declared write and access boundaries.
- [ADR-110](../../decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md) controls retirement of the historical Edge integration.
  [ADR-112](../../decisions/ADR-112-PRIMARY-CHECKOUT-DEV-DOCKER-AND-DATABASE-ISOLATION.md) controls dev/database isolation.
  [ADR-113](../../decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md) retires developer-only DDC while retaining product PM
  approvals, document governance and ordinary Git/CI controls.

## 5. Acceptance and verification references

Acceptance criteria stay in the linked canonical records and accepted contracts.
The paths below were inspected at the source revision. Historical results are
reported by their source documents, not rerun here. Current application tests,
hosted CI, databases, authenticated production UI and live activation are
**NOT_RUN** for this documentation task.

| Evidence question | Exact test or evidence path | Revision and result |
|---|---|---|
| Does intake use the authorized shared lane? | [Plan import](../../../apps/server/tests/integration/plan-import.test.js); [target authorization](../../../apps/server/tests/integration/import-target-authorization.test.js) | Source present at the recorded revision; test execution NOT_RUN |
| Does Domain View have distinct release evidence? | [Domain tests](../../../apps/server/tests/integration/project-domain-view.test.js); [FR-251 release note](features/FR-251-project-execution-domains.md) | Note records release `c07cfaba8eedb53f677e313977a1e2344fb5c8c5`; authenticated production Domain behavior was not exercised. Current production state NOT_VERIFIED |
| Is Feature authority implemented beyond persistence? | [Feature service](../../../apps/server/src/modules/project-manager/application/project-feature-service.js); [mutations](../../../apps/server/tests/integration/project-feature-mutations.test.js); [browser forms](../../../apps/server/tests/e2e/project-feature-mutations.spec.js); [Phase B evidence](features/FR-252-project-feature-authority.md) | Implementation commit `67ffc9061802b7079c54579a8654b4e3faf194f6` is an ancestor of the source revision. Note records local composed evidence; fresh tests and production-role isolation NOT_RUN |
| Are OKR/SMART and later KPI/4DX implementations distinguishable from source lifecycle? | [SMART calculator](../../../apps/server/src/modules/project-manager/progress/smart-checks.js); [SMART tests](../../../apps/server/tests/unit/fr271-smart-checks.test.js); [KPI evidence](features/FR-269-business-scorecard-kpis.md); [4DX evidence](features/FR-270-4dx-weekly-execution.md) | Commits `02f54a52`, `54e7e357`, `8a2fd498` are ancestors of the source revision. Later notes record local/hosted checks; migration apply and live-Business acceptance are not established by this view |
| Are trace/replay and effect approval separate? | [Trace tests](../../../apps/server/tests/integration/project-execution-trace.test.js); [approval tests](../../../apps/server/tests/integration/project-approval-gateway.test.js); [roadmap](../../roadmap/ROADMAP.md) | Approval merge `95b7e3c881db8566223ddae76c2322d86f4ba55b` is an ancestor. Roadmap retains review status and three A-07 proofs as UNVERIFIED; current test execution NOT_RUN |
| Is standard Business provisioning bounded to its owner contract? | [Provisioning service](../../../apps/server/src/modules/project-manager/application/business-provisioning-service.js); [backup tests](../../../apps/server/tests/integration/business-provisioning-backup.test.js) | Source present at the recorded revision; runtime, migration and recovery execution NOT_RUN |
| Does this reading view preserve exact records and membership? | [Profile validator](../../../apps/server/scripts/document-profile-validation.mjs); [profile tests](../../../apps/server/tests/node/document-profile-validation.test.mjs); [canonical format](../../migrations/document-reintegration/CANONICAL-FORMAT.md) | Run governance, profile checks and corpus checks on the composed documentation patch; retain actual results with that patch rather than claiming historical application tests cover it |

## 6. Exclusions and unresolved conflicts

| Topic | Conflicting or excluded sources | Status and next authority |
|---|---|---|
| Full-system and Workforce adoption | [Candidate SRS](../../architecture/project-manager-system/17-SRS.md); [PMR catalog](requirements/README.md); [Workforce proposal](requirements/PMR-033-proposal-requirement.md) | PROPOSAL_ONLY beyond exact registered slices. Owner/domain authorities must adopt changed behavior through the existing reviewed workflow before implementation |
| Historical note/index authority | [FR notes](FR-INDEX.md); [canonical format](../../migrations/document-reintegration/CANONICAL-FORMAT.md) | FR notes explain design/evidence; exact registry-selected records retain statements, lifecycle and FEAT membership. No feature-note status is promoted into canonical lifecycle |
| Feature delivery state | [ZAI:FR-252](../../requirements/FR-252.md); [Phase B note](features/FR-252-project-feature-authority.md); [roadmap](../../roadmap/ROADMAP.md) | SOURCE_CONFLICT: canonical row/roadmap retain W3 API/UI/main-composition pending wording, while composed evidence and implementation commit are present. Delivery reconciliation remains an integrator review; production role/migration/deployment gates are not closed |
| Business strategy and SMART status | [ZAI:FR-268](../../features/FEAT-002/requirements/FR-268.md), [ZAI:FR-269](../../features/FEAT-002/requirements/FR-269.md), [ZAI:FR-270](../../features/FEAT-002/requirements/FR-270.md), [ZAI:FR-271](../../features/FEAT-002/requirements/FR-271.md); [FR-271 design note](features/FR-271-smart-validation-contract.md); [FR-270 delivery note](features/FR-270-4dx-weekly-execution.md); [roadmap](../../roadmap/ROADMAP.md) | SOURCE_CONFLICT: canonical rows retain original phase wording; FR-271 note says design only although its calculator exists. Preserve pinned statements/lifecycle; any canonical status migration needs separate reviewed provenance |
| Approval acceptance | [ZAI:FR-272](../../requirements/FR-272.md); [approval note](features/FR-272-approval-gateway-admission.md); [roadmap](../../roadmap/ROADMAP.md) | EVIDENCE_OPEN: merged implementation does not resolve the roadmap's unverified A-07 proofs or establish current production acceptance |
| Persistence profile | [ZAI:FR-030](../../requirements/FR-030.md); [ZAI:NFR-001](../../requirements/NFR-001.md); [ADR-112](../../decisions/ADR-112-PRIMARY-CHECKOUT-DEV-DOCKER-AND-DATABASE-ISOLATION.md) | PROFILE_SPECIFIC: offline lab and PostgreSQL development/runtime evidence must retain their own configuration and acceptance scope; this reading view does not select a database or authorize a migration |
| Team/Membership and file cohorts | [ZAI:FR-036](../../requirements/FR-036.md); [PM charter](CHARTER.md); [Identity charter](../identity/CHARTER.md); [Files charter](../file-management/CHARTER.md) | Follow accepted ownership, including [ADR-077](../../decisions/ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md). Historical Team/read-slice wording does not grant Membership writes; a standalone Files service does not migrate PM compatibility rows |
| Old status totals and developer procedures | [September status snapshot](../../architecture/project-manager-system/28-CURRENT-IMPLEMENTATION-AND-DELIVERY-STATUS.md); [candidate document 20](../../architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md); [ADR-113](../../decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md) | HISTORICAL: do not reuse old task totals as current PM completion. Retired developer DDC packets, G0 and receipts do not govern this documentation task; product approval requirements remain in force |
| New navigation/catalog identity or runtime acceptance | [Charter](CHARTER.md); [candidate identity explanation](features/FR-070-stable-execution-domain-and-tag-identities.md); [ADR-112](../../decisions/ADR-112-PRIMARY-CHECKOUT-DEV-DOCKER-AND-DATABASE-ISOLATION.md) | No new `DOM-*`/`TD-*` key, authority grant, route, schema, deployment or database change is established here. Reading-view approval and production acceptance remain separate facts |

## 7. Change history

| Version | Date | Source revision | Change |
|---|---|---|---|
| 0.1.0 | 2026-10-23 | `6c4d001eec5f389a80e16cf2e4dcbcd34e0515e4` | Initial proposed linked view; exact canonical paths/lifecycle/membership, existing owner key, peer contracts and scoped evidence. No requirement text, acceptance criteria, FEAT membership or runtime behavior changed |

Parent/peer impact: the charter exposes its existing key for the view; domain
navigation links this document and distinguishes the older full-system proposal.
The PMR bodies, issued IDs, canonical source rows, compatibility exports,
historical snapshots and peer charters retain their existing authority.
