# PM review R4 — views and surfaces

Lens: the screen quietly omits something, and nothing reports it. Scope reviewed:
`src/modules/project-manager/views/`, `src/modules/project-manager/components/`,
`src/app/(pm)/`, plus the API selects those surfaces read. Enum copies already in
`docs/.enum-copy-baseline.json` are excluded per instructions.

## Findings

### F1 — Seven destructive mutations are fire-and-forget: a failed delete/archive shows nothing at all
- **Where** (each is `onClick={async () => { await api(...); reload() }}` or a form submit with no `catch`):
  - `src/modules/project-manager/views/universal/DependenciesView.jsx:126-129` — delete dependency
  - `src/app/(pm)/projects/page.jsx:103-110` — archive project
  - `src/app/(pm)/projects/[projectId]/page.jsx:49-54` — archive project (detail header)
  - `src/app/(pm)/workspaces/page.jsx:139-144` — archive workspace
  - `src/app/(pm)/projects/[projectId]/repositories/page.jsx:106-109` — unlink repository
  - `src/modules/project-manager/components/ManagedFilesPanel.jsx:108` — delete managed-file metadata
  - `src/app/(pm)/files/page.jsx:22` — "Save mount" form submit (`await api('/api/files/mounts', ...)`, no try/catch)
- **What the user sees**: if the request fails (400/403/404/500, network), the promise rejects unhandled. No message, no red state, the row/card stays exactly as it was — the click appears to have done nothing, or worse, appears to have worked until the next reload. On `projects/[projectId]/page.jsx` the redirect to `/projects` runs only on success, so failure = a button that silently does nothing. `api()` throws on every non-ok status (`useApi.js:17-28`), so every server refusal takes this path.
- **Evidence**: routes `/dependencies`, `/projects`, `/projects/[id]`, `/workspaces`, `/projects/[id]/repositories`, `/files`, `/projects/[id]/files` all render these handlers. This is byte-for-byte the `PermissionRow` failure class; the fixed `PermissionRow` (`platform/users/page.jsx:34-38`) even documents why the `catch` is the point of the fix — these seven sites never received it.
- **Severity**: HIGH (failure invisible)
- **Declared requirement it violates**: none — undeclared behaviour, but FR-062's own annotation ("a failed save is reported rather than silently discarded") and BR-001 as cited by FR-059 ("every mutation surfaces the server's exact outcome") state the principle these sites break.

### F2 — Archiving a project leaves its workstreams, work items, milestones and gates alive in every global browser
- **Where**: `src/modules/project-manager/application/project-service.js:151-158` (`archiveProject` soft-deletes only the Project row) vs. `listWorkstreams` (`project-service.js:218-233` — filters `workstream.deletedAt` only), `listWork` (`work-service.js:143-166` — filters item `deletedAt` only), `listMilestonesAndGates` (`milestone-gate-service.js:104-128` — no deletion filter at all), `listDependencies` (`dependency-service.js:101-117`).
- **What the user sees**: the archive confirm says "It disappears from active lists" — and it does disappear from `/projects` — but `/execution/<mode>` still shows the archived project's workstreams as full panels, `/work` still lists its items (status-editable), `/milestones` still lists its milestones and gates (status-editable), `/dependencies` still lists its edges. The user is looking at, counting, and editing work that belongs to a project that no longer exists anywhere they can navigate to.
- **Evidence**: `ExecutionModeView` fetches `/api/workstreams?executionMode=...` (unscoped), `AllWorkView` fetches `/api/work`, `MilestonesView` fetches `/api/milestones` — none of the backing services joins the project's `deletedAt`. Archive is one click away on `/projects`.
- **Severity**: MEDIUM (screens contradict each other; ghost rows remain editable)
- **Declared requirement it violates**: FR-003 (archive/soft delete) read together with FR-005/FR-006/FR-009, whose global browsers claim to show tracked work "across projects" — nothing declares archived projects' children as still-active.

### F3 — Structure Plan (WBS) renders from a tree query that disagrees with every other view
- **Where**: `src/app/api/projects/[id]/tree/route.js:16-31`
- **What the user sees**, two ways:
  1. **Archived workstreams reappear.** The `workstreams` include has no `deletedAt: null` filter (every other list has one — compare `getProject` at `project-service.js:79-82`). Archive a workstream and it vanishes from the project page, boards and execution views but keeps rendering on `/projects/[id]/structure`, its items clickable and editable through the Workpackage modal.
  2. **Containers deeper than two levels vanish.** Only root containers (`parentId: null`) and one level of `children` are included; a child's own `children` are not. A container whose parent itself has a parent — constructible through the plan-import pipeline, which chains `parentCode` freely (`plan-import-service.js:282-287`) — is silently absent from the "canonical work hierarchy", together with all its work items. Those items still appear on the Board and in All Work, so the two Work sub-views disagree with no indication.
- **Evidence**: `/projects/[id]/structure` → `WbsCanvas` → `/api/projects/[id]/tree`. `ContainerNode` (`WbsCanvas.jsx:44-83`) recurses on `container.children`, but the data shape stops feeding it at depth 2.
- **Severity**: MEDIUM (data invisible on the view FR-040 calls canonical; archived data resurrected)
- **Declared requirement it violates**: FR-017 / FR-040 ("Structure Plan renders the opened Project's canonical work hierarchy")

### F4 — Two execution-mode bodies render only their favourite subtype; the rest of the workstream's items appear nowhere
- **Where**: `src/modules/project-manager/views/execution/mode-bodies.jsx:89` (`MigrationMonitor`: `items.filter((i) => i.subtype === 'DATASET' || i.metrics.recordsTotal)`) and `:125` (`SalesPipeline`: `items.filter((i) => i.subtype === 'DEAL' || i.numericValue != null)`)
- **What the user sees**: in a DATA_MIGRATION workstream, `VALIDATION` and `RECONCILIATION` items with no `recordsTotal` metric render in no list, no count, no fallback — the mode contract (`EXECUTION_MODE_CONTRACTS.DATA_MIGRATION.itemSubtypes`, `enums.js:152-157`) explicitly admits those subtypes through the intake pipeline. Same shape in B2B_SALES: `ACCOUNT` and `ACTIVITY` items (also contract-admitted) with no `numericValue` are invisible in the pipeline board. Compare the other five bodies, which render **all** `workstream.items`. The dropped items surface only if the user happens to open All Work — the same "renders in no column, with no error" mechanics as the CANCELLED precedent, applied to subtype instead of status.
- **Evidence**: `/execution/migration`, `/execution/b2b-sales` and their project-scoped twins render these bodies over `listWorkstreams` (which returns every non-deleted item).
- **Severity**: MEDIUM (data invisible in the view that claims the mode)
- **Declared requirement it violates**: FR-009 (seven execution views over the neutral core model) + FR-012/BR-004 (the mode's vocabulary includes those subtypes)

### F5 — A failed /api/scope fetch is an infinite anonymous spinner on every shell page
- **Where**: `src/context/ScopeContext.jsx:42-51` (`catch {}` and silent `if (!res.ok) return`) + `src/lib/business-shell-guard.js:53` (`!scopeLoaded → LOADING`) + `BusinessShellGuard.jsx:42`
- **What the user sees**: if `/api/scope` errors or returns non-ok once, `scope.loaded` stays `false` forever — no retry is scheduled and no state records the failure — so every guarded (pm) route renders `LoadingCard` indefinitely. No error, no retry button, nothing in the UI distinguishes "server down" from "still loading". The comment says "offline-first: shell still renders without scope data", but the guard makes the opposite true: nothing renders.
- **Evidence**: every route under `src/app/(pm)/` is wrapped by `BusinessShellGuard`; entry paths (`/`, `/login`, `/businesses`) bypass.
- **Severity**: MEDIUM (failure looks like loading, permanently)
- **Declared requirement it violates**: none — undeclared behaviour (FR-044 declares the guard states but no failure state for scope)

### F6 — The audit browser cannot filter roughly half of what the audit log actually contains
- **Where**: `src/app/(pm)/audit/page.jsx:10-14` (`ENTITY_TYPES` hand-list, 16 values) vs. actual `recordAudit` writers (grep `entityType:` under `src/modules/` — ~30 distinct values)
- **What the user sees**: the entity-type filter offers PROJECT…SNAPSHOT but the log also contains `MEMBERSHIP`, `FILE_ASSET`, `BUSINESS_ROADMAP`, `BUSINESS_GOAL`, `PROJECT_GOAL`, `AGENT_ACTION`, `CUSTOMER`, `EXTERNAL_IDENTITY`, `CONVERSATION`, `STEP_UP`, `PRINCIPAL`, `LOCAL_WORKSPACE_MOUNT`, `PROJECT_FILE`, `PROJECT_FILE_MIGRATION`, `FILE_RECONCILE`, `FILE_CACHE`, `IDENTITY_LINK_TOKEN`. Those events are reachable only inside the newest 200 rows of "All entity types" (the URL hardcodes `limit=200` with no paging), so on a live tenant the permission-change trail (`MEMBERSHIP` — exactly what an owner audits after FR-038/FR-062 incidents) is effectively unfindable, silently. Not baseline debt: `ENTITY_TYPES` is not an `enums.js` enum, and the baseline entries for this file cover two different lists.
- **Evidence**: route `/audit`; API `/api/audit` accepts any `entityType` — only the dropdown is narrow.
- **Severity**: MEDIUM (recorded data invisible to the surface whose job is showing it)
- **Declared requirement it violates**: FR-014 (audit log immutable + UI browser with entityType filter)

### F7 — All Work and the Project Board silently cap at the 500 most-recently-updated items
- **Where**: `src/modules/project-manager/application/work-service.js:163` (`take: 500`, ordered `updatedAt desc`)
- **What the user sees**: past 500 items in scope, the oldest-updated items simply stop existing on `/work`, `/projects/[id]/all-work` and both boards — column counts shrink, no "showing 500 of N", no paging control. Because the cut is by `updatedAt`, it is precisely the stalest (most at-risk) work that disappears first.
- **Evidence**: `KanbanBoard` and `AllWorkView` both read `/api/work`; nothing in either view or the API response signals truncation.
- **Severity**: MEDIUM (data invisible at scale, silently)
- **Declared requirement it violates**: FR-005 ("browsed … global and project-scoped") — no truncation is declared

### F8 — Business Home project rows render a failed progress fetch as 0 %
- **Where**: `src/app/(pm)/overview/page.jsx:107-121` (`ProjectProgressRow`: `const { data } = useFetch(...)` — `error` never read; bar shows `data?.percent ?? 0`, the number shows `'…'` forever)
- **What the user sees**: if `/api/progress/project/[id]` fails, the row shows a 0 % progress bar and a permanent "…" — indistinguishable from a genuinely-0 % project that is still loading. On the page whose stated purpose is "never report a number a page would disagree with", a failure paints the most alarming possible number with no error.
- **Evidence**: route `/overview` (Business Home), one row per Business project.
- **Severity**: MEDIUM (error state renders as bad data)
- **Declared requirement it violates**: FR-060 / SDD-033 (figures come from the read model; a fabricated 0 is not from any model), spirit of the "progress is always recomputed" rule

### F9 — File Manager: a failed mounts fetch renders as "no mounts", and Relink can silently do nothing
- **Where**: `src/modules/project-manager/components/ManagedFilesPanel.jsx:77-80` (`mounts.error` never checked; only `files.error` gets an ErrorState) and `:113` (Relink: `if (!relativePath || !activeMounts[0]) return` — silent no-op)
- **What the user sees**: if `/api/files/mounts` fails, the panel behaves exactly as if the business has no mounts: "Managed local file" is disabled in the Add dialog, the business tools report "Configure an active device mount first" (wrong diagnosis), and the Relink button — still rendered on every LOCAL_FILE card — prompts for a path and then does nothing at all when there is no active mount, with no message. A rendered control the flow cannot honour, failing silently: the FR-062 class.
- **Evidence**: `/files` and `/projects/[id]/files` both render `ManagedFilesPanel`.
- **Severity**: MEDIUM (error collapses into empty; dead control gives no feedback)
- **Declared requirement it violates**: FR-045 (explicit device mounts are first-class state of this surface); the silent Relink is undeclared behaviour

### F10 — Project page: a project whose workstreams are all ARCHIVED shows a blank Workstreams section — no cards, no empty state
- **Where**: `src/app/(pm)/projects/[projectId]/page.jsx:76-80` — the empty check uses `p.workstreams` (from `getProject`, which includes ARCHIVED) but the rendered list is `progress.data?.workstreams || p.workstreams`, and `computeProjectProgress` excludes `status: 'ARCHIVED'` (`progress-service.js:55`).
- **What the user sees**: normally, ARCHIVED (non-deleted) workstreams silently drop out of the Workstreams grid while `/projects` still counts them in the "Streams" column — the two screens disagree. In the all-ARCHIVED case the guard `length === 0` is false, so no EmptyState renders and the grid maps over an empty array: a heading followed by nothing.
- **Evidence**: route `/projects/[id]`; set a workstream's status to ARCHIVED via its own Edit modal (`WORKSTREAM_STATUSES` offers it) without archiving it.
- **Severity**: LOW (blank section, data reachable via the edit path fallback)
- **Declared requirement it violates**: none — undeclared behaviour

### F11 — A failed /api/viewer fetch silently strips every FR-059 edit control from an OWNER
- **Where**: `src/app/(pm)/overview/page.jsx:312-313` (`viewer.error` never read; `isOwner` degrades to `false`)
- **What the user sees**: if the viewer resolve hiccups, the Business Home strategy card renders in read-only MEMBER shape for a real OWNER — no Create/Edit/Link buttons, no hint anything failed. Fail-closed is the right direction, but nothing distinguishes "you are not an owner" from "we could not find out".
- **Evidence**: route `/overview`; same `useFetch('/api/viewer')` whose error state `BusinessShellGuard` treats as AUTH_REQUIRED, but this second, independent fetch has no such handling.
- **Severity**: LOW (safe direction, silent)
- **Declared requirement it violates**: none — undeclared behaviour (FR-059 declares affordance gating, not failure signalling)

### F12 — Link-repository modal shows an empty dropdown when the repositories fetch failed
- **Where**: `src/app/(pm)/projects/[projectId]/repositories/page.jsx:65-67` (`repos.error` never checked; `repos={repos.data || []}`)
- **What the user sees**: `/api/repositories` failing makes the "Link repository" modal open with an empty required `<select>` — reads as "no repositories registered" (the empty-state hint even says to go register some), and the Link button can never submit. Error rendered as empty.
- **Evidence**: route `/projects/[id]/repositories`, "Link repository" action.
- **Severity**: LOW
- **Declared requirement it violates**: none — undeclared behaviour (FR-008 surface)

## Checked and found sound

- **KanbanBoard (FR-063)**: columns derived from `WORK_STATUSES` with metadata-only map and fallback — the CANCELLED fix holds; loading/error/empty all distinct.
- **Sprint board grouping** (`mode-bodies.jsx:33-54`): exhaustive over `WORK_STATUSES` with a per-status fallback column; cannot repeat the CANCELLED drop.
- **StatusSelect**: catch + inline `role="alert"` error + disabled-while-busy. Correct.
- **PermissionRow** (`platform/users/page.jsx`): the precedent fix is in place — catch, error surfaced, `manageable` gating (FR-062).
- **All create/edit modals** (WorkItemModal, WorkpackageModal, ProjectModal, WorkstreamModal, WorkspaceModal, RepoModal, LinkRepoModal, RoadmapModal, GoalModal, LinkProjectModal): every submit catches and renders the server message; LinkProjectModal branches 409 on `err.status`, not message text.
- **PlanImportPanel / wizard xlsx path**: looks like it skips `res.ok`, but `/api/import/xlsx/route.js` returns `{valid:false, errors:[...]}` on *every* failure path including its catch-all, so errors always surface. Dry-run/commit go through `api()` with catches.
- **Backup page**: export/preview/restore all catch and render; restore is preview-gated and confirm-gated (BR-008).
- **Project Team page** (FR-036): every mutation goes through one `mutate()` with catch + ErrorState; immutable rows render read-only pills, matching server `mutable`.
- **PeopleDirectory (FR-042)**, **AllWorkView**, **MilestonesView**, **DependenciesView list**, **audit/projects/repositories list pages**: loading, error (with retry) and empty are three distinct renders.
- **ProjectDependenciesPage + DependencyMap (FR-040)**: loading/error/empty separated; nodes-without-edges gets its own message.
- **FileManagerViews (FR-058)**: preview eligibility matrix fails to explicit "Preview unavailable · kind · state", never a blank; TextPreview has real error state.
- **`/api/milestones`, `/api/workstreams` selects**: include everything MilestonesView / LaunchTimeline / mode bodies render (no `code · undefined` shape found in the PM surfaces; `listWork` includes `workstream.project` for the board captions).
- **Execution `[mode]` routes**: unknown slugs get an explicit EmptyState, derived from `MODE_SLUGS`.

## Uncertain

- **`STATUS_DOT` maps** in `WorkpackageModal.jsx:13-16` and `WbsCanvas.jsx:14-17` spell all seven `WORK_STATUSES` as object keys. Complete today and presentation-only; WbsCanvas has a grey fallback, WorkpackageModal does not (a future status renders an invisible dot). These look below the enum-copy guard's radar (object keys, not arrays) and are not in the baseline — worth a derive-or-fallback sweep, but no user-visible loss today.
- **F2 intent**: I could not find a declaration either way on whether an archived project's children should remain in global browsers; the archive confirm text ("disappears from active lists") and the CANCELLED-fix philosophy both suggest not, but if the product intends "archive hides only the project row", F2 downgrades to a wording problem on the confirm dialog.
- **F3(b) reachability in practice**: plan-import chains `parentCode` without an explicit depth guard as far as I traced (`plan-import-service.js:282-287`), but I did not run an import to prove a depth-3 container lands; if a validator elsewhere rejects grandparent chains, F3(b) drops to latent.
- **`LinkRepoModal` role list** (`['PRIMARY','REFERENCE','INFRA','DOCS']`, repositories pages): hand-spelled vocabulary, but no corresponding enum exists in `enums.js`, so I could not check it against a source of truth; if the server validates roles from another list, the dropdown can drift.
