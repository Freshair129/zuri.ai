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
| **Version** | 1.4.0b |
| **Status** | Candidate — normalized registry; runtime status is per interface |
| **Last Updated** | 2026-09-02 |
| **Primary responsibility** | Canonical registry of current user-visible interfaces and implementation status |
| **Runtime evidence** | `src/app/**/page.jsx`, `src/config/domains.js`, route/layout files |
| **Change authority** | [ZV2-CR-007](changes/ZV2-CR-007-INTERFACE-INVENTORY-NORMALIZATION.md) |

<!-- interface-inventory-counts: page_routes=56; operational_domain_keys=9; operational_subdomain_entries=29; business_home_shell_slots=1 -->

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
Landing → credential Login → signed viewer resolution → Business Routing
→ Business Home/BusinessShell → domain → sub-domain → Project resource
```

| Shell | Entry condition | Owns | Current implementation | Required boundary |
|---|---|---|---|---|
| **EntryShell** | no authenticated viewer or pre-shell entry | `/`, `/login`, `/signup`, `/reset-password` | `src/components/layouts/EntryShell.jsx` | no domain bar, sidebar or Business context |
| **BusinessRoutingShell** | viewer exists but Business is not selected | `/businesses` | `src/app/(entry)/businesses/page.jsx` | displays only authorized Business choices |
| **BusinessShell** | trusted viewer plus authorized `activeBusinessId` | `/overview` and Business domains | `src/app/(pm)/layout.jsx`, `BusinessShellGuard.jsx` | selection occurs before final chrome mounts |
| **ProjectResourceShell** | BusinessShell plus opened `projectId` | `/projects/[projectId]/**` | `src/app/(pm)/projects/[projectId]/layout.jsx` | Project tabs remain inside the selected Business |
| **PlatformControlShell** | trusted installation operator; no Business selection | `/control/**` | `src/app/(control)/layout.jsx` | no DomainBar, Business sidebar, Business context or Business navigation entry |

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
| `/login` | Credential Login | EntryShell | email/account-code and password authentication with password reveal and an opt-in persistent session, then Business Routing; two links out — reset, and self-serve signup (FR-120) | ready, invalid credentials, unavailable session, error | implemented beta; `src/app/login/page.jsx`, `/api/auth/login`, FR-046 |
| `/reset-password` | Password Reset Redemption (ตั้งรหัสผ่านใหม่) | EntryShell | consume a single-use reset token handed over out of band — typed by hand or carried in the link — set a new credential, and report that every active session was revoked | unauthenticated, prefilled token, invalid/used/expired token (one generic message), password too short, confirmation mismatch, done | implemented; `src/app/reset-password/page.jsx`, `/api/auth/reset-password`, FR-104 |
| `/signup` | Self-Serve Signup (สมัครสมาชิก) | EntryShell | create your own `Person` + `PersonCredential` with no invite and no operator, be signed in, and continue into FR-066 at its `PROFILE` step — grants no scope, capability or membership | unauthenticated, confirmation mismatch (caught before any request), password below the minimum, address already taken (named plainly — no mail transport means nothing to hide it behind), rate-limited (429) | implemented; `src/app/signup/page.jsx`, `/api/auth/signup`, FR-120 |
| `/businesses` | Business Routing | BusinessRoutingShell | list authorized Businesses and select one; empty Business scope now routes to the pre-Business journey (FR-066) | auth required, empty Business scope, loading, error | implemented beta; `src/app/(entry)/businesses/page.jsx`, `GET /api/entry` |
| `/onboarding/profile` | Profile Setup (ตั้งค่าโปรไฟล์) | BusinessRoutingShell | complete the Profile over the session's own Person before any scope prompt (AC-066.1); routes onward by the server's `nextStep` | auth required, loading, validation error, error | implemented; `src/app/(entry)/onboarding/profile/page.jsx`, `/api/onboarding/profile`, FR-066 |
| `/waiting-room` | Waiting Room (ห้องรอ) | BusinessRoutingShell | the Profile-only resting state: own pending invites, joined Workspaces, token acceptance, owner path Workspace creation | auth required, incomplete profile redirect, loading, error | implemented; `src/app/(entry)/waiting-room/page.jsx`, `/api/onboarding/state`, `/api/workspace-invites/accept`, FR-066/FR-067 |
| `/plugin/authorize` | Plugin Authorization Consent (อนุมัติการเชื่อมต่อปลักอิน) | none — a bare server-rendered page, deliberately outside every shell so nothing about the granting account's scope surrounds a decision about delegating it | state, in server-derived terms only, what a first-party plugin is asking for — its registered name, the capabilities its own viewer resolves to, the exact redirect target and the granting account — and take approval or refusal. Only the POST it submits mints an authorization code (ADR-052 D4) | auth required (→ `/login`), invalid request refused in place without naming or following the `redirect_uri` that failed, session store unavailable stated as an outage rather than a refusal | implemented; `src/app/(entry)/plugin/authorize/page.jsx`, `POST /api/plugin/auth/authorize`, FR-123 |
| `/workspace-home` | Workspace Home | BusinessRoutingShell | joined top-level Workspaces (Portfolio); owner collaboration panel — ACTIVE members with remove, PENDING invites with revoke, and a mint form whose invite code is shown once with copy affordances (AC-067.1/2/7); owner continuation into the FR-020 one-step Business creator; Business Routing link only when Business access exists (AC-066.6) | auth required, incomplete profile redirect, loading, empty, error, session unavailable (503 kept apart from 401 — retry state, no redirect); panel-only states: roster loading, roster refused (same 404 as an absent Workspace), no members, no pending invites, expired-but-revocable invite, minted-code shown once, per-action confirm and server refusal | implemented; `src/app/(entry)/workspace-home/page.jsx`, `src/modules/identity/workspace-collaboration-view.js`, `src/lib/viewer-failure.js`, `/api/onboarding/state`, `/api/workspace-memberships` (GET roster, DELETE remove), `/api/workspace-invites` (POST mint), `/api/workspace-invites/[id]` (DELETE revoke), FR-046, FR-066, FR-067 |
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

### 3.3 CRM domain

The `customer` domain key stopped being a reserved slot on 2026-08-20 (FR-091).
`Customer`, `Conversation` and `Message` had been written by the LINE ingest
seam since FR-023 while the domain advertised no page at all, so the product
received messages it could not show anyone. Both interfaces are read-only: the
reply belongs to the edge runtime that holds the channel (BR-011), and neither
page can issue a write.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/customer` | CRM Dashboard | BusinessShell → CRM / Dashboard | conversation, customer and per-direction message counts, active channels, most recent conversations | ready, empty, loading, error, no-business | implemented beta; `src/app/(pm)/customer/page.jsx`, FR-091 |
| `/customer/conversations` | CRM Inbox | BusinessShell → CRM / Inbox | tenant-scoped conversation list with last-message preview, and the selected thread oldest-first | ready, empty, loading, error, forbidden, no-business; explicitly no reply state | implemented beta; `src/app/(pm)/customer/conversations/page.jsx`, FR-091 |

### 3.4 Market Intelligence domain

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/market` | Market Intelligence Dashboard | BusinessShell → Market Intelligence / Dashboard | translated `MarketObservation` feed for the active Business (provider, source entity, observation type, resolution status) with KPI counts computed from the returned rows; watch rules are shown as a labelled not-yet-available panel with no control | ready, empty, loading, error, forbidden, no Business selected | implemented; `src/app/(pm)/market/page.jsx`, `src/modules/market-intelligence/components/MarketDashboard.jsx`, `GET /api/market/observations`, FR-092 — empty on a live installation until a translation trigger exists |

### 3.5 People and Platform domains

The operational registry has nine domain keys. Platform currently exposes eight
page routes from nine navigation entries because its Dashboard and Settings entries share
`/settings`; one route is one interface row here.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/people` | People Dashboard | BusinessShell → HR / People | People domain landing and directory entry | ready, empty, loading, error, forbidden | implemented; `src/app/(pm)/people/page.jsx`, FR-042 |
| `/people/directory` | People Directory | BusinessShell → HR / People / Directory | Business-scoped people search and view | empty, loading, error, forbidden | implemented; `src/app/(pm)/people/directory/page.jsx`, FR-042 |
| `/platform/product-readiness` | Product Readiness | BusinessShell → Platform / Product Readiness | read-only projection of implementation progress, verified requirements, feature readiness and one example use case per feature | platform-visibility required, auth required, ready, filtered-empty | implemented beta; `src/app/(pm)/platform/product-readiness/page.jsx`, FR-124 |
| `/platform/product-readiness/[domain]` | Product Readiness — domain lane | BusinessShell → Platform / Product Readiness / domain | the same contract scoped to one stable domain key | platform-visibility required, auth required, ready, unknown-domain not-found | implemented beta; `src/app/(pm)/platform/product-readiness/[domain]/page.jsx`, FR-124 |
| `/platform/users` | Users and Permissions | BusinessShell → Platform / Users | OWNER-scoped membership role and domain grants | owner-only, empty, loading, error, forbidden | implemented; `src/app/(pm)/platform/users/page.jsx`, FR-038/062 |
| `/platform/integrations` | Platform Integrations | BusinessShell → Platform / Integrations | owner-only provider/connection metadata and redacted Vault readiness | owner-only, empty, loading, error, manager unavailable; no raw secret state | implemented beta; `src/app/(pm)/platform/integrations/page.jsx`, FR-080 |
| `/platform/customer-import-reviews` | Customer Duplicate Review | BusinessShell → Platform / Customer Review | review held duplicate groups, inspect redacted evidence and append a per-item decision | reviewer-only, empty, loading, error, forbidden, stale-version conflict; no Customer publish | implemented beta; `src/app/(pm)/platform/customer-import-reviews/page.jsx`, FR-078 |
| `/platform/sot-pipeline` | SoT Pipeline Plan Board | BusinessShell → Platform / SoT Pipeline | view the SoT pipeline's P0–P10 phases with status derived from run evidence; navigate to run evidence and the approval inbox | business-scope required, loading, error, empty runs | implemented beta; `src/app/(pm)/platform/sot-pipeline/page.jsx`, FR-099 |
| `/platform/sot-pipeline/graph` | SoT Pipeline Graph | BusinessShell → Platform / SoT Pipeline | read-only node/edge view of the same plan payload with pending-decision badges | business-scope required, loading, error | implemented beta; `src/app/(pm)/platform/sot-pipeline/graph/page.jsx`, FR-101 |
| `/platform/sot-pipeline/inbox` | SoT Approval Inbox | BusinessShell → Platform / SoT Pipeline | approve or reject pending data-plane decisions (reject requires a reason); payload shown verbatim | business-scope required, loading, error, empty queue, action failure | implemented beta; `src/app/(pm)/platform/sot-pipeline/inbox/page.jsx`, FR-100 |
| `/profile` | My Profile | BusinessShell → Platform/identity | resolved local account, language and LINE-link state | auth required, loading, error, empty | implemented beta; `src/app/(pm)/profile/page.jsx`, FR-038 |
| `/settings` | Settings | BusinessShell → Platform / Settings | local preferences and shell/runtime settings | loading, error, ready, forbidden | implemented; `src/app/(pm)/settings/page.jsx`, FR-020 |
| `/audit` | Audit Log | BusinessShell → Platform / Audit | immutable audit event browser and filters | empty, loading, error, forbidden | implemented; `src/app/(pm)/audit/page.jsx`, FR-014 |
| `/backup` | Backup | BusinessShell → Platform / Backup | snapshot export and preview-then-confirm restore | loading, validation, confirmation, error, forbidden | implemented; `src/app/(pm)/backup/page.jsx`, FR-013 |

### 3.6 Asset Management domain

The foundation exposes one guarded, Business-scoped dashboard. Receiving and
register are declared navigation destinations but remain unavailable until their
write/read slices close; the dashboard labels those adapters rather than implying
that OCR, LINE retrieval, live Sheets sync, procurement lookup or Finance posting
is operational.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/assets` | Asset Management Dashboard | BusinessShell → Asset Management / Dashboard | foundation readiness, intake stages, evidence/procurement/lot gates, receiving/template entry and explicit external/Finance boundaries | Business and `assets` domain visibility required, ready, forbidden, configured/snapshot/external-boundary states | implemented beta; `src/app/(pm)/assets/page.jsx`, FR-133..140 / ADR-055/056 |
| `/assets/receiving` | Asset Receiving & Evidence Review | BusinessShell → Asset Management / Receiving | upload verified private evidence, create canonical draft, invoke OCR/Vision candidate, human accept, download/import/export Asset workbook | Business plus `assets` grant and owner/receiver/reviewer capability; idle, uploading, draft, candidate, review, error, `READY_FOR_REGISTRATION` | implemented beta; `src/app/(pm)/assets/receiving/page.jsx`, FR-137..139 / ADR-056 |

### 3.7 Workspace compatibility surfaces

These pages remain routable Project Manager Space surfaces. They are not a second
global collaboration Workspace authority; ADR-027's future onboarding surface is
separately documented.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/workspaces` | Workspace list | BusinessShell → Development/Space compatibility | list and open Spaces | empty, loading, error, forbidden | implemented; `src/app/(pm)/workspaces/page.jsx` |
| `/workspaces/[workspaceId]` | Workspace detail | BusinessShell → Development/Space compatibility | Space metadata and related Projects | not found, loading, error, forbidden | implemented; `src/app/(pm)/workspaces/[workspaceId]/page.jsx` |

### 3.8 Project resource surfaces

All rows below are nested in ProjectResourceShell. Project-local work views are
not new global domains or new persistence aggregates.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/projects/[projectId]` | Project Overview | ProjectResourceShell | Project identity, health, summary and tab entry | not found, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/page.jsx`, FR-043 |
| `/projects/[projectId]/all-work` | Project All Work | ProjectResourceShell → Work | Project-filtered WorkItems and status actions | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/all-work/page.jsx`, FR-005 |
| `/projects/[projectId]/board` | Project Board | ProjectResourceShell → Work | board view over Project work | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/board/page.jsx`, FR-063 |
| `/projects/[projectId]/dependencies` | Project Dependency Map | ProjectResourceShell → Work | contained dependency graph; both endpoints must belong to Project | empty, loading, error, forbidden, graph error | implemented; `src/app/(pm)/projects/[projectId]/dependencies/page.jsx`, FR-040 |
| `/projects/[projectId]/roadmap` | Execution Roadmap | ProjectResourceShell → Work | read-only Project outcome, Business Goals, execution hierarchy, progress, dependencies, blocker evidence, identity references and closure gates | empty, loading, error, forbidden, unavailable fields | implemented; `src/app/(pm)/projects/[projectId]/roadmap/page.jsx`, `tests/unit/project-roadmap-ui.test.js`, FR-068 |
| `/projects/[projectId]/execution/[mode]` | Project Execution Mode | ProjectResourceShell → Work | mode view scoped to opened Project | invalid mode, empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx`, FR-009 |
| `/projects/[projectId]/files` | Project Files | ProjectResourceShell → Files | Project file references and metadata actions | empty, loading, error, forbidden, capability-disabled | implemented; `src/app/(pm)/projects/[projectId]/files/page.jsx`, FR-045 |
| `/projects/[projectId]/import` | Project Plan Import | ProjectResourceShell → Import | validate, dry-run, conflict preview and commit plan | validation, conflict, loading, error, forbidden, success | implemented; `src/app/(pm)/projects/[projectId]/import/page.jsx`, FR-012 |
| `/projects/[projectId]/inventory` | Project Inventory | ProjectResourceShell → Overview | bounded read-only snapshot of work, gates, files, repos, team, progress and activity | not found, loading, error, forbidden, empty/partial/truncated/unavailable | implemented beta; working tree/pending commit for FR-077; `src/app/(pm)/projects/[projectId]/inventory/page.jsx` |
| `/projects/[projectId]/milestones` | Project Milestones and Gates | ProjectResourceShell → Milestones & Gates | Project-local milestone/gate browsing and evidence updates | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/projects/[projectId]/milestones/page.jsx`, FR-006 |
| `/projects/[projectId]/repositories` | Project Repositories | ProjectResourceShell → Repositories | linked repository metadata and link/unlink actions | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/projects/[projectId]/repositories/page.jsx`, FR-008 |
| `/projects/[projectId]/structure` | Structure Plan | ProjectResourceShell → Work | Project → Workstream → Container → WorkItem WBS | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/structure/page.jsx`, FR-040 |
| `/projects/[projectId]/team` | Project Team | ProjectResourceShell → Team | Project team membership view and actions | empty, loading, error, forbidden, validation | implemented; `src/app/(pm)/projects/[projectId]/team/page.jsx`, FR-036 |
| `/projects/[projectId]/timeline` | Project Schedule | ProjectResourceShell → Work | Project-local schedule and dates | empty, loading, error, forbidden | implemented; `src/app/(pm)/projects/[projectId]/timeline/page.jsx`, FR-064 |

### 3.9 Platform Control surface

Platform Control is an installation-operator-only operational surface. It is not
one of the nine operational Business domains (§4), is not configured in `DOMAINS`,
and does not require an active Business selection.

| Route | Interface | Shell/context | Primary content and actions | Required states/access | Status and evidence |
|---|---|---|---|---|---|
| `/control/roadmap` | Platform Programme Roadmap | PlatformControlShell → programme plan snapshot | read-only six-phase / twelve-sprint / thirty-task plan, gates and deliverables; entered from `/settings` (operator-only link) and exits to `/businesses` through the shell header | auth required, loading, forbidden, ready; `isOperator` only; no Business scope | implemented locally; `src/app/(control)/control/roadmap/page.jsx`, FR-105 / ADR-048 |

## 4. Runtime registry reconciliation

The source registry has a shell slot plus operational domains. Counts are stated
explicitly so “domain count” cannot silently mix the two concepts:

| Count | Current value | Source interpretation |
|---|---:|---|
| Source `DOMAINS` entries | 10 | `business-home` plus nine operational domains |
| Operational domain keys | 9 | `commerce`, `customer`, `market`, `growth`, `operations`, `people`, `projects`, `assets`, `platform` |
| Business Home shell slots | 1 | `business-home`, `/overview`, always visible, not an operational domain |
| Source sub-domain entries | 30 | includes Business Home Dashboard |
| Operational sub-domain entries | 29 | excludes Business Home Dashboard |
| Development sub-domain entries | 8 | includes Files and excludes Business Home |
| Asset Management navigation entries | 3 | Dashboard and Receiving are current; Register remains a declared unavailable destination |
| Platform navigation entries | 9 | Dashboard and Settings intentionally share `/settings` |

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
| `src/app/**/page.jsx` | 55 page routes | preflight compares every derived URL to this registry |
| `src/config/domains.js` | 9 operational domains, 29 operational sub-domains, 1 Business Home slot | preflight compares the control marker to the source registry |
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
| 1.4.0b | 2026-09-02 | beta | Added operational Asset Receiving and updated the dashboard/template boundaries; 56 page routes, 9 domains and 29 sub-domain entries | working-tree | RWANG |
| 1.3.0b | 2026-09-02 | candidate | Registered the guarded Asset Management foundation dashboard and reconciled the source registry to 55 page routes, 9 operational domains and 29 operational sub-domain entries; Receiving/Register and provider-backed adapters remain explicitly unavailable | working-tree | Codex |
| 1.2.2b | 2026-08-29 | candidate | Registered the FR-120 Self-Serve Signup screen — before it no unauthenticated visitor could create an account, which also meant no new person could be invited, since an invite needs a Person to attach to — restated `/login` as having two ways out rather than one, and reconciled the marker to 50 page routes | working-tree | ATHER |
| 1.2.1b | 2026-08-29 | candidate | Registered the FR-104 Password Reset Redemption screen — the consume leg had a route and no screen, so a minted token had nowhere to be spent — restated `/login`'s reveal and opt-in persistent session (AC-046-15), and reconciled the marker to 49 page routes | working-tree | ATHER |
| 1.2.0b | 2026-08-20 | candidate | Registered the FR-091 CRM Dashboard and Inbox, the first reader surface over the LINE ingress, and reconciled the counts to 41 page routes / 23 subdomain entries | working-tree | ATHER |
| 1.1.0b | 2026-08-18 | candidate | Added the FR-078 Customer Duplicate Review interface and reconciled the page/domain counts to the live registry | working-tree | ATHER |
| 1.0.0b | 2026-08-18 | candidate | Executed CR-007: bounded the document to a canonical UI registry, reconciled 37 routes and explicit Business Home/domain counts, and added machine-checkable evidence | working-tree | ATHER |
| 0.4.0 | 2026-08-14 | beta | FR-044/FR-046 shell boundary inventory before normalization | historical | ATHER |
