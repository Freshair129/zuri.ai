---
version: "1.0.0b"
created_at: "2026-08-18T00:00:00+07:00,ATHER"
last_update: "2026-08-18T00:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "documentation-architecture"
  doc_type: "interface-inventory"
  scope: "current user-visible route registry and shell boundary"
---

# Zuri V2 — Interface Inventory

| Field | Value |
|---|---|
| **Version** | 1.0.0b |
| **Status** | Candidate — normalized registry; runtime status is per interface |
| **Last Updated** | 2026-08-18 |
| **Primary responsibility** | Canonical registry of current user-visible interfaces and implementation status |
| **Runtime evidence** | `src/app/**/page.jsx`, `src/config/domains.js`, route/layout files |
| **Change authority** | [ZV2-CR-007](changes/ZV2-CR-007-INTERFACE-INVENTORY-NORMALIZATION.md) |

<!-- interface-inventory-counts: page_routes=37; operational_domain_keys=7; operational_subdomain_entries=21; business_home_shell_slots=1 -->

## 1. Responsibility and authority boundary

This document answers one question:

> What user-visible interfaces exist, where are they mounted, what do they do,
> what states and access boundary do they require, and what is their current status?

It does not own facts that already have a stronger source of truth:

| Concern | Authority | This document does |
|---|---|---|
| Route tree, layouts and URL topology | [ROUTES-SITEMAP.md](ROUTES-SITEMAP.md) | records the route that exposes an interface and links to the route map |
| Domain bar and sub-domain navigation | [SITEMAP-DOMAIN-NAV.md](SITEMAP-DOMAIN-NAV.md), `src/config/domains.js` | records the interface's domain context; does not redefine navigation |
| API endpoint catalog and DTO contracts | [Appendix A](appendices/A-api-spec.md), live `GET /api/docs` | records only the API dependency needed to understand a UI surface |
| Feature, requirement and test traceability | generated [FEATURE-MAP.md](FEATURE-MAP.md), [TRACE.md](TRACE.md) | references FR/SDD ids; does not duplicate global counts |
| Tokens, components and accessibility rules | [UI-DESIGN-SYSTEM.md](UI-DESIGN-SYSTEM.md) | names relevant patterns; does not restate token rules |
| Durable decisions and changes | ADRs, CRs and [RCA](../.brain/rca/2026-08-18-document-graph-did-not-govern-semantic-inventory.md) | links to rationale; does not contain a change ledger |

Generated views are projections, not authorities. Regenerate them with
`npm run govern`; never hand-edit `FEATURE-MAP.md`, `DOMAIN-MAP.md`, `TRACE.md`,
or `appendices/D-traceability.md`.

## 2. Shell boundary

The current entry journey is:

```text
Landing → Login/demo boundary → trusted viewer resolution → Business Routing
→ Business Home/BusinessShell → domain → sub-domain → Project resource
```

| Shell | Entry condition | Owns | Current implementation | Required boundary |
|---|---|---|---|---|
| **EntryShell** | no authenticated viewer or pre-shell entry | `/`, `/login` | `src/components/layouts/EntryShell.jsx` | no domain bar, sidebar or Business context |
| **BusinessRoutingShell** | viewer exists but Business is not selected | `/businesses` | `src/app/(entry)/businesses/page.jsx` | displays only authorized Business choices |
| **BusinessShell** | trusted viewer plus authorized `activeBusinessId` | `/overview` and Business domains | `src/app/(pm)/layout.jsx`, `BusinessShellGuard.jsx` | selection occurs before final chrome mounts |
| **ProjectResourceShell** | BusinessShell plus opened `projectId` | `/projects/[projectId]/**` | `src/app/(pm)/projects/[projectId]/layout.jsx` | Project tabs remain inside the selected Business |

`/overview` is Business Home's Dashboard and the BusinessShell root. It is not a
Development sub-domain. Development starts at `/projects`.

## 3. Current interface registry

Each row represents one current routable page. Dynamic route parameters preserve
their source names so the registry can be checked mechanically against the route
tree. `implemented beta` means the route exists and has local proof; it does not
mean production identity, external providers or cutover gates are complete.

### 3.1 Entry and Business Home

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/` | Landing | EntryShell | product entry, continue to login/demo boundary | initial, loading, local/offline-safe | implemented; `src/app/(entry)/page.jsx` |
| `/login` | Login stub | EntryShell | explicit local demo transition; no real credential provider | ready, disabled-in-production, error | implemented beta; `src/app/(entry)/login/page.jsx`, FR-044/046 |
| `/businesses` | Business Routing | BusinessRoutingShell | list authorized Businesses and select one | auth required, empty Business scope, loading, error | implemented beta; `src/app/(entry)/businesses/page.jsx`, `GET /api/entry` |
| `/overview` | Business Home Dashboard | BusinessShell; shell-level cross-domain projection | Business briefing, KPI/health, strategy and attention links | Business required, ready, forbidden, loading, empty, error, offline | implemented beta; `src/app/(pm)/overview/page.jsx`, FR-060 |

### 3.2 Development domain — global surfaces

The runtime registry has eight Development sub-domain entries, including Files;
the Business Home slot is excluded from this count.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/projects` | Projects | BusinessShell → Development / Projects | Business-scoped Project list, filters, open Project, create through objective intake | ready, empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/page.jsx`, FR-003 |
| `/projects/new` | Objective intake | BusinessShell → Development / Projects | create a structured plan from an objective; preview and submit | validation, conflict, loading, error, success | implemented; `src/app/(pm)/projects/new/page.jsx`, FR-017 |
| `/work` | All Work | BusinessShell → Development / All Work | global WorkItem browse/filter/status editing | empty, loading, error, forbidden, offline | implemented; `src/app/(pm)/work/page.jsx`, FR-005 |
| `/execution` | Execution overview | BusinessShell → Development / Execution | choose or summarize the seven canonical execution modes | ready, empty, loading, error, forbidden | implemented; `src/app/(pm)/execution/page.jsx`, FR-009 |
| `/execution/[mode]` | Execution mode view | BusinessShell → Development / Execution | mode-specific view over the neutral work model | invalid mode, empty, loading, error, forbidden | implemented; `src/app/(pm)/execution/[mode]/page.jsx`, FR-009 |
| `/timeline` | Global Timeline | BusinessShell → Development / Timeline | cross-Project schedule and date-bound work | empty, loading, error, forbidden | implemented; `src/app/(pm)/timeline/page.jsx`, FR-064 |
| `/dependencies` | Dependency register | BusinessShell → Development / Dependencies | cross-Project dependency list, create, inspect and delete | empty, loading, error, forbidden, cycle/domain validation | implemented; `src/app/(pm)/dependencies/page.jsx`, FR-007 |
| `/milestones` | Milestones and Gates | BusinessShell → Development / Milestones & Gates | global milestones/gates, status and evidence updates | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/milestones/page.jsx`, FR-006 |
| `/files` | Managed Files | BusinessShell → Development / Files | Business/Project file metadata, reconcile, mount and safe content actions | empty, loading, error, capability-disabled, forbidden | implemented beta; `src/app/(pm)/files/page.jsx`, FR-045 |
| `/repositories` | Repositories | BusinessShell → Development / Repositories | local repository metadata and Project links | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/repositories/page.jsx`, FR-008 |

### 3.3 People and Platform domains

The operational registry has seven domain keys. Platform currently exposes six
page routes because its Dashboard and Settings navigation entries share
`/settings`; one route is one interface row here.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/people` | People Dashboard | BusinessShell → HR / People | People domain landing and directory entry | ready, empty, loading, error, forbidden | implemented; `src/app/(pm)/people/page.jsx`, FR-042 |
| `/people/directory` | People Directory | BusinessShell → HR / People / Directory | Business-scoped people search and view | empty, loading, error, forbidden | implemented; `src/app/(pm)/people/directory/page.jsx`, FR-042 |
| `/platform/users` | Users and Permissions | BusinessShell → Platform / Users | OWNER-scoped membership role and domain grants | owner-only, empty, loading, error, forbidden | implemented; `src/app/(pm)/platform/users/page.jsx`, FR-038/062 |
| `/platform/integrations` | Platform Integrations | BusinessShell → Platform / Integrations | owner-only provider/connection metadata and redacted Vault readiness | owner-only, empty, loading, error, manager unavailable; no raw secret state | implemented beta; `src/app/(pm)/platform/integrations/page.jsx`, FR-080 |
| `/profile` | My Profile | BusinessShell → Platform/identity | resolved local account, language and LINE-link state | auth required, loading, error, empty | implemented beta; `src/app/(pm)/profile/page.jsx`, FR-038 |
| `/settings` | Settings | BusinessShell → Platform / Settings | local preferences and shell/runtime settings | loading, error, ready, forbidden | implemented; `src/app/(pm)/settings/page.jsx`, FR-020 |
| `/audit` | Audit Log | BusinessShell → Platform / Audit | immutable audit event browser and filters | empty, loading, error, forbidden | implemented; `src/app/(pm)/audit/page.jsx`, FR-014 |
| `/backup` | Backup | BusinessShell → Platform / Backup | snapshot export and preview-then-confirm restore | loading, validation, confirmation, error, forbidden | implemented; `src/app/(pm)/backup/page.jsx`, FR-013 |

### 3.4 Workspace compatibility surfaces

These pages remain routable Project Manager Space surfaces. They are not a second
global collaboration Workspace authority; ADR-027's future onboarding surface is
separately documented.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/workspaces` | Workspace list | BusinessShell → Development/Space compatibility | list and open Spaces | empty, loading, error, forbidden | implemented; `src/app/(pm)/workspaces/page.jsx` |
| `/workspaces/[workspaceId]` | Workspace detail | BusinessShell → Development/Space compatibility | Space metadata and related Projects | not found, loading, error, forbidden | implemented; `src/app/(pm)/workspaces/[workspaceId]/page.jsx` |

### 3.5 Project resource surfaces

All rows below are nested in ProjectResourceShell. Project-local work views are
not new global domains or new persistence aggregates.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/projects/[projectId]` | Project Overview | ProjectResourceShell | Project identity, health, summary and tab entry | not found, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/page.jsx`, FR-043 |
| `/projects/[projectId]/all-work` | Project All Work | ProjectResourceShell → Work | Project-filtered WorkItems and status actions | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/all-work/page.jsx`, FR-005 |
| `/projects/[projectId]/board` | Project Board | ProjectResourceShell → Work | board view over Project work | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/board/page.jsx`, FR-063 |
| `/projects/[projectId]/dependencies` | Project Dependency Map | ProjectResourceShell → Work | contained dependency graph; both endpoints must belong to Project | empty, loading, error, forbidden, graph error | implemented; `src/app/(pm)/projects/[projectId]/dependencies/page.jsx`, FR-040 |
| `/projects/[projectId]/execution/[mode]` | Project Execution Mode | ProjectResourceShell → Work | mode view scoped to opened Project | invalid mode, empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx`, FR-009 |
| `/projects/[projectId]/files` | Project Files | ProjectResourceShell → Files | Project file references and metadata actions | empty, loading, error, forbidden, capability-disabled | implemented; `src/app/(pm)/projects/[projectId]/files/page.jsx`, FR-045 |
| `/projects/[projectId]/import` | Project Plan Import | ProjectResourceShell → Import | validate, dry-run, conflict preview and commit plan | validation, conflict, loading, error, forbidden, success | implemented; `src/app/(pm)/projects/[projectId]/import/page.jsx`, FR-012 |
| `/projects/[projectId]/inventory` | Project Inventory | ProjectResourceShell → Overview | bounded read-only snapshot of work, gates, files, repos, team, progress and activity | not found, loading, error, forbidden, empty/partial/truncated/unavailable | implemented beta; working tree/pending commit for FR-077; `src/app/(pm)/projects/[projectId]/inventory/page.jsx` |
| `/projects/[projectId]/milestones` | Project Milestones and Gates | ProjectResourceShell → Milestones & Gates | Project-local milestone/gate browsing and evidence updates | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/projects/[projectId]/milestones/page.jsx`, FR-006 |
| `/projects/[projectId]/repositories` | Project Repositories | ProjectResourceShell → Repositories | linked repository metadata and link/unlink actions | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/projects/[projectId]/repositories/page.jsx`, FR-008 |
| `/projects/[projectId]/structure` | Structure Plan | ProjectResourceShell → Work | Project → Workstream → Container → WorkItem WBS | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/structure/page.jsx`, FR-040 |
| `/projects/[projectId]/team` | Project Team | ProjectResourceShell → Team | Project team membership view and actions | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/projects/[projectId]/team/page.jsx`, FR-036 |
| `/projects/[projectId]/timeline` | Project Schedule | ProjectResourceShell → Work | Project-local schedule and dates | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/timeline/page.jsx`, FR-064 |

## 4. Runtime registry reconciliation

The source registry has a shell slot plus operational domains. Counts are stated
explicitly so “domain count” cannot silently mix the two concepts:

| Count | Current value | Source interpretation |
|---|---:|---|
| Source `DOMAINS` entries | 8 | `business-home` plus seven operational domains |
| Operational domain keys | 7 | `commerce`, `customer`, `growth`, `operations`, `people`, `projects`, `platform` |
| Business Home shell slots | 1 | `business-home`, `/overview`, always visible, not an operational domain |
| Source sub-domain entries | 22 | includes Business Home Dashboard |
| Operational sub-domain entries | 21 | excludes Business Home Dashboard |
| Development sub-domain entries | 8 | includes Files and excludes Business Home |
| Platform navigation entries | 6 | Dashboard and Settings intentionally share `/settings` |

The marker at the top of this document is the published operational count. The
preflight check derives it from `src/config/domains.js` and fails if it drifts.
Reserved `soon` entries are navigation slots, not delivered product modules.

## 5. Shared interface-state contract

The registry uses these states consistently; individual rows identify the states
that materially apply to that surface.

| State | Meaning | Required behavior |
|---|---|---|
| `AUTH_REQUIRED` | trusted viewer/session is absent | route to EntryShell `/login`; do not query protected scope first |
| `BUSINESS_REQUIRED` | viewer has no selected authorized Business | route to BusinessRoutingShell `/businesses` |
| `READY` | scope and resource authorization succeeded | mount the declared shell and render content |
| `FORBIDDEN` | viewer lacks the required Business/domain/resource authority | fail closed; do not disclose cross-scope existence |
| `NOT_FOUND` | route/resource does not exist or is intentionally indistinguishable from unauthorized | render a non-enumerating not-found state |
| `LOADING` | async read is in flight | use the shared loading primitive; preserve shell boundary |
| `EMPTY` | authorized read returned no records | explain the empty state and expose the valid next action |
| `ERROR` | known read/write failure | show safe error, retry where possible, never report success on manager failure |
| `OFFLINE` | local-first runtime has no network | retain local behavior; label unavailable external capabilities explicitly |
| `PARTIAL` / `TRUNCATED` | bounded read cannot show the complete window | disclose section and limit; link to the owning detailed surface |

Presentation tokens and component accessibility rules remain in
[UI-DESIGN-SYSTEM.md](UI-DESIGN-SYSTEM.md); this table defines only interface-level
state obligations.

## 6. Verification and maintenance contract

Before adding or changing a page route:

1. declare the requirement/spec/test anchors in the source file;
2. add or update exactly one interface row here, including status and states;
3. update the owning route/domain/feature authority when its meaning changes;
4. run `npm run govern`, which regenerates graph projections and checks semantic
   route/API/interface parity;
5. run the relevant tests and `npm run verify` before calling the surface complete.

The current route evidence is:

| Evidence | Current value | Check |
|---|---:|---|
| `src/app/**/page.jsx` | 37 page routes | preflight compares every derived URL to this registry |
| `src/config/domains.js` | 7 operational domains, 21 operational sub-domains, 1 Business Home slot | preflight compares the control marker to the source registry |
| UI status | per-row, not a global completion claim | local implementation does not imply production provider/cutover readiness |

## 7. Out of scope

- API endpoint definitions, request/response schemas and secret-management
  lifecycle contracts (see [Appendix A](appendices/A-api-spec.md)).
- global FR/code/test coverage counts (see generated [FEATURE-MAP.md](FEATURE-MAP.md)
  and [TRACE.md](TRACE.md)).
- navigation redesign, new execution modes, new persistence aggregates or
  production identity/provider activation.
- historical change DAGs and owner follow-up ledgers; use CR/ADR/RCA documents.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-08-18 | candidate | Executed CR-007: bounded the document to a canonical UI registry, reconciled 37 routes and explicit Business Home/domain counts, and added machine-checkable evidence | working-tree | ATHER |
| 0.4.0 | 2026-08-14 | beta | FR-044/FR-046 shell boundary inventory before normalization | historical | ATHER |
